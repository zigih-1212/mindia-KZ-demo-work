// Общие утилиты edge-версии. Денежные суммы — целые минорные единицы,
// время — строки RFC3339 (UTC), как в Go-бэкенде (backend/ — эталон).

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

// today возвращает текущую дату в формате YYYY-MM-DD (для overdue-проверок).
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// formatMoney — зеркало service.FormatMoney из Go: major.frac без разделителей.
export function formatMoney(minor: number): string {
  const neg = minor < 0;
  const abs = neg ? -minor : minor;
  const major = Math.trunc(abs / 100);
  const frac = abs % 100;
  const out = `${major}.${String(frac).padStart(2, "0")}`;
  return neg ? `-${out}` : out;
}

// Page — зеркало domain.Page.Normalize (лимит по умолчанию 20, максимум 100).
export interface Page {
  limit: number;
  offset: number;
}

export function normalizePage(limitRaw: number | undefined, offsetRaw: number | undefined): Page {
  let limit = limitRaw ?? 20;
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  if (limit > 100) limit = 100;
  let offset = offsetRaw ?? 0;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  return { limit: Math.trunc(limit), offset: Math.trunc(offset) };
}

// Поиск по кириллице: lower() в SQLite/D1 сворачивает только ASCII,
// поэтому поисковый фильтр применяется в JS (повторяет фикс lower() из Go-стора).
export function matchesSearch(haystack: string | null | undefined, search: string): boolean {
  if (!search) return true;
  return (haystack ?? "").toLowerCase().includes(search.toLowerCase());
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

// nullIfEmpty — зеркало store.nullIfEmpty из Go. Необязательные ссылки на
// users(id)/project_stages(id) в схеме объявлены как FK
// (`manager_id TEXT REFERENCES users(id)`, `stage_id TEXT REFERENCES project_stages(id)`).
// Пустая строка не проходит проверку внешнего ключа, поэтому «нет связи» нужно
// писать как NULL, иначе вставка/обновление падает.
export function nullIfEmpty(s: string | null | undefined): string | null {
  const v = (s ?? "").trim();
  return v === "" ? null : v;
}
