package service

import (
	"context"
	"errors"
	"testing"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
)

func TestDocumentService_ApproveKS2_UpdatesProjectSpent(t *testing.T) {
	projects := newFakeProjectRepo()
	projects.byID["p1"] = &domain.Project{ID: "p1", Code: "P1", Name: "Объект", SpentMinor: 1000}
	docs := newFakeDocumentRepo()
	svc := NewDocumentService(docs, projects, &fakeActivityRepo{})
	ctx := context.Background()

	admin := newTestUser("adm", domain.RoleAdmin)
	estimator := newTestUser("est", domain.RoleEstimator)

	docs.byID["d1"] = &domain.Document{
		ID: "d1", ProjectID: "p1", Type: domain.DocKS2, Number: "КС-2-1",
		Title: "Акт", Status: domain.DocDraft, AmountMinor: 5000, Version: 1,
	}

	// draft -> submitted (исполнитель может).
	if _, err := svc.Transition(ctx, estimator, "d1", domain.DocSubmitted, 1); err != nil {
		t.Fatalf("Transition(draft->submitted): %v", err)
	}

	// Исполнитель НЕ может утверждать -> forbidden.
	if _, err := svc.Transition(ctx, estimator, "d1", domain.DocApproved, 0); !errors.Is(err, domain.ErrForbidden) {
		t.Errorf("Transition(estimator approve) = %v, ожидалось ErrForbidden", err)
	}

	// Администратор утверждает КС-2 -> факт объекта увеличивается на сумму акта.
	before := projects.byID["p1"].SpentMinor
	if _, err := svc.Transition(ctx, admin, "d1", domain.DocApproved, 0); err != nil {
		t.Fatalf("Transition(admin approve KS2): %v", err)
	}
	if projects.byID["p1"].SpentMinor != before+5000 {
		t.Errorf("spent = %d, ожидалось %d", projects.byID["p1"].SpentMinor, before+5000)
	}
	if len(projects.addSpentLog) != 1 || projects.addSpentLog[0].Delta != 5000 {
		t.Errorf("AddSpent не вызван корректно: %+v", projects.addSpentLog)
	}
}

func TestDocumentService_NonKS_DoesNotTouchSpent(t *testing.T) {
	projects := newFakeProjectRepo()
	projects.byID["p1"] = &domain.Project{ID: "p1", SpentMinor: 1000}
	docs := newFakeDocumentRepo()
	svc := NewDocumentService(docs, projects, &fakeActivityRepo{})
	ctx := context.Background()
	admin := newTestUser("adm", domain.RoleAdmin)

	// Счёт (invoice): утверждение не должно менять освоенный бюджет.
	docs.byID["inv"] = &domain.Document{
		ID: "inv", ProjectID: "p1", Type: domain.DocInvoice, Number: "СЧ-1",
		Title: "Счёт", Status: domain.DocSubmitted, AmountMinor: 9999, Version: 1,
	}
	if _, err := svc.Transition(ctx, admin, "inv", domain.DocApproved, 0); err != nil {
		t.Fatalf("Transition(invoice approve): %v", err)
	}
	if projects.byID["p1"].SpentMinor != 1000 {
		t.Errorf("счёт не должен менять факт: spent = %d", projects.byID["p1"].SpentMinor)
	}
	if len(projects.addSpentLog) != 0 {
		t.Errorf("AddSpent не должен вызываться для счёта: %+v", projects.addSpentLog)
	}
}

func TestDocumentService_DeleteBlockedWhenApproved(t *testing.T) {
	projects := newFakeProjectRepo()
	docs := newFakeDocumentRepo()
	svc := NewDocumentService(docs, projects, &fakeActivityRepo{})
	ctx := context.Background()
	admin := newTestUser("adm", domain.RoleAdmin)

	docs.byID["appr"] = &domain.Document{ID: "appr", Status: domain.DocApproved, Version: 2}
	if err := svc.Delete(ctx, admin, "appr"); !errors.Is(err, domain.ErrPreconditionFailed) {
		t.Errorf("Delete(approved) = %v, ожидалось ErrPreconditionFailed", err)
	}
}

func TestDocumentService_Create_Validation(t *testing.T) {
	projects := newFakeProjectRepo()
	projects.byID["p1"] = &domain.Project{ID: "p1"}
	docs := newFakeDocumentRepo()
	svc := NewDocumentService(docs, projects, &fakeActivityRepo{})
	ctx := context.Background()
	admin := newTestUser("adm", domain.RoleAdmin)

	// Неверный тип документа -> validation.
	_, err := svc.Create(ctx, admin, CreateDocumentInput{
		ProjectID: "p1", Type: domain.DocumentType("bogus"), Number: "X-1", Title: "Тест",
	})
	if !errors.Is(err, domain.ErrValidation) {
		t.Errorf("Create(bad type) = %v, ожидалось ErrValidation", err)
	}

	// Корректный документ -> создаётся в статусе draft.
	d, err := svc.Create(ctx, admin, CreateDocumentInput{
		ProjectID: "p1", Type: domain.DocKS2, Number: "КС-2-9", Title: "Акт за период", AmountMinor: 100,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if d.Status != domain.DocDraft {
		t.Errorf("status = %q, ожидалось draft", d.Status)
	}
}
