// Package domain содержит сущности предметной области и доменные ошибки.
// Слой не зависит ни от SQL, ни от HTTP, ни от конкретной СУБД.
package domain

import "time"

// Role — роль пользователя в системе. Определяет права доступа.
type Role string

const (
	RoleAdmin     Role = "admin"     // администратор системы
	RoleManager   Role = "manager"   // руководитель проектов
	RoleEstimator Role = "estimator" // сметчик
	RoleForeman   Role = "foreman"   // прораб
	RoleCustomer  Role = "customer"  // заказчик (только чтение)
)

// Valid сообщает, является ли роль известной системе.
func (r Role) Valid() bool {
	switch r {
	case RoleAdmin, RoleManager, RoleEstimator, RoleForeman, RoleCustomer:
		return true
	default:
		return false
	}
}

// CanManageProjects — создание/изменение/удаление объектов.
func (r Role) CanManageProjects() bool {
	return r == RoleAdmin || r == RoleManager
}

// CanEditEstimates — сметы (создание/позиции/отправка/анализ).
func (r Role) CanEditEstimates() bool {
	return r == RoleAdmin || r == RoleManager || r == RoleEstimator
}

// CanEditDocuments — документы (создание/отправка).
func (r Role) CanEditDocuments() bool {
	return r == RoleAdmin || r == RoleManager || r == RoleForeman
}

// CanEdit — обратная совместимость: любая роль, кроме заказчика, может вносить
// какие-то изменения (конкретные операции ограничены Can* методами выше).
func (r Role) CanEdit() bool {
	return r == RoleAdmin || r == RoleManager || r == RoleEstimator || r == RoleForeman
}

// CanApprove сообщает, разрешено ли роли утверждать сметы и документы.
func (r Role) CanApprove() bool {
	return r == RoleAdmin || r == RoleManager
}

// User — учётная запись.
type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	FullName     string    `json:"fullName"`
	Position     string    `json:"position"`
	Role         Role      `json:"role"`
	IsActive     bool      `json:"isActive"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// ProjectStatus — жизненный цикл объекта строительства.
type ProjectStatus string

const (
	ProjectPlanning  ProjectStatus = "planning"
	ProjectActive    ProjectStatus = "active"
	ProjectSuspended ProjectStatus = "suspended"
	ProjectCompleted ProjectStatus = "completed"
)

// Valid проверяет допустимость статуса объекта.
func (s ProjectStatus) Valid() bool {
	switch s {
	case ProjectPlanning, ProjectActive, ProjectSuspended, ProjectCompleted:
		return true
	default:
		return false
	}
}

// Project — строительный объект.
type Project struct {
	ID               string        `json:"id"`
	Code             string        `json:"code"`
	Name             string        `json:"name"`
	Customer         string        `json:"customer"`
	Address          string        `json:"address"`
	Status           ProjectStatus `json:"status"`
	BudgetMinor      int64         `json:"budgetMinor"`
	SpentMinor       int64         `json:"spentMinor"`
	ContractAmountMinor int64      `json:"contractAmountMinor"`
	StartDate        string        `json:"startDate"`      // YYYY-MM-DD
	PlannedEndDate   string        `json:"plannedEndDate"` // YYYY-MM-DD
	ActualEndDate    string        `json:"actualEndDate,omitempty"`
	ManagerID        string        `json:"managerId"`
	ManagerName      string        `json:"managerName,omitempty"`
	ProgressPercent  int           `json:"progressPercent"`
	Version          int           `json:"version"`
	CreatedAt        time.Time     `json:"createdAt"`
	UpdatedAt        time.Time     `json:"updatedAt"`
}

// StageStatus — статус этапа.
type StageStatus string

const (
	StagePending   StageStatus = "pending"
	StageActive    StageStatus = "active"
	StageDone      StageStatus = "done"
	StageCancelled StageStatus = "cancelled"
)

// ProjectStage — этап работ по объекту.
type ProjectStage struct {
	ID              string      `json:"id"`
	ProjectID       string      `json:"projectId"`
	Name            string      `json:"name"`
	Sequence        int         `json:"sequence"`
	Status          StageStatus `json:"status"`
	PlannedStart    string      `json:"plannedStart"`
	PlannedEnd      string      `json:"plannedEnd"`
	ProgressPercent int         `json:"progressPercent"`
	PlannedMinor    int64       `json:"plannedMinor"`
	ActualMinor     int64       `json:"actualMinor"`
}

// EstimateStatus — статус сметы.
type EstimateStatus string

const (
	EstimateDraft    EstimateStatus = "draft"
	EstimateOnReview EstimateStatus = "on_review"
	EstimateApproved EstimateStatus = "approved"
	EstimateRejected EstimateStatus = "rejected"
	EstimateArchived EstimateStatus = "archived"
)

// Valid проверяет допустимость статуса сметы.
func (s EstimateStatus) Valid() bool {
	switch s {
	case EstimateDraft, EstimateOnReview, EstimateApproved, EstimateRejected, EstimateArchived:
		return true
	default:
		return false
	}
}

// Estimate — смета по объекту (или этапу).
type Estimate struct {
	ID           string         `json:"id"`
	ProjectID    string         `json:"projectId"`
	ProjectName  string         `json:"projectName,omitempty"`
	StageID      string         `json:"stageId,omitempty"`
	Number       string         `json:"number"`
	Name         string         `json:"name"`
	Status       EstimateStatus `json:"status"`
	Currency     string         `json:"currency"`
	TotalMinor   int64          `json:"totalMinor"`
	ItemCount    int            `json:"itemCount"`
	CreatedBy    string         `json:"createdBy"`
	CreatedByName string        `json:"createdByName,omitempty"`
	ApprovedBy   string         `json:"approvedBy,omitempty"`
	ApprovedAt   *time.Time     `json:"approvedAt,omitempty"`
	Version      int            `json:"version"`
	CreatedAt    time.Time      `json:"createdAt"`
	UpdatedAt    time.Time      `json:"updatedAt"`
}

// EstimateItem — позиция сметы.
type EstimateItem struct {
	ID          string  `json:"id"`
	EstimateID  string  `json:"estimateId"`
	Position    int     `json:"position"`
	Code        string  `json:"code"`
	Name        string  `json:"name"`
	Unit        string  `json:"unit"`
	Quantity    float64 `json:"quantity"`
	UnitPriceMinor int64 `json:"unitPriceMinor"`
	TotalMinor  int64   `json:"totalMinor"`
	Category    string  `json:"category"`
}

// DocumentStatus — статус документа.
type DocumentStatus string

const (
	DocDraft     DocumentStatus = "draft"
	DocSubmitted DocumentStatus = "submitted"
	DocApproved  DocumentStatus = "approved"
	DocRejected  DocumentStatus = "rejected"
)

// Valid проверяет допустимость статуса документа.
func (s DocumentStatus) Valid() bool {
	switch s {
	case DocDraft, DocSubmitted, DocApproved, DocRejected:
		return true
	default:
		return false
	}
}

// DocumentType — вид исполнительной документации.
type DocumentType string

const (
	DocKS2     DocumentType = "ks2"     // акт о приёмке выполненных работ
	DocKS3     DocumentType = "ks3"     // справка о стоимости работ
	DocInvoice DocumentType = "invoice" // счёт
	DocAct     DocumentType = "act"     // произвольный акт
	DocOther   DocumentType = "other"
)

// Document — документ исполнительной документации.
type Document struct {
	ID           string         `json:"id"`
	ProjectID    string         `json:"projectId"`
	ProjectName  string         `json:"projectName,omitempty"`
	Type         DocumentType   `json:"type"`
	Number       string         `json:"number"`
	Title        string         `json:"title"`
	Status       DocumentStatus `json:"status"`
	PeriodFrom   string         `json:"periodFrom"`
	PeriodTo     string         `json:"periodTo"`
	AmountMinor  int64          `json:"amountMinor"`
	CreatedBy    string         `json:"createdBy"`
	CreatedByName string        `json:"createdByName,omitempty"`
	ApprovedBy   string         `json:"approvedBy,omitempty"`
	ApprovedAt   *time.Time     `json:"approvedAt,omitempty"`
	Version      int            `json:"version"`
	CreatedAt    time.Time      `json:"createdAt"`
	UpdatedAt    time.Time      `json:"updatedAt"`
}

// Material — материал по объекту.
type Material struct {
	ID            string  `json:"id"`
	ProjectID     string  `json:"projectId"`
	Name          string  `json:"name"`
	Unit          string  `json:"unit"`
	PlannedQty    float64 `json:"plannedQty"`
	UsedQty       float64 `json:"usedQty"`
	UnitPriceMinor int64  `json:"unitPriceMinor"`
	Supplier      string  `json:"supplier"`
}

// Activity — запись журнала действий.
type Activity struct {
	ID         string    `json:"id"`
	ActorID    string    `json:"actorId"`
	ActorName  string    `json:"actorName"`
	Action     string    `json:"action"`
	EntityType string    `json:"entityType"`
	EntityID   string    `json:"entityId"`
	Summary    string    `json:"summary"`
	CreatedAt  time.Time `json:"createdAt"`
}

// NormativeDoc — фрагмент нормативной базы для RAG.
type NormativeDoc struct {
	ID      string `json:"id"`
	Code    string `json:"code"`
	Title   string `json:"title"`
	Section string `json:"section"`
	Content string `json:"content"`
	// Keywords — токены для лексического поиска (SQLite FTS/Postgres tsvector-free).
	Keywords string `json:"-"`
}

// AIConversation — диалог с ИИ-ассистентом.
type AIConversation struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// AIMessage — сообщение диалога.
type AIMessage struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversationId"`
	Role           string    `json:"role"` // user | assistant | tool
	Content        string    `json:"content"`
	ToolName       string    `json:"toolName,omitempty"`
	TokensIn       int       `json:"tokensIn"`
	TokensOut      int       `json:"tokensOut"`
	CreatedAt      time.Time `json:"createdAt"`
}

// AIUsage — учёт расхода токенов (бюджет демо-режима).
type AIUsage struct {
	TokensIn   int64 `json:"tokensIn"`
	TokensOut  int64 `json:"tokensOut"`
	LimitTotal int64 `json:"limitTotal"`
	Requests   int64 `json:"requests"`
}

// AIChatResult — итог обработки сообщения ассистентом.
type AIChatResult struct {
	ConversationID string     `json:"conversationId"`
	Message        AIMessage  `json:"message"`
	Usage          AIUsage    `json:"usage"`
	Limited        bool       `json:"limited"`
	Sources        []string   `json:"sources,omitempty"`
	ToolCalls      []ToolCallTrace `json:"toolCalls,omitempty"`
}

// ToolCallTrace — трассировка вызова инструмента ассистентом (для прозрачности).
type ToolCallTrace struct {
	Name   string `json:"name"`
	Args   string `json:"args"`
	Result string `json:"result"`
	Error  string `json:"error,omitempty"`
}

// EstimateAnomaly — результат проверки сметы на аномалии.
type EstimateAnomaly struct {
	Severity   string  `json:"severity"` // high | medium | low
	Kind       string  `json:"kind"`
	ItemID     string  `json:"itemId,omitempty"`
	ItemName   string  `json:"itemName,omitempty"`
	Message    string  `json:"message"`
	ImpactMinor int64  `json:"impactMinor"`
}

// EstimateAnalysis — результат детерминированного анализа сметы.
type EstimateAnalysis struct {
	EstimateID     string            `json:"estimateId"`
	TotalMinor     int64             `json:"totalMinor"`
	ItemCount      int               `json:"itemCount"`
	Anomalies      []EstimateAnomaly `json:"anomalies"`
	RiskScore      int               `json:"riskScore"` // 0..100
	ByCategory     []CategoryTotal   `json:"byCategory"`
}

// CategoryTotal — сумма по категории затрат.
type CategoryTotal struct {
	Category   string `json:"category"`
	TotalMinor int64  `json:"totalMinor"`
	ItemCount  int    `json:"itemCount"`
}

// DashboardSummary — агрегированные KPI для дашборда.
type DashboardSummary struct {
	ProjectsTotal     int             `json:"projectsTotal"`
	ProjectsActive    int             `json:"projectsActive"`
	BudgetMinor       int64           `json:"budgetMinor"`
	SpentMinor        int64           `json:"spentMinor"`
	EstimatesTotal    int             `json:"estimatesTotal"`
	EstimatesPending  int             `json:"estimatesPending"`
	DocumentsPending  int             `json:"documentsPending"`
	OverdueProjects   int             `json:"overdueProjects"`
	ProjectsByStatus  []StatusCount   `json:"projectsByStatus"`
	BudgetsByProject  []ProjectBudget `json:"budgetsByProject"`
	RecentActivity    []Activity      `json:"recentActivity"`
	GeneratedAt       time.Time       `json:"generatedAt"`
}

// StatusCount — счётчик по статусу.
type StatusCount struct {
	Status string `json:"status"`
	Count  int    `json:"count"`
}

// ProjectBudget — бюджет vs факт по объекту.
type ProjectBudget struct {
	ProjectID   string `json:"projectId"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	BudgetMinor int64  `json:"budgetMinor"`
	SpentMinor  int64  `json:"spentMinor"`
	ProgressPercent int `json:"progressPercent"`
}
