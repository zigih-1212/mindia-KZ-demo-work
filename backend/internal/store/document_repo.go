package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/service"
)

// DocumentRepo — реализация service.DocumentRepository.
type DocumentRepo struct{ db *DB }

// NewDocumentRepo создаёт репозиторий документов.
func NewDocumentRepo(db *DB) *DocumentRepo { return &DocumentRepo{db: db} }

var _ service.DocumentRepository = (*DocumentRepo)(nil)

const documentCols = `d.id, d.project_id, COALESCE(p.name,''), d.type, d.number, d.title, d.status,
	d.period_from, d.period_to, d.amount_minor, d.created_by, COALESCE(cu.full_name,''),
	COALESCE(d.approved_by,''), d.approved_at, d.version, d.created_at, d.updated_at`

// Create добавляет документ.
func (r *DocumentRepo) Create(ctx context.Context, d *domain.Document) error {
	_, err := r.db.ExecContext(ctx, r.db.Rebind(`
		INSERT INTO documents (id, project_id, type, number, title, status, period_from, period_to,
			amount_minor, created_by, approved_by, approved_at, version, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`),
		d.ID, d.ProjectID, string(d.Type), d.Number, d.Title, string(d.Status), d.PeriodFrom,
		d.PeriodTo, d.AmountMinor, d.CreatedBy, d.Version, fmtTime(d.CreatedAt), fmtTime(d.UpdatedAt))
	if err != nil {
		if isUniqueViolation(err) {
			return domain.NewConflict("документ с таким номером уже существует для объекта")
		}
		return err
	}
	return nil
}

// GetByID возвращает документ по идентификатору.
func (r *DocumentRepo) GetByID(ctx context.Context, id string) (*domain.Document, error) {
	row := r.db.QueryRowContext(ctx, r.db.Rebind(`
		SELECT `+documentCols+` FROM documents d
		LEFT JOIN projects p ON p.id = d.project_id
		LEFT JOIN users cu ON cu.id = d.created_by
		WHERE d.id = ?`), id)
	d, err := scanDocument(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return d, err
}

// List возвращает страницу документов с фильтрами.
func (r *DocumentRepo) List(ctx context.Context, f service.DocumentFilter, page domain.Page) (domain.ListResult[domain.Document], error) {
	page = page.Normalize()
	conds := []string{"1=1"}
	args := []any{}
	if f.ProjectID != "" {
		conds = append(conds, "d.project_id = ?")
		args = append(args, f.ProjectID)
	}
	if f.Status != "" {
		conds = append(conds, "d.status = ?")
		args = append(args, f.Status)
	}
	if f.Type != "" {
		conds = append(conds, "d.type = ?")
		args = append(args, f.Type)
	}
	if s := strings.TrimSpace(f.Search); s != "" {
		conds = append(conds, "(lower(d.title) LIKE ? OR lower(d.number) LIKE ?)")
		like := "%" + strings.ToLower(s) + "%"
		args = append(args, like, like)
	}
	where := strings.Join(conds, " AND ")

	var total int
	if err := r.db.QueryRowContext(ctx, r.db.Rebind(`SELECT COUNT(*) FROM documents d WHERE `+where), args...).Scan(&total); err != nil {
		return domain.ListResult[domain.Document]{}, err
	}

	query := `SELECT ` + documentCols + ` FROM documents d
		LEFT JOIN projects p ON p.id = d.project_id
		LEFT JOIN users cu ON cu.id = d.created_by
		WHERE ` + where + ` ORDER BY d.created_at DESC LIMIT ? OFFSET ?`
	args = append(args, page.Limit, page.Offset)

	rows, err := r.db.QueryContext(ctx, r.db.Rebind(query), args...)
	if err != nil {
		return domain.ListResult[domain.Document]{}, err
	}
	defer rows.Close()
	items := make([]domain.Document, 0, page.Limit)
	for rows.Next() {
		d, err := scanDocument(rows)
		if err != nil {
			return domain.ListResult[domain.Document]{}, err
		}
		items = append(items, *d)
	}
	return domain.ListResult[domain.Document]{Items: items, Total: total, Limit: page.Limit, Offset: page.Offset}, rows.Err()
}

// UpdateStatus переводит документ в новый статус с оптимистической блокировкой.
func (r *DocumentRepo) UpdateStatus(ctx context.Context, id string, status domain.DocumentStatus, approvedBy string, expectedVersion int) error {
	var approvedAt any
	if status == domain.DocApproved {
		approvedAt = fmtTime(nowUTC())
	}
	res, err := r.db.ExecContext(ctx, r.db.Rebind(`
		UPDATE documents SET status = ?, approved_by = ?, approved_at = ?, version = version + 1, updated_at = ?
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
		return mapVersionMiss(ctx, r.db, "documents", id, expectedVersion)
	}
	return nil
}

// Update сохраняет редактируемые поля документа.
func (r *DocumentRepo) Update(ctx context.Context, d *domain.Document) error {
	res, err := r.db.ExecContext(ctx, r.db.Rebind(`
		UPDATE documents SET title = ?, period_from = ?, period_to = ?, amount_minor = ?,
			version = version + 1, updated_at = ?
		WHERE id = ? AND version = ?`),
		d.Title, d.PeriodFrom, d.PeriodTo, d.AmountMinor, fmtTime(nowUTC()), d.ID, d.Version)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return mapVersionMiss(ctx, r.db, "documents", d.ID, d.Version)
	}
	return nil
}

// Delete удаляет документ.
func (r *DocumentRepo) Delete(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx, r.db.Rebind(`DELETE FROM documents WHERE id = ?`), id)
	if err != nil {
		return err
	}
	return affectedOrNotFound(res)
}

func scanDocument(s scanner) (*domain.Document, error) {
	var (
		d          domain.Document
		docType    string
		status     string
		approvedAt sql.NullString
		created    string
		updated    string
	)
	if err := s.Scan(&d.ID, &d.ProjectID, &d.ProjectName, &docType, &d.Number, &d.Title, &status,
		&d.PeriodFrom, &d.PeriodTo, &d.AmountMinor, &d.CreatedBy, &d.CreatedByName,
		&d.ApprovedBy, &approvedAt, &d.Version, &created, &updated); err != nil {
		return nil, err
	}
	d.Type = domain.DocumentType(docType)
	d.Status = domain.DocumentStatus(status)
	d.ApprovedAt = parseTimePtr(approvedAt)
	d.CreatedAt = parseTime(created)
	d.UpdatedAt = parseTime(updated)
	return &d, nil
}
