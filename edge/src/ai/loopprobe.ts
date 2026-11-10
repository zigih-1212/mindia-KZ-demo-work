// Диагностика двухшагового цикла ассистента (LLM → инструмент → LM).
// Продовые запросы: провайдер отклоняет второй вызов — выясняем, что именно
// в сообщениях ему не нравится. Значения ключей не выводятся.

import { DISABLE_THINKING_PARAMS, providersFromEnv, SYSTEM_PROMPT, TOOL_DEFS } from "./llm";

export interface LoopPhase {
  status: number | null;
  /** Текст ошибки провайдера (без ключей) либо текст исключения. */
  error: string;
  /** Короткий фрагмент ответа (для проверки, что ответ пришёл). */
  sample: string;
  /** Длительность вызова, мс. */
  ms: number;
}

export interface LoopProbe {
  provider: string;
  model: string;
  /** Фаза 1 — запрос с инструментами: модель должна вызвать tool. */
  phase1: LoopPhase;
  /** Вызванные инструменты (имена). */
  toolCalls: string[];
  /**
   * Фаза 2 — запрос с результатом инструмента. Проверяем варианты формы
   * сообщений, чтобы найти тот, который провайдер принимает:
   *  - "as-is"       — как в проде (content:"" + tool-сообщение с name);
   *  - "no-name"     — tool-сообщение без поля name;
   *  - "null-content"— assistant-сообщение с content: null.
   */
  phase2: Record<string, LoopPhase>;
}

const DUMMY_TOOL_RESULT = JSON.stringify({
  projectsTotal: 5,
  projectsActive: 2,
  budget: 13210000000,
  spent: 6516000000,
  estimatesPending: 2,
  documentsPending: 6,
  overdueProjects: 1,
  overruns: [],
});

interface RawToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface PhaseResult {
  status: number | null;
  error: string;
  sample: string;
  toolCalls: RawToolCall[];
  assistantContent: string;
  /** Длительность вызова, мс. */
  ms: number;
}

async function callPhase(
  baseURL: string,
  apiKey: string,
  model: string,
  messages: unknown[],
  withTools: boolean,
  timeoutMs: number,
): Promise<PhaseResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  const out: PhaseResult = { status: null, error: "", sample: "", toolCalls: [], assistantContent: "", ms: 0 };
  try {
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: 0.2,
      max_tokens: 1024,
      ...DISABLE_THINKING_PARAMS,
    };
    if (withTools) body.tools = TOOL_DEFS;
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    out.status = res.status;
    const text = await res.text();
    if (!res.ok) {
      out.error = text.slice(0, 300);
    } else {
      try {
        const data = JSON.parse(text) as {
          choices?: Array<{
            message?: {
              content?: unknown;
              tool_calls?: Array<{
                id?: unknown;
                function?: { name?: unknown; arguments?: unknown };
              }>;
            };
          }>;
        };
        const msg = data.choices?.[0]?.message ?? {};
        out.assistantContent = typeof msg.content === "string" ? msg.content : "";
        out.sample = out.assistantContent.slice(0, 160);
        out.toolCalls = (msg.tool_calls ?? []).map((tc, i) => ({
          id: String(tc.id ?? `call_${i}`),
          name: String(tc.function?.name ?? ""),
          arguments: String(tc.function?.arguments ?? "{}"),
        }));
      } catch {
        out.error = "не удалось разобрать ответ /chat/completions";
      }
    }
  } catch (err) {
    out.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  } finally {
    clearTimeout(timer);
  }
  out.ms = Date.now() - started;
  return out;
}

// probeLoop — прогоняет цикл ассистента у провайдера и показывает, на какой
// фазе приходит отказ и с каким текстом ошибки.
export async function probeLoop(
  env: object,
  timeoutMs = 30_000,
  options: { provider?: string; model?: string } = {},
): Promise<LoopProbe[]> {
  const results: LoopProbe[] = [];
  const providers = providersFromEnv(env).filter((p) => !options.provider || p.name === options.provider);

  for (const p of providers) {
    const model = options.model || p.model;
    const probe: LoopProbe = {
      provider: p.name,
      model,
      phase1: { status: null, error: "", sample: "", ms: 0 },
      toolCalls: [],
      phase2: {},
    };

    const baseMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: "Какие объекты сейчас в работе?" },
    ];
    const first = await callPhase(p.baseURL, p.apiKey, model, baseMessages, true, timeoutMs);
    probe.phase1 = { status: first.status, error: first.error, sample: first.sample, ms: first.ms };
    probe.toolCalls = first.toolCalls.map((t) => t.name);
    if (first.toolCalls.length === 0) {
      results.push(probe);
      continue;
    }

    const firstCall = first.toolCalls[0];
    if (!firstCall) {
      results.push(probe);
      continue;
    }

    const assistantMsg = {
      role: "assistant",
      content: first.assistantContent,
      tool_calls: first.toolCalls.map((t) => ({
        id: t.id,
        type: "function",
        function: { name: t.name, arguments: t.arguments },
      })),
    };
    const toolMsgWithName = {
      role: "tool",
      tool_call_id: firstCall.id,
      name: firstCall.name,
      content: DUMMY_TOOL_RESULT,
    };
    const toolMsgNoName = {
      role: "tool",
      tool_call_id: firstCall.id,
      content: DUMMY_TOOL_RESULT,
    };

    const variants: Record<string, unknown[]> = {
      "as-is": [...baseMessages, assistantMsg, toolMsgWithName],
      "no-name": [...baseMessages, assistantMsg, toolMsgNoName],
      "null-content": [
        ...baseMessages,
        { ...assistantMsg, content: null },
        toolMsgWithName,
      ],
    };

    for (const [name, messages] of Object.entries(variants)) {
      const res = await callPhase(p.baseURL, p.apiKey, model, messages, true, timeoutMs);
      probe.phase2[name] = { status: res.status, error: res.error, sample: res.sample, ms: res.ms };
    }
    results.push(probe);
  }
  return results;
}
