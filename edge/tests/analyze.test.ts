// Тесты детерминированного анализа смет (зеркало Go estimate_service.Analyze).
import { describe, expect, it } from "vitest";

import { analyzeItems } from "../src/services/analyze";
import type { EstimateItem } from "../src/types";

// item — фабрика позиции сметы.
function item(partial: Partial<EstimateItem>): EstimateItem {
  return {
    id: "i1", estimateId: "e1", position: 1, code: "", name: "Позиция",
    unit: "шт", quantity: 1, unitPriceMinor: 1000, totalMinor: 1000, category: "",
    ...partial,
  };
}

describe("analyzeItems", () => {
  it("пустая смета -> high 'empty', riskScore 20", () => {
    const a = analyzeItems("e1", 0, []);
    expect(a.anomalies).toHaveLength(1);
    expect(a.anomalies[0]).toMatchObject({ severity: "high", kind: "empty" });
    expect(a.riskScore).toBe(20);
  });

  it("дубликат позиции -> medium 'duplicate', riskScore 8", () => {
    const items = [
      item({ id: "i1", name: "Кирпич", quantity: 5, totalMinor: 5000 }),
      item({ id: "i2", position: 2, name: "кирпич ", quantity: 3, totalMinor: 3000 }),
    ];
    const a = analyzeItems("e1", 8000, items);
    const dup = a.anomalies.find((x) => x.kind === "duplicate");
    expect(dup).toBeDefined();
    expect(dup?.severity).toBe("medium");
    expect(dup?.impactMinor).toBe(8000);
    expect(a.riskScore).toBe(8);
  });

  it("нулевая цена -> medium 'non_positive_price', riskScore 8", () => {
    const items = [item({ name: "Бетон", quantity: 10, unitPriceMinor: 0, totalMinor: 0 })];
    const a = analyzeItems("e1", 0, items);
    const z = a.anomalies.find((x) => x.kind === "non_positive_price");
    expect(z).toBeDefined();
    expect(z?.severity).toBe("medium");
    expect(a.riskScore).toBe(8);
  });

  it("нулевое количество -> high 'non_positive_qty'", () => {
    const items = [item({ name: "Арматура", quantity: 0, totalMinor: 0 })];
    const a = analyzeItems("e1", 0, items);
    expect(a.anomalies.some((x) => x.kind === "non_positive_qty" && x.severity === "high")).toBe(true);
  });

  it("арифметическое расхождение -> high 'math_mismatch'", () => {
    const items = [item({ name: "Песок", quantity: 10, unitPriceMinor: 1000, totalMinor: 12000 })];
    const a = analyzeItems("e1", 12000, items);
    expect(a.anomalies.some((x) => x.kind === "math_mismatch" && x.severity === "high")).toBe(true);
    expect(a.riskScore).toBeGreaterThanOrEqual(20);
  });

  it("доминирующая позиция (>40% при >3 позициях) -> medium 'dominant_item'", () => {
    const items = [
      item({ id: "i1", name: "А", totalMinor: 9000 }),
      item({ id: "i2", position: 2, name: "Б", totalMinor: 1000 }),
      item({ id: "i3", position: 3, name: "В", totalMinor: 1000 }),
      item({ id: "i4", position: 4, name: "Г", totalMinor: 1000 }),
    ];
    const a = analyzeItems("e1", 12000, items);
    expect(a.anomalies.some((x) => x.kind === "dominant_item" && x.severity === "medium")).toBe(true);
  });

  it("корректная смета без аномалий -> riskScore 0", () => {
    const items = [
      item({ id: "i1", name: "Кирпич", quantity: 100, unitPriceMinor: 50, totalMinor: 5000 }),
      item({ id: "i2", position: 2, name: "Цемент", quantity: 20, unitPriceMinor: 100, totalMinor: 2000 }),
    ];
    const a = analyzeItems("e1", 7000, items);
    expect(a.anomalies).toHaveLength(0);
    expect(a.riskScore).toBe(0);
    expect(a.totalMinor).toBe(7000);
  });

  it("byCategory агрегирует суммы по категориям", () => {
    const items = [
      item({ id: "i1", name: "А", totalMinor: 5000, category: "материалы" }),
      item({ id: "i2", position: 2, name: "Б", totalMinor: 2000, category: "работы" }),
    ];
    const a = analyzeItems("e1", 7000, items);
    expect(a.byCategory).toHaveLength(2);
    expect(a.byCategory[0]?.category).toBe("материалы");
    expect(a.byCategory[0]?.totalMinor).toBe(5000);
  });
});
