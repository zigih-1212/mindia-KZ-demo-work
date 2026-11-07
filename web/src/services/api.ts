import { API_BASE, TOKEN_KEY, USER_KEY } from "../env";
import type {
  AIChatResult,
  AIConversation,
  AIMessage,
  AIUsage,
  Activity,
  DashboardSummary,
  Document,
  Estimate,
  EstimateAnalysis,
  EstimateItem,
  ItemsResult,
  ListResult,
  LoginResult,
  NormativeDoc,
  Project,
  ProjectStage,
  User,
} from "../types";

/** Ошибка HTTP-запроса с телом ответа бэкенда. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field?: string;

  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

// --- Токен и профиль ------------------------------------------------------

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function storeSession(token: string, user: User): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// --- Низкоуровневый запрос -------------------------------------------------

type ErrorBody = { error?: string; message?: string; field?: string };

async function parseError(res: Response): Promise<HttpError> {
  let body: ErrorBody = {};
  try {
    body = (await res.json()) as ErrorBody;
  } catch {
    // тело не JSON — оставляем пустым
  }
  return new HttpError(
    res.status,
    body.error ?? `http_${res.status}`,
    body.message ?? `Ошибка запроса (${res.status})`,
    body.field,
  );
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Не обрабатывать 401 глобально (используется на форме входа). */
  skipAuthRedirect?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401 && !options.skipAuthRedirect) {
    // Сессия истекла — очищаем и отправляем на вход.
    clearSession();
    if (!window.location.pathname.startsWith("/login")) {
      window.location.assign("/login");
    }
  }

  if (!res.ok) throw await parseError(res);

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/** Собирает query-строку, пропуская пустые значения. */
export function withQuery(
  path: string,
  query: Record<string, string | number | undefined | null>,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

// --- Публичный API ---------------------------------------------------------

export interface ProjectQuery {
  status?: string;
  managerId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface EstimateQuery {
  projectId?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface DocumentQuery {
  projectId?: string;
  status?: string;
  type?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export const api = {
  // Аутентификация
  async login(email: string, password: string): Promise<LoginResult> {
    return request<LoginResult>("/api/v1/auth/login", {
      method: "POST",
      body: { email, password },
      skipAuthRedirect: true,
    });
  },

  async register(input: {
    email: string;
    password: string;
    fullName: string;
    position?: string;
    role?: string;
  }): Promise<LoginResult> {
    return request<LoginResult>("/api/v1/auth/register", {
      method: "POST",
      body: input,
      skipAuthRedirect: true,
    });
  },

  async me(): Promise<User> {
    return request<User>("/api/v1/me");
  },

  // Дашборд и активность
  async dashboard(): Promise<DashboardSummary> {
    return request<DashboardSummary>("/api/v1/dashboard");
  },

  async activity(limit = 30): Promise<ItemsResult<Activity>> {
    return request<ItemsResult<Activity>>(withQuery("/api/v1/activity", { limit }));
  },

  // Объекты
  async listProjects(q: ProjectQuery = {}): Promise<ListResult<Project>> {
    return request<ListResult<Project>>(withQuery("/api/v1/projects", { ...q }));
  },

  async getProject(id: string): Promise<Project> {
    return request<Project>(`/api/v1/projects/${id}`);
  },

  async projectStages(id: string): Promise<ItemsResult<ProjectStage>> {
    return request<ItemsResult<ProjectStage>>(`/api/v1/projects/${id}/stages`);
  },

  async createProject(body: Record<string, unknown>): Promise<Project> {
    return request<Project>("/api/v1/projects", { method: "POST", body });
  },

  async updateProject(id: string, body: Record<string, unknown>): Promise<Project> {
    return request<Project>(`/api/v1/projects/${id}`, { method: "PUT", body });
  },

  async deleteProject(id: string): Promise<void> {
    return request<void>(`/api/v1/projects/${id}`, { method: "DELETE" });
  },

  // Сметы
  async listEstimates(q: EstimateQuery = {}): Promise<ListResult<Estimate>> {
    return request<ListResult<Estimate>>(withQuery("/api/v1/estimates", { ...q }));
  },

  async getEstimate(id: string): Promise<Estimate> {
    return request<Estimate>(`/api/v1/estimates/${id}`);
  },

  async estimateItems(id: string): Promise<ItemsResult<EstimateItem>> {
    return request<ItemsResult<EstimateItem>>(`/api/v1/estimates/${id}/items`);
  },

  async createEstimate(body: Record<string, unknown>): Promise<Estimate> {
    return request<Estimate>("/api/v1/estimates", { method: "POST", body });
  },

  async replaceEstimateItems(
    id: string,
    items: Array<Record<string, unknown>>,
  ): Promise<Estimate> {
    return request<Estimate>(`/api/v1/estimates/${id}/items`, {
      method: "PUT",
      body: { items },
    });
  },

  async transitionEstimate(
    id: string,
    status: string,
    expectedVersion: number,
  ): Promise<Estimate> {
    return request<Estimate>(`/api/v1/estimates/${id}/transition`, {
      method: "POST",
      body: { status, expectedVersion },
    });
  },

  async analyzeEstimate(id: string): Promise<EstimateAnalysis> {
    return request<EstimateAnalysis>(`/api/v1/estimates/${id}/analyze`, {
      method: "POST",
    });
  },

  async deleteEstimate(id: string): Promise<void> {
    return request<void>(`/api/v1/estimates/${id}`, { method: "DELETE" });
  },

  // Документы
  async listDocuments(q: DocumentQuery = {}): Promise<ListResult<Document>> {
    return request<ListResult<Document>>(withQuery("/api/v1/documents", { ...q }));
  },

  async getDocument(id: string): Promise<Document> {
    return request<Document>(`/api/v1/documents/${id}`);
  },

  async createDocument(body: Record<string, unknown>): Promise<Document> {
    return request<Document>("/api/v1/documents", { method: "POST", body });
  },

  async transitionDocument(
    id: string,
    status: string,
    expectedVersion: number,
  ): Promise<Document> {
    return request<Document>(`/api/v1/documents/${id}/transition`, {
      method: "POST",
      body: { status, expectedVersion },
    });
  },

  async deleteDocument(id: string): Promise<void> {
    return request<void>(`/api/v1/documents/${id}`, { method: "DELETE" });
  },

  // Нормативная база (публично)
  async listNormative(): Promise<ItemsResult<NormativeDoc>> {
    return request<ItemsResult<NormativeDoc>>("/api/v1/normative");
  },

  // AI-ассистент
  async aiConversations(): Promise<ItemsResult<AIConversation>> {
    return request<ItemsResult<AIConversation>>("/api/v1/ai/conversations");
  },

  async aiMessages(conversationId: string): Promise<ItemsResult<AIMessage>> {
    return request<ItemsResult<AIMessage>>(
      `/api/v1/ai/conversations/${conversationId}/messages`,
    );
  },

  async aiChat(conversationId: string, message: string): Promise<AIChatResult> {
    return request<AIChatResult>("/api/v1/ai/chat", {
      method: "POST",
      body: { conversationId, message },
    });
  },

  async aiUsage(): Promise<AIUsage> {
    return request<AIUsage>("/api/v1/ai/usage");
  },
};
