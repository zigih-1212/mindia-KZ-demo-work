package api

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/ai"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/auth"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/config"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/service"
)

// Server держит все зависимости HTTP-слоя.
type Server struct {
	cfg           config.Config
	auth          *service.AuthService
	projects      *service.ProjectService
	estimates     *service.EstimateService
	documents     *service.DocumentService
	normative     *service.NormativeService
	activity      *service.ActivityService
	assistant     *ai.Assistant
	tokens        *auth.Manager
}

// Deps — зависимости сервера.
type Deps struct {
	Config    config.Config
	Auth      *service.AuthService
	Projects  *service.ProjectService
	Estimates *service.EstimateService
	Documents *service.DocumentService
	Normative *service.NormativeService
	Activity  *service.ActivityService
	Assistant *ai.Assistant
	Tokens    *auth.Manager
}

// NewServer собирает HTTP-сервер.
func NewServer(d Deps) *Server {
	return &Server{
		cfg: d.Config, auth: d.Auth, projects: d.Projects, estimates: d.Estimates,
		documents: d.Documents, normative: d.Normative, activity: d.Activity,
		assistant: d.Assistant, tokens: d.Tokens,
	}
}

// Routes собирает маршруты API и middleware.
func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(60 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   s.cfg.FrontendOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "aiEnabled": s.assistant.Enabled()})
	})

	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/auth/login", s.handleLogin)
		r.Post("/auth/register", s.handleRegister)
		r.Get("/normative", s.handleNormativeList) // публичный справочник

		r.Group(func(r chi.Router) {
			r.Use(s.authMiddleware)

			r.Get("/me", s.handleMe)

			// Дашборд и журнал.
			r.Get("/dashboard", s.handleDashboard)
			r.Get("/activity", s.handleActivity)

			// Объекты.
			r.Get("/projects", s.handleProjectList)
			r.With(requireRole(domain.RoleAdmin, domain.RoleManager)).Post("/projects", s.handleProjectCreate)
			r.Get("/projects/{id}", s.handleProjectGet)
			r.With(requireRole(domain.RoleAdmin, domain.RoleManager)).Put("/projects/{id}", s.handleProjectUpdate)
			r.With(requireRole(domain.RoleAdmin, domain.RoleManager)).Delete("/projects/{id}", s.handleProjectDelete)
			r.Get("/projects/{id}/stages", s.handleProjectStages)

			// Сметы.
			r.Get("/estimates", s.handleEstimateList)
			r.Post("/estimates", s.handleEstimateCreate)
			r.Get("/estimates/{id}", s.handleEstimateGet)
			r.Get("/estimates/{id}/items", s.handleEstimateItems)
			r.Put("/estimates/{id}/items", s.handleEstimateReplaceItems)
			r.Post("/estimates/{id}/transition", s.handleEstimateTransition)
			r.Post("/estimates/{id}/analyze", s.handleEstimateAnalyze)
			r.Delete("/estimates/{id}", s.handleEstimateDelete)

			// Документы.
			r.Get("/documents", s.handleDocumentList)
			r.Post("/documents", s.handleDocumentCreate)
			r.Get("/documents/{id}", s.handleDocumentGet)
			r.Post("/documents/{id}/transition", s.handleDocumentTransition)
			r.Delete("/documents/{id}", s.handleDocumentDelete)

			// ИИ-ассистент.
			r.Get("/ai/conversations", s.handleAIConversations)
			r.Post("/ai/chat", s.handleAIChat)
			r.Get("/ai/conversations/{id}/messages", s.handleAIMessages)
			r.Get("/ai/usage", s.handleAIUsage)
		})
	})

	return r
}
