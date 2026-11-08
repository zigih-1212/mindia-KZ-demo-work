import { defineConfig } from "vitest/config";

// Чистые unit-тесты (node): анализ смет, матрицы переходов, PBKDF2/JWT (Web
// Crypto есть в Node 24), маршрутизация офлайн-ассистента. Интеграционный
// прогон через workerd тяжёл для локальной машины — контракт дополнительно
// проверяется smoke-тестами wrangler dev.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
  },
});
