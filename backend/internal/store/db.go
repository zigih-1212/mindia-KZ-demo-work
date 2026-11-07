package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"strings"
	"time"

	// Драйверы регистрируются побочным эффектом импорта.
	_ "github.com/jackc/pgx/v5/stdlib"
	"modernc.org/sqlite"
)

// Встроенная в SQLite функция lower() сворачивает регистр ТОЛЬКО для ASCII,
// поэтому поиск по кириллице («Алатау» → «алатау») на SQLite не работал бы,
// хотя на PostgreSQL он работает. Переопределяем lower() Unicode-осознанной
// реализацией на Go, чтобы поведение обоих драйверов совпадало.
func init() {
	sqlite.MustRegisterDeterministicScalarFunction("lower", 1,
		func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
			if len(args) == 0 || args[0] == nil {
				return nil, nil
			}
			switch v := args[0].(type) {
			case string:
				return strings.ToLower(v), nil
			case []byte:
				return strings.ToLower(string(v)), nil
			default:
				return v, nil
			}
		})
}

// DB — обёртка над *sql.DB, знающая свой диалект. Единый SQL пишется с
// плейсхолдерами '?', а Rebind переводит его в синтаксис конкретной СУБД.
// Так один и тот же код работает и на SQLite (локальный запуск без Docker),
// и на PostgreSQL (production / docker-compose).
type DB struct {
	*sql.DB
	Dialect string // "sqlite" | "postgres"
}

// Open открывает соединение с БД по конфигурации.
func Open(driver, dsn string) (*DB, error) {
	var realDriver, realDSN string
	switch driver {
	case "sqlite":
		realDriver = "sqlite"
		// WAL повышает параллелизм чтения/записи; busy_timeout сглаживает конкуренцию.
		sep := "?"
		if strings.Contains(dsn, "?") {
			sep = "&"
		}
		realDSN = dsn + sep + "_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)"
	case "postgres":
		realDriver = "pgx"
		realDSN = dsn
	default:
		return nil, fmt.Errorf("unsupported driver %q", driver)
	}

	sqlDB, err := sql.Open(realDriver, realDSN)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	if driver == "sqlite" {
		// SQLite допускает только одного писателя; ограничиваем пул.
		sqlDB.SetMaxOpenConns(1)
	} else {
		sqlDB.SetMaxOpenConns(10)
		sqlDB.SetMaxIdleConns(5)
		sqlDB.SetConnMaxLifetime(30 * time.Minute)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(ctx); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return &DB{DB: sqlDB, Dialect: driver}, nil
}

// Rebind переводит запрос с '?'-плейсхолдерами в диалект СУБД.
// Для PostgreSQL получаются $1..$n, для SQLite строка возвращается без изменений.
func (db *DB) Rebind(query string) string {
	if db.Dialect != "postgres" {
		return query
	}
	var b strings.Builder
	b.Grow(len(query) + 8)
	n := 0
	inSingle := false
	for i := 0; i < len(query); i++ {
		ch := query[i]
		switch {
		case ch == '\'':
			inSingle = !inSingle
			b.WriteByte(ch)
		case ch == '?' && !inSingle:
			n++
			b.WriteByte('$')
			b.WriteString(fmt.Sprint(n))
		default:
			b.WriteByte(ch)
		}
	}
	return b.String()
}

// IsPostgres сообщает, используется ли PostgreSQL.
func (db *DB) IsPostgres() bool { return db.Dialect == "postgres" }
