// Детерминированный офлайн-ассистент — зеркало backend/internal/ai (Go — эталон).
// В edge-версии внешняя LLM не подключается: ассистент маршрутизирует запрос
// по ключевым словам к одному из whitelisted инструментов и возвращает реальные
// данные платформы. Вне области продукта — вежливый отказ. Бюджет токенов
// демо-режима (500 000) учитывается в ai_usage.

import { truncate, formatMoney } from "../lib/util";
import { AIRepo } from "../repositories/misc";
import { NormativeRepo } from "../repositories/misc";
import { ProjectRepo } from "../repositories/projects";
import { EstimateRepo } from "../repositories/estimates";
import { DocumentRepo } from "../repositories/documents";
import { analyzeItems } from "../services/analyze";
import type { AIMessage, AIChatResult, AIUsage, ToolCallTrace } from "../types";

export const BUDGET_TOKENS = 100_000;

export const limitedMessage =
  "Демо-режим ассистента закончился: исчерпан лимит токенов (100 000 входящих и исходящих суммарно на весь сайт). " +
  "Ассистент отключён до сброса бюджета администратором. Остальные функции платформы работают в полном объёме.";

export const refusalMessage =
  "Я помогаю только по работе с платформой СтройКонтроль: объекты, сметы, документы " +
  "(КС-2/КС-3/акты/счета), нормативы и работа с интерфейсом. Уточните вопрос в этих рамках.";

// pickOfflineTool — выбор инструмента по ключевым словам (как в Go).
// __chat__ — болтовня/приветствия: отвечаем дружелюбно без инструментов.
export function pickOfflineTool(q: string): { tool: string; args: string } {
  const s = q.toLowerCase();
  if (containsAny(s, ["привет", "здравствуй", "добрый день", "добрый вечер", "доброе утро", "как дела", "спасибо", "кто ты", "что ты умеешь"])) {
    return { tool: "__chat__", args: JSON.stringify({ query: q }) };
  }
  if (containsAny(s, ["норматив", "гост", "снип", "сп ", "фер", "правил", "документооборот", "материал", "фундамент", "отделк", "кровл", "монтаж", "сметн", "безопасност", "охран", "тб", "технолог", "срок", "penalty", "неустойк"])) {
    return { tool: "search_normative", args: JSON.stringify({ query: q }) };
  }
  if (containsAny(s, ["смет", "аномал", "провер"])) {
    return { tool: "list_pending_approvals", args: "{}" };
  }
  if (containsAny(s, ["документ", "кс-2", "кс2", "кс-3", "кс3", "акт", "счет", "счёт"])) {
    return { tool: "list_documents", args: "{}" };
  }
  if (containsAny(s, ["объект", "проект", "бюджет", "перерасход", "затрат"])) {
    return { tool: "project_overview", args: "{}" };
  }
  // Вне области продукта: инструмент не вызываем.
  return { tool: "", args: "" };
}

function containsAny(s: string, words: string[]): boolean {
  return words.some((w) => s.includes(w));
}

export interface OfflineDeps {
  projects: ProjectRepo;
  estimates: EstimateRepo;
  documents: DocumentRepo;
  normative: NormativeRepo;
  ai: AIRepo;
}

// callTool — выполнение whitelisted инструмента с реальными данными платформы.
export async function callTool(deps: OfflineDeps, name: string, argsJSON: string): Promise<unknown> {
  const args = safeParse(argsJSON);
  switch (name) {
    case "list_projects": {
      const { items, total } = await deps.projects.list({}, { limit: 10, offset: 0 });
      return {
        total,
        items: items.map((p) => ({
          code: p.code,
          name: p.name,
          status: p.status,
          budget: formatMoney(p.budgetMinor),
          spent: formatMoney(p.spentMinor),
          budgetMinor: p.budgetMinor,
          spentMinor: p.spentMinor,
          progressPercent: p.progressPercent,
          customer: p.customer,
        })),
      };
    }
    case "project_overview": {
      const s = await deps.projects.summary();
      const overruns = s.budgetsByProject
        .filter((b) => b.spentMinor > b.budgetMinor)
        .map((b) => ({
          code: b.code,
          name: b.name,
          overrunMinor: b.spentMinor - b.budgetMinor,
          overrun: formatMoney(b.spentMinor - b.budgetMinor),
        }));
      return {
        projectsTotal: s.projectsTotal,
        projectsActive: s.projectsActive,
        budget: formatMoney(s.budgetMinor),
        spent: formatMoney(s.spentMinor),
        estimatesPending: s.estimatesPending,
        documentsPending: s.documentsPending,
        overdueProjects: s.overdueProjects,
        overruns,
      };
    }
    case "analyze_estimate": {
      const id = typeof args.estimateId === "string" ? args.estimateId : "";
      if (!id) throw new Error("estimateId обязателен");
      const e = await deps.estimates.mustGet(id);
      const items = await deps.estimates.items(id);
      return analyzeItems(e.id, e.totalMinor, items);
    }
    case "list_pending_approvals": {
      const { items: est } = await deps.estimates.list({ status: "on_review" }, { limit: 10, offset: 0 });
      const { items: docs } = await deps.documents.list({ status: "submitted" }, { limit: 10, offset: 0 });
      return {
        estimates: est.map((e) => ({ id: e.id, number: e.number, name: e.name, total: formatMoney(e.totalMinor), totalMinor: e.totalMinor })),
        documents: docs.map((d) => ({
          id: d.id,
          type: d.type,
          number: d.number,
          title: d.title,
          amount: formatMoney(d.amountMinor),
          amountMinor: d.amountMinor,
        })),
      };
    }
    case "search_normative": {
      const q = typeof args.query === "string" ? args.query : "";
      if (!q.trim()) throw new Error("query обязателен");
      const items = await deps.normative.search(q, 5);
      return { items: items.map((n) => ({ code: n.code, title: n.title, section: n.section, content: n.content })) };
    }
    case "list_documents": {
      const { items, total } = await deps.documents.list({}, { limit: 10, offset: 0 });
      return {
        total,
        items: items.map((d) => ({
          id: d.id,
          type: d.type,
          number: d.number,
          title: d.title,
          status: d.status,
          amount: formatMoney(d.amountMinor),
        })),
      };
    }
    default:
      throw new Error(`неизвестный инструмент: ${name}`);
  }
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json) as unknown;
    return (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function summarizeOffline(tool: string, out: unknown): string {
  const json = JSON.stringify(out);
  switch (tool) {
    case "project_overview":
      return "Сводка по портфелю объектов:\n" + json;
    case "list_documents":
      return "Документы:\n" + json;
    case "search_normative":
      return "Найденные нормативные документы:\n" + json;
    case "list_pending_approvals":
      return "Ожидают согласования:\n" + json;
    default:
      return json;
  }
}

// ask — полный офлайн-цикл: бюджет -> диалог -> инструмент -> ответ.
export async function askOffline(
  deps: OfflineDeps,
  actor: { uid: string },
  conversationID: string,
  userText: string,
): Promise<AIChatResult> {
  const conv = await ensureConversation(deps, conversationID, actor.uid, userText);

  const usage = await deps.ai.usage();
  const usageWithLimit: AIUsage = { ...usage, limitTotal: BUDGET_TOKENS };

  // Бюджет демо-режима проверяется ДО вызова инструмента.
  if (usage.tokensIn + usage.tokensOut >= BUDGET_TOKENS) {
    const reply = await appendAssistant(deps.ai, conv.id, limitedMessage, "", 0, 0);
    await deps.ai.touch(conv.id, "");
    return { conversationId: conv.id, message: reply, usage: usageWithLimit, limited: true };
  }

  await deps.ai.appendMessage({
    id: crypto.randomUUID(),
    conversationId: conv.id,
    role: "user",
    content: userText,
    tokensIn: 0,
    tokensOut: 0,
    createdAt: new Date().toISOString(),
  });

  const { tool, args } = pickOfflineTool(userText.toLowerCase());
  const traces: ToolCallTrace[] = [];
  let content = refusalMessage;
  let toolName = "";

  if (tool === "__chat__") {
    content =
      "Здравствуйте! Я ассистент «СтройКонтроль». Помогу с объектами, сметами, документами " +
      "(КС-2/КС-3/акты/счета), нормативами и вообще вопросами по строительству. " +
      "Спросите, например: «какие сметы сейчас на проверке?» или «что такое КС-2?».";
  } else if (tool) {
    try {
      const out = await callTool(deps, tool, args);
      traces.push({ name: tool, args, result: truncate(JSON.stringify(out), 800) });
      toolName = tool;
      content =
        "Ассистент работает в демонстрационном (офлайн) режиме без подключённой LLM. " +
        "\n\nВот актуальные данные по запросу:\n" +
        summarizeOffline(tool, out) +
        "\n\nДля полноценных ответов подключите модель через переменные AI_BASE_URL и AI_API_KEY.";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      traces.push({ name: tool, args, result: "", error: msg });
      content = `Инструмент ${tool} вернул ошибку: ${msg}. Попробуйте переформулировать вопрос.`;
    }
  }

  const reply = await appendAssistant(deps.ai, conv.id, content, toolName, 0, 0);
  await deps.ai.touch(conv.id, "");
  return { conversationId: conv.id, message: reply, usage: usageWithLimit, limited: false, toolCalls: traces };
}

async function ensureConversation(deps: OfflineDeps, conversationID: string, uid: string, firstText: string) {
  if (conversationID) {
    // Владелец проверяется: чужой диалог недоступен.
    return deps.ai.assertOwner(conversationID, uid);
  }
  return deps.ai.createConversation(uid, truncate(firstText, 60));
}

async function appendAssistant(
  ai: AIRepo,
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
