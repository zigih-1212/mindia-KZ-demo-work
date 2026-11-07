package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/service"
)

// EstimateRepo — реализация service.EstimateRepository.
type EstimateRepo struct{ db *DB }

// NewEstimateRepo создаёт репозиторий смет.
func NewEstimateRepo(db *DB) *EstimateRepo { return &EstimateRepo{db: db} }

var _ service.EstimateRepository = (*EstimateRepo)(nil)

const estimateCols = `e.id, e.project_id, COALESCE(p.name,''), COALESCE(e.stage_id,''), e.number, e.name,
	e.status, e.currency, e.total_minor, e.created_by, COALESCE(cu.full_name,''),
	COALESCE(e.approved_by,''), e.approved_at, e.version, e.created_at, e.updated_at`

// Create вставляет смету и её позиции в одной транзакции.
func (r *EstimateRepo) Create(ctx context.Context, e *domain.Estimate, items []domain.EstimateItem) error {
	return r.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, r.db.Rebind(`
			INSERT INTO estimates (id, project_id, stage_id, number, name, status, currency, total_minor,
				created_by, approved_by, approved_at, version, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`),
			e.ID, e.ProjectID, nullIfEmpty(e.StageID), e.Number, e.Name, string(e.Status), e.Currency,
			e.TotalMinor, e.CreatedBy, e.Version, fmtTime(e.CreatedAt), fmtTime(e.UpdatedAt)); err != nil {
			if isUniqueViolation(err) {
				return domain.NewConflict("смета с таким номером уже существует для объекта")
			}
			return err
		}
		for i := range items {
			it := items[i]
			if _, err := tx.ExecContext(ctx, r.db.Rebind(`
				INSERT INTO estimate_items (id, estimate_id, position, code, name, unit, quantity,
					unit_price_minor, total_minor, category)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
				it.ID, e.ID, it.Position, it.Code, it.Name, it.Unit, it.Quantity,
				it.UnitPriceMinor, it.TotalMinor, it.Category); err != nil {
				return err
			}
		}
		return nil
	})
}

// GetByID возвращает смету без позиций.
func (r *EstimateRepo) GetByID(ctx context.Context, id string) (*domain.Estimate, error) {
	row := r.db.QueryRowContext(ctx, r.db.Rebind(`
		SELECT `+estimateCols+` FROM estimates e
		LEFT JOIN projects p ON p.id = e.project_id
		LEFT JOIN users cu ON cu.id = e.created_by
		WHERE e.id = ?`), id)
	e, err := scanEstimate(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	// Число позиций вычисляется отдельно, чтобы не усложнять основной запрос.
	var count int
	if err := r.db.QueryRowContext(ctx, r.db.Rebind(`SELECT COUNT(*) FROM estimate_items WHERE estimate_id = ?`), id).Scan(&count); err != nil {
		return nil, err
	}
	e.ItemCount = count
	return e, nil
}

// List возвращает страницу смет с фильтрами.
func (r *EstimateRepo) List(ctx context.Context, f service.EstimateFilter, page domain.Page) (domain.ListResult[domain.Estimate], error) {
	page = page.Normalize()
	conds := []string{"1=1"}
	args := []any{}
	if f.ProjectID != "" {
		conds = append(conds, "e.project_id = ?")
		args = append(args, f.ProjectID)
	}
	if f.Status != "" {
		conds = append(conds, "e.status = ?")
		args = append(args, f.Status)
	}
	if s := strings.TrimSpace(f.Search); s != "" {
		conds = append(conds, "(lower(e.name) LIKE ? OR lower(e.number) LIKE ?)")
		like := "%" + strings.ToLower(s) + "%"
		args = append(args, like, like)
	}
	where := strings.Join(conds, " AND ")

	var total int
	if err := r.db.QueryRowContext(ctx, r.db.Rebind(`SELECT COUNT(*) FROM estimates e WHERE `+where), args...).Scan(&total); err != nil {
		return domain.ListResult[domain.Estimate]{}, err
	}

	query := `SELECT ` + estimateCols + `,
		(SELECT COUNT(*) FROM estimate_items it WHERE it.estimate_id = e.id)
		FROM estimates e
		LEFT JOIN projects p ON p.id = e.project_id
		LEFT JOIN users cu ON cu.id = e.created_by
		WHERE ` + where + ` ORDER BY e.created_at DESC LIMIT ? OFFSET ?`
	args = append(args, page.Limit, page.Offset)

	rows, err := r.db.QueryContext(ctx, r.db.Rebind(query), args...)
	if err != nil {
		return domain.ListResult[domain.Estimate]{}, err
	}
	defer rows.Close()

	items := make([]domain.Estimate, 0, page.Limit)
	for rows.Next() {
		e, err := scanEstimateWithCount(rows)
		if err != nil {
			return domain.ListResult[domain.Estimate]{}, err
		}
		items = append(items, *e)
	}
	return domain.ListResult[domain.Estimate]{Items: items, Total: total, Limit: page.Limit, Offset: page.Offset}, rows.Err()
}

// Update сохраняет заголовок сметы с оптимистической блокировкой.
func (r *EstimateRepo) Update(ctx context.Context, e *domain.Estimate) error {
	res, err := r.db.ExecContext(ctx, r.db.Rebind(`
		UPDATE estimates SET name = ?, stage_id = ?, currency = ?, version = version + 1, updated_at = ?
		WHERE id = ? AND version = ?`),
		e.Name, nullIfEmpty(e.StageID), e.Currency, fmtTime(nowUTC()), e.ID, e.Version)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return mapVersionMiss(ctx, r.db, "estimates", e.ID, e.Version)
	}
	return nil
}

// UpdateStatus переводит смету в новый статус (для утверждения/отклонения).
func (r *EstimateRepo) UpdateStatus(ctx context.Context, id string, status domain.EstimateStatus, approvedBy string, expectedVersion int) error {
	var approvedAt any
	if status == domain.EstimateApproved {
		approvedAt = fmtTime(nowUTC())
	}
	res, err := r.db.ExecContext(ctx, r.db.Rebind(`
		UPDATE estimates SET status = ?, approved_by = ?, approved_at = ?, version = version + 1, updated_at = ?
		WHERE id = ? AND version = ?`),
		string(status), nullIfEmpty(approvedBy), approvedAt, fmtTime(nowUTC()), id, expectedVersion)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return mapVersionMiss(ctx, r.db, "estimates", id, expectedVersion)
	}
	return nil
}

// ListItems возвращает позиции сметы по порядку.
func (r *EstimateRepo) ListItems(ctx context.Context, estimateID string) ([]domain.EstimateItem, error) {
	rows, err := r.db.QueryContext(ctx, r.db.Rebind(`
		SELECT id, estimate_id, position, code, name, unit, quantity, unit_price_minor, total_minor, category
		FROM estimate_items WHERE estimate_id = ? ORDER BY position`), estimateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.EstimateItem{}
	for rows.Next() {
		var it domain.EstimateItem
		if err := rows.Scan(&it.ID, &it.EstimateID, &it.Position, &it.Code, &it.Name, &it.Unit,
			&it.Quantity, &it.UnitPriceMinor, &it.TotalMinor, &it.Category); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// ReplaceItems заменяет все позиции сметы в одной транзакции.
func (r *EstimateRepo) ReplaceItems(ctx context.Context, estimateID string, items []domain.EstimateItem) error {
	return r.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, r.db.Rebind(`DELETE FROM estimate_items WHERE estimate_id = ?`), estimateID); err != nil {
			return err
		}
		for i := range items {
			it := items[i]
			if _, err := tx.ExecContext(ctx, r.db.Rebind(`
				INSERT INTO estimate_items (id, estimate_id, position, code, name, unit, quantity,
					unit_price_minor, total_minor, category)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
				it.ID, estimateID, it.Position, it.Code, it.Name, it.Unit, it.Quantity,
				it.UnitPriceMinor, it.TotalMinor, it.Category); err != nil {
				return err
			}
		}
		return nil
	})
}

// RecomputeTotal пересчитывает итог сметы из позиций и сохраняет его.
func (r *EstimateRepo) RecomputeTotal(ctx context.Context, estimateID string) (int64, error) {
	var total int64
	if err := r.db.QueryRowContext(ctx, r.db.Rebind(`
		SELECT COALESCE(SUM(total_minor),0) FROM estimate_items WHERE estimate_id = ?`), estimateID).Scan(&total); err != nil {
		return 0, err
	}
	if _, err := r.db.ExecContext(ctx, r.db.Rebind(`
		UPDATE estimates SET total_minor = ?, updated_at = ? WHERE id = ?`),
		total, fmtTime(nowUTC()), estimateID); err != nil {
		return 0, err
	}
	return total, nil
}

// Delete удаляет смету (позиции уходят каскадом).
func (r *EstimateRepo) Delete(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx, r.db.Rebind(`DELETE FROM estimates WHERE id = ?`), id)
	if err != nil {
		return err
	}
	return affectedOrNotFound(res)
}

func (r *EstimateRepo) withTx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

func scanEstimate(s scanner) (*domain.Estimate, error) {
	var (
		e          domain.Estimate
		status     string
		approvedBy string
		approvedAt sql.NullString
		created    string
		updated    string
	)
	if err := s.Scan(&e.ID, &e.ProjectID, &e.ProjectName, &e.StageID, &e.Number, &e.Name, &status,
		&e.Currency, &e.TotalMinor, &e.CreatedBy, &e.CreatedByName, &approvedBy, &approvedAt,
		&e.Version, &created, &updated); err != nil {
		return nil, err
	}
	e.Status = domain.EstimateStatus(status)
	e.ApprovedBy = approvedBy
	e.ApprovedAt = parseTimePtr(approvedAt)
	e.CreatedAt = parseTime(created)
	e.UpdatedAt = parseTime(updated)
	return &e, nil
}

func scanEstimateWithCount(s scanner) (*domain.Estimate, error) {
	var (
		e          domain.Estimate
		status     string
		approvedBy string
		approvedAt sql.NullString
		created    string
		updated    string
	)
	if err := s.Scan(&e.ID, &e.ProjectID, &e.ProjectName, &e.StageID, &e.Number, &e.Name, &status,
		&e.Currency, &e.TotalMinor, &e.CreatedBy, &e.CreatedByName, &approvedBy, &approvedAt,
		&e.Version, &created, &updated, &e.ItemCount); err != nil {
		return nil, err
	}
	e.Status = domain.EstimateStatus(status)
	e.ApprovedBy = approvedBy
	e.ApprovedAt = parseTimePtr(approvedAt)
	e.CreatedAt = parseTime(created)
	e.UpdatedAt = parseTime(updated)
	return &e, nil
}
