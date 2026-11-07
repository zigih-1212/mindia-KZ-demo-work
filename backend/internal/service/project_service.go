package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
)

// ProjectService — бизнес-логика по строительным объектам.
type ProjectService struct {
	projects ProjectRepository
	activity ActivityRepository
	clock    func() time.Time
}

// NewProjectService собирает сервис объектов.
func NewProjectService(projects ProjectRepository, activity ActivityRepository) *ProjectService {
	return &ProjectService{projects: projects, activity: activity, clock: time.Now}
}

// CreateProjectInput — входные данные создания объекта.
type CreateProjectInput struct {
	Code             string
	Name             string
	Customer         string
	Address          string
	Status           domain.ProjectStatus
	BudgetMinor      int64
	ContractAmountMinor int64
	StartDate        string
	PlannedEndDate   string
	ManagerID        string
	ProgressPercent  int
}

// Create создаёт объект после валидации.
func (s *ProjectService) Create(ctx context.Context, actor *domain.User, in CreateProjectInput) (*domain.Project, error) {
	in.Code = strings.TrimSpace(in.Code)
	in.Name = strings.TrimSpace(in.Name)
	if in.Code == "" {
		return nil, domain.NewValidation("code", "укажите код объекта")
	}
	if in.Name == "" {
		return nil, domain.NewValidation("name", "укажите название объекта")
	}
	if in.BudgetMinor < 0 {
		return nil, domain.NewValidation("budgetMinor", "бюджет не может быть отрицательным")
	}
	if in.Status == "" {
		in.Status = domain.ProjectPlanning
	}
	if !in.Status.Valid() {
		return nil, domain.NewValidation("status", "неизвестный статус объекта")
	}
	if err := validateDateRange(in.StartDate, in.PlannedEndDate); err != nil {
		return nil, err
	}

	now := s.clock().UTC()
	p := &domain.Project{
		ID:                  uuid.NewString(),
		Code:                in.Code,
		Name:                in.Name,
		Customer:            strings.TrimSpace(in.Customer),
		Address:             strings.TrimSpace(in.Address),
		Status:              in.Status,
		BudgetMinor:         in.BudgetMinor,
		ContractAmountMinor: in.ContractAmountMinor,
		StartDate:           in.StartDate,
		PlannedEndDate:      in.PlannedEndDate,
		ManagerID:           in.ManagerID,
		ProgressPercent:     clampInt(in.ProgressPercent),
		Version:             1,
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	if err := s.projects.Create(ctx, p); err != nil {
		return nil, err
	}
	_ = s.record(ctx, actor, "create", "project", p.ID, "Создан объект "+p.Code+" — "+p.Name)
	return p, nil
}

// UpdateProjectInput — входные данные изменения объекта.
type UpdateProjectInput struct {
	Code             string
	Name             string
	Customer         string
	Address          string
	Status           domain.ProjectStatus
	BudgetMinor      int64
	ContractAmountMinor int64
	StartDate        string
	PlannedEndDate   string
	ActualEndDate    string
	ManagerID        string
	ProgressPercent  int
	Version          int
}

// Update изменяет объект с проверкой версии (оптимистическая блокировка).
func (s *ProjectService) Update(ctx context.Context, actor *domain.User, id string, in UpdateProjectInput) (*domain.Project, error) {
	existing, err := s.projects.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if in.Version != existing.Version {
		return nil, domain.ErrVersionMismatch
	}
	if strings.TrimSpace(in.Name) == "" {
		return nil, domain.NewValidation("name", "укажите название объекта")
	}
	if !in.Status.Valid() {
		return nil, domain.NewValidation("status", "неизвестный статус объекта")
	}
	if in.BudgetMinor < 0 {
		return nil, domain.NewValidation("budgetMinor", "бюджет не может быть отрицательным")
	}
	if err := validateDateRange(in.StartDate, in.PlannedEndDate); err != nil {
		return nil, err
	}
	if in.ActualEndDate != "" && in.Status != domain.ProjectCompleted {
		return nil, domain.NewValidation("actualEndDate", "дата завершения допустима только для завершённого объекта")
	}

	existing.Code = strings.TrimSpace(in.Code)
	existing.Name = strings.TrimSpace(in.Name)
	existing.Customer = strings.TrimSpace(in.Customer)
	existing.Address = strings.TrimSpace(in.Address)
	existing.Status = in.Status
	existing.BudgetMinor = in.BudgetMinor
	existing.ContractAmountMinor = in.ContractAmountMinor
	existing.StartDate = in.StartDate
	existing.PlannedEndDate = in.PlannedEndDate
	existing.ActualEndDate = in.ActualEndDate
	existing.ManagerID = in.ManagerID
	existing.ProgressPercent = clampInt(in.ProgressPercent)

	if err := s.projects.Update(ctx, existing); err != nil {
		return nil, err
	}
	existing.Version++
	_ = s.record(ctx, actor, "update", "project", existing.ID, "Изменён объект "+existing.Code)
	return s.projects.GetByID(ctx, id)
}

// Get возвращает объект.
func (s *ProjectService) Get(ctx context.Context, id string) (*domain.Project, error) {
	return s.projects.GetByID(ctx, id)
}

// List возвращает объекты с фильтрами.
func (s *ProjectService) List(ctx context.Context, f ProjectFilter, page domain.Page) (domain.ListResult[domain.Project], error) {
	if f.Status != "" && !domain.ProjectStatus(f.Status).Valid() {
		return domain.ListResult[domain.Project]{}, domain.NewValidation("status", "неизвестный статус")
	}
	return s.projects.List(ctx, f, page)
}

// Delete удаляет объект (только администратор или менеджер — проверено в API).
func (s *ProjectService) Delete(ctx context.Context, actor *domain.User, id string) error {
	p, err := s.projects.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if err := s.projects.Delete(ctx, id); err != nil {
		return err
	}
	_ = s.record(ctx, actor, "delete", "project", id, "Удалён объект "+p.Code)
	return nil
}

// Summary собирает KPI дашборда.
func (s *ProjectService) Summary(ctx context.Context) (domain.DashboardSummary, error) {
	return s.projects.Summary(ctx)
}

// Stages возвращает этапы объекта.
func (s *ProjectService) Stages(ctx context.Context, projectID string) ([]domain.ProjectStage, error) {
	if _, err := s.projects.GetByID(ctx, projectID); err != nil {
		return nil, err
	}
	return s.projects.ListStages(ctx, projectID)
}

func (s *ProjectService) record(ctx context.Context, actor *domain.User, action, entity, id, summary string) error {
	if s.activity == nil || actor == nil {
		return nil
	}
	return s.activity.Add(ctx, &domain.Activity{
		ID: uuid.NewString(), ActorID: actor.ID, ActorName: actor.FullName,
		Action: action, EntityType: entity, EntityID: id, Summary: summary,
		CreatedAt: s.clock().UTC(),
	})
}
