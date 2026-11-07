// База API задаётся на этапе сборки. На Cloudflare Pages выставляется
// переменной VITE_API_BASE_URL (см. web/.env.example). По умолчанию —
// локальный бэкенд, что удобно для `npm run dev` (прокси в vite.config.ts).
const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

/** Базовый URL API без завершающего слэша. Пустая строка => относительные пути. */
export const API_BASE = raw.replace(/\/+$/, "");

/** Ключи локального хранилища (токен и профиль пользователя). */
export const TOKEN_KEY = "mindia_token";
export const USER_KEY = "mindia_user";
