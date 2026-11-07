package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/service"
)

// UserRepo — реализация service.UserRepository поверх *sql.DB.
type UserRepo struct{ db *DB }

// NewUserRepo создаёт репозиторий пользователей.
func NewUserRepo(db *DB) *UserRepo { return &UserRepo{db: db} }

var _ service.UserRepository = (*UserRepo)(nil)

const userCols = `id, email, password_hash, full_name, position, role, is_active, created_at, updated_at`

// Create добавляет пользователя.
func (r *UserRepo) Create(ctx context.Context, u *domain.User) error {
	_, err := r.db.ExecContext(ctx, r.db.Rebind(`
		INSERT INTO users (`+userCols+`)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		u.ID, u.Email, u.PasswordHash, u.FullName, u.Position, string(u.Role),
		boolToInt(u.IsActive), fmtTime(u.CreatedAt), fmtTime(u.UpdatedAt))
	if err != nil {
		if isUniqueViolation(err) {
			return domain.NewConflict("пользователь с таким email уже существует")
		}
		return err
	}
	return nil
}

// GetByID возвращает пользователя по идентификатору.
func (r *UserRepo) GetByID(ctx context.Context, id string) (*domain.User, error) {
	return r.queryOne(ctx, `SELECT `+userCols+` FROM users WHERE id = ?`, id)
}

// GetByEmail возвращает пользователя по email (без учёта регистра).
func (r *UserRepo) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	return r.queryOne(ctx, `SELECT `+userCols+` FROM users WHERE lower(email) = lower(?)`, email)
}

func (r *UserRepo) queryOne(ctx context.Context, query string, args ...any) (*domain.User, error) {
	row := r.db.QueryRowContext(ctx, r.db.Rebind(query), args...)
	u, err := scanUser(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return u, err
}

// List возвращает страницу пользователей.
func (r *UserRepo) List(ctx context.Context, page domain.Page) (domain.ListResult[domain.User], error) {
	page = page.Normalize()
	var total int
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&total); err != nil {
		return domain.ListResult[domain.User]{}, err
	}
	rows, err := r.db.QueryContext(ctx, r.db.Rebind(`
		SELECT `+userCols+` FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?`),
		page.Limit, page.Offset)
	if err != nil {
		return domain.ListResult[domain.User]{}, err
	}
	defer rows.Close()

	items := make([]domain.User, 0, page.Limit)
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return domain.ListResult[domain.User]{}, err
		}
		items = append(items, *u)
	}
	return domain.ListResult[domain.User]{Items: items, Total: total, Limit: page.Limit, Offset: page.Offset}, rows.Err()
}

// Update сохраняет изменения профиля (без пароля и активности).
func (r *UserRepo) Update(ctx context.Context, u *domain.User) error {
	res, err := r.db.ExecContext(ctx, r.db.Rebind(`
		UPDATE users SET email = ?, full_name = ?, position = ?, role = ?, updated_at = ?
		WHERE id = ?`),
		u.Email, u.FullName, u.Position, string(u.Role), fmtTime(u.UpdatedAt), u.ID)
	if err != nil {
		if isUniqueViolation(err) {
			return domain.NewConflict("пользователь с таким email уже существует")
		}
		return err
	}
	return affectedOrNotFound(res)
}

// SetActive меняет признак активности учётной записи.
func (r *UserRepo) SetActive(ctx context.Context, id string, active bool) error {
	res, err := r.db.ExecContext(ctx, r.db.Rebind(`
		UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?`),
		boolToInt(active), fmtTime(nowUTC()), id)
	if err != nil {
		return err
	}
	return affectedOrNotFound(res)
}

// Count возвращает число пользователей.
func (r *UserRepo) Count(ctx context.Context) (int, error) {
	var n int
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

func scanUser(s scanner) (*domain.User, error) {
	var (
		u        domain.User
		role     string
		isActive int
		created  string
		updated  string
	)
	if err := s.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.FullName, &u.Position, &role,
		&isActive, &created, &updated); err != nil {
		return nil, err
	}
	u.Role = domain.Role(role)
	u.IsActive = isActive != 0
	u.CreatedAt = parseTime(created)
	u.UpdatedAt = parseTime(updated)
	return &u, nil
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique") || strings.Contains(msg, "duplicate key")
}
