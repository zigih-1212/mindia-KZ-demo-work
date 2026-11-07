package service

import (
	"context"
	"errors"
	"testing"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
)

func TestProjectService_Create_ValidatesAndDefaults(t *testing.T) {
	repo := newFakeProjectRepo()
	svc := NewProjectService(repo, &fakeActivityRepo{})
	ctx := context.Background()
	manager := newTestUser("mgr", domain.RoleManager)

	// Успешное создание: статус по умолчанию — planning.
	p, err := svc.Create(ctx, manager, CreateProjectInput{Code: "NEW-1", Name: "Новый объект", BudgetMinor: 100})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if p.Status != domain.ProjectPlanning {
		t.Errorf("status = %q, ожидалось planning", p.Status)
	}

	// Пустой код -> validation.
	if _, err := svc.Create(ctx, manager, CreateProjectInput{Name: "Без кода"}); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("Create(no code) = %v, ожидалось ErrValidation", err)
	}

	// Пустое имя -> validation.
	if _, err := svc.Create(ctx, manager, CreateProjectInput{Code: "X-1"}); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("Create(no name) = %v, ожидалось ErrValidation", err)
	}

	// Отрицательный бюджет -> validation.
	if _, err := svc.Create(ctx, manager, CreateProjectInput{Code: "X-2", Name: "Y", BudgetMinor: -1}); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("Create(negative budget) = %v, ожидалось ErrValidation", err)
	}
}

func TestProjectService_Update_StaleVersion(t *testing.T) {
	repo := newFakeProjectRepo()
	svc := NewProjectService(repo, &fakeActivityRepo{})
	ctx := context.Background()
	manager := newTestUser("mgr", domain.RoleManager)

	repo.byID["p1"] = &domain.Project{ID: "p1", Code: "P1", Name: "Объект", Status: domain.ProjectActive, Version: 3}

	// Устаревшая версия -> конфликт версий.
	_, err := svc.Update(ctx, manager, "p1", UpdateProjectInput{Name: "Обновлён", Status: domain.ProjectActive, Version: 2})
	if !errors.Is(err, domain.ErrVersionMismatch) {
		t.Errorf("Update(stale) = %v, ожидалось ErrVersionMismatch", err)
	}

	// Актуальная версия -> успех.
	upd, err := svc.Update(ctx, manager, "p1", UpdateProjectInput{Name: "Обновлён", Status: domain.ProjectActive, Version: 3})
	if err != nil {
		t.Fatalf("Update(current): %v", err)
	}
	if upd.Name != "Обновлён" {
		t.Errorf("имя = %q", upd.Name)
	}
}

func TestProjectService_Update_ActualEndDateRequiresCompletion(t *testing.T) {
	repo := newFakeProjectRepo()
	svc := NewProjectService(repo, &fakeActivityRepo{})
	ctx := context.Background()
	manager := newTestUser("mgr", domain.RoleManager)

	repo.byID["p2"] = &domain.Project{ID: "p2", Code: "P2", Name: "Объект", Status: domain.ProjectActive, Version: 1}

	// Фактическая дата окончания при незавершённом статусе -> validation.
	_, err := svc.Update(ctx, manager, "p2", UpdateProjectInput{
		Name: "Объект", Status: domain.ProjectActive, Version: 1, ActualEndDate: "2026-01-01",
	})
	if !errors.Is(err, domain.ErrValidation) {
		t.Errorf("Update(actualEndDate while active) = %v, ожидалось ErrValidation", err)
	}
}
