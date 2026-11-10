// Типы edge-двойника. JSON-контракт зеркалит Go-бэкенд
// (backend/internal/domain/models.go): деньги — int64 минорные единицы
// (*Minor), время — строки RFC3339 (TEXT в D1).

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  JWT_SECRET: string;
  // LLM (необязательные; ключи — через `wrangler secret put`):
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
  AI_MODEL?: string;
  AI_FALLBACK_BASE_URL?: string;
  AI_FALLBACK_API_KEY?: string;
  AI_FALLBACK_MODEL?: string;
  AI_FALLBACK_MODEL_ALT?: string;
  // Резервный оператор (третий в цепочке) — отдельный endpoint и ключ.
  AI_RESERVE_BASE_URL?: string;
  AI_RESERVE_API_KEY?: string;
  AI_RESERVE_MODEL?: string;
  AI_RESERVE_MODEL_ALT?: string;
  AI_TIMEOUT_MS?: string;
  AI_MAX_TOOL_CALLS?: string;
}

export type Role = "admin" | "manager" | "estimator" | "foreman" | "customer";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  position: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResult {
  token: string;
  expiresAt: string;
  user: AuthUser;
}

export type ProjectStatus = "planning" | "active" | "suspended" | "completed";
export type StageStatus = "pending" | "active" | "done" | "cancelled";
export type EstimateStatus = "draft" | "on_review" | "approved" | "rejected" | "archived";
export type DocumentStatus = "draft" | "submitted" | "approved" | "rejected";
export type DocumentType = "ks2" | "ks3" | "invoice" | "act" | "other";

export interface Project {
  id: string;
  code: string;
  name: string;
  customer: string;
  address: string;
  status: ProjectStatus;
  budgetMinor: number;
  spentMinor: number;
  contractAmountMinor: number;
  startDate: string;
  plannedEndDate: string;
  actualEndDate?: string;
  managerId: string;
  managerName?: string;
  progressPercent: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectStage {
  id: string;
  projectId: string;
  name: string;
  sequence: number;
  status: StageStatus;
  plannedStart: string;
  plannedEnd: string;
  progressPercent: number;
  plannedMinor: number;
  actualMinor: number;
}

export interface Estimate {
  id: string;
  projectId: string;
  projectName?: string;
  stageId?: string;
  number: string;
  name: string;
  status: EstimateStatus;
  currency: string;
  totalMinor: number;
  itemCount: number;
  createdBy: string;
  createdByName?: string;
  approvedBy?: string;
  approvedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface EstimateItem {
  id: string;
  estimateId: string;
  position: number;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  category: string;
}

export interface DocumentDTO {
  id: string;
  projectId: string;
  projectName?: string;
  type: DocumentType;
  number: string;
  title: string;
  status: DocumentStatus;
  periodFrom: string;
  periodTo: string;
  amountMinor: number;
  createdBy: string;
  createdByName?: string;
  approvedBy?: string;
  approvedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt: string;
}

export interface NormativeDoc {
  id: string;
  code: string;
  title: string;
  section: string;
  content: string;
}

export interface StatusCount {
  status: ProjectStatus;
  count: number;
}

export interface ProjectBudget {
  projectId: string;
  code: string;
  name: string;
  budgetMinor: number;
  spentMinor: number;
  progressPercent: number;
}

export interface DashboardSummary {
  projectsTotal: number;
  projectsActive: number;
  budgetMinor: number;
  spentMinor: number;
  estimatesTotal: number;
  estimatesPending: number;
  documentsPending: number;
  overdueProjects: number;
  projectsByStatus: StatusCount[];
  budgetsByProject: ProjectBudget[];
  recentActivity: Activity[];
  generatedAt: string;
}

export interface EstimateAnomaly {
  severity: "high" | "medium" | "low";
  kind: string;
  itemId?: string;
  itemName?: string;
  message: string;
  impactMinor: number;
}

export interface CategoryTotal {
  category: string;
  totalMinor: number;
  itemCount: number;
}

export interface EstimateAnalysis {
  estimateId: string;
  totalMinor: number;
  itemCount: number;
  anomalies: EstimateAnomaly[];
  riskScore: number;
  byCategory: CategoryTotal[];
}

export interface AIUsage {
  tokensIn: number;
  tokensOut: number;
  limitTotal: number;
  requests: number;
}

export interface AIMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  tokensIn: number;
  tokensOut: number;
  createdAt: string;
}

export interface AIConversation {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolCallTrace {
  name: string;
  args: string;
  result: string;
  error?: string;
}

export interface AIChatResult {
  conversationId: string;
  message: AIMessage;
  usage: AIUsage;
  limited: boolean;
  sources?: string[];
  toolCalls?: ToolCallTrace[];
}

export interface ListResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// JWT payload (HS256, issuer mindia-kz-demo, TTL 12h).
export interface TokenPayload {
  uid: string;
  email: string;
  role: Role;
  iss: string;
  exp: number;
  iat: number;
}
