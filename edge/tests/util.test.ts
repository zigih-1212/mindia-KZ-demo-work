// Регрессия на баг: сохранение объекта/сметы из UI возвращало HTTP 500.
// Пустой необязательный FK (manager_id, stage_id) писался как "" — D1 проверяет
// внешний ключ и отклоняет пустую строку. «Нет связи» должно быть NULL.
import { describe, expect, it } from "vitest";

import { nullIfEmpty } from "../src/lib/util";

describe("nullIfEmpty (необязательные внешние ключи)", () => {
  it("пустую строку превращает в NULL, а не в ''", () => {
    expect(nullIfEmpty("")).toBeNull();
  });

  it("строку из пробелов тоже считает пустой", () => {
    expect(nullIfEmpty("   ")).toBeNull();
  });

  it("undefined и null превращает в NULL", () => {
    expect(nullIfEmpty(undefined)).toBeNull();
    expect(nullIfEmpty(null)).toBeNull();
  });

  it("непустой идентификатор сохраняет без изменений", () => {
    const id = "b1f3c2a4-0000-4000-8000-000000000001";
    expect(nullIfEmpty(id)).toBe(id);
  });

  it("обрезает пробелы вокруг идентификатора", () => {
    expect(nullIfEmpty("  user-1  ")).toBe("user-1");
  });
});
