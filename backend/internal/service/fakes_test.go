package service

import (
	"context"
	"time"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
)

// --- fakes: реализации портов в памяти для изоляции бизнес-логики от БД. ---

// fakeUserRepo — in-memory UserRepository.
type fakeUserRepo struct {
	byID    map[string]*domain.User
	byEmail map[string]*domain.User
}

func newFakeUserRepo() *fakeUserRepo {
	return &fakeUserRepo{byID: map[string]*domain.User{}, byEmail: map[string]*domain.User{}}
}

func (r *fakeUserRepo) Create(_ context.Context, u *domain.User) error {
	if _, ok := r.byEmail[u.Email]; ok {
		return domain.NewConflict("пользователь с таким email уже существует")
	}
	r.byID[u.ID] = u
	r.byEmail[u.Email] = u
	return nil
}

func (r *fakeUserRepo) GetByID(_ context.Context, id string) (*domain.User, error) {
	if u, ok := r.byID[id]; ok {
		return u, nil
	}
	return nil, domain.ErrNotFound
}

func (r *fakeUserRepo) GetByEmail(_ context.Context, email string) (*domain.User, error) {
	if u, ok := r.byEmail[email]; ok {
		return u, nil
	}
	return nil, domain.ErrNotFound
}

func (r *fakeUserRepo) List(_ context.Context, _ domain.Page) (domain.ListResult[domain.User], error) {
	items := make([]domain.User, 0, len(r.byID))
	for _, u := range r.byID {
		items = append(items, *u)
	}
	return domain.ListResult[domain.User]{Items: items, Total: len(items)}, nil
}

func (r *fakeUserRepo) Update(_ context.Context, u *domain.User) error {
	if _, ok := r.byID[u.ID]; !ok {
		return domain.ErrNotFound
	}
	r.byID[u.ID] = u
	r.byEmail[u.Email] = u
	return nil
}

func (r *fakeUserRepo) SetActive(_ context.Context, id string, active bool) error {
	u, ok := r.byID[id]
	if !ok {
		return domain.ErrNotFound
	}
	u.IsActive = active
	return nil
}

func (r *fakeUserRepo) Count(_ context.Context) (int, error) { return len(r.byID), nil }

// fakeProjectRepo — in-memory ProjectRepository с записью вызовов AddSpent.
type fakeProjectRepo struct {
	byID        map[string]*domain.Project
	stages      map[string][]domain.ProjectStage
	summary     domain.DashboardSummary
	addSpentLog []addSpentCall
}

type addSpentCall struct {
	ProjectID string
	Delta     int64
}

func newFakeProjectRepo() *fakeProjectRepo {
	return &fakeProjectRepo{byID: map[string]*domain.Project{}, stages: map[string][]domain.ProjectStage{}}
}

func (r *fakeProjectRepo) Create(_ context.Context, p *domain.Project) error {
	r.byID[p.ID] = p
	return nil
}

func (r *fakeProjectRepo) GetByID(_ context.Context, id string) (*domain.Project, error) {
	if p, ok := r.byID[id]; ok {
		return p, nil
	}
	return nil, domain.ErrNotFound
}

func (r *fakeProjectRepo) List(_ context.Context, _ ProjectFilter, _ domain.Page) (domain.ListResult[domain.Project], error) {
	items := make([]domain.Project, 0, len(r.byID))
	for _, p := range r.byID {
		items = append(items, *p)
	}
	return domain.ListResult[domain.Project]{Items: items, Total: len(items)}, nil
}

func (r *fakeProjectRepo) Update(_ context.Context, p *domain.Project) error {
	p.Version++
	r.byID[p.ID] = p
	return nil
}

func (r *fakeProjectRepo) Delete(_ context.Context, id string) error {
	if _, ok := r.byID[id]; !ok {
		return domain.ErrNotFound
	}
	delete(r.byID, id)
	return nil
}

func (r *fakeProjectRepo) Summary(_ context.Context) (domain.DashboardSummary, error) {
	return r.summary, nil
}

func (r *fakeProjectRepo) AddSpent(_ context.Context, id string, deltaMinor int64) error {
	p, ok := r.byID[id]
	if !ok {
		return domain.ErrNotFound
	}
	p.SpentMinor += deltaMinor
	r.addSpentLog = append(r.addSpentLog, addSpentCall{ProjectID: id, Delta: deltaMinor})
	return nil
}

func (r *fakeProjectRepo) ListStages(_ context.Context, projectID string) ([]domain.ProjectStage, error) {
	return r.stages[projectID], nil
}

func (r *fakeProjectRepo) GetStage(_ context.Context, id string) (*domain.ProjectStage, error) {
	return nil, domain.ErrNotFound
}

// fakeEstimateRepo — in-memory EstimateRepository.
type fakeEstimateRepo struct {
	byID  map[string]*domain.Estimate
	items map[string][]domain.EstimateItem
}

func newFakeEstimateRepo() *fakeEstimateRepo {
	return &fakeEstimateRepo{byID: map[string]*domain.Estimate{}, items: map[string][]domain.EstimateItem{}}
}

func (r *fakeEstimateRepo) Create(_ context.Context, e *domain.Estimate, items []domain.EstimateItem) error {
	for _, other := range r.byID {
		if other.ProjectID == e.ProjectID && other.Number == e.Number {
			return domain.NewConflict("смета с таким номером уже существует для объекта")
		}
	}
	e.ItemCount = len(items)
	r.byID[e.ID] = e
	r.items[e.ID] = items
	return nil
}

func (r *fakeEstimateRepo) GetByID(_ context.Context, id string) (*domain.Estimate, error) {
	if e, ok := r.byID[id]; ok {
		return e, nil
	}
	return nil, domain.ErrNotFound
}

func (r *fakeEstimateRepo) List(_ context.Context, _ EstimateFilter, _ domain.Page) (domain.ListResult[domain.Estimate], error) {
	items := make([]domain.Estimate, 0, len(r.byID))
	for _, e := range r.byID {
		items = append(items, *e)
	}
	return domain.ListResult[domain.Estimate]{Items: items, Total: len(items)}, nil
}

func (r *fakeEstimateRepo) Update(_ context.Context, e *domain.Estimate) error {
	r.byID[e.ID] = e
	return nil
}

func (r *fakeEstimateRepo) UpdateStatus(_ context.Context, id string, status domain.EstimateStatus, approvedBy string, expectedVersion int) error {
	e, ok := r.byID[id]
	if !ok {
		return domain.ErrNotFound
	}
	if e.Version != expectedVersion {
		return domain.ErrVersionMismatch
	}
	e.Status = status
	e.Version++
	if approvedBy != "" {
		e.ApprovedBy = approvedBy
	}
	return nil
}

func (r *fakeEstimateRepo) ListItems(_ context.Context, estimateID string) ([]domain.EstimateItem, error) {
	return r.items[estimateID], nil
}

func (r *fakeEstimateRepo) ReplaceItems(_ context.Context, estimateID string, items []domain.EstimateItem) error {
	r.items[estimateID] = items
	return nil
}

func (r *fakeEstimateRepo) RecomputeTotal(_ context.Context, estimateID string) (int64, error) {
	var total int64
	for _, it := range r.items[estimateID] {
		total += it.TotalMinor
	}
	if e, ok := r.byID[estimateID]; ok {
		e.TotalMinor = total
	}
	return total, nil
}

func (r *fakeEstimateRepo) Delete(_ context.Context, id string) error {
	if _, ok := r.byID[id]; !ok {
		return domain.ErrNotFound
	}
	delete(r.byID, id)
	delete(r.items, id)
	return nil
}

// fakeDocumentRepo — in-memory DocumentRepository.
type fakeDocumentRepo struct {
	byID map[string]*domain.Document
}

func newFakeDocumentRepo() *fakeDocumentRepo {
	return &fakeDocumentRepo{byID: map[string]*domain.Document{}}
}

func (r *fakeDocumentRepo) Create(_ context.Context, d *domain.Document) error {
	r.byID[d.ID] = d
	return nil
}

func (r *fakeDocumentRepo) GetByID(_ context.Context, id string) (*domain.Document, error) {
	if d, ok := r.byID[id]; ok {
		return d, nil
	}
	return nil, domain.ErrNotFound
}

func (r *fakeDocumentRepo) List(_ context.Context, _ DocumentFilter, _ domain.Page) (domain.ListResult[domain.Document], error) {
	items := make([]domain.Document, 0, len(r.byID))
	for _, d := range r.byID {
		items = append(items, *d)
	}
	return domain.ListResult[domain.Document]{Items: items, Total: len(items)}, nil
}

func (r *fakeDocumentRepo) UpdateStatus(_ context.Context, id string, status domain.DocumentStatus, approvedBy string, expectedVersion int) error {
	d, ok := r.byID[id]
	if !ok {
		return domain.ErrNotFound
	}
	if d.Version != expectedVersion {
		return domain.ErrVersionMismatch
	}
	d.Status = status
	d.Version++
	if approvedBy != "" {
		d.ApprovedBy = approvedBy
	}
	return nil
}

func (r *fakeDocumentRepo) Update(_ context.Context, d *domain.Document) error {
	r.byID[d.ID] = d
	return nil
}

func (r *fakeDocumentRepo) Delete(_ context.Context, id string) error {
	if _, ok := r.byID[id]; !ok {
		return domain.ErrNotFound
	}
	delete(r.byID, id)
	return nil
}

// fakeActivityRepo — in-memory ActivityRepository.
type fakeActivityRepo struct {
	entries []domain.Activity
}

func (r *fakeActivityRepo) Add(_ context.Context, a *domain.Activity) error {
	r.entries = append(r.entries, *a)
	return nil
}

func (r *fakeActivityRepo) List(_ context.Context, _ int) ([]domain.Activity, error) {
	return r.entries, nil
}

func (r *fakeActivityRepo) ListByEntity(_ context.Context, _, _ string, _ int) ([]domain.Activity, error) {
	return r.entries, nil
}

// newTestUser создаёт активного пользователя заданной роли.
func newTestUser(id string, role domain.Role) *domain.User {
	return &domain.User{
		ID: id, Email: id + "@test.kz", FullName: "Тест " + id,
		Role: role, IsActive: true, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
}
