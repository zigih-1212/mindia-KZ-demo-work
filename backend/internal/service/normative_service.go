package service

import (
	"context"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
)

// NormativeService — доступ к нормативной базе (RAG).
type NormativeService struct {
	normative NormativeRepository
}

// NewNormativeService собирает сервис нормативной базы.
func NewNormativeService(normative NormativeRepository) *NormativeService {
	return &NormativeService{normative: normative}
}

// Search ищет релевантные фрагменты нормативной базы.
func (s *NormativeService) Search(ctx context.Context, query string, limit int) ([]domain.NormativeDoc, error) {
	if limit <= 0 {
		limit = 5
	}
	return s.normative.Search(ctx, query, limit)
}

// List возвращает всю нормативную базу.
func (s *NormativeService) List(ctx context.Context) ([]domain.NormativeDoc, error) {
	return s.normative.List(ctx)
}
