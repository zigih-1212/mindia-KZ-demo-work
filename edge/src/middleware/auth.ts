// Middleware аутентификации/авторизации (аналог Go requireRole).
import type { Context, Next } from "hono";
import type { Env, Role, TokenPayload } from "../types";
import { verifyToken } from "../lib/auth";
import { ForbiddenError, UnauthorizedError } from "../lib/errors";

// Контекст с переменной user, которую кладёт requireAuth.
export type Ctx = Context<{ Bindings: Env; Variables: { user: TokenPayload } }>;

export async function requireAuth(c: Ctx, next: Next) {
  const header = c.req.header("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) throw UnauthorizedError();
  const payload = await verifyToken(header.slice(7), c.env.JWT_SECRET);
  if (!payload) throw UnauthorizedError();
  c.set("user", payload);
  await next();
}

export function requireRole(...roles: Role[]) {
  return async (c: Ctx, next: Next) => {
    const u = c.get("user");
    if (!u) throw UnauthorizedError();
    if (!roles.includes(u.role)) throw ForbiddenError();
    await next();
  };
}

export function currentUser(c: Ctx): TokenPayload {
  const u = c.get("user");
  if (!u) throw UnauthorizedError();
  return u;
}
