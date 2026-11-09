// Тесты офлайн-маршрутизации ассистента (зеркало Go pickOfflineTool).
import { describe, expect, it } from "vitest";

import { BUDGET_TOKENS, pickOfflineTool } from "../src/ai/offline";

describe("pickOfflineTool", () => {
  it("нормативные ключевые слова -> search_normative", () => {
    expect(pickOfflineTool("что сказано про фундамент в нормативах").tool).toBe("search_normative");
    expect(pickOfflineTool("требования гост на акты").tool).toBe("search_normative");
    expect(pickOfflineTool("какие снип действуют").tool).toBe("search_normative");
    expect(pickOfflineTool("правила документооборота").tool).toBe("search_normative");
  });

  it("сметы -> list_pending_approvals", () => {
    expect(pickOfflineTool("какие сметы ждут согласования").tool).toBe("list_pending_approvals");
    expect(pickOfflineTool("проверь смету на аномалии").tool).toBe("list_pending_approvals");
  });

  it("документы -> list_documents", () => {
    expect(pickOfflineTool("покажи документы по проекту").tool).toBe("list_documents");
    expect(pickOfflineTool("где кс-2 за июнь").tool).toBe("list_documents");
    expect(pickOfflineTool("покажи акты и счета").tool).toBe("list_documents");
  });

  it("объекты/бюджет -> project_overview", () => {
    expect(pickOfflineTool("сколько у нас объектов и каков бюджет").tool).toBe("project_overview");
    expect(pickOfflineTool("есть ли перерасход по затратам").tool).toBe("project_overview");
  });

  it("вне области продукта -> пустой инструмент (вежливый отказ)", () => {
    expect(pickOfflineTool("напиши мне рецепт борща").tool).toBe("");
    expect(pickOfflineTool("какая погода в астане").tool).toBe("");
    expect(pickOfflineTool("напиши код на react").tool).toBe("");
  });
});

describe("BUDGET_TOKENS", () => {
  it("лимит демо-режима — 100 000 токенов на весь сайт", () => {
    expect(BUDGET_TOKENS).toBe(100_000);
  });
});
