// Репозиторий смет и позиций (D1). Зеркало backend/internal/store/estimate_repo.go.

import { ConflictError, NotFoundError, VersionMismatchError } from "../lib/errors";
import { matchesSearch, newId, nowIso, nullIfEmpty } from "../lib/util";
import type { Estimate, EstimateItem, EstimateStatus } from "../types";

interface EstimateRow {
  id: string;
  project_id: string;
  project_name: string;
  stage_id: string;
  number: string;
  name: string;
  status: EstimateStatus;
  currency: string;
  total_minor: number;
  item_count: number;
  created_by: string;
  created_by_name: string;
  approved_by: string;
  approved_at: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface ItemRow {
  id: string;
  estimate_id: string;
  position: number;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  unit_price_minor: number;
  total_minor: number;
  category: string;
}

function mapEstimate(r: EstimateRow): Estimate {
  return {
    id: r.id,
    projectId: r.project_id,
    ...(r.project_name ? { projectName: r.project_name } : {}),
    ...(r.stage_id ? { stageId: r.stage_id } : {}),
    number: r.number,
    name: r.name,
    status: r.status,
    currency: r.currency,
    totalMinor: r.total_minor,
    itemCount: r.item_count,
    createdBy: r.created_by,
    ...(r.created_by_name ? { createdByName: r.created_by_name } : {}),
    ...(r.approved_by ? { approvedBy: r.approved_by } : {}),
    ...(r.approved_at ? { approvedAt: r.approved_at } : {}),
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapItem(r: ItemRow): EstimateItem {
  return {
    id: r.id,
    estimateId: r.estimate_id,
    position: r.position,
    code: r.code,
    name: r.name,
    unit: r.unit,
    quantity: r.quantity,
    unitPriceMinor: r.unit_price_minor,
    totalMinor: r.total_minor,
    category: r.category,
  };
}

export interface EstimateFilter {
  projectId?: string;
  status?: string;
  search?: string;
}

const BASE_SELECT = `SELECT e.*, p.name AS project_name,
    (SELECT COUNT(*) FROM estimate_items ei WHERE ei.estimate_id = e.id) AS item_count,
    u.full_name AS created_by_name
  FROM estimates e
  JOIN projects p ON p.id = e.project_id
  LEFT JOIN users u ON u.id = e.created_by`;

export class EstimateRepo {
  constructor(private readonly db: D1Database) {}

  async list(f: EstimateFilter, page: { limit: number; offset: number }): Promise<{ items: Estimate[]; total: number }> {
    // Поиск (кириллица) — в JS, как и в проектах: lower() D1 не сворачивает не-ASCII.
    const conds: string[] = [];
    const args: unknown[] = [];
    if (f.projectId) {
      conds.push("e.project_id = ?");
      args.push(f.projectId);
    }
    if (f.status) {
      conds.push("e.status = ?");
      args.push(f.status);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const res = await this.db
      .prepare(`${BASE_SELECT} ${where} ORDER BY e.created_at DESC`)
      .bind(...args)
      .all<EstimateRow>();
    let rows = res.results ?? [];
    if (f.search) rows = rows.filter((r) => matchesSearch(r.name, f.search!) || matchesSearch(r.number, f.search!));
    const total = rows.length;
    const items = rows.slice(page.offset, page.offset + page.limit).map(mapEstimate);
    return { items, total };
  }

  async getByID(id: string): Promise<Estimate | null> {
    const row = await this.db.prepare(`${BASE_SELECT} WHERE e.id = ?`).bind(id).first<EstimateRow>();
    return row ? mapEstimate(row) : null;
  }

  async mustGet(id: string): Promise<Estimate> {
    const e = await this.getByID(id);
    if (!e) throw NotFoundError();
    return e;
  }

  // Дубликат (project_id, number) — 409 (UNIQUE в схеме).
  async duplicateExists(projectId: string, number: string): Promise<boolean> {
    const row = await this.db
      .prepare(`SELECT id FROM estimates WHERE project_id = ? AND lower(number) = lower(?)`)
      .bind(projectId, number)
      .first<{ id: string }>();
    return row !== null;
  }

  async create(
    e: {
      projectId: string; stageId: string; number: string; name: string; currency: string;
      totalMinor: number; createdBy: string;
    },
    items: EstimateItem[],
  ): Promise<Estimate> {
    const now = nowIso();
    const id = newId();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO estimates (id, project_id, stage_id, number, name, status, currency, total_minor,
             created_by, approved_by, approved_at, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, NULL, NULL, 1, ?, ?)`,
        )
        .bind(id, e.projectId, nullIfEmpty(e.stageId), e.number, e.name, e.currency, e.totalMinor, e.createdBy, now, now),
      ...items.map((it, i) =>
        this.db
          .prepare(
            `INSERT INTO estimate_items (id, estimate_id, position, code, name, unit, quantity, unit_price_minor, total_minor, category)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(newId(), id, i + 1, it.code, it.name, it.unit, it.quantity, it.unitPriceMinor, it.totalMinor, it.category),
      ),
    ]);
    return await this.mustGet(id);
  }

  async items(estimateId: string): Promise<EstimateItem[]> {
    const res = await this.db
      .prepare(`SELECT * FROM estimate_items WHERE estimate_id = ? ORDER BY position`)
      .bind(estimateId)
      .all<ItemRow>();
    return (res.results ?? []).map(mapItem);
  }

  async updateHeader(id: string, inp: { name: string; stageId: string; currency: string; version: number }): Promise<Estimate> {
    const res = await this.db
      .prepare(
        `UPDATE estimates SET name = ?, stage_id = ?, currency = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ?`,
      )
      .bind(inp.name, nullIfEmpty(inp.stageId), inp.currency, nowIso(), id, inp.version)
      .run();
    if ((res.meta?.changes ?? 0) === 0) {
      const existing = await this.getByID(id);
      if (!existing) throw NotFoundError();
      throw VersionMismatchError();
    }
    return this.mustGet(id);
  }

  async updateStatus(id: string, status: EstimateStatus, approvedBy: string, expectedVersion: number): Promise<void> {
    const approvedAt = status === "approved" || status === "rejected" ? nowIso() : "";
    const res = await this.db
      .prepare(
        `UPDATE estimates SET status = ?, approved_by = ?, approved_at = ?, version = version + 1, updated_at = ?
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

  // ReplaceItems — транзакция: удалить позиции, вставить новые, пересчитать итог.
  async replaceItems(estimateId: string, items: EstimateItem[]): Promise<void> {
    await this.db.batch([
      this.db.prepare(`DELETE FROM estimate_items WHERE estimate_id = ?`).bind(estimateId),
      ...items.map((it, i) =>
        this.db
          .prepare(
            `INSERT INTO estimate_items (id, estimate_id, position, code, name, unit, quantity, unit_price_minor, total_minor, category)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(newId(), estimateId, i + 1, it.code, it.name, it.unit, it.quantity, it.unitPriceMinor, it.totalMinor, it.category),
      ),
      this.db
        .prepare(`UPDATE estimates SET total_minor = ?, updated_at = ? WHERE id = ?`)
        .bind(items.reduce((s, it) => s + it.totalMinor, 0), nowIso(), estimateId),
    ]);
  }

  async del(id: string): Promise<void> {
    const res = await this.db.prepare(`DELETE FROM estimates WHERE id = ?`).bind(id).run();
    if ((res.meta?.changes ?? 0) === 0) throw NotFoundError();
  }
}
