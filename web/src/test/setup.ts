import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Изоляция тестов: сбрасываем DOM и localStorage между кейсами.
afterEach(() => {
  cleanup();
  localStorage.clear();
});
