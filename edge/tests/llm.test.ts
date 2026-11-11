// Тесты очистки «размышлений» модели: reasoning-модели (MiniMax M2.7) присылают
// блок <think> в поле content — пользователю его показывать нельзя.
import { describe, expect, it } from "vitest";
import {
  cleanServiceTags,
  providersFromEnv,
  stripProviderReasoning,
  stripReasoning,
  stripToolNarration,
  timeoutMsFromEnv,
} from "../src/ai/llm";

describe("stripReasoning", () => {
  it("убирает закрытый блок <think>…</think>", () => {
    const raw = "<think>размышление</think>Готовый ответ пользователю";
    expect(stripReasoning(raw)).toBe("Готовый ответ пользователю");
  });

  it("оставляет обычный текст без изменений", () => {
    const raw = "На объекте 5 этапов, бюджет 13,2 млрд ₸";
    expect(stripReasoning(raw)).toBe(raw);
  });

  it("обрезает незакрытый блок <think> по заключительной фразе рассуждения", () => {
    const raw = [
      "<think>Пользователь спросил про объекты.",
      "Данные получены, нужно кратко и по делу ответить.",
      "",
      "В работе 2 объекта, перерасхода нет.",
    ].join("\n");
    const out = stripReasoning(raw);
    expect(out).not.toContain("<think>");
    expect(out).toContain("В работе 2 объекта");
    expect(out).not.toContain("Данные получены");
  });

  it("обрезает незакрытый блок по первому markdown-заголовку ответа", () => {
    const raw = ["<think>Размышление без маркера.", "", "## Портфель объектов", "Всего 5 объектов."].join("\n\n");
    const out = stripReasoning(raw);
    expect(out).toContain("## Портфель объектов");
    expect(out).not.toContain("Размышление без маркера");
  });

  it("не выбрасывает текст, если размышление не распознано", () => {
    const raw = "<think>просто текст без структуры";
    expect(stripReasoning(raw)).toContain("просто текст без структуры");
  });
});

describe("cleanServiceTags", () => {
  it("убирает служебный маркер <end_turn> из ответа", () => {
    expect(cleanServiceTags("Ответ модели<end_turn>")).toBe("Ответ модели");
    expect(cleanServiceTags("Ответ модели</end_turn>")).toBe("Ответ модели");
  });
});

describe("stripToolNarration", () => {
  it("убирает проговоренные действия с инструментами перед ответом", () => {
    const raw = [
      "Получил данные по портфелю. Теперь нужно их интерпретировать.",
      "- Всего объектов: 5",
      "",
      "Нужно уточнить, какие объекты в работе. Можно вызвать list_projects.",
      "",
      "Сейчас в работе **2 объекта** из 5.",
    ].join("\n");
    const out = stripToolNarration(raw);
    expect(out).toContain("Сейчас в работе");
    expect(out).not.toContain("Получил данные по портфелю");
    expect(out).not.toContain("Можно вызвать list_projects");
  });

  it("не трогает обычный ответ без упоминания инструментов", () => {
    const raw = ["Чтобы установить плиту, нужно:", "1. подготовить основание;", "2. уложить плиту."].join("\n");
    expect(stripToolNarration(raw)).toBe(raw);
  });

  it("убирает рассуждение, когда ответ — одно предложение в том же абзаце", () => {
    const raw = "Получил данные по портфелю. Теперь нужно их интерпретировать. Сейчас в работе **2 объекта** из 5.";
    const out = stripToolNarration(raw);
    expect(out).toContain("Сейчас в работе");
    expect(out).not.toContain("Получил данные");
    expect(out).not.toContain("Теперь нужно");
  });

  it("убирает рассуждение из нескольких предложений перед ответом", () => {
    const raw = [
      "Получил данные по портфелю.",
      "Теперь нужно их интерпретировать.",
      "Нужно уточнить, какие объекты в работе.",
      "Могу вызвать list_projects для деталей.",
      "Сейчас в работе **2 объекта** из 5.",
    ].join(" ");
    const out = stripToolNarration(raw);
    expect(out).toContain("Сейчас в работе");
    expect(out).not.toContain("Получил данные");
    expect(out).not.toContain("Могу вызвать");
  });

  it("возвращает исходный текст, если после среза не осталось ответа", () => {
    const raw = "Получил данные по портфелю. Теперь нужно их интерпретировать.";
    expect(stripToolNarration(raw)).toBe(raw);
  });
});

describe("stripProviderReasoning", () => {
  it("удаляет префикс рассуждений, если провайдер продублировал его в content", () => {
    expect(stripProviderReasoning("мысли модели\n\nОтвет пользователю", "мысли модели")).toBe("Ответ пользователю");
  });

  it("не меняет ответ, если рассуждения в отдельном поле", () => {
    expect(stripProviderReasoning("Ответ пользователю", "мысли модели")).toBe("Ответ пользователю");
  });
});

describe("providersFromEnv", () => {
  it("добавляет третьего провайдера, если задан AI_FALLBACK_MODEL_ALT", () => {
    const providers = providersFromEnv({
      AI_API_KEY: "key-1",
      AI_FALLBACK_API_KEY: "key-2",
      AI_FALLBACK_MODEL_ALT: "zai-org/GLM-5.3-Flash",
    });
    expect(providers.map((p) => p.name)).toEqual(["dahl", "dahl-alt", "vyceai"]);
    expect(providers[1]?.model).toBe("zai-org/GLM-5.3-Flash");
    // Тот же endpoint и ключ, что и у основного fallback-провайдера.
    expect(providers[1]?.baseURL).toBe(providers[0]?.baseURL);
  });

  it("пропускает провайдера без ключа и без ALT-модели", () => {
    const providers = providersFromEnv({ AI_FALLBACK_API_KEY: "key-2" });
    expect(providers.map((p) => p.name)).toEqual(["dahl"]);
  });

  it("добавляет резервного оператора Kilo с ALT-моделью", () => {
    const providers = providersFromEnv({
      AI_API_KEY: "key-1",
      AI_FALLBACK_API_KEY: "key-2",
      AI_RESERVE_API_KEY: "key-3",
      AI_RESERVE_MODEL: "nvidia/nemotron-3.5-lightning:free",
      AI_RESERVE_MODEL_ALT: "kilo-auto/free",
    });
    expect(providers.map((p) => p.name)).toEqual(["dahl", "kilo", "kilo-alt", "vyceai"]);
    expect(providers[1]?.model).toBe("nvidia/nemotron-3.5-lightning:free");
    expect(providers[2]?.model).toBe("kilo-auto/free");
    // ALT-модель резервного оператора работает через тот же endpoint и ключ.
    expect(providers[2]?.baseURL).toBe(providers[1]?.baseURL);
  });

  it("пропускает резервного оператора без ключа", () => {
    const providers = providersFromEnv({
      AI_API_KEY: "key-1",
      AI_RESERVE_MODEL: "kilo-auto/free",
    });
    expect(providers.map((p) => p.name)).toEqual(["vyceai"]);
  });
});

describe("timeoutMsFromEnv", () => {
  it("берёт значение из окружения", () => {
    expect(timeoutMsFromEnv({ AI_TIMEOUT_MS: "45000" })).toBe(45000);
  });

  it("падает на значение по умолчанию при некорректной переменной", () => {
    expect(timeoutMsFromEnv({ AI_TIMEOUT_MS: "abc" })).toBe(60000);
    expect(timeoutMsFromEnv({})).toBe(60000);
  });
});
