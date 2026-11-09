// Репозиторий объектов и этапов (D1). Зеркало backend/internal/store/project_repo.go.

import { ConflictError, NotFoundError, VersionMismatchError } from "../lib/errors";
import { matchesSearch, newId, nowIso, nullIfEmpty, today } from "../lib/util";
import type { DashboardSummary, Project, ProjectBudget, ProjectStage, ProjectStatus, StatusCount } from "../types";

interface ProjectRow {
  id: string;
  code: string;
  name: string;
  customer: string;
  address: string;
  status: ProjectStatus;
  budget_minor: number;
  spent_minor: number;
  contract_amount_minor: number;
  start_date: string;
  planned_end_date: string;
  actual_end_date: string;
  manager_id: string;
  manager_name: string;
  progress_percent: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface StageRow {
  id: string;
  project_id: string;
  name: string;
  sequence: number;
  status: string;
  planned_start: string;
  planned_end: string;
  progress_percent: number;
  planned_minor: number;
  actual_minor: number;
}

function mapProject(r: ProjectRow): Project {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    customer: r.customer,
    address: r.address,
    status: r.status,
    budgetMinor: r.budget_minor,
    spentMinor: r.spent_minor,
    contractAmountMinor: r.contract_amount_minor,
    startDate: r.start_date,
    plannedEndDate: r.planned_end_date,
    ...(r.actual_end_date ? { actualEndDate: r.actual_end_date } : {}),
    managerId: r.manager_id,
    ...(r.manager_name ? { managerName: r.manager_name } : {}),
    progressPercent: r.progress_percent,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapStage(r: StageRow): ProjectStage {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    sequence: r.sequence,
    status: r.status as ProjectStage["status"],
    plannedStart: r.planned_start,
    plannedEnd: r.planned_end,
    progressPercent: r.progress_percent,
    plannedMinor: r.planned_minor,
    actualMinor: r.actual_minor,
  };
}

export interface ProjectInput {
  code: string;
  name: string;
  customer: string;
  address: string;
  status: ProjectStatus;
  budgetMinor: number;
  contractAmountMinor: number;
  startDate: string;
  plannedEndDate: string;
  actualEndDate: string;
  managerId: string;
  progressPercent: number;
}

export interface ProjectUpdateInput extends ProjectInput {
  version: number;
}

export interface ProjectFilter {
  status?: string;
  managerId?: string;
  search?: string;
}

export class ProjectRepo {
  constructor(private readonly db: D1Database) {}

  private baseSelect(): string {
    return `SELECT p.*, u.full_name AS manager_name FROM projects p
            LEFT JOIN users u ON u.id = p.manager_id`;
  }

  async list(f: ProjectFilter, page: { limit: number; offset: number }): Promise<{ items: Project[]; total: number }> {
    // Поиск по кириллице не работает в lower() D1, поэтому фильтр поиска — в JS
    // (см. util.matchesSearch; данные демо-масштаба, это осознанный компромисс).
    const conds: string[] = [];
    const args: unknown[] = [];
    if (f.status) {
      conds.push("p.status = ?");
      args.push(f.status);
    }
    if (f.managerId) {
      conds.push("p.manager_id = ?");
      args.push(f.managerId);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const res = await this.db
      .prepare(`${this.baseSelect()} ${where} ORDER BY p.created_at DESC`)
      .bind(...args)
      .all<ProjectRow>();
    let rows = res.results ?? [];
    if (f.search) rows = rows.filter((r) => matchesSearch(r.name, f.search!) || matchesSearch(r.code, f.search!));
    const total = rows.length;
    const items = rows.slice(page.offset, page.offset + page.limit).map(mapProject);
    return { items, total };
  }

  async getByID(id: string): Promise<Project | null> {
    const row = await this.db
      .prepare(`${this.baseSelect()} WHERE p.id = ?`)
      .bind(id)
      .first<ProjectRow>();
    return row ? mapProject(row) : null;
  }

  async mustGet(id: string): Promise<Project> {
    const p = await this.getByID(id);
    if (!p) throw NotFoundError();
    return p;
  }

  async codeExists(code: string): Promise<boolean> {
    const row = await this.db
      .prepare(`SELECT id FROM projects WHERE lower(code) = lower(?)`)
      .bind(code)
      .first<{ id: string }>();
    return row !== null;
  }

  async create(inp: ProjectInput): Promise<Project> {
    const now = nowIso();
    const id = newId();
    await this.db
      .prepare(
        `INSERT INTO projects (id, code, name, customer, address, status, budget_minor, spent_minor,
           contract_amount_minor, start_date, planned_end_date, actual_end_date, manager_id,
           progress_percent, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        id, inp.code, inp.name, inp.customer, inp.address, inp.status, inp.budgetMinor,
        inp.contractAmountMinor, inp.startDate, inp.plannedEndDate, inp.actualEndDate,
        nullIfEmpty(inp.managerId), inp.progressPercent, now, now,
      )
      .run();
    return this.mustGet(id);
  }

  async update(id: string, inp: ProjectUpdateInput): Promise<Project> {
    const res = await this.db
      .prepare(
        `UPDATE projects SET code = ?, name = ?, customer = ?, address = ?, status = ?,
           budget_minor = ?, contract_amount_minor = ?, start_date = ?, planned_end_date = ?,
           actual_end_date = ?, manager_id = ?, progress_percent = ?,
           version = version + 1, updated_at = ?
         WHERE id = ? AND version = ?`,
      )
      .bind(
        inp.code, inp.name, inp.customer, inp.address, inp.status, inp.budgetMinor,
        inp.contractAmountMinor, inp.startDate, inp.plannedEndDate, inp.actualEndDate,
        nullIfEmpty(inp.managerId), inp.progressPercent, nowIso(), id, inp.version,
      )
      .run();
    if ((res.meta?.changes ?? 0) === 0) {
      const existing = await this.getByID(id);
      if (!existing) throw NotFoundError();
      throw VersionMismatchError();
    }
    return this.mustGet(id);
  }

  async del(id: string): Promise<void> {
    const res = await this.db.prepare(`DELETE FROM projects WHERE id = ?`).bind(id).run();
    if ((res.meta?.changes ?? 0) === 0) throw NotFoundError();
  }

  // AddSpent вызывается при утверждении КС-2/КС-3 (см. documents service).
  async addSpent(id: string, amountMinor: number): Promise<void> {
    await this.db
      .prepare(`UPDATE projects SET spent_minor = spent_minor + ?, version = version + 1, updated_at = ? WHERE id = ?`)
      .bind(amountMinor, nowIso(), id)
      .run();
  }

  async stages(projectId: string): Promise<ProjectStage[]> {
    const res = await this.db
      .prepare(`SELECT * FROM project_stages WHERE project_id = ? ORDER BY sequence`)
      .bind(projectId)
      .all<StageRow>();
    return (res.results ?? []).map(mapStage);
  }

  // Summary — зеркало project_repo.go Summary (дашборд).
  async summary(): Promise<DashboardSummary> {
    const batch = await this.db.batch([
      this.db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(budget_minor),0) AS budget, COALESCE(SUM(spent_minor),0) AS spent FROM projects`),
      this.db.prepare(`SELECT status, COUNT(*) AS n FROM projects GROUP BY status`),
      this.db.prepare(`SELECT id AS project_id, code, name, budget_minor, spent_minor, progress_percent FROM projects ORDER BY budget_minor DESC LIMIT 8`),
      this.db.prepare(`SELECT COUNT(*) AS n FROM estimates`),
      this.db.prepare(`SELECT COUNT(*) AS n FROM estimates WHERE status = 'on_review'`),
      this.db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE status IN ('draft','submitted')`),
      this.db.prepare(`SELECT COUNT(*) AS n FROM projects WHERE planned_end_date <> '' AND planned_end_date < ? AND status <> 'completed'`).bind(today()),
    ]);
    const totals = batch[0]!;
    const byStatus = batch[1]!;
    const budgets = batch[2]!;
    const estTotal = batch[3]!;
    const estPending = batch[4]!;
    const docsPending = batch[5]!;
    const overdue = batch[6]!;
    const t = totals.results[0] as unknown as { n: number; budget: number; spent: number };
    const budgetsByProject: ProjectBudget[] = (budgets.results as unknown as ProjectBudgetRow[]).map((r) => ({
      projectId: r.project_id, code: r.code, name: r.name,
      budgetMinor: r.budget_minor, spentMinor: r.spent_minor, progressPercent: r.progress_percent,
    }));
    return {
      projectsTotal: t?.n ?? 0,
      projectsActive: (byStatus.results as unknown as { status: ProjectStatus; n: number }[]).find((r) => r.status === "active")?.n ?? 0,
      budgetMinor: t?.budget ?? 0,
      spentMinor: t?.spent ?? 0,
      estimatesTotal: (estTotal.results[0] as unknown as { n: number })?.n ?? 0,
      estimatesPending: (estPending.results[0] as unknown as { n: number })?.n ?? 0,
      documentsPending: (docsPending.results[0] as unknown as { n: number })?.n ?? 0,
      overdueProjects: (overdue.results[0] as unknown as { n: number })?.n ?? 0,
      projectsByStatus: (byStatus.results as unknown as { status: ProjectStatus; n: number }[]).map((r) => ({ status: r.status, count: r.n })),
      budgetsByProject,
      recentActivity: [],
      generatedAt: nowIso(),
    };
  }
}

interface ProjectBudgetRow {
  project_id: string;
  code: string;
  name: string;
  budget_minor: number;
  spent_minor: number;
  progress_percent: number;
}
