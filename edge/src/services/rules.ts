// Бизнес-правила, зеркалящие backend/internal/service (Go — эталон):
// матрицы переходов статусов, права/роли, нормализация позиций сметы.

import { ForbiddenError, ValidationError } from "../lib/errors";
import type { EstimateItem, EstimateStatus, DocumentStatus, Role } from "../types";

// --- RBAC (5 ролей, явные возможности) ---
// admin     — полный доступ.
// manager   — управление проектами, сметы/документы, согласование.
// estimator — сметы (создание/правка/отправка на проверку), просмотр остального.
// foreman   — документы (создание/правка/отправка), просмотр остального.
// customer  — только просмотр (read-only) + AI.

export function canManageProjects(role: Role): boolean {
  return role === "admin" || role === "manager";
}

export function canApprove(role: Role): boolean {
  return role === "admin" || role === "manager";
}

export function canEditEstimates(role: Role): boolean {
  return role === "admin" || role === "manager" || role === "estimator";
}

export function canEditDocuments(role: Role): boolean {
  return role === "admin" || role === "manager" || role === "foreman";
}

export function isReadOnly(role: Role): boolean {
  return role === "customer";
}

export function assertCanManageProjects(role: Role): void {
  if (!canManageProjects(role)) throw ForbiddenError();
}
export function assertCanEditEstimates(role: Role): void {
  if (!canEditEstimates(role)) throw ForbiddenError();
}
export function assertCanEditDocuments(role: Role): void {
  if (!canEditDocuments(role)) throw ForbiddenError();
}
export function assertCanApprove(role: Role): void {
  if (!canApprove(role)) throw ForbiddenError();
}

// Кто может выполнить переход статуса (помимо матрицы переходов).
export function canTransitionEstimate(role: Role, from: EstimateStatus, to: EstimateStatus): boolean {
  if (to === "approved" || to === "rejected") return canApprove(role);
  if (to === "archived") return canApprove(role); // архивация — управленческое решение
  // draft<->on_review (отправка/возврат в работу) — сметчик и выше
  if (to === "on_review" || (from === "on_review" && to === "draft") || (from === "rejected" && to === "draft")) {
    return canEditEstimates(role);
  }
  return canEditEstimates(role);
}

export function canTransitionDocument(role: Role, _from: DocumentStatus, to: DocumentStatus): boolean {
  if (to === "approved" || to === "rejected") return canApprove(role);
  // draft->submitted, rejected->draft — автор документа (прораб) и выше
  return canEditDocuments(role);
}

const ESTIMATE_TRANSITIONS: Record<EstimateStatus, EstimateStatus[]> = {
  draft: ["on_review", "archived"],
  on_review: ["approved", "rejected", "draft"],
  rejected: ["draft", "archived"],
  approved: ["archived"],
  archived: [],
};

const DOCUMENT_TRANSITIONS: Record<DocumentStatus, DocumentStatus[]> = {
  draft: ["submitted"],
  submitted: ["approved", "rejected"],
  rejected: ["draft"],
  approved: [],
};

export function estimateCanTransition(from: EstimateStatus, to: EstimateStatus): boolean {
  return ESTIMATE_TRANSITIONS[from].includes(to);
}

export function documentCanTransition(from: DocumentStatus, to: DocumentStatus): boolean {
  return DOCUMENT_TRANSITIONS[from].includes(to);
}

// Изменение позиций/удаление запрещено после согласования или архивации.
export function estimateEditable(status: EstimateStatus): boolean {
  return status === "draft" || status === "on_review" || status === "rejected";
}

export function documentEditable(status: DocumentStatus): boolean {
  return status === "draft" || status === "rejected";
}

export interface RawItemInput {
  code?: unknown;
  name?: unknown;
  unit?: unknown;
  quantity?: unknown;
  unitPriceMinor?: unknown;
  category?: unknown;
}

// normalizeItems — зеркало EstimateService.normalizeItems: валидация входа,
// пересчёт total = round(qty * price), позиции с 1. Ошибки — как в Go (422).
export function normalizeItems(raw: unknown): EstimateItem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw ValidationError("items", "смета должна содержать хотя бы одну позицию");
  }
  const out: EstimateItem[] = [];
  raw.forEach((r, i) => {
    const src = (r ?? {}) as RawItemInput;
    const name = typeof src.name === "string" ? src.name.trim() : "";
    if (!name) throw ValidationError("items", `позиция ${i + 1}: укажите наименование`);
    const quantity = typeof src.quantity === "number" ? src.quantity : Number(src.quantity);
    const unitPriceMinor = typeof src.unitPriceMinor === "number" ? src.unitPriceMinor : Number(src.unitPriceMinor);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw ValidationError("items", `позиция ${i + 1}: количество должно быть неотрицательным`);
    }
    if (!Number.isFinite(unitPriceMinor) || unitPriceMinor < 0) {
      throw ValidationError("items", `позиция ${i + 1}: цена должна быть неотрицательной`);
    }
    out.push({
      id: "",
      estimateId: "",
      position: i + 1,
      code: typeof src.code === "string" ? src.code.trim() : "",
      name,
      unit: typeof src.unit === "string" ? src.unit.trim() : "",
      quantity,
      unitPriceMinor: Math.round(unitPriceMinor),
      totalMinor: Math.round(quantity * unitPriceMinor),
      category: typeof src.category === "string" ? src.category.trim() : "",
    });
  });
  return out;
}

export function itemsTotal(items: EstimateItem[]): number {
  return items.reduce((acc, it) => acc + it.totalMinor, 0);
}
