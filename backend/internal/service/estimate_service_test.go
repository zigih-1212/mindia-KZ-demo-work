package service

import (
	"context"
	"errors"
	"testing"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
)

func newEstimateSvc(projects *fakeProjectRepo) (*EstimateService, *fakeEstimateRepo) {
	estimates := newFakeEstimateRepo()
	svc := NewEstimateService(estimates, projects, &fakeActivityRepo{})
	return svc, estimates
}

func TestEstimateService_Create_NormalizesAndValidates(t *testing.T) {
	projects := newFakeProjectRepo()
	projects.byID["p1"] = &domain.Project{ID: "p1", Code: "P1", Name: "Объект"}
	svc, _ := newEstimateSvc(projects)
	ctx := context.Background()
	actor := newTestUser("estimator", domain.RoleEstimator)

	// Успешное создание: TotalMinor = Σ round(qty*price).
	est, err := svc.Create(ctx, actor, CreateEstimateInput{
		ProjectID: "p1", Number: "СМ-100", Name: "Смета",
		Items: []EstimateItemInput{
			{Name: "Бетон", Unit: "м3", Quantity: 2, UnitPriceMinor: 1500, Category: "Материалы"},
			{Name: "Работы", Unit: "ч", Quantity: 3, UnitPriceMinor: 1000, Category: "Работы"},
		},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if est.TotalMinor != 6000 {
		t.Errorf("TotalMinor = %d, ожидалось 6000", est.TotalMinor)
	}
	if est.Status != domain.EstimateDraft {
		t.Errorf("status = %q, ожидалось draft", est.Status)
	}
	if est.Currency != "KZT" {
		t.Errorf("currency = %q, ожидалось KZT", est.Currency)
	}

	// Отрицательное количество -> validation.
	_, err = svc.Create(ctx, actor, CreateEstimateInput{
		ProjectID: "p1", Number: "СМ-101", Name: "Плохая",
		Items: []EstimateItemInput{{Name: "X", Quantity: -1, UnitPriceMinor: 10}},
	})
	if !errors.Is(err, domain.ErrValidation) {
		t.Errorf("Create(negative qty) = %v, ожидалось ErrValidation", err)
	}

	// Несуществующий объект -> не найдено.
	_, err = svc.Create(ctx, actor, CreateEstimateInput{
		ProjectID: "nope", Number: "СМ-102", Name: "Сирота",
		Items: []EstimateItemInput{{Name: "X", Quantity: 1, UnitPriceMinor: 10}},
	})
	if !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("Create(unknown project) = %v, ожидалось ErrNotFound", err)
	}
}

func TestEstimateService_Transition_MatrixAndRBAC(t *testing.T) {
	projects := newFakeProjectRepo()
	svc, estimates := newEstimateSvc(projects)
	ctx := context.Background()

	estimator := newTestUser("est", domain.RoleEstimator)
	admin := newTestUser("adm", domain.RoleAdmin)

	estimates.byID["e1"] = &domain.Estimate{ID: "e1", Number: "СМ-1", Status: domain.EstimateDraft, Version: 1}

	// draft -> on_review разрешён.
	got, err := svc.Transition(ctx, estimator, "e1", domain.EstimateOnReview, 1)
	if err != nil {
		t.Fatalf("Transition(draft->on_review): %v", err)
	}
	if got.Status != domain.EstimateOnReview {
		t.Errorf("status = %q, ожидалось on_review", got.Status)
	}

	// Сметчик НЕ может утверждать -> forbidden.
	if _, err := svc.Transition(ctx, estimator, "e1", domain.EstimateApproved, 0); !errors.Is(err, domain.ErrForbidden) {
		t.Errorf("Transition(estimator approve) = %v, ожидалось ErrForbidden", err)
	}

	// Администратор может утверждать.
	approved, err := svc.Transition(ctx, admin, "e1", domain.EstimateApproved, 0)
	if err != nil {
		t.Fatalf("Transition(admin approve): %v", err)
	}
	if approved.Status != domain.EstimateApproved || approved.ApprovedBy != admin.ID {
		t.Errorf("утверждение не зафиксировано: %+v", approved)
	}

	// Неизвестный статус -> validation.
	if _, err := svc.Transition(ctx, admin, "e1", domain.EstimateStatus("bogus"), 0); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("Transition(bad status) = %v, ожидалось ErrValidation", err)
	}
}

func TestEstimateService_Transition_VersionMismatch(t *testing.T) {
	projects := newFakeProjectRepo()
	svc, estimates := newEstimateSvc(projects)
	ctx := context.Background()
	estimates.byID["e2"] = &domain.Estimate{ID: "e2", Status: domain.EstimateDraft, Version: 5}

	if _, err := svc.Transition(ctx, newTestUser("adm", domain.RoleAdmin), "e2", domain.EstimateOnReview, 4); !errors.Is(err, domain.ErrVersionMismatch) {
		t.Errorf("Transition(stale) = %v, ожидалось ErrVersionMismatch", err)
	}
}

func TestEstimateService_Analyze_Rules(t *testing.T) {
	projects := newFakeProjectRepo()
	svc, estimates := newEstimateSvc(projects)
	ctx := context.Background()

	// (a) дубликат имени -> medium duplicate.
	estimates.byID["dup"] = &domain.Estimate{ID: "dup", TotalMinor: 400}
	estimates.items["dup"] = []domain.EstimateItem{
		{ID: "i1", Name: "Фасад", TotalMinor: 200, Quantity: 2, UnitPriceMinor: 100},
		{ID: "i2", Name: "Фасад", TotalMinor: 200, Quantity: 2, UnitPriceMinor: 100},
	}
	an, err := svc.Analyze(ctx, "dup")
	if err != nil {
		t.Fatalf("Analyze(dup): %v", err)
	}
	if !hasKind(an, "duplicate") {
		t.Errorf("ожидалась аномалия duplicate, получено %+v", an.Anomalies)
	}

	// (b) нулевая цена -> medium non_positive_price; нулевое количество -> high.
	estimates.byID["zero"] = &domain.Estimate{ID: "zero", TotalMinor: 0}
	estimates.items["zero"] = []domain.EstimateItem{
		{ID: "z1", Name: "Без цены", Quantity: 1, UnitPriceMinor: 0, TotalMinor: 0},
	}
	an, _ = svc.Analyze(ctx, "zero")
	if !hasKind(an, "non_positive_price") {
		t.Errorf("ожидалась non_positive_price, получено %+v", an.Anomalies)
	}
	if an.RiskScore != 8 { // 1 medium * 8
		t.Errorf("RiskScore = %d, ожидалось 8", an.RiskScore)
	}

	// (c) арифметическое расхождение -> high math_mismatch.
	estimates.byID["math"] = &domain.Estimate{ID: "math", TotalMinor: 999}
	estimates.items["math"] = []domain.EstimateItem{
		{ID: "m1", Name: "Расхождение", Quantity: 2, UnitPriceMinor: 100, TotalMinor: 999},
	}
	an, _ = svc.Analyze(ctx, "math")
	if !hasKind(an, "math_mismatch") {
		t.Errorf("ожидалась math_mismatch, получено %+v", an.Anomalies)
	}
	if an.RiskScore != 20 { // 1 high * 20
		t.Errorf("RiskScore = %d, ожидалось 20", an.RiskScore)
	}

	// (d) доминирующая позиция (>40% при >3 позициях) -> medium dominant_item.
	estimates.byID["dom"] = &domain.Estimate{ID: "dom", TotalMinor: 1000}
	estimates.items["dom"] = []domain.EstimateItem{
		{ID: "d1", Name: "Дорогая", Quantity: 1, UnitPriceMinor: 700, TotalMinor: 700},
		{ID: "d2", Name: "Дешёвая 1", Quantity: 1, UnitPriceMinor: 100, TotalMinor: 100},
		{ID: "d3", Name: "Дешёвая 2", Quantity: 1, UnitPriceMinor: 100, TotalMinor: 100},
		{ID: "d4", Name: "Дешёвая 3", Quantity: 1, UnitPriceMinor: 100, TotalMinor: 100},
	}
	an, _ = svc.Analyze(ctx, "dom")
	if !hasKind(an, "dominant_item") {
		t.Errorf("ожидалась dominant_item, получено %+v", an.Anomalies)
	}

	// Пустая смета -> high empty, RiskScore 20.
	estimates.byID["empty"] = &domain.Estimate{ID: "empty", TotalMinor: 0}
	estimates.items["empty"] = nil
	an, _ = svc.Analyze(ctx, "empty")
	if !hasKind(an, "empty") || an.RiskScore != 20 {
		t.Errorf("пустая смета: ожидалась empty и RiskScore 20, получено %+v (score=%d)", an.Anomalies, an.RiskScore)
	}
}

func TestEstimateService_Delete_And_ReplaceItems_Blocked(t *testing.T) {
	projects := newFakeProjectRepo()
	svc, estimates := newEstimateSvc(projects)
	ctx := context.Background()
	admin := newTestUser("adm", domain.RoleAdmin)

	estimates.byID["appr"] = &domain.Estimate{ID: "appr", Status: domain.EstimateApproved, Version: 2}

	if err := svc.Delete(ctx, admin, "appr"); !errors.Is(err, domain.ErrPreconditionFailed) {
		t.Errorf("Delete(approved) = %v, ожидалось ErrPreconditionFailed", err)
	}
	_, err := svc.ReplaceItems(ctx, admin, "appr", []EstimateItemInput{{Name: "X", Quantity: 1, UnitPriceMinor: 1}})
	if !errors.Is(err, domain.ErrPreconditionFailed) {
		t.Errorf("ReplaceItems(approved) = %v, ожидалось ErrPreconditionFailed", err)
	}
}

func hasKind(a domain.EstimateAnalysis, kind string) bool {
	for _, an := range a.Anomalies {
		if an.Kind == kind {
			return true
		}
	}
	return false
}
