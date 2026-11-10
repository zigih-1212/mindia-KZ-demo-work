// Диагностика LLM-провайдеров: проверка ключа и списка доступных моделей.
// Ключи никогда не выводятся — только HTTP-статусы, тексты ошибок провайдера
// и идентификаторы моделей. Используется для админской проверки (admin).

import { DISABLE_THINKING_PARAMS, providersFromEnv, TOOL_DEFS } from "./llm";

export interface ProviderProbe {
  provider: string;
  baseURL: string;
  /** Модель, заданная в конфигурации воркера. */
  model: string;
  /** HTTP-статус GET {base}/models (null — запрос не дошёл). */
  modelsStatus: number | null;
  /** Список доступных моделей (первые 50). */
  availableModels: string[];
  /** Текст ошибки провайдера (без ключей). */
  error: string;
}

// probeProviders — поочерёдная проверка каждого провайдера из конфигурации.
export async function probeProviders(env: object, timeoutMs = 15_000): Promise<ProviderProbe[]> {
  const out: ProviderProbe[] = [];
  for (const p of providersFromEnv(env)) {
    const probe: ProviderProbe = {
      provider: p.name,
      baseURL: p.baseURL,
      model: p.model,
      modelsStatus: null,
      availableModels: [],
      error: "",
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${p.baseURL}/models`, {
        headers: { Authorization: `Bearer ${p.apiKey}` },
        signal: ctrl.signal,
      });
      probe.modelsStatus = res.status;
      const text = await res.text();
      if (!res.ok) {
        probe.error = text.slice(0, 200);
      } else {
        try {
          const data = JSON.parse(text) as { data?: Array<{ id?: unknown }> };
          probe.availableModels = (data.data ?? [])
            .map((m) => String(m.id ?? ""))
            .filter(Boolean)
            .slice(0, 50);
        } catch {
          probe.error = "не удалось разобрать ответ /models";
        }
      }
    } catch (err) {
      probe.error = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }
    out.push(probe);
  }
  return out;
}

export interface ChatProbe {
  provider: string;
  model: string;
  /** true — запрос с инструментами (как в реальном ассистенте). */
  withTools: boolean;
  /** Вариант тела запроса (параметры отключения размышлений). */
  variant: string;
  status: number | null;
  error: string;
  /** Короткий фрагмент ответа модели (для проверки, что ответ пришёл). */
  sample: string;
  /** true — модель вернула блок размышлений <think> в поле content. */
  hasThink: boolean;
  /** Поля, которые провайдер вернул в message (для разбора формата ответа). */
  msgKeys: string[];
  /** Длина отдельного поля с рассуждениями (reasoning_content/reasoning), если оно есть. */
  reasoningLen: number;
  /** Фрагмент рассуждений из отдельного поля (если провайдер его отдаёт отдельно). */
  reasoningSample: string;
}

export interface ComboProbe {
  /** Какой базовый URL проверяем (primary/fallback). */
  base: string;
  /** Имя слота ключа (значение ключа не выводится). */
  keySlot: string;
  model: string;
  /** full — тело как в ассистенте; minimal — только model+messages. */
  body: string;
  status: number | null;
  error: string;
  sample: string;
}

// probeCombos — перебор пар (base URL × ключ) для одной модели каждого
// провайдера. Нужен, чтобы понять, какой ключ к какому провайдеру подходит:
// значения ключей никогда не выводятся, только имена слотов.
export async function probeCombos(env: object, timeoutMs = 20_000): Promise<ComboProbe[]> {
  const e = env as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const keys: { slot: string; value: string }[] = [];
  if (str(e.AI_API_KEY)) keys.push({ slot: "AI_API_KEY", value: str(e.AI_API_KEY) });
  if (str(e.AI_FALLBACK_API_KEY)) {
    keys.push({ slot: "AI_FALLBACK_API_KEY", value: str(e.AI_FALLBACK_API_KEY) });
  }
  const bases: { name: string; url: string; models: string[] }[] = [
    {
      name: "primary",
      url: (str(e.AI_BASE_URL) || "https://vyceai.com/v1").replace(/\/+$/, ""),
      models: ["deepseek-v4.1"],
    },
    {
      name: "fallback",
      url: (str(e.AI_FALLBACK_BASE_URL) || "https://inference.dahl.global/v1").replace(/\/+$/, ""),
      models: ["MiniMaxAI/MiniMax-M2.7"],
    },
  ];

  const tasks: Promise<ComboProbe>[] = [];
  for (const b of bases) {
    for (const k of keys) {
      for (const model of b.models) {
        for (const bodyKind of ["full", "minimal"]) {
          tasks.push(oneCombo(b.name, b.url, k, model, bodyKind, timeoutMs));
        }
      }
    }
  }
  return Promise.all(tasks);
}

async function oneCombo(
  base: string,
  url: string,
  key: { slot: string; value: string },
  model: string,
  bodyKind: string,
  timeoutMs: number,
): Promise<ComboProbe> {
  const probe: ComboProbe = { base, keySlot: key.slot, model, body: bodyKind, status: null, error: "", sample: "" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const body: Record<string, unknown> =
      bodyKind === "minimal"
        ? { model, messages: [{ role: "user", content: "ping" }] }
        : { model, messages: [{ role: "user", content: "ping" }], max_tokens: 16, temperature: 0.2 };
    const res = await fetch(`${url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.value}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    probe.status = res.status;
    const text = await res.text();
    if (!res.ok) {
      probe.error = text.slice(0, 160);
    } else {
      try {
        const data = JSON.parse(text) as { choices?: Array<{ message?: { content?: unknown } }> };
        probe.sample = String(data.choices?.[0]?.message?.content ?? "").slice(0, 100);
      } catch {
        probe.error = "не удалось разобрать ответ";
      }
    }
  } catch (err) {
    probe.error = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }
  return probe;
}

export interface ChatProbeOptions {
  /** Проверить только этого провайдера (имя из конфигурации). */
  provider?: string;
  /** Переопределить модель (для перебора каталога без смены vars). */
  model?: string;
  /** Проверить только один вариант: с инструментами или без. */
  withTools?: boolean;
  /**
   * Тело запроса:
   *  - "no-thinking" — с параметрами отключения размышлений (как в проде);
   *  - "plain"       — только model+messages (без дополнительных параметров).
   */
  variant?: "plain" | "no-thinking";
}

// probeChat — минимальный запрос к /chat/completions (с инструментами и без).
// Показывает, какой именно вызов отклоняет провайдер и с каким статусом.
// Через options можно переопределить модель/провайдера — без деплоя новых vars.
export async function probeChat(
  env: object,
  timeoutMs = 20_000,
  options: ChatProbeOptions = {},
): Promise<ChatProbe[]> {
  const out: ChatProbe[] = [];
  const providers = providersFromEnv(env).filter(
    (p) => !options.provider || p.name === options.provider,
  );
  const variants = typeof options.withTools === "boolean" ? [options.withTools] : [false, true];
  const variant = options.variant ?? "no-thinking";
  for (const p of providers) {
    const model = options.model || p.model;
    for (const withTools of variants) {
      const probe: ChatProbe = {
        provider: p.name,
        model,
        withTools,
        variant,
        status: null,
        error: "",
        sample: "",
        hasThink: false,
        msgKeys: [],
        reasoningLen: 0,
        reasoningSample: "",
      };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const body: Record<string, unknown> = {
          model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 16,
        };
        if (withTools) body.tools = TOOL_DEFS;
        if (variant === "no-thinking") Object.assign(body, DISABLE_THINKING_PARAMS);
        const res = await fetch(`${p.baseURL}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}` },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        probe.status = res.status;
        const text = await res.text();
        if (!res.ok) {
          probe.error = text.slice(0, 200);
        } else {
          try {
            const data = JSON.parse(text) as {
              choices?: Array<{ message?: Record<string, unknown> }>;
            };
            const msg = data.choices?.[0]?.message ?? {};
            const content = String(msg.content ?? "");
            probe.sample = content.slice(0, 120);
            probe.hasThink = /<think/i.test(content);
            // Какие поля вернул провайдер и есть ли отдельное поле с рассуждениями:
            // это определяет, как чистить «мысли модели» из ответа.
            probe.msgKeys = Object.keys(msg);
            const reasoning = String(msg.reasoning_content ?? msg.reasoning ?? "");
            probe.reasoningLen = reasoning.length;
            probe.reasoningSample = reasoning.slice(0, 300);
          } catch {
            probe.error = "не удалось разобрать ответ /chat/completions";
          }
        }
      } catch (err) {
        probe.error = err instanceof Error ? err.message : String(err);
      } finally {
        clearTimeout(timer);
      }
      out.push(probe);
    }
  }
  return out;
}
