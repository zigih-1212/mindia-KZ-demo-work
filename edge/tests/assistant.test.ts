// Тесты AI-ассистента edge: LLM-fallback по провайдерам, офлайн-режим, бюджет 100k.
import { describe, expect, it, vi, afterEach } from "vitest";
import { ask } from "../src/ai/assistant";
import { BUDGET_TOKENS } from "../src/ai/offline";
import type { OfflineDeps } from "../src/ai/offline";
import type { AIConversation, AIMessage, AIUsage } from "../src/types";

// In-memory AIRepo,足够 для ask(): разговоры, сообщения, usage.
function fakeAIRepo(initial?: Partial<AIUsage>) {
  const convs: AIConversation[] = [];
  const msgs: AIMessage[] = [];
  let usage: AIUsage = { tokensIn: 0, tokensOut: 0, limitTotal: BUDGET_TOKENS, requests: 0, ...initial };
  return {
    repo: {
      async createConversation(userId: string, title: string) {
        const c: AIConversation = { id: "c1", userId, title, createdAt: "t", updatedAt: "t" };
        convs.push(c);
        return c;
      },
      async assertOwner(id: string, userId: string) {
        const c = convs.find((x) => x.id === id);
        if (!c || c.userId !== userId) throw new Error("forbidden");
        return c;
      },
      async touch() {},
      async listConversations() {
        return convs;
      },
      async appendMessage(m: AIMessage) {
        msgs.push(m);
      },
      async listMessages() {
        return msgs.slice(-20);
      },
      async usage() {
        return usage;
      },
      async addUsage(inp: number, out: number) {
        usage = { ...usage, tokensIn: usage.tokensIn + inp, tokensOut: usage.tokensOut + out, requests: usage.requests + 1 };
      },
    } as unknown as OfflineDeps["ai"],
    msgs,
    getUsage: () => usage,
  };
}

const noopRepo = {} as never;
function depsWith(ai: OfflineDeps["ai"]): OfflineDeps {
  return { projects: noopRepo, estimates: noopRepo, documents: noopRepo, normative: noopRepo, ai };
}

function jsonResponse(content: string, prompt = 10, completion = 5) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { role: "assistant", content } }],
      usage: { prompt_tokens: prompt, completion_tokens: completion },
    }),
    text: async () => "",
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("assistant ask()", () => {
  it("без ключей провайдеров — офлайн-ответ на приветствие", async () => {
    const { repo, msgs } = fakeAIRepo();
    const res = await ask(depsWith(repo), {}, { uid: "u1" }, "", "Привет!");
    expect(res.limited).toBe(false);
    const last = msgs.at(-1)!;
    expect(last.role).toBe("assistant");
    expect(last.content).toContain("Здравствуйте");
  });

  it("fallback: первый провайдер падает (500), второй отвечает — ответ от второго, usage посчитан", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        calls.push(String(url));
        if (String(url).includes("vyceai.com")) {
          return { ok: false, status: 500, text: async () => "boom" } as Response;
        }
        return jsonResponse("Второй провайдер на связи");
      }),
    );
    const { repo, getUsage } = fakeAIRepo();
    const env = { AI_API_KEY: "k1", AI_FALLBACK_API_KEY: "k2" };
    const res = await ask(depsWith(repo), env, { uid: "u1" }, "", "Привет, кто на связи?");
    expect(calls.length).toBe(2);
    expect(calls[1]).toContain("dahl.global");
    expect(res.message.content).toBe("Второй провайдер на связи");
    expect(getUsage().tokensIn).toBe(10);
    expect(getUsage().tokensOut).toBe(5);
    expect(getUsage().requests).toBe(1);
  });

  it("все провайдеры лежат — честный офлайн-ответ, а не молчание", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, text: async () => "down" }) as Response),
    );
    const { repo, msgs } = fakeAIRepo();
    const env = { AI_API_KEY: "k1", AI_FALLBACK_API_KEY: "k2" };
    const res = await ask(depsWith(repo), env, { uid: "u1" }, "", "привет, подскажи что-нибудь");
    expect(res.limited).toBe(false);
    const last = msgs.at(-1)!;
    expect(last.content).toContain("офлайн");
  });

  it("бюджет 100 000 исчерпан — limited-ответ и отказ до вызова LLM", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { repo, msgs } = fakeAIRepo({ tokensIn: BUDGET_TOKENS - 5, tokensOut: 10 });
    const res = await ask(depsWith(repo), { AI_API_KEY: "k" }, { uid: "u1" }, "", "привет");
    expect(res.limited).toBe(true);
    expect(res.message.content).toContain("100 000");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(msgs.at(-1)!.content).toContain("Демо-режим");
  });

  it("tool-calling: модель просит инструмент, ассистент вызывает его и отвечает финалом", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n++;
        if (n === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "",
                    tool_calls: [
                      { id: "t1", type: "function", function: { name: "project_overview", arguments: "{}" } },
                    ],
                  },
                },
              ],
              usage: { prompt_tokens: 20, completion_tokens: 3 },
            }),
            text: async () => "",
          } as Response;
        }
        return jsonResponse("Итог: объектов 5", 30, 7);
      }),
    );
    // callTool для project_overview дергает projects.summary — подменим проекты-заглушкой
    const projectsStub = {
      async summary() {
        return {
          projectsTotal: 5,
          projectsActive: 2,
          budgetMinor: 1,
          spentMinor: 0,
          budgetsByProject: [],
          estimatesPending: 0,
          documentsPending: 0,
          overdueProjects: 0,
        };
      },
    };
    const { repo } = fakeAIRepo();
    const d = depsWith(repo);
    d.projects = projectsStub as never;
    const res = await ask(d, { AI_API_KEY: "k" }, { uid: "u1" }, "", "дай сводку по объектам");
    expect(res.toolCalls!.length).toBe(1);
    expect(res.toolCalls![0]!.name).toBe("project_overview");
    expect(res.message.content).toBe("Итог: объектов 5");
  });

  it("пустой ответ модели — внятное сообщение вместо «…»", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse("", 10, 2)));
    const { repo, msgs } = fakeAIRepo();
    const res = await ask(depsWith(repo), { AI_API_KEY: "k" }, { uid: "u1" }, "", "привет");
    expect(res.message.content).not.toBe("…");
    expect(res.message.content.length).toBeGreaterThan(10);
    expect(msgs.at(-1)!.content).not.toBe("…");
  });

  it("инструмент отработал, а финальный текст пуст — отдаём данные инструмента, а не «…»", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n++;
        if (n === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "",
                    tool_calls: [{ id: "t1", type: "function", function: { name: "project_overview", arguments: "{}" } }],
                  },
                },
              ],
              usage: { prompt_tokens: 20, completion_tokens: 3 },
            }),
            text: async () => "",
          } as Response;
        }
        return jsonResponse("", 30, 4);
      }),
    );
    const projectsStub = {
      async summary() {
        return {
          projectsTotal: 5,
          projectsActive: 2,
          budgetMinor: 1,
          spentMinor: 0,
          budgetsByProject: [],
          estimatesPending: 0,
          documentsPending: 0,
          overdueProjects: 0,
        };
      },
    };
    const { repo } = fakeAIRepo();
    const d = depsWith(repo);
    d.projects = projectsStub as never;
    const res = await ask(d, { AI_API_KEY: "k" }, { uid: "u1" }, "", "дай сводку по объектам");
    expect(res.message.content).not.toBe("…");
    expect(res.message.content).toContain("project_overview");
  });
});
