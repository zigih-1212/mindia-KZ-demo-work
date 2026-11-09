import type { Role } from "../types";

// Зеркало edge/src/services/rules.ts — для управления UI (кнопки/разделы).
// Источник истины по доступу — API; UI только скрывает недоступные действия.

export function canManageProjects(role?: Role): boolean {
  return role === "admin" || role === "manager";
}
export function canApprove(role?: Role): boolean {
  return role === "admin" || role === "manager";
}
export function canEditEstimates(role?: Role): boolean {
  return role === "admin" || role === "manager" || role === "estimator";
}
export function canEditDocuments(role?: Role): boolean {
  return role === "admin" || role === "manager" || role === "foreman";
}
export function isReadOnly(role?: Role): boolean {
  return role === "customer";
}
