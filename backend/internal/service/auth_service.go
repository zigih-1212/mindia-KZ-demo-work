// Package service содержит бизнес-логику приложения.
// Сервисы зависят только от портов (интерфейсов) и доменных типов,
// что делает их тестируемыми без БД и HTTP.
package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/auth"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
)

// AuthService отвечает за регистрацию, вход и профиль.
type AuthService struct {
	users  UserRepository
	auth   *auth.Manager
	clock  func() time.Time
	activity ActivityRepository
}

// NewAuthService собирает сервис аутентификации.
func NewAuthService(users UserRepository, mgr *auth.Manager, activity ActivityRepository) *AuthService {
	return &AuthService{users: users, auth: mgr, clock: time.Now, activity: activity}
}

// LoginResult — результат успешного входа.
type LoginResult struct {
	Token     string     `json:"token"`
	ExpiresAt time.Time  `json:"expiresAt"`
	User      domain.User `json:"user"`
}

// Login проверяет учётные данные и выпускает токен.
func (s *AuthService) Login(ctx context.Context, email, password string) (LoginResult, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	if email == "" || password == "" {
		return LoginResult{}, domain.NewValidation("credentials", "укажите email и пароль")
	}
	u, err := s.users.GetByEmail(ctx, email)
	if err != nil {
		if err == domain.ErrNotFound {
			// Не раскрываем, существует ли пользователь.
			return LoginResult{}, domain.ErrUnauthorized
		}
		return LoginResult{}, err
	}
	if !u.IsActive {
		return LoginResult{}, domain.NewPrecondition("учётная запись отключена")
	}
	if !s.auth.CheckPassword(u.PasswordHash, password) {
		return LoginResult{}, domain.ErrUnauthorized
	}
	token, exp, err := s.auth.Issue(u)
	if err != nil {
		return LoginResult{}, err
	}
	_ = s.record(ctx, u, "login", "user", u.ID, "Вход в систему")
	return LoginResult{Token: token, ExpiresAt: exp, User: *u}, nil
}

// RegisterCreate — входные данные для создания пользователя.
type RegisterInput struct {
	Email    string
	Password string
	FullName string
	Position string
	Role     domain.Role
}

// Register создаёт пользователя и сразу выпускает токен.
func (s *AuthService) Register(ctx context.Context, in RegisterInput) (LoginResult, error) {
	in.Email = strings.TrimSpace(strings.ToLower(in.Email))
	in.FullName = strings.TrimSpace(in.FullName)
	if err := validateRegister(in); err != nil {
		return LoginResult{}, err
	}
	// Публичная регистрация: роль всегда foreman (нельзя эскалировать привилегии).
	// Управление ролями — только через администрирование (вне публичного API).
	in.Role = domain.RoleForeman
	hash, err := s.auth.HashPassword(in.Password)
	if err != nil {
		return LoginResult{}, err
	}
	now := s.clock().UTC()
	u := &domain.User{
		ID:           uuid.NewString(),
		Email:        in.Email,
		PasswordHash: hash,
		FullName:     in.FullName,
		Position:     strings.TrimSpace(in.Position),
		Role:         in.Role,
		IsActive:     true,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := s.users.Create(ctx, u); err != nil {
		return LoginResult{}, err
	}
	token, exp, err := s.auth.Issue(u)
	if err != nil {
		return LoginResult{}, err
	}
	_ = s.record(ctx, u, "register", "user", u.ID, "Регистрация: "+u.FullName)
	return LoginResult{Token: token, ExpiresAt: exp, User: *u}, nil
}

func validateRegister(in RegisterInput) error {
	if in.Email == "" || !strings.Contains(in.Email, "@") {
		return domain.NewValidation("email", "укажите корректный email")
	}
	if len(in.Password) < 8 {
		return domain.NewValidation("password", "пароль должен быть не короче 8 символов")
	}
	if in.FullName == "" {
		return domain.NewValidation("fullName", "укажите имя")
	}
	return nil
}

// Profile возвращает профиль по идентификатору.
func (s *AuthService) Profile(ctx context.Context, userID string) (*domain.User, error) {
	return s.users.GetByID(ctx, userID)
}

func (s *AuthService) record(ctx context.Context, actor *domain.User, action, entity, id, summary string) error {
	if s.activity == nil {
		return nil
	}
	return s.activity.Add(ctx, &domain.Activity{
		ID: uuid.NewString(), ActorID: actor.ID, ActorName: actor.FullName,
		Action: action, EntityType: entity, EntityID: id, Summary: summary,
		CreatedAt: s.clock().UTC(),
	})
}
