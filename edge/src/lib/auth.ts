// Аутентификация edge-двойника: PBKDF2 (Web Crypto) для паролей и HS256 JWT
// с тем же payload'ом, что у Go (uid, email, role, iss=mindia-kz-demo, TTL 12h).
// bcrypt недоступен в Workers — PBKDF2-хеши живут только в этой БД.

import type { Role, TokenPayload } from "../types";

const PBKDF2_ITERATIONS = 100_000;
const JWT_TTL_SECONDS = 12 * 3600;
const ISSUER = "mindia-kz-demo";

const enc = new TextEncoder();

function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64urlEncode(salt)}$${b64urlEncode(bits)}`;
}

// Постоянная времени для timing-safe сравнения (устойчивость к замеру времени).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const salt = b64urlDecode(parts[2]!);
  const expected = parts[3]!;
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return timingSafeEqual(b64urlEncode(bits), expected);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signToken(user: { id: string; email: string; role: Role }, secret: string): Promise<{ token: string; expiresAt: string }> {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    uid: user.id, email: user.email, role: user.role,
    iss: ISSUER, iat: now, exp: now + JWT_TTL_SECONDS,
  };
  const header = b64urlEncode(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${body}`));
  return {
    token: `${header}.${body}.${b64urlEncode(sig)}`,
    expiresAt: new Date((now + JWT_TTL_SECONDS) * 1000).toISOString(),
  };
}

export async function verifyToken(token: string, secret: string): Promise<TokenPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify(
    "HMAC", key,
    b64urlDecode(sig),
    enc.encode(`${header}.${body}`),
  );
  if (!ok) return null;
  let payload: TokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as TokenPayload;
  } catch {
    return null;
  }
  if (payload.iss !== ISSUER || payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}
