package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/service"
)

// ToolDeps — зависимости инструментов ассистента.
// Инструменты дают ассистенту доступ к данным ТОЛЬКО через сервисы,
// поэтому все правила доступа и бизнес-инварианты соблюдаются.
type ToolDeps struct {
	Projects  *service.ProjectService
	Estimates *service.EstimateService
	Documents *service.DocumentService
	Normative *service.NormativeService
}

// toolFunc — реализация инструмента.
type toolFunc func(ctx context.Context, actor *domain.User, args map[string]any) (string, error)

type toolSpec struct {
	def ToolFunction
	fn  toolFunc
}

// registry — набор инструментов, доступных ассистенту.
// Whitelist: ассистент НЕ имеет доступа ни к чему за пределами этих вызовов.
func registry(deps ToolDeps) map[string]toolSpec {
	specs := map[string]toolSpec{}

	specs["list_projects"] = toolSpec{
		def: ToolFunction{
			Name:        "list_projects",
			Description: "Вернуть список строительных объектов с бюджетом, фактом и прогрессом. Фильтры: status (planning|active|suspended|completed), search.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"status": map[string]any{"type": "string", "description": "Статус объекта (необязательно)"},
					"search": map[string]any{"type": "string", "description": "Поиск по коду, названию, заказчику"},
				},
			},
		},
		fn: func(ctx context.Context, actor *domain.User, args map[string]any) (string, error) {
			res, err := deps.Projects.List(ctx, service.ProjectFilter{
				Status: str(args["status"]), Search: str(args["search"]),
			}, domain.Page{Limit: 10}.Normalize())
			if err != nil {
				return "", err
			}
			rows := make([]map[string]any, 0, len(res.Items))
			for _, p := range res.Items {
				rows = append(rows, map[string]any{
					"code": p.Code, "name": p.Name, "status": p.Status,
					"budget": service.FormatMoney(p.BudgetMinor), "spent": service.FormatMoney(p.SpentMinor),
					"budgetMinor": p.BudgetMinor, "spentMinor": p.SpentMinor,
					"progressPercent": p.ProgressPercent, "customer": p.Customer,
				})
			}
			return toJSON(map[string]any{"total": res.Total, "items": rows})
		},
	}

	specs["project_overview"] = toolSpec{
		def: ToolFunction{
			Name:        "project_overview",
			Description: "Сводка по портфелю объектов: количество, активные, бюджет, факт, перерасход, документы на согласовании, сметы на проверке и последние действия.",
			Parameters: map[string]any{"type": "object", "properties": map[string]any{}},
		},
		fn: func(ctx context.Context, actor *domain.User, args map[string]any) (string, error) {
			s, err := deps.Projects.Summary(ctx)
			if err != nil {
				return "", err
			}
			overruns := make([]map[string]any, 0)
			for _, b := range s.BudgetsByProject {
				if b.SpentMinor > b.BudgetMinor {
					overruns = append(overruns, map[string]any{
						"code": b.Code, "name": b.Name,
						"overrunMinor": b.SpentMinor - b.BudgetMinor,
						"overrun":      service.FormatMoney(b.SpentMinor - b.BudgetMinor),
					})
				}
			}
			return toJSON(map[string]any{
				"projectsTotal":    s.ProjectsTotal,
				"projectsActive":   s.ProjectsActive,
				"budget":           service.FormatMoney(s.BudgetMinor),
				"spent":            service.FormatMoney(s.SpentMinor),
				"estimatesPending": s.EstimatesPending,
				"documentsPending": s.DocumentsPending,
				"overdueProjects":  s.OverdueProjects,
				"overruns":         overruns,
			})
		},
	}

	specs["analyze_estimate"] = toolSpec{
		def: ToolFunction{
			Name:        "analyze_estimate",
			Description: "Проверить смету на аномалии (дубли, нулевые значения, доминирующие позиции, ошибки расчёта) по идентификатору сметы и вернуть риск-скор.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"estimateId": map[string]any{"type": "string", "description": "Идентификатор сметы"},
				},
				"required": []string{"estimateId"},
			},
		},
		fn: func(ctx context.Context, actor *domain.User, args map[string]any) (string, error) {
			id := str(args["estimateId"])
			if id == "" {
				return "", fmt.Errorf("укажите estimateId")
			}
			a, err := deps.Estimates.Analyze(ctx, id)
			if err != nil {
				return "", err
			}
			return toJSON(a)
		},
	}

	specs["list_pending_approvals"] = toolSpec{
		def: ToolFunction{
			Name:        "list_pending_approvals",
			Description: "Вернуть сметы на проверке и документы, ожидающие согласования (для контроля рабочего процесса).",
			Parameters: map[string]any{"type": "object", "properties": map[string]any{}},
		},
		fn: func(ctx context.Context, actor *domain.User, args map[string]any) (string, error) {
			est, err := deps.Estimates.List(ctx, service.EstimateFilter{Status: string(domain.EstimateOnReview)}, domain.Page{Limit: 10}.Normalize())
			if err != nil {
				return "", err
			}
			docs, err := deps.Documents.List(ctx, service.DocumentFilter{Status: string(domain.DocSubmitted)}, domain.Page{Limit: 10}.Normalize())
			if err != nil {
				return "", err
			}
			estRows := make([]map[string]any, 0, len(est.Items))
			for _, e := range est.Items {
				estRows = append(estRows, map[string]any{
					"id": e.ID, "number": e.Number, "name": e.Name,
					"total": service.FormatMoney(e.TotalMinor), "totalMinor": e.TotalMinor,
				})
			}
			docRows := make([]map[string]any, 0, len(docs.Items))
			for _, d := range docs.Items {
				docRows = append(docRows, map[string]any{
					"id": d.ID, "type": d.Type, "number": d.Number, "title": d.Title,
					"amount": service.FormatMoney(d.AmountMinor), "amountMinor": d.AmountMinor,
				})
			}
			return toJSON(map[string]any{"estimates": estRows, "documents": docRows})
		},
	}

	specs["search_normative"] = toolSpec{
		def: ToolFunction{
			Name:        "search_normative",
			Description: "Найти релевантные фрагменты нормативной базы (ГОСТ, СНиП, ФЕР, правила документооборота) по поисковому запросу.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query": map[string]any{"type": "string", "description": "Поисковый запрос на русском"},
				},
				"required": []string{"query"},
			},
		},
		fn: func(ctx context.Context, actor *domain.User, args map[string]any) (string, error) {
			q := str(args["query"])
			if q == "" {
				return "", fmt.Errorf("укажите query")
			}
			docs, err := deps.Normative.Search(ctx, q, 5)
			if err != nil {
				return "", err
			}
			rows := make([]map[string]any, 0, len(docs))
			for _, d := range docs {
				rows = append(rows, map[string]any{
					"code": d.Code, "title": d.Title, "section": d.Section, "content": d.Content,
				})
			}
			return toJSON(map[string]any{"items": rows})
		},
	}

	specs["list_documents"] = toolSpec{
		def: ToolFunction{
			Name:        "list_documents",
			Description: "Вернуть документы (КС-2, КС-3, счета, акты) с фильтрами по объекту, статусу или типу.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"projectId": map[string]any{"type": "string", "description": "Идентификатор объекта"},
					"status":    map[string]any{"type": "string", "description": "draft|submitted|approved|rejected"},
					"type":      map[string]any{"type": "string", "description": "ks2|ks3|invoice|act|other"},
				},
			},
		},
		fn: func(ctx context.Context, actor *domain.User, args map[string]any) (string, error) {
			res, err := deps.Documents.List(ctx, service.DocumentFilter{
				ProjectID: str(args["projectId"]), Status: str(args["status"]), Type: str(args["type"]),
			}, domain.Page{Limit: 10}.Normalize())
			if err != nil {
				return "", err
			}
			rows := make([]map[string]any, 0, len(res.Items))
			for _, d := range res.Items {
				rows = append(rows, map[string]any{
					"id": d.ID, "type": d.Type, "number": d.Number, "title": d.Title,
					"status": d.Status, "amount": service.FormatMoney(d.AmountMinor),
				})
			}
			return toJSON(map[string]any{"total": res.Total, "items": rows})
		},
	}

	return specs
}

// ToolDefs возвращает описания инструментов для LLM.
func ToolDefs(deps ToolDeps) []Tool {
	specs := registry(deps)
	out := make([]Tool, 0, len(specs))
	for _, s := range specs {
		out = append(out, Tool{Type: "function", Function: s.def})
	}
	return out
}

// callTool выполняет инструмент по имени.
func callTool(ctx context.Context, deps ToolDeps, name string, argsJSON string, actor *domain.User) (string, error) {
	specs := registry(deps)
	spec, ok := specs[name]
	if !ok {
		return "", fmt.Errorf("инструмент %q недоступен", name)
	}
	args := map[string]any{}
	if strings.TrimSpace(argsJSON) != "" {
		if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
			return "", fmt.Errorf("некорректные аргументы инструмента %q: %w", name, err)
		}
	}
	return spec.fn(ctx, actor, args)
}

func str(v any) string {
	s, _ := v.(string)
	return strings.TrimSpace(s)
}

func toJSON(v any) (string, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return string(b), nil
}
