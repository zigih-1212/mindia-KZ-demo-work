import type {
  DocumentStatus,
  DocumentType,
  EstimateStatus,
  ProjectStatus,
  Role,
  StageStatus,
} from "../types";

// --- Деньги ---------------------------------------------------------------
// На бэкенде суммы — в минорных единицах (тиын = 1/100 тенге).

/** Форматирует минорные единицы в строку вида «1 234 567,89 ₸». */
export function formatMoney(minor: number, withSymbol = true): string {
  const major = minor / 100;
  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(major);
  return withSymbol ? `${formatted} ₸` : formatted;
}

/** Компактный формат для крупных сумм: «1,23 млрд ₸», «4,85 млн ₸». */
export function formatMoneyShort(minor: number): string {
  const major = minor / 100;
  const abs = Math.abs(major);
  const fmt = (v: number, unit: string) =>
    `${new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(v)} ${unit} ₸`;
  if (abs >= 1_000_000_000) return fmt(major / 1_000_000_000, "млрд");
  if (abs >= 1_000_000) return fmt(major / 1_000_000, "млн");
  if (abs >= 1_000) return fmt(major / 1_000, "тыс.");
  return formatMoney(minor);
}

/** Минорные единицы -> число в основных единицах (для полей ввода). */
export function minorToMajor(minor: number): number {
  return Math.round(minor) / 100;
}

/** Основные единицы -> минорные (для отправки на бэкенд).
 * Принимает число или строку из поля ввода; некорректное значение -> 0. */
export function majorToMinor(major: number | string): number {
  const n = typeof major === "string" ? Number(major.replace(",", ".")) : major;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

// --- Даты -----------------------------------------------------------------

/** «12.03.2026» из ISO-строки; пустое значение -> «—». */
export function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/** «12.03.2026, 14:05» из ISO-строки. */
export function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** «5 минут назад», «вчера», «12.03.2026» — относительно now. */
export function formatRelative(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "только что";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} ${plural(min, "минуту", "минуты", "минут")} назад`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} ${plural(hours, "час", "часа", "часов")} назад`;
  const days = Math.round(hours / 24);
  if (days === 1) return "вчера";
  if (days < 30) return `${days} ${plural(days, "день", "дня", "дней")} назад`;
  return formatDate(iso);
}

/** Индекс сегодняшней даты в формате input[type=date] (YYYY-MM-DD). */
export function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

// --- Человекочитаемые подписи справочников --------------------------------

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Администратор",
  manager: "Руководитель проекта",
  estimator: "Сметчик",
  foreman: "Прораб",
  customer: "Заказчик",
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: "Планирование",
  active: "В работе",
  suspended: "Приостановлен",
  completed: "Завершён",
};

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  pending: "Не начат",
  active: "В работе",
  done: "Завершён",
  cancelled: "Отменён",
};

export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  draft: "Черновик",
  on_review: "На проверке",
  approved: "Утверждена",
  rejected: "Отклонена",
  archived: "В архиве",
};

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: "Черновик",
  submitted: "На согласовании",
  approved: "Утверждён",
  rejected: "Отклонён",
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  ks2: "КС-2",
  ks3: "КС-3",
  invoice: "Счёт",
  act: "Акт",
  other: "Прочее",
};

/** Цвет бейджа статуса проекта. */
export function projectStatusTone(status: ProjectStatus): string {
  switch (status) {
    case "active":
      return "bg-emerald-100 text-emerald-800";
    case "planning":
      return "bg-sky-100 text-sky-800";
    case "suspended":
      return "bg-amber-100 text-amber-800";
    case "completed":
      return "bg-slate-200 text-slate-700";
    default:
      return "bg-slate-200 text-slate-700";
  }
}

/** Цвет бейджа статуса сметы. */
export function estimateStatusTone(status: EstimateStatus): string {
  switch (status) {
    case "approved":
      return "bg-emerald-100 text-emerald-800";
    case "on_review":
      return "bg-amber-100 text-amber-800";
    case "rejected":
      return "bg-red-100 text-red-800";
    case "archived":
      return "bg-slate-200 text-slate-600";
    case "draft":
      return "bg-sky-100 text-sky-800";
    default:
      return "bg-slate-200 text-slate-700";
  }
}

/** Цвет бейджа статуса документа. */
export function documentStatusTone(status: DocumentStatus): string {
  switch (status) {
    case "approved":
      return "bg-emerald-100 text-emerald-800";
    case "submitted":
      return "bg-amber-100 text-amber-800";
    case "rejected":
      return "bg-red-100 text-red-800";
    case "draft":
      return "bg-sky-100 text-sky-800";
    default:
      return "bg-slate-200 text-slate-700";
  }
}

/** Цвет бейджа уровня риска/серьёзности аномалии. */
export function severityTone(severity: string): string {
  switch (severity) {
    case "high":
      return "bg-red-100 text-red-800";
    case "medium":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-slate-200 text-slate-700";
  }
}

/** Прогресс «факт/бюджет» в процентах (без переполнения). */
export function utilizationPercent(spentMinor: number, budgetMinor: number): number {
  if (budgetMinor <= 0) return 0;
  return Math.min(999, Math.round((spentMinor / budgetMinor) * 100));
}
