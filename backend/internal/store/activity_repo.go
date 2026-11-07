package store

import (
	"context"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/service"
)

// ActivityRepo — реализация service.ActivityRepository.
type ActivityRepo struct{ db *DB }

// NewActivityRepo создаёт репозиторий журнала действий.
func NewActivityRepo(db *DB) *ActivityRepo { return &ActivityRepo{db: db} }

var _ service.ActivityRepository = (*ActivityRepo)(nil)

// Add записывает действие в журнал.
func (r *ActivityRepo) Add(ctx context.Context, a *domain.Activity) error {
	_, err := r.db.ExecContext(ctx, r.db.Rebind(`
		INSERT INTO activity (id, actor_id, actor_name, action, entity_type, entity_id, summary, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
		a.ID, a.ActorID, a.ActorName, a.Action, a.EntityType, a.EntityID, a.Summary, fmtTime(a.CreatedAt))
	return err
}

// List возвращает последние записи журнала.
func (r *ActivityRepo) List(ctx context.Context, limit int) ([]domain.Activity, error) {
	return r.query(ctx, `SELECT id, actor_id, actor_name, action, entity_type, entity_id, summary, created_at
		FROM activity ORDER BY created_at DESC LIMIT ?`, limit)
}

// ListByEntity возвращает журнал по конкретной сущности.
func (r *ActivityRepo) ListByEntity(ctx context.Context, entityType, entityID string, limit int) ([]domain.Activity, error) {
	return r.query(ctx, `SELECT id, actor_id, actor_name, action, entity_type, entity_id, summary, created_at
		FROM activity WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT ?`,
		entityType, entityID, limit)
}

func (r *ActivityRepo) query(ctx context.Context, query string, args ...any) ([]domain.Activity, error) {
	rows, err := r.db.QueryContext(ctx, r.db.Rebind(query), args...)
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
