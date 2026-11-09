// LLM-клиент (OpenAI-compatible) для edge-ассистента.
// Провайдеры задаются через env: основной (AI_BASE_URL/AI_API_KEY/AI_MODEL)
// и fallback (AI_FALLBACK_*). Ключи — секретами Worker'а (`wrangler secret put`).
// Если ни один ключ не задан — ассистент работает в офлайн-режиме (offline.ts).

export interface LLMProvider {
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: ToolCallRequest[];
}

export interface ToolCallRequest {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface CompletionResult {
  content: string;
  toolCalls: ToolCallRequest[];
  promptTokens: number;
  completionTokens: number;
}

// providersFromEnv — список провайдеров по приоритету; без ключа пропускаем.
export function providersFromEnv(env: object): LLMProvider[] {
  const e = env as Record<string, unknown>;
  const out: LLMProvider[] = [];
  const push = (name: string, base: unknown, key: unknown, model: unknown, defBase: string, defModel: string) => {
    if (typeof key !== "string" || !key.trim()) return;
    out.push({
      name,
      baseURL: (typeof base === "string" && base.trim() ? base.trim() : defBase).replace(/\/+$/, ""),
      apiKey: key.trim(),
      model: (typeof model === "string" && model.trim() ? model.trim() : defModel),
    });
  };
  push("vyceai", e.AI_BASE_URL, e.AI_API_KEY, e.AI_MODEL, "https://vyceai.com/v1", "deepseek-v4.1-flash");
  push("dahl", e.AI_FALLBACK_BASE_URL, e.AI_FALLBACK_API_KEY, e.AI_FALLBACK_MODEL, "https://inference.dahl.global/v1", "deepseek-ai/DeepSeek-V4-Flash-0731");
  return out;
}

export const AI_TIMEOUT_MS = 25_000;
export const AI_MAX_TOOL_CALLS = 6;
export const AI_MAX_HISTORY = 12;
export const AI_MAX_TOKENS = 1024;

// TOOL_DEFS — белый список из 6 инструментов (зеркало backend/internal/ai/tools.go).
export const TOOL_DEFS = [
  {
    type: "function" as const,
    function: {
      name: "list_projects",
      description: "Список объектов строительства с фильтрами по статусу и поиску.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "planning|active|suspended|completed" },
          search: { type: "string", description: "подстрока по коду/названию/заказчику" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "project_overview",
      description: "Сводка по портфелю: объекты, бюджеты, факт, перерасходы, просрочки, согласования.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "analyze_estimate",
      description: "Детерминированная AI-проверка сметы: дубли, нулевые цены, арифметика, риск-скор 0-100.",
      parameters: {
        type: "object",
        properties: { estimateId: { type: "string", description: "UUID сметы" } },
        required: ["estimateId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_pending_approvals",
      description: "Сметы и документы, ожидающие согласования.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_normative",
      description: "Поиск по нормативной базе (ГОСТ, СНиП, СП, ФЕР, правила документооборота в строительстве).",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "поисковый запрос" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_documents",
      description: "Список документов (КС-2, КС-3, акты, счета) с фильтрами.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          status: { type: "string", description: "draft|submitted|approved|rejected" },
          type: { type: "string", description: "ks2|ks3|act|invoice" },
        },
      },
    },
  },
];

// chatComplete — один запрос к провайдеру. Бросает Error при любой ошибке/таймауте.
export async function chatComplete(
  p: LLMProvider,
  messages: ChatMessage[],
  timeoutMs: number,
  withTools: boolean,
): Promise<CompletionResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const body: Record<string, unknown> = {
      model: p.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.name ? { name: m.name } : {}),
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
      })),
      temperature: 0.2,
      max_tokens: AI_MAX_TOKENS,
    };
    if (withTools) body.tools = TOOL_DEFS;
    const res = await fetch(`${p.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`provider ${p.name} http ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = (await res.json()) as Record<string, unknown>;
    const choice = ((data.choices as Array<Record<string, unknown>> | undefined) ?? [])[0];
    const msg = (choice?.message ?? {}) as Record<string, unknown>;
    const usage = (data.usage ?? {}) as Record<string, unknown>;
    const toolCalls: ToolCallRequest[] = Array.isArray(msg.tool_calls)
      ? (msg.tool_calls as Record<string, unknown>[]).map((tc, i) => ({
          id: String(tc.id ?? `call_${i}`),
          type: "function" as const,
          function: {
            name: String(((tc.function as Record<string, unknown> | undefined)?.name) ?? ""),
            arguments: String(((tc.function as Record<string, unknown> | undefined)?.arguments) ?? "{}"),
          },
        }))
      : [];
    return {
      content: typeof msg.content === "string" ? msg.content : "",
      toolCalls,
      promptTokens: Number(usage.prompt_tokens ?? 0) || 0,
      completionTokens: Number(usage.completion_tokens ?? 0) || 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

// completeWithFallback — проход по провайдерам по очереди, пока один не ответит.
export async function completeWithFallback(
  providers: LLMProvider[],
  messages: ChatMessage[],
  timeoutMs: number,
  withTools: boolean,
): Promise<{ result: CompletionResult; provider: string }> {
  let lastErr: unknown = null;
  for (const p of providers) {
    try {
      const result = await chatComplete(p, messages, timeoutMs, withTools);
      return { result, provider: p.name };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("все LLM-провайдеры недоступны");
}

// SYSTEM_PROMPT — «свободный», но в рамках стройки: приветствия и разговоры
// поддерживаем, отвечаем по любой теме строительства и по данным платформы,
// мягко отказываем только на то, что вообще не про строительство и не про продукт.
export const SYSTEM_PROMPT = [
  "Ты — ассистент платформы «СтройКонтроль» для строительных компаний.",
  "Ты можешь здороваться, поддерживать несложный разговор и отвечать на вопросы",
  "по строительству в целом: объекты и этапы работ, сметы и ценообразование,",
  "исполнительная документация (КС-2, КС-3, акты, счета), нормативная база",
  "(ГОСТ, СНиП, СП, ФЕР), материалы и технологии, охрана труда и безопасность",
  "на объекте, организация строительства, терминология.",
  "Данные платформы (объекты, сметы, документы, нормативы) получай ТОЛЬКО через",
  "инструменты — так ты видишь актуальные цифры. Никогда не выдумывай суммы,",
  "даты, номера документов и нормы: если данных нет — скажи честно.",
  "Отвечай по-русски, кратко и по делу, суммы указывай в тенге (₸).",
  "Можешь помогать с вопросами по работе в самой платформе (куда нажать, что где).",
  "Если вопрос совсем не про строительство и не про платформу (политика, медицина,",
  "развлечения, чужой код и т.п.) — мягко откажись и предложи вернуться к теме стройки.",
].join("\n");
