// Нормативная база, журнал активности и хранилище AI (D1).
// Зеркала normative_repo.go, activity_repo.go, ai_repo.go.

import { ForbiddenError, NotFoundError } from "../lib/errors";
import { newId, nowIso, truncate } from "../lib/util";
import type { Activity, AIConversation, AIMessage, AIUsage, NormativeDoc } from "../types";

interface NormativeRow {
  id: string;
  code: string;
  title: string;
  section: string;
  content: string;
  keywords: string;
}

// Токен-перекрытие: запрос разбивается на слова, релевантность — число совпавших
// слов в code+title+content; совпадение по коду даёт +3 (зеркало NormativeService.Search).
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)
    .filter((t) => t.length > 2);
}

function scoreDoc(q: string, r: NormativeRow): number {
  const tokens = tokenize(q);
  if (tokens.length === 0) return 0;
  const code = r.code.toLowerCase();
  const title = r.title.toLowerCase();
  const content = r.content.toLowerCase();
  const keywords = r.keywords.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (code.includes(t)) score += 3;
    if (title.includes(t)) score += 2;
    if (keywords.includes(t)) score += 2;
    if (content.includes(t)) score += 1;
  }
  return score;
}

export class NormativeRepo {
  constructor(private readonly db: D1Database) {}

  async search(q: string, limit: number): Promise<NormativeDoc[]> {
    const res = await this.db.prepare(`SELECT * FROM normative_docs`).all<NormativeRow>();
    const rows = res.results ?? [];
    if (!q.trim()) {
      return rows.slice(0, limit).map((r) => ({ id: r.id, code: r.code, title: r.title, section: r.section, content: r.content }));
    }
    return rows
      .map((r) => ({ r, score: scoreDoc(q, r) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => ({ id: x.r.id, code: x.r.code, title: x.r.title, section: x.r.section, content: x.r.content }));
  }
}

interface ActivityRow {
  id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  created_at: string;
}

export class ActivityRepo {
  constructor(private readonly db: D1Database) {}

  async add(inp: { actorId: string; actorName: string; action: string; entityType: string; entityId: string; summary: string }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO activity (id, actor_id, actor_name, action, entity_type, entity_id, summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(newId(), inp.actorId, inp.actorName, inp.action, inp.entityType, inp.entityId, inp.summary, nowIso())
      .run();
  }

  async recent(limit: number): Promise<Activity[]> {
    const res = await this.db
      .prepare(`SELECT * FROM activity ORDER BY created_at DESC LIMIT ?`)
      .bind(limit)
      .all<ActivityRow>();
    return (res.results ?? []).map((r) => ({
      id: r.id, actorId: r.actor_id, actorName: r.actor_name, action: r.action,
      entityType: r.entity_type, entityId: r.entity_id, summary: r.summary, createdAt: r.created_at,
    }));
  }
}

interface ConvRow {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface MsgRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_name: string;
  tokens_in: number;
  tokens_out: number;
  created_at: string;
}

function mapMsg(r: MsgRow): AIMessage {
  return {
    id: r.id, conversationId: r.conversation_id, role: r.role, content: r.content,
    ...(r.tool_name ? { toolName: r.tool_name } : {}),
    tokensIn: r.tokens_in, tokensOut: r.tokens_out, createdAt: r.created_at,
  };
}

export class AIRepo {
  constructor(private readonly db: D1Database) {}

  async createConversation(userId: string, title: string): Promise<AIConversation> {
    const now = nowIso();
    const conv: AIConversation = { id: newId(), userId, title, createdAt: now, updatedAt: now };
    await this.db
      .prepare(`INSERT INTO ai_conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(conv.id, conv.userId, conv.title, conv.createdAt, conv.updatedAt)
      .run();
    return conv;
  }

  async getConversation(id: string): Promise<AIConversation> {
    const row = await this.db
      .prepare(`SELECT * FROM ai_conversations WHERE id = ?`)
      .bind(id)
      .first<ConvRow>();
    if (!row) throw NotFoundError();
    // Чужой диалог недоступен (изоляция владельца, как в Go).
    return { id: row.id, userId: row.user_id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  async assertOwner(id: string, userId: string): Promise<AIConversation> {
    const conv = await this.getConversation(id);
    if (conv.userId !== userId) throw ForbiddenError();
    return conv;
  }

  async touch(id: string, title: string): Promise<void> {
    await this.db
      .prepare(`UPDATE ai_conversations SET updated_at = ?, title = CASE WHEN ? <> '' AND title = '' THEN ? ELSE title END WHERE id = ?`)
      .bind(nowIso(), title, title, id)
      .run();
  }

  async listConversations(userId: string, limit: number): Promise<AIConversation[]> {
    const res = await this.db
      .prepare(`SELECT * FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?`)
      .bind(userId, limit)
      .all<ConvRow>();
    return (res.results ?? []).map((r) => ({ id: r.id, userId: r.user_id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  async appendMessage(m: AIMessage): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO ai_messages (id, conversation_id, role, content, tool_name, tokens_in, tokens_out, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(m.id, m.conversationId, m.role, m.content, m.toolName ?? "", m.tokensIn, m.tokensOut, m.createdAt)
      .run();
  }

  async listMessages(conversationId: string, limit: number): Promise<AIMessage[]> {
    // Последние limit в обратном порядке, разворачиваем в хронологический.
    const res = await this.db
      .prepare(`SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?`)
      .bind(conversationId, limit)
      .all<MsgRow>();
    return (res.results ?? []).map(mapMsg).reverse();
  }

  async usage(): Promise<AIUsage> {
    const row = await this.db
      .prepare(`SELECT tokens_in, tokens_out, requests FROM ai_usage WHERE scope = 'global'`)
      .first<{ tokens_in: number; tokens_out: number; requests: number }>();
    return {
      tokensIn: row?.tokens_in ?? 0,
      tokensOut: row?.tokens_out ?? 0,
      limitTotal: 0, // заполняется сервисом из конфига
      requests: row?.requests ?? 0,
    };
  }

  async addUsage(tokensIn: number, tokensOut: number): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO ai_usage (scope, tokens_in, tokens_out, requests) VALUES ('global', ?, ?, 1)
         ON CONFLICT (scope) DO UPDATE SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ?, requests = requests + 1`,
      )
      .bind(tokensIn, tokensOut, tokensIn, tokensOut)
      .run();
  }
}

export { truncate };
