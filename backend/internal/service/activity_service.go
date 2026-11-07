package service

import (
	"context"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
)

// ActivityService — чтение журнала действий.
type ActivityService struct {
	activity ActivityRepository
}

// NewActivityService собирает сервис журнала.
func NewActivityService(activity ActivityRepository) *ActivityService {
	return &ActivityService{activity: activity}
}

// List возвращает последние действия.
func (s *ActivityService) List(ctx context.Context, limit int) ([]domain.Activity, error) {
	if limit <= 0 {
		limit = 30
	}
	if limit > 200 {
		limit = 200
	}
	return s.activity.List(ctx, limit)
}

// ListByEntity возвращает действия по сущности.
func (s *ActivityService) ListByEntity(ctx context.Context, entityType, entityID string, limit int) ([]domain.Activity, error) {
	if limit <= 0 {
		limit = 30
	}
	return s.activity.ListByEntity(ctx, entityType, entityID, limit)
}
