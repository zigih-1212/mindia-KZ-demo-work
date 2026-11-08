// Репозиторий исполнительной документации (D1). Зеркало document_repo.go.

import { ConflictError, NotFoundError, VersionMismatchError } from "../lib/errors";
import { matchesSearch, newId, nowIso } from "../lib/util";
import type { DocumentDTO, DocumentStatus, DocumentType } from "../types";

interface DocRow {
  id: string;
  project_id: string;
  project_name: string;
  type: DocumentType;
  number: string;
  title: string;
  status: DocumentStatus;
  period_from: string;
  period_to: string;
  amount_minor: number;
  created_by: string;
  created_by_name: string;
  approved_by: string;
  approved_at: string;
  version: number;
  created_at: string;
  updated_at: string;
}

function mapDoc(r: DocRow): DocumentDTO {
  return {
    id: r.id,
    projectId: r.project_id,
    ...(r.project_name ? { projectName: r.project_name } : {}),
    type: r.type,
    number: r.number,
    title: r.title,
    status: r.status,
    periodFrom: r.period_from,
    periodTo: r.period_to,
    amountMinor: r.amount_minor,
    createdBy: r.created_by,
    ...(r.created_by_name ? { createdByName: r.created_by_name } : {}),
    ...(r.approved_by ? { approvedBy: r.approved_by } : {}),
    ...(r.approved_at ? { approvedAt: r.approved_at } : {}),
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface DocumentFilter {
  projectId?: string;
  status?: string;
  type?: string;
  search?: string;
}

export interface DocumentInput {
  projectId: string;
  type: DocumentType;
  number: string;
  title: string;
  periodFrom: string;
  periodTo: string;
  amountMinor: number;
  createdBy: string;
}

const BASE_SELECT = `SELECT d.*, p.name AS project_name, u.full_name AS created_by_name
  FROM documents d
  JOIN projects p ON p.id = d.project_id
  LEFT JOIN users u ON u.id = d.created_by`;

export class DocumentRepo {
  constructor(private readonly db: D1Database) {}

  async list(f: DocumentFilter, page: { limit: number; offset: number }): Promise<{ items: DocumentDTO[]; total: number }> {
    // Поиск (кириллица) — в JS (см. util.matchesSearch).
    const conds: string[] = [];
    const args: unknown[] = [];
    if (f.projectId) {
      conds.push("d.project_id = ?");
      args.push(f.projectId);
    }
    if (f.status) {
      conds.push("d.status = ?");
      args.push(f.status);
    }
    if (f.type) {
      conds.push("d.type = ?");
      args.push(f.type);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const res = await this.db
      .prepare(`${BASE_SELECT} ${where} ORDER BY d.created_at DESC`)
      .bind(...args)
      .all<DocRow>();
    let rows = res.results ?? [];
    if (f.search) rows = rows.filter((r) => matchesSearch(r.title, f.search!) || matchesSearch(r.number, f.search!));
    const total = rows.length;
    const items = rows.slice(page.offset, page.offset + page.limit).map(mapDoc);
    return { items, total };
  }

  async getByID(id: string): Promise<DocumentDTO | null> {
    const row = await this.db.prepare(`${BASE_SELECT} WHERE d.id = ?`).bind(id).first<DocRow>();
    return row ? mapDoc(row) : null;
  }

  async mustGet(id: string): Promise<DocumentDTO> {
    const d = await this.getByID(id);
    if (!d) throw NotFoundError();
    return d;
  }

  async create(inp: DocumentInput): Promise<DocumentDTO> {
    const dup = await this.db
      .prepare(`SELECT id FROM documents WHERE project_id = ? AND lower(number) = lower(?)`)
      .bind(inp.projectId, inp.number)
      .first<{ id: string }>();
    if (dup) throw ConflictError();
    const now = nowIso();
    const id = newId();
    await this.db
      .prepare(
        `INSERT INTO documents (id, project_id, type, number, title, status, period_from, period_to,
           amount_minor, created_by, approved_by, approved_at, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, NULL, NULL, 1, ?, ?)`,
      )
      .bind(id, inp.projectId, inp.type, inp.number, inp.title, inp.periodFrom, inp.periodTo, inp.amountMinor, inp.createdBy, now, now)
      .run();
    return this.mustGet(id);
  }

  async updateStatus(id: string, status: DocumentStatus, approvedBy: string, expectedVersion: number): Promise<void> {
    const approvedAt = status === "approved" || status === "rejected" ? nowIso() : "";
    const res = await this.db
      .prepare(
        `UPDATE documents SET status = ?, approved_by = ?, approved_at = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ?`,
      )
      .bind(status, approvedBy || null, approvedAt, nowIso(), id, expectedVersion)
      .run();
    if ((res.meta?.changes ?? 0) === 0) {
      const existing = await this.getByID(id);
      if (!existing) throw NotFoundError();
      throw VersionMismatchError();
    }
  }

  async del(id: string): Promise<void> {
    const res = await this.db.prepare(`DELETE FROM documents WHERE id = ?`).bind(id).run();
    if ((res.meta?.changes ?? 0) === 0) throw NotFoundError();
  }
}
