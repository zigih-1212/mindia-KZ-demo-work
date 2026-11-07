package store

import (
	"context"
	"strings"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/service"
)

// NormativeRepo — реализация service.NormativeRepository для RAG.
// Реализован лексический поиск (token overlap по полю keywords) — этого
// достаточно для небольшой нормативной базы и не требует внешних сервисов.
type NormativeRepo struct{ db *DB }

// NewNormativeRepo создаёт репозиторий нормативных документов.
func NewNormativeRepo(db *DB) *NormativeRepo { return &NormativeRepo{db: db} }

var _ service.NormativeRepository = (*NormativeRepo)(nil)

// Search ищет релевантные фрагменты нормативной базы по токенам запроса.
func (r *NormativeRepo) Search(ctx context.Context, query string, limit int) ([]domain.NormativeDoc, error) {
	docs, err := r.List(ctx)
	if err != nil {
		return nil, err
	}
	tokens := tokenize(query)
	if len(tokens) == 0 {
		if len(docs) > limit {
			docs = docs[:limit]
		}
		return docs, nil
	}

	type scored struct {
		doc   domain.NormativeDoc
		score int
	}
	ranked := make([]scored, 0, len(docs))
	for _, d := range docs {
		hay := strings.ToLower(d.Keywords + " " + d.Title + " " + d.Section)
		score := 0
		for _, t := range tokens {
			if strings.Contains(hay, t) {
				score++
				// Код документа в запросе — сильный сигнал.
				if strings.Contains(strings.ToLower(d.Code), t) {
					score += 3
				}
			}
		}
		if score > 0 {
			ranked = append(ranked, scored{doc: d, score: score})
		}
	}
	// Сортировка вставками (списки малы; избегаем импорта sort ради простоты).
	for i := 1; i < len(ranked); i++ {
		for j := i; j > 0 && ranked[j].score > ranked[j-1].score; j-- {
			ranked[j], ranked[j-1] = ranked[j-1], ranked[j]
		}
	}
	if len(ranked) > limit {
		ranked = ranked[:limit]
	}
	out := make([]domain.NormativeDoc, 0, len(ranked))
	for _, s := range ranked {
		out = append(out, s.doc)
	}
	return out, nil
}

// List возвращает всю нормативную базу.
func (r *NormativeRepo) List(ctx context.Context) ([]domain.NormativeDoc, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, code, title, section, content, keywords FROM normative_docs ORDER BY code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.NormativeDoc{}
	for rows.Next() {
		var d domain.NormativeDoc
		if err := rows.Scan(&d.ID, &d.Code, &d.Title, &d.Section, &d.Content, &d.Keywords); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// tokenize разбивает запрос на токены длиной ≥ 3 символов.
func tokenize(s string) []string {
	fields := strings.FieldsFunc(strings.ToLower(s), func(r rune) bool {
		return !(r >= 'a' && r <= 'z') && !(r >= '0' && r <= '9') &&
			!(r >= 'а' && r <= 'я') && r != 'ё'
	})
	seen := map[string]bool{}
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		if len([]rune(f)) < 3 || seen[f] {
			continue
		}
		seen[f] = true
		out = append(out, f)
	}
	return out
}
