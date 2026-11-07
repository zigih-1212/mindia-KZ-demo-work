package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
)

// dateLayout — ожидаемый формат дат в API (YYYY-MM-DD).
const dateLayout = "2006-01-02"

// validateDateRange проверяет, что обе даты корректны и начало не позже конца.
func validateDateRange(from, to string) error {
	from = strings.TrimSpace(from)
	to = strings.TrimSpace(to)
	if from != "" {
		if _, err := time.Parse(dateLayout, from); err != nil {
			return domain.NewValidation("dateFrom", "дата должна быть в формате YYYY-MM-DD")
		}
	}
	if to != "" {
		if _, err := time.Parse(dateLayout, to); err != nil {
			return domain.NewValidation("dateTo", "дата должна быть в формате YYYY-MM-DD")
		}
	}
	if from != "" && to != "" && from > to {
		return domain.NewValidation("dateRange", "дата начала позже даты окончания")
	}
	return nil
}

// clampInt ограничивает значение диапазоном 0..100.
func clampInt(v int) int {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

// FormatMoney форматирует минорные единицы в «major.minor KZT/units».
// Демо использует тиыны (1/100 тенге) как минорную единицу.
func FormatMoney(minor int64) string {
	neg := minor < 0
	if neg {
		minor = -minor
	}
	major := minor / 100
	frac := minor % 100
	out := fmt.Sprintf("%d.%02d", major, frac)
	if neg {
		out = "-" + out
	}
	return out
}
