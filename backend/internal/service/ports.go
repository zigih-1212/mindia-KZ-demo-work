package service

import (
	"context"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
)

// UserRepository — доступ к учётным записям.
type UserRepository interface {
	Create(ctx context.Context, u *domain.User) error
	GetByID(ctx context.Context, id string) (*domain.User, error)
	GetByEmail(ctx context.Context, email string) (*domain.User, error)
	List(ctx context.Context, page domain.Page) (domain.ListResult[domain.User], error)
	Update(ctx context.Context, u *domain.User) error
	SetActive(ctx context.Context, id string, active bool) error
	Count(ctx context.Context) (int, error)
}

// ProjectRepository — доступ к строительным объектам.
type ProjectRepository interface {
	Create(ctx context.Context, p *domain.Project) error
	GetByID(ctx context.Context, id string) (*domain.Project, error)
	List(ctx context.Context, f ProjectFilter, page domain.Page) (domain.ListResult[domain.Project], error)
	Update(ctx context.Context, p *domain.Project) error
	Delete(ctx context.Context, id string) error
	Summary(ctx context.Context) (domain.DashboardSummary, error)
	AddSpent(ctx context.Context, id string, deltaMinor int64) error
	ListStages(ctx context.Context, projectID string) ([]domain.ProjectStage, error)
	GetStage(ctx context.Context, id string) (*domain.ProjectStage, error)
}

// ProjectFilter — фильтры списка объектов.
type ProjectFilter struct {
	Status  string
	ManagerID string
	Search  string
}

// EstimateRepository — доступ к сметам и позициям.
type EstimateRepository interface {
	Create(ctx context.Context, e *domain.Estimate, items []domain.EstimateItem) error
	GetByID(ctx context.Context, id string) (*domain.Estimate, error)
	List(ctx context.Context, f EstimateFilter, page domain.Page) (domain.ListResult[domain.Estimate], error)
	Update(ctx context.Context, e *domain.Estimate) error
	UpdateStatus(ctx context.Context, id string, status domain.EstimateStatus, approvedBy string, expectedVersion int) error
	ListItems(ctx context.Context, estimateID string) ([]domain.EstimateItem, error)
	ReplaceItems(ctx context.Context, estimateID string, items []domain.EstimateItem) error
	RecomputeTotal(ctx context.Context, estimateID string) (int64, error)
	Delete(ctx context.Context, id string) error
}

// EstimateFilter — фильтры списка смет.
type EstimateFilter struct {
	ProjectID string
	Status    string
	Search    string
}

// DocumentRepository — доступ к документам.
type DocumentRepository interface {
	Create(ctx context.Context, d *domain.Document) error
	GetByID(ctx context.Context, id string) (*domain.Document, error)
	List(ctx context.Context, f DocumentFilter, page domain.Page) (domain.ListResult[domain.Document], error)
	UpdateStatus(ctx context.Context, id string, status domain.DocumentStatus, approvedBy string, expectedVersion int) error
	Update(ctx context.Context, d *domain.Document) error
	Delete(ctx context.Context, id string) error
}

// DocumentFilter — фильтры списка документов.
type DocumentFilter struct {
	ProjectID string
	Status    string
	Type      string
	Search    string
}

// ActivityRepository — журнал действий.
type ActivityRepository interface {
	Add(ctx context.Context, a *domain.Activity) error
	List(ctx context.Context, limit int) ([]domain.Activity, error)
	ListByEntity(ctx context.Context, entityType, entityID string, limit int) ([]domain.Activity, error)
}

// NormativeRepository — нормативная база для RAG-поиска.
type NormativeRepository interface {
	Search(ctx context.Context, query string, limit int) ([]domain.NormativeDoc, error)
	List(ctx context.Context) ([]domain.NormativeDoc, error)
}

// AIRepository — хранение диалогов, сообщений и расхода токенов.
type AIRepository interface {
	CreateConversation(ctx context.Context, c *domain.AIConversation) error
	GetConversation(ctx context.Context, id string) (*domain.AIConversation, error)
	ListConversations(ctx context.Context, userID string, limit int) ([]domain.AIConversation, error)
	TouchConversation(ctx context.Context, id, title string) error
	AppendMessage(ctx context.Context, m *domain.AIMessage) error
	ListMessages(ctx context.Context, conversationID string, limit int) ([]domain.AIMessage, error)
	Usage(ctx context.Context) (domain.AIUsage, error)
	AddUsage(ctx context.Context, tokensIn, tokensOut int) error
}
