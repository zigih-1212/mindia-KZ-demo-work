package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/auth"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
)

func newTestAuth(t *testing.T) (*AuthService, *fakeUserRepo) {
	t.Helper()
	users := newFakeUserRepo()
	mgr := auth.NewManager("test-secret-key-16chars", time.Hour)
	svc := NewAuthService(users, mgr, &fakeActivityRepo{})
	return svc, users
}

func TestAuthService_Login_Success(t *testing.T) {
	svc, users := newTestAuth(t)
	ctx := context.Background()
	mgr := auth.NewManager("test-secret-key-16chars", time.Hour)

	hash, err := mgr.HashPassword("demo1234")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	u := newTestUser("admin", domain.RoleAdmin)
	u.Email = "admin@mindia.kz"
	u.PasswordHash = hash
	if err := users.Create(ctx, u); err != nil {
		t.Fatalf("Create: %v", err)
	}

	res, err := svc.Login(ctx, " Admin@Mindia.KZ ", "demo1234")
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if res.Token == "" {
		t.Error("токен пуст")
	}
	if res.User.Role != domain.RoleAdmin {
		t.Errorf("role = %q, ожидалось admin", res.User.Role)
	}
}

func TestAuthService_Login_Errors(t *testing.T) {
	svc, users := newTestAuth(t)
	ctx := context.Background()

	// Пустые учётные данные -> validation.
	if _, err := svc.Login(ctx, "", ""); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("Login(empty) = %v, ожидалось ErrValidation", err)
	}

	// Неизвестный email -> Unauthorized (без раскрытия существования).
	if _, err := svc.Login(ctx, "nobody@mindia.kz", "demo1234"); !errors.Is(err, domain.ErrUnauthorized) {
		t.Errorf("Login(unknown) = %v, ожидалось ErrUnauthorized", err)
	}

	mgr := auth.NewManager("test-secret-key-16chars", time.Hour)
	hash, _ := mgr.HashPassword("demo1234")
	inactive := &domain.User{
		ID: "u-inactive", Email: "off@mindia.kz", PasswordHash: hash, FullName: "Off",
		Role: domain.RoleForeman, IsActive: false, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	_ = users.Create(ctx, inactive)

	// Отключённая учётная запись -> precondition.
	if _, err := svc.Login(ctx, "off@mindia.kz", "demo1234"); !errors.Is(err, domain.ErrPreconditionFailed) {
		t.Errorf("Login(inactive) = %v, ожидалось ErrPreconditionFailed", err)
	}

	// Неверный пароль -> Unauthorized.
	active := &domain.User{
		ID: "u-active", Email: "on@mindia.kz", PasswordHash: hash, FullName: "On",
		Role: domain.RoleForeman, IsActive: true, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	_ = users.Create(ctx, active)
	if _, err := svc.Login(ctx, "on@mindia.kz", "wrong-pass"); !errors.Is(err, domain.ErrUnauthorized) {
		t.Errorf("Login(bad password) = %v, ожидалось ErrUnauthorized", err)
	}
}

func TestAuthService_Register_DefaultsAndValidation(t *testing.T) {
	svc, _ := newTestAuth(t)
	ctx := context.Background()

	// Роль по умолчанию — foreman.
	res, err := svc.Register(ctx, RegisterInput{
		Email: "New@Mindia.KZ", Password: "supersecret", FullName: "Новый Пользователь",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if res.User.Role != domain.RoleForeman {
		t.Errorf("role по умолчанию = %q, ожидалось foreman", res.User.Role)
	}
	if res.User.Email != "new@mindia.kz" {
		t.Errorf("email не приведён к нижнему регистру: %q", res.User.Email)
	}

	// Короткий пароль -> validation по полю password.
	_, err = svc.Register(ctx, RegisterInput{Email: "x@mindia.kz", Password: "short", FullName: "X"})
	assertValidationField(t, err, "password")

	// Email без @ -> validation по полю email.
	_, err = svc.Register(ctx, RegisterInput{Email: "bad-email", Password: "supersecret", FullName: "X"})
	assertValidationField(t, err, "email")

	// Пустое имя -> validation по полю fullName.
	_, err = svc.Register(ctx, RegisterInput{Email: "y@mindia.kz", Password: "supersecret", FullName: "  "})
	assertValidationField(t, err, "fullName")
}

// assertValidationField проверяет, что ошибка — ValidationError с нужным полем.
func assertValidationField(t *testing.T, err error, field string) {
	t.Helper()
	if err == nil {
		t.Fatalf("ожидалась ошибка валидации по полю %q, получили nil", field)
	}
	var ve *domain.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("ожидался *ValidationError, получили %T: %v", err, err)
	}
	if ve.Field != field {
		t.Errorf("поле = %q, ожидалось %q", ve.Field, field)
	}
}
