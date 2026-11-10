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
  // Третий вариант: тот же endpoint и ключ, но другая модель. Нужен потому,
  // что у бесплатных моделей провайдера бывает 429 model_concurrency —
  // следующая модель на том же ключе продолжает работу.
  if (typeof e.AI_FALLBACK_MODEL_ALT === "string" && e.AI_FALLBACK_MODEL_ALT.trim()) {
    push("dahl-alt", e.AI_FALLBACK_BASE_URL, e.AI_FALLBACK_API_KEY, e.AI_FALLBACK_MODEL_ALT, "https://inference.dahl.global/v1", "");
  }
  return out;
}

// Таймаут одного вызова LLM. 25 с было недостаточно: фаза «ответ после данных
// инструментов» у реальных провайдеров занимает 20-30 с, из-за чего вызов
// обрывался по AbortError и пользователь получал офлайн-шаблон вместо ответа.
export const AI_TIMEOUT_MS = 60_000;

// timeoutMsFromEnv — таймаут вызова из переменной окружения AI_TIMEOUT_MS.
export function timeoutMsFromEnv(env: object): number {
  const raw = Number((env as Record<string, unknown>).AI_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 1000 ? Math.floor(raw) : AI_TIMEOUT_MS;
}
export const AI_MAX_TOOL_CALLS = 6;
// История диалога: 6 сообщений ≈ 3 обмена. Больше — заметный рост prompt-токенов
// на каждом вызове, а бюджет демо-режима общий на весь сайт.
export const AI_MAX_HISTORY = 6;
// Лимит ответа: 1024 токена ≈ 4 000 символов — хватает для таблиц и списков,
// но ограничивает время генерации (иначе провайдер не успевает ответить в срок).
export const AI_MAX_TOKENS = 1024;

// Заключительная фраза «размышления» модели. Нужна для случая, когда блок
// <think> приходит без закрывающего тега (так отвечает MiniMax M2.7 у
// провайдера): по этой фразе понимаем, где кончились рассуждения и начался
// ответ пользователю.
// Границы слов заданы явно (\p{L}), а не через \b: в JavaScript \b не работает
// с кириллицей — буква не считается «словным» символом.
const THINK_END_MARKER =
  /(?<![\p{L}])(?:нужно|необходимо|теперь|иттак|отвечаю|ответить|сформулирую|составляю|выдам|пользователь\s+спросил)(?![\p{L}])[^.\n]{0,120}[.!]?\s*$/iu;

// Доля текста (в строках), в которой ищем заключительную фразу рассуждения.
// Дальше этой границы ответ пользователю — иначе можно срезать «нужно»
// из самого ответа («Вам нужно подтвердить смету»).
const THINK_SCAN_RATIO = 0.7;

// stripReasoning — убирает «мысли» моделей (<think>…</think>) из ответа.
// reasoning-модели (например, MiniMax M2.7) возвращают их в поле content,
// пользователю такой текст показывать не нужно.
export function stripReasoning(content: string): string {
  const withoutClosed = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const open = withoutClosed.search(/<think>/i);
  if (open < 0) return withoutClosed;

  // Блок не закрыт: ищем последнюю «заключительную» фразу рассуждения.
  const rest = withoutClosed.slice(open + "<think>".length);
  const lines = rest.split(/\r?\n/);
  const limit = Math.max(1, Math.floor(lines.length * THINK_SCAN_RATIO));
  let cut = -1;
  for (let i = 0; i < limit; i++) {
    const line = (lines[i] ?? "").trim();
    if (line && THINK_END_MARKER.test(line)) cut = i;
  }
  if (cut >= 0) {
    const answer = lines.slice(cut + 1).join("\n").trim();
    if (answer) return answer;
  }
  // Запасной вариант: ответ начинается с markdown-заголовка.
  const heading = lines.findIndex((line, i) => i > 0 && /^#{1,4}\s/.test(line.trim()));
  if (heading > 0) {
    const answer = lines.slice(heading).join("\n").trim();
    if (answer) return answer;
  }
  // Ответ не распознан — не выбрасываем текст пользователя.
  return rest.trim();
}

// cleanServiceTags — убирает служебные маркеры провайдера (<end_turn> и т.п.),
// которые модель иногда возвращает в поле content.
export function cleanServiceTags(content: string): string {
  return content.replace(/<\/?end_turn>/gi, "").trim();
}

// Имена инструментов ассистента. Reasoning-модели (GLM) иногда проговаривают
// вслух свои действия с инструментами прямо в ответе — такой текст пользователю
// не нужен, но он же надёжный признак, что перед ответом есть «мысли».
const TOOL_NAME_RE = /list_projects|project_overview|analyze_estimate|list_pending_approvals|search_normative|list_documents/;

// Маркеры самоописания действий модели («получил данные», «нужно уточнить»…).
const NARRATION_MARKER = /(?:получил данные|теперь нужно|нужно уточнить|могу вызвать|можно вызвать|вижу[:\s]|отлично,|понял,)/i;

// stripToolNarration — убирает ход рассуждений модели, если она описала его
// текстом (без тегов <think>). Условие строгое: в начале ответа должен
// встречаться либо служебный маркер, либо имя инструмента — иначе обычный
// ответ пользователя не трогаем.
export function stripToolNarration(content: string): string {
  const lines = content.split(/\r?\n/);
  if (lines.length < 3) return content;
  const limit = Math.max(1, Math.floor(lines.length * THINK_SCAN_RATIO));
  const head = lines.slice(0, limit).join("\n");
  if (!TOOL_NAME_RE.test(head) && !NARRATION_MARKER.test(head)) return content;
  let cut = -1;
  for (let i = 0; i < limit; i++) {
    if (NARRATION_MARKER.test(lines[i] ?? "")) cut = i;
  }
  if (cut < 0) return content;
  const answer = lines.slice(cut + 1).join("\n").trim();
  return answer || content;
}

// stripProviderReasoning — часть провайдеров отдаёт рассуждения отдельным
// полем reasoning_content (иногда продублированным в начале content).
export function stripProviderReasoning(content: string, reasoning: string): string {
  const r = reasoning.trim();
  if (!r) return content;
  if (content.startsWith(r)) return content.slice(r.length).trim();
  return content;
}

// Параметры отключения «размышлений» модели. Единого стандарта у
// OpenAI-совместимых провайдеров нет: пробуем с ними, а если провайдер
// отвечает 4xx — повторяем запрос без них (провайдер не понимает поля).
export const DISABLE_THINKING_PARAMS: Record<string, unknown> = {
  chat_template_kwargs: { enable_thinking: false },
  reasoning_effort: "none",
};
let thinkingParamsRejected = false;

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
    const send = (payload: Record<string, unknown>) =>
      fetch(`${p.baseURL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}` },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    // Сначала пробуем отключить «размышления» модели; если провайдер отвергает
    // незнакомые поля (4xx) — повторяем запрос без них.
    let res = await send(thinkingParamsRejected ? body : { ...body, ...DISABLE_THINKING_PARAMS });
    if (!res.ok && res.status === 400 && !thinkingParamsRejected) {
      thinkingParamsRejected = true;
      res = await send(body);
    }
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
    const rawContent = typeof msg.content === "string" ? msg.content : "";
    const providerReasoning =
      typeof msg.reasoning_content === "string"
        ? msg.reasoning_content
        : typeof msg.reasoning === "string"
          ? msg.reasoning
          : "";
    const cleaned = cleanServiceTags(
      stripToolNarration(stripReasoning(stripProviderReasoning(rawContent, providerReasoning))),
    );
    return {
      // Если чистка съела весь текст (модель отдала только «мысли»), возвращаем
      // исходный ответ: пустое сообщение пользователю бесполезно.
      content: cleaned.trim() ? cleaned : rawContent.trim(),
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
      // Логируем причину: без неё отказ провайдера выглядит как «офлайн-режим».
      console.warn(`[llm] провайдер ${p.name} недоступен:`, err instanceof Error ? err.message : String(err));
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
  "Пиши сразу ответ: внутренние рассуждения и служебные теги (<think>) не выводи.",
  "Не описывай свои рассуждения, действия с инструментами и промежуточные мысли —",
  "сразу дай пользователю итоговый ответ по его вопросу.",
  "Ответ держи в пределах 200 слов: списками или короткой таблицей, без длинных вступлений.",
  "Если нужно несколько инструментов — вызывай их в одном ответе (несколько вызовов за раз),",
  "чтобы не тратить дополнительные шаги диалога.",
  "Один и тот же инструмент не вызывай повторно: данные уже получены.",
  "Когда данных достаточно — сразу дай текстовый ответ, без дополнительных вызовов.",
  "Можешь помогать с вопросами по работе в самой платформе (куда нажать, что где).",
  "Если вопрос совсем не про строительство и не про платформу (политика, медицина,",
  "развлечения, чужой код и т.п.) — мягко откажись и предложи вернуться к теме стройки.",
].join("\n");
