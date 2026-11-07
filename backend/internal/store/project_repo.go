package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/service"
)

// ProjectRepo — реализация service.ProjectRepository.
type ProjectRepo struct{ db *DB }

// NewProjectRepo создаёт репозиторий объектов.
func NewProjectRepo(db *DB) *ProjectRepo { return &ProjectRepo{db: db} }

var _ service.ProjectRepository = (*ProjectRepo)(nil)

const projectCols = `p.id, p.code, p.name, p.customer, p.address, p.status,
	p.budget_minor, p.spent_minor, p.contract_amount_minor, p.start_date, p.planned_end_date,
	p.actual_end_date, COALESCE(p.manager_id,''), COALESCE(u.full_name,''), p.progress_percent,
	p.version, p.created_at, p.updated_at`

// Create добавляет объект.
func (r *ProjectRepo) Create(ctx context.Context, p *domain.Project) error {
	_, err := r.db.ExecContext(ctx, r.db.Rebind(`
		INSERT INTO projects (id, code, name, customer, address, status, budget_minor, spent_minor,
			contract_amount_minor, start_date, planned_end_date, actual_end_date, manager_id,
			progress_percent, version, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		p.ID, p.Code, p.Name, p.Customer, p.Address, string(p.Status), p.BudgetMinor, p.SpentMinor,
		p.ContractAmountMinor, p.StartDate, p.PlannedEndDate, p.ActualEndDate, nullIfEmpty(p.ManagerID),
		p.ProgressPercent, p.Version, fmtTime(p.CreatedAt), fmtTime(p.UpdatedAt))
	if err != nil {
		if isUniqueViolation(err) {
			return domain.NewConflict("объект с таким кодом уже существует")
		}
		return err
	}
	return nil
}

// GetByID возвращает объект по идентификатору.
func (r *ProjectRepo) GetByID(ctx context.Context, id string) (*domain.Project, error) {
	row := r.db.QueryRowContext(ctx, r.db.Rebind(`
		SELECT `+projectCols+` FROM projects p LEFT JOIN users u ON u.id = p.manager_id
		WHERE p.id = ?`), id)
	p, err := scanProject(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return p, err
}

// List возвращает страницу объектов с фильтрами.
func (r *ProjectRepo) List(ctx context.Context, f service.ProjectFilter, page domain.Page) (domain.ListResult[domain.Project], error) {
	page = page.Normalize()
	where, args := buildProjectWhere(f)

	var total int
	if err := r.db.QueryRowContext(ctx, r.db.Rebind(`SELECT COUNT(*) FROM projects p WHERE `+where), args...).Scan(&total); err != nil {
		return domain.ListResult[domain.Project]{}, err
	}

	query := `SELECT ` + projectCols + ` FROM projects p
		LEFT JOIN users u ON u.id = p.manager_id
		WHERE ` + where + ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
	args = append(args, page.Limit, page.Offset)

	rows, err := r.db.QueryContext(ctx, r.db.Rebind(query), args...)
	if err != nil {
		return domain.ListResult[domain.Project]{}, err
	}
	defer rows.Close()

	items := make([]domain.Project, 0, page.Limit)
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return domain.ListResult[domain.Project]{}, err
		}
		items = append(items, *p)
	}
	return domain.ListResult[domain.Project]{Items: items, Total: total, Limit: page.Limit, Offset: page.Offset}, rows.Err()
}

func buildProjectWhere(f service.ProjectFilter) (string, []any) {
	conds := []string{"1=1"}
	args := []any{}
	if f.Status != "" {
		conds = append(conds, "p.status = ?")
		args = append(args, f.Status)
	}
	if f.ManagerID != "" {
		conds = append(conds, "p.manager_id = ?")
		args = append(args, f.ManagerID)
	}
	if s := strings.TrimSpace(f.Search); s != "" {
		conds = append(conds, "(lower(p.name) LIKE ? OR lower(p.code) LIKE ? OR lower(p.customer) LIKE ?)")
		like := "%" + strings.ToLower(s) + "%"
		args = append(args, like, like, like)
	}
	return strings.Join(conds, " AND "), args
}

// Update сохраняет объект с оптимистической блокировкой по version.
func (r *ProjectRepo) Update(ctx context.Context, p *domain.Project) error {
	res, err := r.db.ExecContext(ctx, r.db.Rebind(`
		UPDATE projects SET code = ?, name = ?, customer = ?, address = ?, status = ?,
			budget_minor = ?, contract_amount_minor = ?, start_date = ?, planned_end_date = ?,
			actual_end_date = ?, manager_id = ?, progress_percent = ?, version = version + 1, updated_at = ?
		WHERE id = ? AND version = ?`),
		p.Code, p.Name, p.Customer, p.Address, string(p.Status), p.BudgetMinor,
		p.ContractAmountMinor, p.StartDate, p.PlannedEndDate, p.ActualEndDate, nullIfEmpty(p.ManagerID),
		p.ProgressPercent, fmtTime(nowUTC()), p.ID, p.Version)
	if err != nil {
		if isUniqueViolation(err) {
			return domain.NewConflict("объект с таким кодом уже существует")
		}
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return mapVersionMiss(ctx, r.db, "projects", p.ID, p.Version)
	}
	return nil
}

// Delete удаляет объект.
func (r *ProjectRepo) Delete(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx, r.db.Rebind(`DELETE FROM projects WHERE id = ?`), id)
	if err != nil {
		return err
	}
	return affectedOrNotFound(res)
}

// AddSpent атомарно увеличивает фактически потраченную сумму по объекту.
func (r *ProjectRepo) AddSpent(ctx context.Context, id string, deltaMinor int64) error {
	if deltaMinor == 0 {
		return nil
	}
	res, err := r.db.ExecContext(ctx, r.db.Rebind(`
		UPDATE projects SET spent_minor = spent_minor + ?, updated_at = ? WHERE id = ?`),
		deltaMinor, fmtTime(nowUTC()), id)
	if err != nil {
		return err
	}
	return affectedOrNotFound(res)
}

// ListStages возвращает этапы объекта в порядке следования.
func (r *ProjectRepo) ListStages(ctx context.Context, projectID string) ([]domain.ProjectStage, error) {
	rows, err := r.db.QueryContext(ctx, r.db.Rebind(`
		SELECT id, project_id, name, sequence, status, planned_start, planned_end,
			progress_percent, planned_minor, actual_minor
		FROM project_stages WHERE project_id = ? ORDER BY sequence`), projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.ProjectStage{}
	for rows.Next() {
		var s domain.ProjectStage
		var status string
		if err := rows.Scan(&s.ID, &s.ProjectID, &s.Name, &s.Sequence, &status, &s.PlannedStart,
			&s.PlannedEnd, &s.ProgressPercent, &s.PlannedMinor, &s.ActualMinor); err != nil {
			return nil, err
		}
		s.Status = domain.StageStatus(status)
		out = append(out, s)
	}
	return out, rows.Err()
}

// GetStage возвращает этап по идентификатору.
func (r *ProjectRepo) GetStage(ctx context.Context, id string) (*domain.ProjectStage, error) {
	var s domain.ProjectStage
	var status string
	err := r.db.QueryRowContext(ctx, r.db.Rebind(`
		SELECT id, project_id, name, sequence, status, planned_start, planned_end,
			progress_percent, planned_minor, actual_minor
		FROM project_stages WHERE id = ?`), id).
		Scan(&s.ID, &s.ProjectID, &s.Name, &s.Sequence, &status, &s.PlannedStart,
			&s.PlannedEnd, &s.ProgressPercent, &s.PlannedMinor, &s.ActualMinor)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	s.Status = domain.StageStatus(status)
	return &s, nil
}

// Summary собирает KPI дашборда набором агрегатных запросов.
func (r *ProjectRepo) Summary(ctx context.Context) (domain.DashboardSummary, error) {
	s := domain.DashboardSummary{GeneratedAt: nowUTC()}

	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM projects`).Scan(&s.ProjectsTotal); err != nil {
		return s, err
	}
	if err := r.db.QueryRowContext(ctx, r.db.Rebind(`SELECT COUNT(*) FROM projects WHERE status = ?`),
		string(domain.ProjectActive)).Scan(&s.ProjectsActive); err != nil {
		return s, err
	}
	if err := r.db.QueryRowContext(ctx, `
		SELECT COALESCE(SUM(budget_minor),0), COALESCE(SUM(spent_minor),0) FROM projects`).
		Scan(&s.BudgetMinor, &s.SpentMinor); err != nil {
		return s, err
	}
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM estimates`).Scan(&s.EstimatesTotal); err != nil {
		return s, err
	}
	if err := r.db.QueryRowContext(ctx, r.db.Rebind(`SELECT COUNT(*) FROM estimates WHERE status = ?`),
		string(domain.EstimateOnReview)).Scan(&s.EstimatesPending); err != nil {
		return s, err
	}
	if err := r.db.QueryRowContext(ctx, r.db.Rebind(`SELECT COUNT(*) FROM documents WHERE status IN (?, ?)`),
		string(domain.DocDraft), string(domain.DocSubmitted)).Scan(&s.DocumentsPending); err != nil {
		return s, err
	}
	if err := r.db.QueryRowContext(ctx, r.db.Rebind(`
		SELECT COUNT(*) FROM projects
		WHERE planned_end_date <> '' AND planned_end_date < ? AND status <> ?`),
		nowUTC().Format("2006-01-02"), string(domain.ProjectCompleted)).Scan(&s.OverdueProjects); err != nil {
		return s, err
	}

	// Распределение по статусам.
	byStatus, err := r.statusCounts(ctx)
	if err != nil {
		return s, err
	}
	s.ProjectsByStatus = byStatus

	// Топ объектов по бюджету.
	budgets, err := r.projectBudgets(ctx, 8)
	if err != nil {
		return s, err
	}
	s.BudgetsByProject = budgets

	// Последние действия.
	activities, err := r.recentActivity(ctx, 10)
	if err != nil {
		return s, err
	}
	s.RecentActivity = activities
	return s, nil
}

func (r *ProjectRepo) statusCounts(ctx context.Context) ([]domain.StatusCount, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT status, COUNT(*) FROM projects GROUP BY status ORDER BY status`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.StatusCount{}
	for rows.Next() {
		var sc domain.StatusCount
		if err := rows.Scan(&sc.Status, &sc.Count); err != nil {
			return nil, err
		}
		out = append(out, sc)
	}
	return out, rows.Err()
}

func (r *ProjectRepo) projectBudgets(ctx context.Context, limit int) ([]domain.ProjectBudget, error) {
	rows, err := r.db.QueryContext(ctx, r.db.Rebind(`
		SELECT id, code, name, budget_minor, spent_minor, progress_percent
		FROM projects ORDER BY budget_minor DESC LIMIT ?`), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.ProjectBudget{}
	for rows.Next() {
		var b domain.ProjectBudget
		if err := rows.Scan(&b.ProjectID, &b.Code, &b.Name, &b.BudgetMinor, &b.SpentMinor, &b.ProgressPercent); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (r *ProjectRepo) recentActivity(ctx context.Context, limit int) ([]domain.Activity, error) {
	rows, err := r.db.QueryContext(ctx, r.db.Rebind(`
		SELECT id, actor_id, actor_name, action, entity_type, entity_id, summary, created_at
		FROM activity ORDER BY created_at DESC LIMIT ?`), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Activity{}
	for rows.Next() {
		var a domain.Activity
		var created string
		if err := rows.Scan(&a.ID, &a.ActorID, &a.ActorName, &a.Action, &a.EntityType,
			&a.EntityID, &a.Summary, &created); err != nil {
			return nil, err
		}
		a.CreatedAt = parseTime(created)
		out = append(out, a)
	}
	return out, rows.Err()
}

func scanProject(s scanner) (*domain.Project, error) {
	var (
		p        domain.Project
		status   string
		created  string
		updated  string
		manager  string
	)
	if err := s.Scan(&p.ID, &p.Code, &p.Name, &p.Customer, &p.Address, &status,
		&p.BudgetMinor, &p.SpentMinor, &p.ContractAmountMinor, &p.StartDate, &p.PlannedEndDate,
		&p.ActualEndDate, &manager, &p.ManagerName, &p.ProgressPercent,
		&p.Version, &created, &updated); err != nil {
		return nil, err
	}
	p.Status = domain.ProjectStatus(status)
	p.ManagerID = manager
	p.CreatedAt = parseTime(created)
	p.UpdatedAt = parseTime(updated)
	return &p, nil
}

// mapVersionMiss различает «не найдено» и «изменено другим пользователем».
func mapVersionMiss(ctx context.Context, db *DB, table, id string, version int) error {
	var exists int
	q := db.Rebind(`SELECT COUNT(*) FROM ` + table + ` WHERE id = ?`)
	if err := db.QueryRowContext(ctx, q, id).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return domain.ErrNotFound
	}
	return fmt.Errorf("%w: запись изменена другим пользователем (ожидалась версия %d)", domain.ErrVersionMismatch, version)
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
