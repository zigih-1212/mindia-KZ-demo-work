package service

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
)

// EstimateService — бизнес-логика по сметам и их анализу.
type EstimateService struct {
	estimates EstimateRepository
	projects  ProjectRepository
	activity  ActivityRepository
	clock     func() time.Time
}

// NewEstimateService собирает сервис смет.
func NewEstimateService(estimates EstimateRepository, projects ProjectRepository, activity ActivityRepository) *EstimateService {
	return &EstimateService{estimates: estimates, projects: projects, activity: activity, clock: time.Now}
}

// EstimateItemInput — входная позиция сметы.
type EstimateItemInput struct {
	Code           string  `json:"code"`
	Name           string  `json:"name"`
	Unit           string  `json:"unit"`
	Quantity       float64 `json:"quantity"`
	UnitPriceMinor int64   `json:"unitPriceMinor"`
	Category       string  `json:"category"`
}

// CreateEstimateInput — входные данные создания сметы.
type CreateEstimateInput struct {
	ProjectID string
	StageID   string
	Number    string
	Name      string
	Currency  string
	Items     []EstimateItemInput
}

// Create создаёт смету, вычисляет суммы и итог.
func (s *EstimateService) Create(ctx context.Context, actor *domain.User, in CreateEstimateInput) (*domain.Estimate, error) {
	in.Number = strings.TrimSpace(in.Number)
	in.Name = strings.TrimSpace(in.Name)
	if in.ProjectID == "" {
		return nil, domain.NewValidation("projectId", "укажите объект")
	}
	if in.Number == "" {
		return nil, domain.NewValidation("number", "укажите номер сметы")
	}
	if in.Name == "" {
		return nil, domain.NewValidation("name", "укажите название сметы")
	}
	if _, err := s.projects.GetByID(ctx, in.ProjectID); err != nil {
		return nil, err
	}
	items, total, err := s.normalizeItems(in.Items)
	if err != nil {
		return nil, err
	}
	if in.Currency == "" {
		in.Currency = "KZT"
	}

	now := s.clock().UTC()
	e := &domain.Estimate{
		ID:        uuid.NewString(),
		ProjectID: in.ProjectID,
		StageID:   in.StageID,
		Number:    in.Number,
		Name:      in.Name,
		Status:    domain.EstimateDraft,
		Currency:  in.Currency,
		TotalMinor: total,
		CreatedBy: actor.ID,
		Version:   1,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := s.estimates.Create(ctx, e, items); err != nil {
		return nil, err
	}
	_ = s.record(ctx, actor, "create", "estimate", e.ID,
		fmt.Sprintf("Создана смета %s на сумму %s", e.Number, FormatMoney(total)))
	return s.estimates.GetByID(ctx, e.ID)
}

// Get возвращает смету.
func (s *EstimateService) Get(ctx context.Context, id string) (*domain.Estimate, error) {
	return s.estimates.GetByID(ctx, id)
}

// Items возвращает позиции сметы.
func (s *EstimateService) Items(ctx context.Context, estimateID string) ([]domain.EstimateItem, error) {
	if _, err := s.estimates.GetByID(ctx, estimateID); err != nil {
		return nil, err
	}
	return s.estimates.ListItems(ctx, estimateID)
}

// List возвращает сметы с фильтрами.
func (s *EstimateService) List(ctx context.Context, f EstimateFilter, page domain.Page) (domain.ListResult[domain.Estimate], error) {
	if f.Status != "" && !domain.EstimateStatus(f.Status).Valid() {
		return domain.ListResult[domain.Estimate]{}, domain.NewValidation("status", "неизвестный статус")
	}
	return s.estimates.List(ctx, f, page)
}

// ReplaceItems заменяет позиции сметы (только в статусе черновика/на проверке).
func (s *EstimateService) ReplaceItems(ctx context.Context, actor *domain.User, estimateID string, items []EstimateItemInput) (*domain.Estimate, error) {
	e, err := s.estimates.GetByID(ctx, estimateID)
	if err != nil {
		return nil, err
	}
	if e.Status == domain.EstimateApproved || e.Status == domain.EstimateArchived {
		return nil, domain.NewPrecondition("нельзя менять позиции утверждённой или архивной сметы")
	}
	normalized, _, err := s.normalizeItems(items)
	if err != nil {
		return nil, err
	}
	if err := s.estimates.ReplaceItems(ctx, estimateID, normalized); err != nil {
		return nil, err
	}
	if _, err := s.estimates.RecomputeTotal(ctx, estimateID); err != nil {
		return nil, err
	}
	_ = s.record(ctx, actor, "update", "estimate", estimateID, "Обновлены позиции сметы "+e.Number)
	return s.estimates.GetByID(ctx, estimateID)
}

// Transition переводит смету между статусами по правилам рабочего процесса.
func (s *EstimateService) Transition(ctx context.Context, actor *domain.User, id string, target domain.EstimateStatus, expectedVersion int) (*domain.Estimate, error) {
	e, err := s.estimates.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if expectedVersion != 0 && expectedVersion != e.Version {
		return nil, domain.ErrVersionMismatch
	}
	if err := s.checkTransition(e, target, actor); err != nil {
		return nil, err
	}
	approvedBy := ""
	if target == domain.EstimateApproved {
		approvedBy = actor.ID
	}
	if err := s.estimates.UpdateStatus(ctx, id, target, approvedBy, e.Version); err != nil {
		return nil, err
	}
	_ = s.record(ctx, actor, "status", "estimate", id,
		fmt.Sprintf("Смета %s: %s → %s", e.Number, e.Status, target))
	return s.estimates.GetByID(ctx, id)
}

// checkTransition — матрица допустимых переходов статуса сметы.
func (s *EstimateService) checkTransition(e *domain.Estimate, target domain.EstimateStatus, actor *domain.User) error {
	if !target.Valid() {
		return domain.NewValidation("status", "неизвестный статус сметы")
	}
	allowed := map[domain.EstimateStatus][]domain.EstimateStatus{
		domain.EstimateDraft:    {domain.EstimateOnReview, domain.EstimateArchived},
		domain.EstimateOnReview: {domain.EstimateApproved, domain.EstimateRejected, domain.EstimateDraft},
		domain.EstimateRejected: {domain.EstimateDraft, domain.EstimateArchived},
		domain.EstimateApproved: {domain.EstimateArchived},
		domain.EstimateArchived: {},
	}
	if !containsStatus(allowed[e.Status], target) {
		return domain.NewPrecondition(fmt.Sprintf("переход %s → %s недопустим", e.Status, target))
	}
	// Утверждение и отклонение требуют права approve.
	if (target == domain.EstimateApproved || target == domain.EstimateRejected) && !actor.Role.CanApprove() {
		return domain.ErrForbidden
	}
	return nil
}

// Delete удаляет смету.
func (s *EstimateService) Delete(ctx context.Context, actor *domain.User, id string) error {
	e, err := s.estimates.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if e.Status == domain.EstimateApproved {
		return domain.NewPrecondition("нельзя удалить утверждённую смету")
	}
	if err := s.estimates.Delete(ctx, id); err != nil {
		return err
	}
	_ = s.record(ctx, actor, "delete", "estimate", id, "Удалена смета "+e.Number)
	return nil
}

// Analyze выполняет детерминированную проверку сметы на аномалии.
// Это предметная (не LLM) бизнес-логика: правила предметной области строительства.
func (s *EstimateService) Analyze(ctx context.Context, id string) (domain.EstimateAnalysis, error) {
	e, err := s.estimates.GetByID(ctx, id)
	if err != nil {
		return domain.EstimateAnalysis{}, err
	}
	items, err := s.estimates.ListItems(ctx, id)
	if err != nil {
		return domain.EstimateAnalysis{}, err
	}

	a := domain.EstimateAnalysis{
		EstimateID: id,
		TotalMinor: e.TotalMinor,
		ItemCount:  len(items),
		Anomalies:  []domain.EstimateAnomaly{},
	}
	if len(items) == 0 {
		a.Anomalies = append(a.Anomalies, domain.EstimateAnomaly{
			Severity: "high", Kind: "empty", Message: "В смете нет ни одной позиции",
		})
		a.RiskScore = 20
		return a, nil
	}

	byCat := map[string]*domain.CategoryTotal{}
	byName := map[string][]domain.EstimateItem{}
	var total float64
	for _, it := range items {
		total += float64(it.TotalMinor)
		c := byCat[it.Category]
		if c == nil {
			c = &domain.CategoryTotal{Category: it.Category}
			byCat[it.Category] = c
		}
		c.TotalMinor += it.TotalMinor
		c.ItemCount++
		byName[strings.ToLower(strings.TrimSpace(it.Name))] = append(byName[strings.ToLower(strings.TrimSpace(it.Name))], it)
	}

	high, medium := 0, 0

	// Правило 1: дублирующиеся позиции (одинаковое наименование более одного раза).
	for name, group := range byName {
		if len(group) > 1 && name != "" {
			var impact int64
			for _, g := range group {
				impact += g.TotalMinor
			}
			a.Anomalies = append(a.Anomalies, domain.EstimateAnomaly{
				Severity: "medium", Kind: "duplicate", ItemID: group[0].ID, ItemName: group[0].Name,
				Message: fmt.Sprintf("Позиция «%s» встречается %d раза", group[0].Name, len(group)),
				ImpactMinor: impact,
			})
			medium++
		}
	}

	// Правило 2: количество или цена неположительны.
	for _, it := range items {
		if it.Quantity <= 0 {
			a.Anomalies = append(a.Anomalies, domain.EstimateAnomaly{
				Severity: "high", Kind: "non_positive_qty", ItemID: it.ID, ItemName: it.Name,
				Message: "Нулевое или отрицательное количество", ImpactMinor: it.TotalMinor,
			})
			high++
		}
		if it.UnitPriceMinor <= 0 {
			a.Anomalies = append(a.Anomalies, domain.EstimateAnomaly{
				Severity: "medium", Kind: "non_positive_price", ItemID: it.ID, ItemName: it.Name,
				Message: "Нулевая или отрицательная цена за единицу", ImpactMinor: it.TotalMinor,
			})
			medium++
		}
	}

	// Правило 3: позиция занимает аномально большую долю сметы (> 40% при > 3 позициях).
	if len(items) > 3 && total > 0 {
		for _, it := range items {
			share := float64(it.TotalMinor) / total
			if share > 0.40 {
				a.Anomalies = append(a.Anomalies, domain.EstimateAnomaly{
					Severity: "medium", Kind: "dominant_item", ItemID: it.ID, ItemName: it.Name,
					Message: fmt.Sprintf("Позиция занимает %.0f%% сметы — проверьте объём и цену", share*100),
					ImpactMinor: it.TotalMinor,
				})
				medium++
			}
		}
	}

	// Правило 4: детализация цены не совпадает с произведением количества и цены.
	for _, it := range items {
		expected := int64(math.Round(it.Quantity * float64(it.UnitPriceMinor)))
		diff := it.TotalMinor - expected
		if diff < 0 {
			diff = -diff
		}
		// Допуск — 1 минорная единица на погрешность округления.
		if diff > 1 && it.Quantity > 0 && it.UnitPriceMinor > 0 {
			a.Anomalies = append(a.Anomalies, domain.EstimateAnomaly{
				Severity: "high", Kind: "math_mismatch", ItemID: it.ID, ItemName: it.Name,
				Message: "Сумма позиции не совпадает с «количество × цена»",
				ImpactMinor: diff,
			})
			high++
		}
	}

	// Заполняем категорийные итоги.
	for _, c := range byCat {
		a.ByCategory = append(a.ByCategory, *c)
	}

	// Risk score: 0..100 на основе числа и тяжести находок.
	score := high*20 + medium*8
	if score > 100 {
		score = 100
	}
	a.RiskScore = score
	return a, nil
}

// normalizeItems проверяет позиции и вычисляет суммы и итог.
func (s *EstimateService) normalizeItems(input []EstimateItemInput) ([]domain.EstimateItem, int64, error) {
	if len(input) == 0 {
		return nil, 0, domain.NewValidation("items", "смета должна содержать хотя бы одну позицию")
	}
	items := make([]domain.EstimateItem, 0, len(input))
	var total int64
	for i, in := range input {
		name := strings.TrimSpace(in.Name)
		if name == "" {
			return nil, 0, domain.NewValidation("items", fmt.Sprintf("позиция %d: укажите наименование", i+1))
		}
		if in.Quantity < 0 {
			return nil, 0, domain.NewValidation("items", fmt.Sprintf("позиция %d: количество не может быть отрицательным", i+1))
		}
		if in.UnitPriceMinor < 0 {
			return nil, 0, domain.NewValidation("items", fmt.Sprintf("позиция %d: цена не может быть отрицательной", i+1))
		}
		sum := int64(math.Round(in.Quantity * float64(in.UnitPriceMinor)))
		total += sum
		items = append(items, domain.EstimateItem{
			ID:             uuid.NewString(),
			Position:       i + 1,
			Code:           strings.TrimSpace(in.Code),
			Name:           name,
			Unit:           strings.TrimSpace(in.Unit),
			Quantity:       in.Quantity,
			UnitPriceMinor: in.UnitPriceMinor,
			TotalMinor:     sum,
			Category:       strings.TrimSpace(in.Category),
		})
	}
	return items, total, nil
}

func (s *EstimateService) record(ctx context.Context, actor *domain.User, action, entity, id, summary string) error {
	if s.activity == nil || actor == nil {
		return nil
	}
	return s.activity.Add(ctx, &domain.Activity{
		ID: uuid.NewString(), ActorID: actor.ID, ActorName: actor.FullName,
		Action: action, EntityType: entity, EntityID: id, Summary: summary,
		CreatedAt: s.clock().UTC(),
	})
}

func containsStatus(list []domain.EstimateStatus, s domain.EstimateStatus) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
