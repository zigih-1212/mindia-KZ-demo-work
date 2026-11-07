package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/ai"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/auth"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/config"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/service"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/store"
)

// newTestServer поднимает полноценный HTTP-сервер поверх реальной SQLite-БД
// с демо-данными — это интеграционный тест уровня API (router + middleware +
// сервисы + БД), как того требует вакансия.
func newTestServer(t *testing.T) http.Handler {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "api.db")
	db, err := store.Open("sqlite", dsn)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	if err := db.Migrate(ctx); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	if err := store.Seed(ctx, db); err != nil {
		t.Fatalf("Seed: %v", err)
	}

	users := store.NewUserRepo(db)
	projects := store.NewProjectRepo(db)
	estimates := store.NewEstimateRepo(db)
	documents := store.NewDocumentRepo(db)
	normative := store.NewNormativeRepo(db)
	activity := store.NewActivityRepo(db)
	aiRepo := store.NewAIRepo(db)

	tokens := auth.NewManager("test-secret-key-16chars", time.Hour)
	cfg := config.Config{Env: "test", FrontendOrigins: []string{"http://localhost:5173"}}

	// Реальный, но выключенный ассистент: без ключа LLM он остаётся
	// недоступен (503), что и проверяем ниже.
	llm := ai.NewClient("", "", "test-model", time.Second)
	assistant := ai.NewAssistant(llm, aiRepo, ai.ToolDeps{
		Projects:  service.NewProjectService(projects, activity),
		Estimates: service.NewEstimateService(estimates, projects, activity),
		Documents: service.NewDocumentService(documents, projects, activity),
		Normative: service.NewNormativeService(normative),
	}, ai.Config{Enabled: false, BudgetTokens: 500000})

	srv := NewServer(Deps{
		Config:    cfg,
		Auth:      service.NewAuthService(users, tokens, activity),
		Projects:  service.NewProjectService(projects, activity),
		Estimates: service.NewEstimateService(estimates, projects, activity),
		Documents: service.NewDocumentService(documents, projects, activity),
		Normative: service.NewNormativeService(normative),
		Activity:  service.NewActivityService(activity),
		Assistant: assistant,
		Tokens:    tokens,
	})
	return srv.Routes()
}

// do выполняет HTTP-запрос и возвращает код ответа и тело.
func do(t *testing.T, h http.Handler, method, path, token string, body any) (int, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode body: %v", err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	out := map[string]any{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// login возвращает токен для демо-аккаунта.
func login(t *testing.T, h http.Handler, email string) string {
	t.Helper()
	code, body := do(t, h, http.MethodPost, "/api/v1/auth/login", "", map[string]string{
		"email": email, "password": "demo1234",
	})
	if code != http.StatusOK {
		t.Fatalf("login %s: код %d, тело %v", email, code, body)
	}
	token, _ := body["token"].(string)
	if token == "" {
		t.Fatalf("login %s: пустой токен", email)
	}
	return token
}

func TestAPI_Healthz(t *testing.T) {
	h := newTestServer(t)
	code, body := do(t, h, http.MethodGet, "/healthz", "", nil)
	if code != http.StatusOK || body["status"] != "ok" {
		t.Fatalf("healthz: код %d, тело %v", code, body)
	}
}

func TestAPI_AuthAndMe(t *testing.T) {
	h := newTestServer(t)

	// Неверный пароль -> 401.
	if code, _ := do(t, h, http.MethodPost, "/api/v1/auth/login", "", map[string]string{
		"email": "admin@mindia.kz", "password": "wrong",
	}); code != http.StatusUnauthorized {
		t.Errorf("login(wrong pw) = %d, ожидалось 401", code)
	}

	token := login(t, h, "admin@mindia.kz")

	// /me без токена -> 401.
	if code, _ := do(t, h, http.MethodGet, "/api/v1/me", "", nil); code != http.StatusUnauthorized {
		t.Errorf("/me(no token) = %d, ожидалось 401", code)
	}

	// /me с токеном -> 200 и роль admin.
	code, body := do(t, h, http.MethodGet, "/api/v1/me", token, nil)
	if code != http.StatusOK || body["role"] != "admin" {
		t.Errorf("/me = %d, роль %v", code, body["role"])
	}
}

func TestAPI_DashboardAndLists(t *testing.T) {
	h := newTestServer(t)
	token := login(t, h, "manager@mindia.kz")

	code, body := do(t, h, http.MethodGet, "/api/v1/dashboard", token, nil)
	if code != http.StatusOK {
		t.Fatalf("dashboard: код %d", code)
	}
	if body["projectsTotal"].(float64) != 5 {
		t.Errorf("projectsTotal = %v, ожидалось 5", body["projectsTotal"])
	}

	// Список объектов.
	code, body = do(t, h, http.MethodGet, "/api/v1/projects", token, nil)
	if code != http.StatusOK || body["total"].(float64) != 5 {
		t.Errorf("/projects: код %d, total %v", code, body["total"])
	}

	// Публичный справочник нормативов доступен без токена.
	if code, _ := do(t, h, http.MethodGet, "/api/v1/normative", "", nil); code != http.StatusOK {
		t.Errorf("/normative(public) = %d, ожидалось 200", code)
	}
}

func TestAPI_RBAC_ProjectCreate(t *testing.T) {
	h := newTestServer(t)

	// Прораб не может создавать объекты -> 403.
	foreman := login(t, h, "foreman@mindia.kz")
	code, _ := do(t, h, http.MethodPost, "/api/v1/projects", foreman, map[string]any{
		"code": "TST-1", "name": "Тест",
	})
	if code != http.StatusForbidden {
		t.Errorf("foreman create project = %d, ожидалось 403", code)
	}

	// Менеджер может -> 201.
	manager := login(t, h, "manager@mindia.kz")
	code, body := do(t, h, http.MethodPost, "/api/v1/projects", manager, map[string]any{
		"code": "TST-2", "name": "Тестовый объект", "budgetMinor": 100000,
	})
	if code != http.StatusCreated {
		t.Fatalf("manager create project = %d, тело %v", code, body)
	}
	if body["code"] != "TST-2" {
		t.Errorf("code = %v, ожидалось TST-2", body["code"])
	}
}

func TestAPI_Validation_And_NotFound(t *testing.T) {
	h := newTestServer(t)
	manager := login(t, h, "manager@mindia.kz")

	// Пустой код -> 422.
	code, body := do(t, h, http.MethodPost, "/api/v1/projects", manager, map[string]any{"name": "Без кода"})
	if code != http.StatusUnprocessableEntity {
		t.Errorf("create(no code) = %d, ожидалось 422; тело %v", code, body)
	}

	// Несуществующий объект -> 404.
	if code, _ := do(t, h, http.MethodGet, "/api/v1/projects/no-such-id", manager, nil); code != http.StatusNotFound {
		t.Errorf("get(unknown) = %d, ожидалось 404", code)
	}
}

func TestAPI_EstimateAnalyzeFlow(t *testing.T) {
	h := newTestServer(t)
	token := login(t, h, "estimator@mindia.kz")

	// Берём существующую смету со стенда.
	_, list := do(t, h, http.MethodGet, "/api/v1/estimates", token, nil)
	items, _ := list["items"].([]any)
	if len(items) == 0 {
		t.Fatal("нет смет в сиде")
	}
	first := items[0].(map[string]any)
	id := first["id"].(string)

	// Анализ сметы -> 200 и наличие поля riskScore.
	code, body := do(t, h, http.MethodPost, "/api/v1/estimates/"+id+"/analyze", token, nil)
	if code != http.StatusOK {
		t.Fatalf("analyze = %d, тело %v", code, body)
	}
	if _, ok := body["riskScore"]; !ok {
		t.Errorf("в ответе анализа нет riskScore: %v", body)
	}
}

func TestAPI_AIChat_Disabled(t *testing.T) {
	h := newTestServer(t)
	token := login(t, h, "admin@mindia.kz")

	// Assistant==nil (не сконфигурирован) -> 503 ai_disabled.
	code, body := do(t, h, http.MethodPost, "/api/v1/ai/chat", token, map[string]string{"message": "привет"})
	if code != http.StatusServiceUnavailable {
		t.Errorf("ai/chat(disabled) = %d, ожидалось 503; тело %v", code, body)
	}
	if body["error"] != "ai_disabled" {
		t.Errorf("error = %v, ожидалось ai_disabled", body["error"])
	}
}
