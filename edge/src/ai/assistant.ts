// Ассистент edge-версии: цикл «LLM ↔ инструменты» с fallback по провайдерам
// (vyceai → dahl), бюджетом токенов и офлайн-fallback, если ключи не заданы.
// Зеркалит backend/internal/ai/assistant.go (Go — эталон).

import {
  AI_MAX_HISTORY,
  AI_MAX_TOOL_CALLS,
  SYSTEM_PROMPT,
  completeWithFallback,
  providersFromEnv,
  timeoutMsFromEnv,
  type ChatMessage,
  type CompletionResult,
} from "./llm";
import {
  BUDGET_TOKENS,
  callTool,
  limitedMessage,
  pickOfflineTool,
  refusalMessage,
  type OfflineDeps,
} from "./offline";
import { truncate } from "../lib/util";
import type { AIChatResult, AIMessage, AIUsage, ToolCallTrace } from "../types";

const MAX_MESSAGE_RUNES = 2000;

// ask — полный цикл ассистента: бюджет → (LLM с fallback | офлайн) → ответ.
export async function ask(
  deps: OfflineDeps,
  env: object,
  actor: { uid: string },
  conversationID: string,
  userText: string,
): Promise<AIChatResult> {
  const text = userText.trim();
  if (!text) throw new Error("сообщение не должно быть пустым");
  if ([...text].length > MAX_MESSAGE_RUNES) throw new Error("сообщение длиннее 2000 символов");

  const conv = conversationID
    ? await deps.ai.assertOwner(conversationID, actor.uid)
    : await deps.ai.createConversation(actor.uid, truncate(text, 60));

  const usage = await deps.ai.usage();
  const usageWithLimit: AIUsage = { ...usage, limitTotal: BUDGET_TOKENS };

  // Бюджет демо-режима проверяется ДО любых вызовов.
  if (usage.tokensIn + usage.tokensOut >= BUDGET_TOKENS) {
    const reply = await appendAssistant(deps.ai, conv.id, limitedMessage, "", 0, 0);
    await deps.ai.touch(conv.id, "");
    return { conversationId: conv.id, message: reply, usage: usageWithLimit, limited: true };
  }

  await deps.ai.appendMessage({
    id: crypto.randomUUID(),
    conversationId: conv.id,
    role: "user",
    content: text,
    tokensIn: 0,
    tokensOut: 0,
    createdAt: new Date().toISOString(),
  });

  const providers = providersFromEnv(env);
  const result =
    providers.length > 0
      ? await runLLM(deps, providers, env, conv.id, text, actor)
      : await runOffline(deps, conv.id, text);

  await deps.ai.touch(conv.id, "");
  const after = await deps.ai.usage();
  return {
    conversationId: conv.id,
    message: result.message,
    usage: { ...after, limitTotal: BUDGET_TOKENS },
    limited: after.tokensIn + after.tokensOut >= BUDGET_TOKENS,
    sources: result.sources,
    toolCalls: result.toolCalls,
  };
}

interface RunOutcome {
  message: AIMessage;
  sources?: string[];
  toolCalls?: ToolCallTrace[];
}

// runLLM — цикл tool-calling до 6 шагов; каждый шаг пробует провайдеров по очереди.
async function runLLM(
  deps: OfflineDeps,
  providers: ReturnType<typeof providersFromEnv>,
  env: object,
  convId: string,
  userText: string,
  actor: { uid: string },
): Promise<RunOutcome> {
  const history = await deps.ai.listMessages(convId, AI_MAX_HISTORY);
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  const traces: ToolCallTrace[] = [];
  const sources: string[] = [];
  let totalIn = 0;
  let totalOut = 0;
  let lastContent = "";
  let usedProvider = "";

  for (let step = 0; step <= AI_MAX_TOOL_CALLS; step++) {
    // Бюджет проверяем и между шагами цикла.
    const u = await deps.ai.usage();
    if (u.tokensIn + u.tokensOut + totalIn + totalOut >= BUDGET_TOKENS) {
      const reply = await appendAssistant(deps.ai, convId, limitedMessage, "", 0, 0);
      if (totalIn || totalOut) await deps.ai.addUsage(totalIn, totalOut);
      return { message: reply, sources: dedupe(sources), toolCalls: traces };
    }

    let comp: CompletionResult;
    try {
      const r = await completeWithFallback(providers, messages, timeoutMsFromEnv(env), true);
      comp = r.result;
      usedProvider = r.provider;
    } catch (err) {
      // Все провайдеры отвалились. Причина логируется: иначе отказ LLM
      // неотличим от «ключи не заданы».
      const reason = err instanceof Error ? err.message : String(err);
      console.error("[ai] LLM недоступен:", reason);
      await deps.ai.addUsage(totalIn, totalOut);
      // Если инструменты уже отработали — отдаём их данные: реальные цифры
      // полезнее офлайн-шаблона, который утверждает, что LLM не подключена.
      if (traces.length > 0) {
        const content = degradedAnswer(traces, reason);
        const reply = await appendAssistant(deps.ai, convId, content, "", totalIn, totalOut);
        return { message: reply, sources: dedupe(sources), toolCalls: traces };
      }
      return runOffline(deps, convId, userText);
    }

    totalIn += comp.promptTokens;
    totalOut += comp.completionTokens;

    if (comp.toolCalls.length === 0) {
      // Пустой ответ модели не затираем: ниже сработает запасной вариант
      // с данными инструментов, а не «…».
      if (comp.content.trim()) lastContent = comp.content;
      break;
    }

    // Assistant-сообщение с tool_calls + по одному tool-сообщению на вызов.
    messages.push({ role: "assistant", content: comp.content, tool_calls: comp.toolCalls });
    for (const tc of comp.toolCalls) {
      let out: unknown;
      let errText = "";
      try {
        out = await callTool(deps, tc.function.name, tc.function.arguments);
      } catch (err) {
        errText = err instanceof Error ? err.message : String(err);
        out = { error: errText };
      }
      const outStr = truncate(JSON.stringify(out), 800);
      traces.push({ name: tc.function.name, args: truncate(tc.function.arguments, 300), result: errText ? "" : outStr, error: errText || undefined });
      if (tc.function.name === "search_normative" && !errText) {
        for (const code of extractCodes(out)) if (!sources.includes(code)) sources.push(code);
      }
      messages.push({ role: "tool", tool_call_id: tc.id, name: tc.function.name, content: outStr });
    }
  }

  await deps.ai.addUsage(totalIn, totalOut);
  // Модель могла не вернуть текст (пустой content, обрыв по лимиту шагов).
  // Показываем данные инструментов — это и полезнее, и честнее «…».
  const finalText = lastContent.trim()
    ? lastContent
    : traces.length > 0
      ? degradedAnswer(traces, "модель не вернула текстовый ответ")
      : "Модель вернула пустой ответ. Переформулируйте вопрос или уточните детали.";
  const reply = await appendAssistant(deps.ai, convId, finalText, "", totalIn, totalOut);
  void usedProvider; // провайдер-источник не храним в сообщении, только в логике fallback
  void actor;
  return { message: reply, sources: dedupe(sources), toolCalls: traces };
}

// degradedAnswer — ответ по данным уже полученных инструментов на случай,
// когда финальный вызов LLM не удался (таймаут или ошибка провайдера).
function degradedAnswer(traces: ToolCallTrace[], reason: string): string {
  const lines = traces.map((t) =>
    t.error ? `• ${t.name}: ошибка (${t.error})` : `• ${t.name}: ${truncate(t.result, 600)}`,
  );
  return (
    "Собрал актуальные данные платформы по вашему запросу, но сформулировать ответ " +
    "модель не успела (лимит времени ответа провайдера). Данные инструментов:\n" +
    lines.join("\n") +
    `\n\n(причина: ${truncate(reason, 120)})`
  );
}

// runOffline — детерминированный путь без LLM (нет ключей или все провайдеры лежат).
async function runOffline(deps: OfflineDeps, convId: string, userText: string): Promise<RunOutcome> {
  const { tool, args } = pickOfflineTool(userText.toLowerCase());
  const traces: ToolCallTrace[] = [];
  let content = refusalMessage;
  let toolName = "";

  if (tool === "__chat__") {
    content =
      "Здравствуйте! Я ассистент «СтройКонтроль» (сейчас — в офлайн-режиме, отвечаю по ключевым темам). " +
      "Помогу с объектами, сметами, документами (КС-2/КС-3/акты/счета), нормативами и вопросами по строительству. " +
      "Спросите, например: «какие сметы на проверке?» или «что такое КС-2?».";
  } else if (tool) {
    try {
      const out = await callTool(deps, tool, args);
      traces.push({ name: tool, args, result: truncate(JSON.stringify(out), 800) });
      toolName = tool;
      content =
        "Ассистент работает в демонстрационном (офлайн) режиме без подключённой LLM. " +
        "Вот актуальные данные платформы по запросу:\n" + truncate(JSON.stringify(out), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      traces.push({ name: tool, args, result: "", error: msg });
      content = `Инструмент ${tool} вернул ошибку: ${msg}. Переформулируйте вопрос.`;
    }
  }

  const reply = await appendAssistant(deps.ai, convId, content, toolName, 0, 0);
  return { message: reply, toolCalls: traces };
}

async function appendAssistant(
  ai: OfflineDeps["ai"],
  conversationId: string,
  content: string,
  toolName: string,
  tokensIn: number,
  tokensOut: number,
): Promise<AIMessage> {
  const msg: AIMessage = {
    id: crypto.randomUUID(),
    conversationId,
    role: "assistant",
    content,
    toolName: toolName || undefined,
    tokensIn,
    tokensOut,
    createdAt: new Date().toISOString(),
  };
  await ai.appendMessage(msg);
  return msg;
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}

// extractCodes — коды нормативов из результата search_normative (для sources).
function extractCodes(out: unknown): string[] {
  const items = (out as { items?: Array<{ code?: unknown }> })?.items;
  if (!Array.isArray(items)) return [];
  return items.map((i) => String(i?.code ?? "")).filter(Boolean);
}
