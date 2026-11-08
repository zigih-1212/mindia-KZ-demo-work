// Тесты auth: PBKDF2-хеширование и HS256 JWT (Web Crypto, как в Worker).
import { describe, expect, it } from "vitest";

import { hashPassword, signToken, verifyPassword, verifyToken } from "../src/lib/auth";

const SECRET = "test-secret-key-16chars";

describe("hashPassword/verifyPassword", () => {
  it("roundtrip: верный пароль проходит, неверный — нет", async () => {
    const hash = await hashPassword("demo1234");
    expect(hash).toMatch(/^pbkdf2\$100000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(await verifyPassword("demo1234", hash)).toBe(true);
    expect(await verifyPassword("demo1235", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("контракт с seed: хеш из seed.sql проверяется паролем demo1234", async () => {
    const seeded = "pbkdf2$100000$g6pl6Jr7GLkmXkM7gI-qrA$TuA5345lIdcuGFWMTJyvgOuAplix83aYKq88qQpOab4";
    expect(await verifyPassword("demo1234", seeded)).toBe(true);
    expect(await verifyPassword("demo1234!", seeded)).toBe(false);
  });

  it("одинаковые пароли дают разные хеши (случайная соль)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
  });
});

describe("signToken/verifyToken", () => {
  it("roundtrip: подписанный токен проверяется", async () => {
    const { token, expiresAt } = await signToken({ id: "u1", email: "admin@mindia.kz", role: "admin" }, SECRET);
    expect(expiresAt).toBeTruthy();
    const payload = await verifyToken(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.uid).toBe("u1");
    expect(payload?.email).toBe("admin@mindia.kz");
    expect(payload?.role).toBe("admin");
    expect(payload?.iss).toBe("mindia-kz-demo");
  });

  it("чужой секрет / битый токен -> null", async () => {
    const { token } = await signToken({ id: "u1", email: "a@b.kz", role: "foreman" }, SECRET);
    expect(await verifyToken(token, "another-secret-16chars!")).toBeNull();
    expect(await verifyToken("not-a-jwt", SECRET)).toBeNull();
    expect(await verifyToken("", SECRET)).toBeNull();
  });
});
