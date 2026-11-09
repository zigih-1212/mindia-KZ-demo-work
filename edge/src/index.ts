// Hono-роутер edge-двойника: тот же HTTP-контракт, что и Go-бэкенд
// (backend/internal/api/server.go + handlers_*). Деньги — числа в минорных
// единицах (*Minor), время — строки RFC3339, ошибки — {error,message,field?}.
// Статика SPA отдаётся через [assets] из wrangler.toml (binding ASSETS),
// поэтому роутер обрабатывает только /api/v1/* и /healthz.
import { Hono, type Context } from "hono";

import { BUDGET_TOKENS } from "./ai/offline";
import { ask } from "./ai/assistant";
import {
  signToken,
  verifyPassword,
  hashPassword,
} from "./lib/auth";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PreconditionError,
  UnauthorizedError,
  ValidationError,
  VersionMismatchError,
  errorHandler,
} from "./lib/errors";
import { newId, normalizePage, nowIso } from "./lib/util";
import { requireAuth, requireRole, currentUser } from "./middleware/auth";
import { AIRepo, ActivityRepo, NormativeRepo } from "./repositories/misc";
import { DocumentRepo } from "./repositories/documents";
import { EstimateRepo } from "./repositories/estimates";
import { ProjectRepo } from "./repositories/projects";
import { UserRepo } from "./repositories/users";
import {
  analyzeItems,
} from "./services/analyze";
import {
  canEditDocuments,
  canEditEstimates,
  canTransitionDocument,
  canTransitionEstimate,
  documentCanTransition,
  estimateCanTransition,
  estimateEditable,
  normalizeItems,
  itemsTotal,
} from "./services/rules";
import type {
  DocumentStatus,
  DocumentType,
  Env,
  EstimateStatus,
  ProjectStatus,
  Role,
  TokenPayload,
} from "./types";

type Ctx = Context<{ Bindings: Env; Variables: { user: TokenPayload } }>;
type H = (c: Ctx) => Promise<Response> | Response;

const PROJECT_STATUSES: ProjectStatus[] = ["planning", "active", "suspended", "completed"];
const ESTIMATE_STATUSES: EstimateStatus[] = ["draft", "on_review", "approved", "rejected", "archived"];
const DOCUMENT_STATUSES: DocumentStatus[] = ["draft", "submitted", "approved", "rejected"];
const DOCUMENT_TYPES: DocumentType[] = ["ks2", "ks3", "invoice", "act", "other"];
const ROLES: Role[] = ["admin", "manager", "estimator", "foreman", "customer"];

// deps — репозитории поверх D1. Объекты дешёвые, создаём на каждый запрос.
function deps(c: Ctx) {
  const db = c.env.DB;
  return {
    users: new UserRepo(db),
    projects: new ProjectRepo(db),
    estimates: new EstimateRepo(db),
    documents: new DocumentRepo(db),
    normative: new NormativeRepo(db),
    activity: new ActivityRepo(db),
    ai: new AIRepo(db),
  };
}

// readBody — парсинг JSON-тела; некорректный JSON -> 422.
async function readBody<T>(c: Ctx): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw ValidationError("body", "некорректное JSON-тело");
  }
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

// param — параметр пути; отсутствие трактуем как not_found.
function param(c: Ctx, name: string): string {
  const v = c.req.param(name);
  if (!v) throw NotFoundError();
  return v;
}

// actorOf — текущий пользователь из БД (для имён в activity и проверок роли).
async function actorOf(c: Ctx) {
  const payload = currentUser(c);
  const me = await deps(c).users.getByID(payload.uid);
  if (!me || !me.isActive) throw UnauthorizedError();
  return me;
}

// authed / guarded — обёртки хендлеров вместо глобального middleware,
// чтобы публичные маршруты (/auth/*, /normative) не требовали токен.
const authed = (h: H): H => async (c) => {
  await requireAuth(c, async () => {});
  return h(c);
};
const guarded = (...roles: Role[]) => (h: H): H => async (c) => {
  await requireAuth(c, async () => {});
  await requireRole(...roles)(c, async () => {});
  return h(c);
};

async function logActivity(
  c: Ctx,
  actor: { id: string; fullName: string },
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
) {
  await deps(c).activity.add({
    actorId: actor.id,
    actorName: actor.fullName,
    action,
    entityType,
    entityId,
    summary,
  });
}

export const app = new Hono<{ Bindings: Env; Variables: { user: TokenPayload } }>();

app.onError((err, c) => errorHandler(err));
app.notFound((c) => c.json({ error: "not_found", message: "маршрут не найден" }, 404));

// ---------- Публичные маршруты ----------

app.get("/healthz", (c) => c.json({ status: "ok", aiEnabled: true }));

app.post("/api/v1/auth/login", async (c) => {
  const body = await readBody<{ email?: string; password?: string }>(c);
  const email = str(body.email).toLowerCase();
  const password = str(body.password);
  if (!email || !password) throw ValidationError("credentials", "укажите email и пароль");

  const d = deps(c);
  const user = await d.users.getByEmail(email);
  // Существование аккаунта не раскрываем: неверный email и неверный пароль неотличимы.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw UnauthorizedError();
  }
  if (!user.isActive) throw new AppError(412, "precondition_failed", "учётная запись отключена");

  const { token, expiresAt } = await signToken(user, c.env.JWT_SECRET);
  const { passwordHash: _ph, ...authUser } = user;
  return c.json({ token, expiresAt, user: authUser });
});

app.post("/api/v1/auth/register", async (c) => {
  const body = await readBody<{
    email?: string; password?: string; fullName?: string; position?: string; role?: string;
  }>(c);
  const email = str(body.email).toLowerCase();
  const password = str(body.password);
  const fullName = str(body.fullName);
  const position = str(body.position);
  if (!email.includes("@")) throw ValidationError("email", "укажите корректный email");
  if (password.length < 8) throw ValidationError("password", "пароль должен быть не короче 8 символов");
  if (!fullName) throw ValidationError("fullName", "укажите имя");
  // Публичная регистрация: роль всегда foreman (нельзя эскалировать привилегии).
  const role: Role = "foreman";

  const d = deps(c);
  if (await d.users.getByEmail(email)) throw ConflictError();
  const created = await d.users.create({
    email,
    passwordHash: await hashPassword(password),
    fullName,
    position,
    role,
  });
  const { token, expiresAt } = await signToken(created, c.env.JWT_SECRET);
  const { passwordHash: _ph, ...authUser } = created;
  return c.json({ token, expiresAt, user: authUser }, 201);
});

app.get("/api/v1/normative", async (c) => {
  const page = normalizePage(
    c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    c.req.query("offset") ? Number(c.req.query("offset")) : undefined,
  );
  const items = await deps(c).normative.search(c.req.query("q") ?? "", page.limit);
  return c.json({ items });
});

// ---------- Защищённые маршруты ----------

app.get("/api/v1/me", authed(async (c) => {
  const me = await actorOf(c);
  const { passwordHash: _ph, ...user } = me;
  return c.json(user);
}));

app.get("/api/v1/dashboard", authed(async (c) => {
  const d = deps(c);
  const sum = await d.projects.summary();
  sum.recentActivity = await d.activity.recent(10);
  sum.generatedAt = nowIso();
  return c.json(sum);
}));

app.get("/api/v1/activity", authed(async (c) => {
  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Math.min(Math.max(Number(limitRaw) || 20, 1), 100) : 20;
  const items = await deps(c).activity.recent(limit);
  return c.json({ items });
}));

// ---------- Объекты ----------

app.get("/api/v1/projects", authed(async (c) => {
  const status = str(c.req.query("status"));
  if (status && !PROJECT_STATUSES.includes(status as ProjectStatus)) {
    throw ValidationError("status", "неизвестный статус");
  }
  const page = normalizePage(
    c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    c.req.query("offset") ? Number(c.req.query("offset")) : undefined,
  );
  const res = await deps(c).projects.list(
    { status: status || undefined, managerId: str(c.req.query("managerId")) || undefined, search: c.req.query("search") ?? "" },
    page,
  );
  return c.json(res);
}));

app.post("/api/v1/projects", guarded("admin", "manager")(async (c) => {
  const body = await readBody<Record<string, unknown>>(c);
  const code = str(body.code);
  const name = str(body.name);
  const budgetMinor = num(body.budgetMinor);
  const status = str(body.status) || "planning";
  if (!code) throw ValidationError("code", "укажите код объекта");
  if (!name) throw ValidationError("name", "укажите название объекта");
  if (budgetMinor < 0) throw ValidationError("budgetMinor", "бюджет не может быть отрицательным");
  if (!PROJECT_STATUSES.includes(status as ProjectStatus)) throw ValidationError("status", "неизвестный статус объекта");

  const d = deps(c);
  if (await d.projects.codeExists(code)) throw ConflictError();
  const created = await d.projects.create({
    code,
    name,
    customer: str(body.customer),
    address: str(body.address),
    status: status as ProjectStatus,
    budgetMinor,
    contractAmountMinor: num(body.contractAmountMinor),
    startDate: str(body.startDate),
    plannedEndDate: str(body.plannedEndDate),
    actualEndDate: str(body.actualEndDate),
    managerId: str(body.managerId),
    progressPercent: num(body.progressPercent),
  });
  const me = await actorOf(c);
  await logActivity(c, me, "create", "project", created.id, `Создан объект ${created.code}`);
  return c.json(created, 201);
}));

app.get("/api/v1/projects/:id", authed(async (c) => {
  return c.json(await deps(c).projects.mustGet(param(c, "id")));
}));

app.put("/api/v1/projects/:id", guarded("admin", "manager")(async (c) => {
  const id = param(c, "id");
  const d = deps(c);
  const existing = await d.projects.mustGet(id);

  const body = await readBody<Record<string, unknown>>(c);
  const name = str(body.name);
  const budgetMinor = num(body.budgetMinor);
  const status = str(body.status) || existing.status;
  const actualEndDate = str(body.actualEndDate);
  if (!name) throw ValidationError("name", "укажите название объекта");
  if (budgetMinor < 0) throw ValidationError("budgetMinor", "бюджет не может быть отрицательным");
  if (!PROJECT_STATUSES.includes(status as ProjectStatus)) throw ValidationError("status", "неизвестный статус объекта");
  if (actualEndDate && status !== "completed") {
    throw ValidationError("actualEndDate", "дата завершения допустима только для завершённого объекта");
  }
  const version = num(body.version) || existing.version;

  const updated = await d.projects.update(id, {
    code: str(body.code) || existing.code,
    name,
    customer: str(body.customer),
    address: str(body.address),
    status: status as ProjectStatus,
    budgetMinor,
    contractAmountMinor: num(body.contractAmountMinor),
    startDate: str(body.startDate),
    plannedEndDate: str(body.plannedEndDate),
    actualEndDate,
    managerId: str(body.managerId),
    progressPercent: num(body.progressPercent),
    version,
  });
  const me = await actorOf(c);
  await logActivity(c, me, "update", "project", id, `Изменён объект ${updated.code}`);
  return c.json(updated);
}));

app.delete("/api/v1/projects/:id", guarded("admin", "manager")(async (c) => {
  const id = param(c, "id");
  const d = deps(c);
  const existing = await d.projects.mustGet(id);
  await d.projects.del(id);
  const me = await actorOf(c);
  await logActivity(c, me, "delete", "project", id, `Удалён объект ${existing.code}`);
  return c.body(null, 204);
}));

app.get("/api/v1/projects/:id/stages", authed(async (c) => {
  const items = await deps(c).projects.stages(param(c, "id"));
  return c.json({ items });
}));

// ---------- Сметы ----------

app.get("/api/v1/estimates", authed(async (c) => {
  const status = str(c.req.query("status"));
  if (status && !ESTIMATE_STATUSES.includes(status as EstimateStatus)) {
    throw ValidationError("status", "неизвестный статус");
  }
  const page = normalizePage(
    c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    c.req.query("offset") ? Number(c.req.query("offset")) : undefined,
  );
  const res = await deps(c).estimates.list(
    {
      projectId: str(c.req.query("projectId")) || undefined,
      status: status || undefined,
      search: c.req.query("search") ?? "",
    },
    page,
  );
  return c.json(res);
}));

app.post("/api/v1/estimates", authed(async (c) => {
  const body = await readBody<Record<string, unknown>>(c);
  const projectId = str(body.projectId);
  const number = str(body.number);
  const name = str(body.name);
  if (!projectId) throw ValidationError("projectId", "укажите объект");
  if (!number) throw ValidationError("number", "укажите номер сметы");
  if (!name) throw ValidationError("name", "укажите название сметы");

  const d = deps(c);
  const me = await actorOf(c);
  if (!canEditEstimates(me.role)) throw ForbiddenError();
  await d.projects.mustGet(projectId); // 404, если объект не существует
  const items = normalizeItems(body.items);
  if (await d.estimates.duplicateExists(projectId, number)) throw ConflictError();

  const created = await d.estimates.create(
    {
      projectId,
      stageId: str(body.stageId) || "",
      number,
      name,
      currency: str(body.currency) || "KZT",
      totalMinor: itemsTotal(items),
      createdBy: me.id,
    },
    items,
  );
  await logActivity(c, me, "create", "estimate", created.id, `Создана смета ${created.number}`);
  return c.json(created, 201);
}));

app.get("/api/v1/estimates/:id", authed(async (c) => {
  return c.json(await deps(c).estimates.mustGet(param(c, "id")));
}));

app.get("/api/v1/estimates/:id/items", authed(async (c) => {
  const items = await deps(c).estimates.items(param(c, "id"));
  return c.json({ items });
}));

app.put("/api/v1/estimates/:id/items", authed(async (c) => {
  const id = param(c, "id");
  const d = deps(c);
  const me = await actorOf(c);
  if (!canEditEstimates(me.role)) throw ForbiddenError();
  const e = await d.estimates.mustGet(id);
  if (!estimateEditable(e.status)) {
    throw PreconditionError();
  }
  const items = normalizeItems((await readBody<{ items?: unknown }>(c)).items);
  await d.estimates.replaceItems(id, items);
  await logActivity(c, me, "update", "estimate", id, `Обновлены позиции сметы ${e.number}`);
  return c.json(await d.estimates.mustGet(id));
}));

app.post("/api/v1/estimates/:id/transition", authed(async (c) => {
  const id = param(c, "id");
  const d = deps(c);
  const me = await actorOf(c);
  const e = await d.estimates.mustGet(id);

  const body = await readBody<{ status?: string; expectedVersion?: number }>(c);
  const target = str(body.status) as EstimateStatus;
  const expected = num(body.expectedVersion);
  if (expected !== 0 && expected !== e.version) throw VersionMismatchError();
  if (!ESTIMATE_STATUSES.includes(target)) throw ValidationError("status", "неизвестный статус сметы");
  if (!estimateCanTransition(e.status, target)) {
    throw new AppError(412, "precondition_failed", `переход ${e.status} → ${target} недопустим`);
  }
  if (!canTransitionEstimate(me.role, e.status, target)) throw ForbiddenError();

  await d.estimates.updateStatus(id, target, target === "approved" ? me.id : "", e.version);
  await logActivity(c, me, "status", "estimate", id, `Смета ${e.number}: ${e.status} → ${target}`);
  return c.json(await d.estimates.mustGet(id));
}));

app.post("/api/v1/estimates/:id/analyze", authed(async (c) => {
  const d = deps(c);
  const me = await actorOf(c);
  if (!canEditEstimates(me.role)) throw ForbiddenError();
  const e = await d.estimates.mustGet(param(c, "id"));
  const items = await d.estimates.items(e.id);
  return c.json(analyzeItems(e.id, e.totalMinor, items));
}));

app.delete("/api/v1/estimates/:id", authed(async (c) => {
  const id = param(c, "id");
  const d = deps(c);
  const me = await actorOf(c);
  if (!canEditEstimates(me.role)) throw ForbiddenError();
  const e = await d.estimates.mustGet(id);
  if (e.status === "approved") throw PreconditionError();
  await d.estimates.del(id);
  await logActivity(c, me, "delete", "estimate", id, `Удалена смета ${e.number}`);
  return c.body(null, 204);
}));

// ---------- Документы ----------

app.get("/api/v1/documents", authed(async (c) => {
  const status = str(c.req.query("status"));
  if (status && !DOCUMENT_STATUSES.includes(status as DocumentStatus)) {
    throw ValidationError("status", "неизвестный статус");
  }
  const type = str(c.req.query("type"));
  if (type && !DOCUMENT_TYPES.includes(type as DocumentType)) {
    throw ValidationError("type", "неизвестный тип");
  }
  const page = normalizePage(
    c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    c.req.query("offset") ? Number(c.req.query("offset")) : undefined,
  );
  const res = await deps(c).documents.list(
    {
      projectId: str(c.req.query("projectId")) || undefined,
      status: status || undefined,
      type: type || undefined,
      search: c.req.query("search") ?? "",
    },
    page,
  );
  return c.json(res);
}));

app.post("/api/v1/documents", authed(async (c) => {
  const body = await readBody<Record<string, unknown>>(c);
  const projectId = str(body.projectId);
  const type = str(body.type);
  const number = str(body.number);
  const title = str(body.title);
  const amountMinor = num(body.amountMinor);
  if (!projectId) throw ValidationError("projectId", "укажите объект");
  if (!DOCUMENT_TYPES.includes(type as DocumentType)) throw ValidationError("type", "неизвестный тип документа");
  if (!number) throw ValidationError("number", "укажите номер документа");
  if (!title) throw ValidationError("title", "укажите название документа");
  if (amountMinor < 0) throw ValidationError("amountMinor", "сумма не может быть отрицательной");

  const d = deps(c);
  const me = await actorOf(c);
  if (!canEditDocuments(me.role)) throw ForbiddenError();
  await d.projects.mustGet(projectId); // 404
  const created = await d.documents.create({
    projectId,
    type: type as DocumentType,
    number,
    title,
    periodFrom: str(body.periodFrom),
    periodTo: str(body.periodTo),
    amountMinor,
    createdBy: me.id,
  });
  await logActivity(c, me, "create", "document", created.id, `Создан документ ${created.number}`);
  return c.json(created, 201);
}));

app.get("/api/v1/documents/:id", authed(async (c) => {
  return c.json(await deps(c).documents.mustGet(param(c, "id")));
}));

app.post("/api/v1/documents/:id/transition", authed(async (c) => {
  const id = param(c, "id");
  const d = deps(c);
  const me = await actorOf(c);
  const doc = await d.documents.mustGet(id);

  const body = await readBody<{ status?: string; expectedVersion?: number }>(c);
  const target = str(body.status) as DocumentStatus;
  const expected = num(body.expectedVersion);
  if (expected !== 0 && expected !== doc.version) throw VersionMismatchError();
  if (!DOCUMENT_STATUSES.includes(target)) throw ValidationError("status", "неизвестный статус документа");
  if (!documentCanTransition(doc.status, target)) {
    throw new AppError(412, "precondition_failed", `переход ${doc.status} → ${target} недопустим`);
  }
  if (!canTransitionDocument(me.role, doc.status, target)) throw ForbiddenError();

  await d.documents.updateStatus(id, target, target === "approved" ? me.id : "", doc.version);
  // Утверждённые КС-2/КС-3 увеличивают фактические затраты объекта (как в Go).
  if (target === "approved" && (doc.type === "ks2" || doc.type === "ks3") && doc.amountMinor > 0) {
    await d.projects.addSpent(doc.projectId, doc.amountMinor);
  }
  await logActivity(c, me, "status", "document", id, `Документ ${doc.type.toUpperCase()} ${doc.number}: ${doc.status} → ${target}`);
  return c.json(await d.documents.mustGet(id));
}));

app.delete("/api/v1/documents/:id", authed(async (c) => {
  const id = param(c, "id");
  const d = deps(c);
  const me = await actorOf(c);
  if (!canEditDocuments(me.role)) throw ForbiddenError();
  const doc = await d.documents.mustGet(id);
  if (doc.status === "approved") throw PreconditionError();
  await d.documents.del(id);
  await logActivity(c, me, "delete", "document", id, `Удалён документ ${doc.number}`);
  return c.body(null, 204);
}));

// ---------- AI-ассистент (LLM с fallback + офлайн-режим) ----------

app.get("/api/v1/ai/conversations", authed(async (c) => {
  const user = currentUser(c);
  const items = await deps(c).ai.listConversations(user.uid, 50);
  return c.json({ items });
}));

app.post("/api/v1/ai/chat", authed(async (c) => {
  const body = await readBody<{ conversationId?: string; message?: string }>(c);
  const message = str(body.message);
  if (!message) throw ValidationError("message", "укажите сообщение");
  const user = currentUser(c);
  const d = deps(c);
  const res = await ask(
    { projects: d.projects, estimates: d.estimates, documents: d.documents, normative: d.normative, ai: d.ai },
    c.env,
    { uid: user.uid },
    str(body.conversationId),
    message,
  );
  return c.json(res);
}));

app.get("/api/v1/ai/conversations/:id/messages", authed(async (c) => {
  const user = currentUser(c);
  const d = deps(c);
  await d.ai.assertOwner(param(c, "id"), user.uid); // чужой диалог -> 403
  const items = await d.ai.listMessages(param(c, "id"), 200);
  return c.json({ items });
}));

app.get("/api/v1/ai/usage", authed(async (c) => {
  const usage = await deps(c).ai.usage();
  return c.json({ ...usage, limitTotal: BUDGET_TOKENS });
}));

export default {
  async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    return app.fetch(request, env, ctx as never);
  },
};
