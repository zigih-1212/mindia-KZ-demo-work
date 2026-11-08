// Тесты бизнес-правил: матрицы переходов, RBAC, нормализация позиций.
import { describe, expect, it } from "vitest";

import {
  canApprove,
  documentCanTransition,
  documentEditable,
  estimateCanTransition,
  estimateEditable,
  itemsTotal,
  normalizeItems,
} from "../src/services/rules";
import { AppError } from "../src/lib/errors";

describe("матрица переходов смет", () => {
  it("разрешённые переходы", () => {
    expect(estimateCanTransition("draft", "on_review")).toBe(true);
    expect(estimateCanTransition("draft", "archived")).toBe(true);
    expect(estimateCanTransition("on_review", "approved")).toBe(true);
    expect(estimateCanTransition("on_review", "rejected")).toBe(true);
    expect(estimateCanTransition("on_review", "draft")).toBe(true);
    expect(estimateCanTransition("rejected", "draft")).toBe(true);
    expect(estimateCanTransition("rejected", "archived")).toBe(true);
    expect(estimateCanTransition("approved", "archived")).toBe(true);
  });

  it("запрещённые переходы", () => {
    expect(estimateCanTransition("draft", "approved")).toBe(false);
    expect(estimateCanTransition("approved", "draft")).toBe(false);
    expect(estimateCanTransition("archived", "draft")).toBe(false);
    expect(estimateCanTransition("draft", "draft")).toBe(false);
  });
});

describe("матрица переходов документов", () => {
  it("draft -> submitted -> approved|rejected, rejected -> draft", () => {
    expect(documentCanTransition("draft", "submitted")).toBe(true);
    expect(documentCanTransition("submitted", "approved")).toBe(true);
    expect(documentCanTransition("submitted", "rejected")).toBe(true);
    expect(documentCanTransition("rejected", "draft")).toBe(true);
    expect(documentCanTransition("draft", "approved")).toBe(false);
    expect(documentCanTransition("approved", "draft")).toBe(false);
  });
});

describe("RBAC", () => {
  it("утверждение доступно только admin и manager", () => {
    expect(canApprove("admin")).toBe(true);
    expect(canApprove("manager")).toBe(true);
    expect(canApprove("estimator")).toBe(false);
    expect(canApprove("foreman")).toBe(false);
    expect(canApprove("customer")).toBe(false);
  });

  it("редактируемость по статусам", () => {
    expect(estimateEditable("draft")).toBe(true);
    expect(estimateEditable("on_review")).toBe(true);
    expect(estimateEditable("rejected")).toBe(true);
    expect(estimateEditable("approved")).toBe(false);
    expect(estimateEditable("archived")).toBe(false);
    expect(documentEditable("draft")).toBe(true);
    expect(documentEditable("rejected")).toBe(true);
    expect(documentEditable("approved")).toBe(false);
    expect(documentEditable("submitted")).toBe(false);
  });
});

describe("normalizeItems", () => {
  it("валидирует и нормализует позиции (total = round(qty*price), position с 1)", () => {
    const items = normalizeItems([
      { name: " Кирпич ", quantity: 10.5, unitPriceMinor: 200 },
      { name: "Цемент", quantity: 3, unitPriceMinor: 100.4 },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]?.name).toBe("Кирпич");
    expect(items[0]?.position).toBe(1);
    expect(items[0]?.totalMinor).toBe(2100);
    expect(items[1]?.position).toBe(2);
    expect(items[1]?.totalMinor).toBe(301);
    expect(itemsTotal(items)).toBe(2401);
  });

  it("пустой/невалидный список -> 422 'items'", () => {
    for (const bad of [undefined, null, [], "x"]) {
      try {
        normalizeItems(bad);
        expect.unreachable("ожидалась ошибка");
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).status).toBe(422);
        expect((e as AppError).field).toBe("items");
      }
    }
  });

  it("пустое наименование / отрицательные значения -> 422 'items'", () => {
    const cases = [
      [{ name: "  ", quantity: 1, unitPriceMinor: 10 }],
      [{ name: "А", quantity: -1, unitPriceMinor: 10 }],
      [{ name: "А", quantity: 1, unitPriceMinor: -10 }],
    ];
    for (const bad of cases) {
      try {
        normalizeItems(bad);
        expect.unreachable("ожидалась ошибка");
      } catch (e) {
        expect((e as AppError).status).toBe(422);
        expect((e as AppError).field).toBe("items");
      }
    }
  });
});
