package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
)

// DocumentService — бизнес-логика по исполнительной документации.
type DocumentService struct {
	documents DocumentRepository
	projects  ProjectRepository
	activity  ActivityRepository
	clock     func() time.Time
}

// NewDocumentService собирает сервис документов.
func NewDocumentService(documents DocumentRepository, projects ProjectRepository, activity ActivityRepository) *DocumentService {
	return &DocumentService{documents: documents, projects: projects, activity: activity, clock: time.Now}
}

// CreateDocumentInput — входные данные создания документа.
type CreateDocumentInput struct {
	ProjectID  string
	Type       domain.DocumentType
	Number     string
	Title      string
	PeriodFrom string
	PeriodTo   string
	AmountMinor int64
}

var validDocTypes = map[domain.DocumentType]bool{
	domain.DocKS2: true, domain.DocKS3: true, domain.DocInvoice: true, domain.DocAct: true, domain.DocOther: true,
}

// Create создаёт документ в статусе черновика.
func (s *DocumentService) Create(ctx context.Context, actor *domain.User, in CreateDocumentInput) (*domain.Document, error) {
	if actor != nil && !actor.Role.CanEditDocuments() {
		return nil, domain.ErrForbidden
	}
	in.Number = strings.TrimSpace(in.Number)
	in.Title = strings.TrimSpace(in.Title)
	if in.ProjectID == "" {
		return nil, domain.NewValidation("projectId", "укажите объект")
	}
	if !validDocTypes[in.Type] {
		return nil, domain.NewValidation("type", "неизвестный тип документа")
	}
	if in.Number == "" {
		return nil, domain.NewValidation("number", "укажите номер документа")
	}
	if in.Title == "" {
		return nil, domain.NewValidation("title", "укажите название документа")
	}
	if in.AmountMinor < 0 {
		return nil, domain.NewValidation("amountMinor", "сумма не может быть отрицательной")
	}
	if err := validateDateRange(in.PeriodFrom, in.PeriodTo); err != nil {
		return nil, err
	}
	if _, err := s.projects.GetByID(ctx, in.ProjectID); err != nil {
		return nil, err
	}

	now := s.clock().UTC()
	d := &domain.Document{
		ID:          uuid.NewString(),
		ProjectID:   in.ProjectID,
		Type:        in.Type,
		Number:      in.Number,
		Title:       in.Title,
		Status:      domain.DocDraft,
		PeriodFrom:  in.PeriodFrom,
		PeriodTo:    in.PeriodTo,
		AmountMinor: in.AmountMinor,
		CreatedBy:   actor.ID,
		Version:     1,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := s.documents.Create(ctx, d); err != nil {
		return nil, err
	}
	_ = s.record(ctx, actor, "create", "document", d.ID,
		fmt.Sprintf("Создан документ %s %s", strings.ToUpper(string(d.Type)), d.Number))
	return s.documents.GetByID(ctx, d.ID)
}

// Get возвращает документ.
func (s *DocumentService) Get(ctx context.Context, id string) (*domain.Document, error) {
	return s.documents.GetByID(ctx, id)
}

// List возвращает документы с фильтрами.
func (s *DocumentService) List(ctx context.Context, f DocumentFilter, page domain.Page) (domain.ListResult[domain.Document], error) {
	if f.Status != "" && !domain.DocumentStatus(f.Status).Valid() {
		return domain.ListResult[domain.Document]{}, domain.NewValidation("status", "неизвестный статус")
	}
	if f.Type != "" && !validDocTypes[domain.DocumentType(f.Type)] {
		return domain.ListResult[domain.Document]{}, domain.NewValidation("type", "неизвестный тип")
	}
	return s.documents.List(ctx, f, page)
}

// Transition переводит документ между статусами.
// Утверждённый документ КС-2/КС-3 увеличивает фактические затраты объекта.
func (s *DocumentService) Transition(ctx context.Context, actor *domain.User, id string, target domain.DocumentStatus, expectedVersion int) (*domain.Document, error) {
	d, err := s.documents.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if expectedVersion != 0 && expectedVersion != d.Version {
		return nil, domain.ErrVersionMismatch
	}
	if !target.Valid() {
		return nil, domain.NewValidation("status", "неизвестный статус документа")
	}

	allowed := map[domain.DocumentStatus][]domain.DocumentStatus{
		domain.DocDraft:     {domain.DocSubmitted},
		domain.DocSubmitted: {domain.DocApproved, domain.DocRejected},
		domain.DocRejected:  {domain.DocDraft},
		domain.DocApproved:  {},
	}
	if !containsDocStatus(allowed[d.Status], target) {
		return nil, domain.NewPrecondition(fmt.Sprintf("переход %s → %s недопустим", d.Status, target))
	}
	if (target == domain.DocApproved || target == domain.DocRejected) && !actor.Role.CanApprove() {
		return nil, domain.ErrForbidden
	}
	if (target == domain.DocSubmitted || (d.Status == domain.DocRejected && target == domain.DocDraft)) && !actor.Role.CanEditDocuments() {
		return nil, domain.ErrForbidden
	}

	approvedBy := ""
	if target == domain.DocApproved {
		approvedBy = actor.ID
	}
	if err := s.documents.UpdateStatus(ctx, id, target, approvedBy, d.Version); err != nil {
		return nil, err
	}

	// При утверждении акта (КС-2) или справки (КС-3) увеличиваем факт по объекту.
	if target == domain.DocApproved && (d.Type == domain.DocKS2 || d.Type == domain.DocKS3) {
		if err := s.projects.AddSpent(ctx, d.ProjectID, d.AmountMinor); err != nil {
			// Статус уже изменён; фиксируем факт ошибкой сервиса, но не откатываем статус.
			return nil, fmt.Errorf("документ утверждён, но не удалось обновить факт объекта: %w", err)
		}
	}

	_ = s.record(ctx, actor, "status", "document", id,
		fmt.Sprintf("Документ %s %s: %s → %s", strings.ToUpper(string(d.Type)), d.Number, d.Status, target))
	return s.documents.GetByID(ctx, id)
}

// Delete удаляет документ (кроме утверждённого).
func (s *DocumentService) Delete(ctx context.Context, actor *domain.User, id string) error {
	if actor != nil && !actor.Role.CanEditDocuments() {
		return domain.ErrForbidden
	}
	d, err := s.documents.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if d.Status == domain.DocApproved {
		return domain.NewPrecondition("нельзя удалить утверждённый документ")
	}
	if err := s.documents.Delete(ctx, id); err != nil {
		return err
	}
	_ = s.record(ctx, actor, "delete", "document", id, "Удалён документ "+d.Number)
	return nil
}

func (s *DocumentService) record(ctx context.Context, actor *domain.User, action, entity, id, summary string) error {
	if s.activity == nil || actor == nil {
		return nil
	}
	return s.activity.Add(ctx, &domain.Activity{
		ID: uuid.NewString(), ActorID: actor.ID, ActorName: actor.FullName,
		Action: action, EntityType: entity, EntityID: id, Summary: summary,
		CreatedAt: s.clock().UTC(),
	})
}

func containsDocStatus(list []domain.DocumentStatus, s domain.DocumentStatus) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
