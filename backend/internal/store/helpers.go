package store

import (
	"database/sql"
	"time"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
)

// scanner — общий интерфейс *sql.Row и *sql.Rows.
type scanner interface {
	Scan(dest ...any) error
}

// nowUTC возвращает текущее время в UTC.
func nowUTC() time.Time { return time.Now().UTC() }

// fmtTime сериализует время в RFC3339 (единый формат для TEXT-колонок).
func fmtTime(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

// fmtTimePtr сериализует указатель на время либо NULL.
func fmtTimePtr(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UTC().Format(time.RFC3339Nano)
}

// parseTime разбирает RFC3339, возвращая нулевое время при ошибке.
func parseTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC()
		}
	}
	return time.Time{}
}

// parseTimePtr разбирает nullable-время.
func parseTimePtr(ns sql.NullString) *time.Time {
	if !ns.Valid || ns.String == "" {
		return nil
	}
	t := parseTime(ns.String)
	return &t
}

// boolToInt переводит bool в 0/1 для SQLite/Postgres BIGINT-колонок.
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// affectedOrNotFound возвращает ErrNotFound, если ни одна строка не изменена.
func affectedOrNotFound(res sql.Result) error {
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// clampPercent ограничивает процент диапазоном 0..100.
func clampPercent(v int) int {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}
