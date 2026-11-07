// Command server — точка входа бэкенда платформы «СтройКонтроль» (Mindia KZ).
//
// Поддерживает два режима запуска без изменения кода:
//   - DB_DRIVER=sqlite  — локальный запуск без Docker (файл ./data/mindia.db);
//   - DB_DRIVER=postgres — production-режим (docker compose / managed Postgres).
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/ai"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/api"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/auth"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/config"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/service"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/store"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("fatal: %v", err)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger := log.New(os.Stdout, "", log.LstdFlags|log.LUTC)

	// 1. Хранилище и миграции.
	db, err := store.Open(cfg.DBDriver, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := db.Migrate(ctx); err != nil {
		return err
	}
	if err := store.Seed(ctx, db); err != nil {
		return err
	}

	// 2. Репозитории.
	users := store.NewUserRepo(db)
	projects := store.NewProjectRepo(db)
	estimates := store.NewEstimateRepo(db)
	documents := store.NewDocumentRepo(db)
	activity := store.NewActivityRepo(db)
	normative := store.NewNormativeRepo(db)
	aiRepo := store.NewAIRepo(db)

	// 3. Сервисы (бизнес-логика).
	tokens := auth.NewManager(cfg.JWTSecret, cfg.JWTTTL)
	authSvc := service.NewAuthService(users, tokens, activity)
	projectSvc := service.NewProjectService(projects, activity)
	estimateSvc := service.NewEstimateService(estimates, projects, activity)
	documentSvc := service.NewDocumentService(documents, projects, activity)
	normativeSvc := service.NewNormativeService(normative)
	activitySvc := service.NewActivityService(activity)

	// 4. ИИ-ассистент: внешний LLM при наличии ключа, иначе локальный движок.
	client := ai.NewClient(cfg.AIBaseURL, cfg.AIAPIKey, cfg.AIModel, cfg.AITimeout)
	assistant := ai.NewAssistant(client, aiRepo, ai.ToolDeps{
		Projects:  projectSvc,
		Estimates: estimateSvc,
		Documents: documentSvc,
		Normative: normativeSvc,
	}, ai.Config{
		Enabled:      cfg.AIEnabled,
		BudgetTokens: cfg.AIBudgetTokens,
		MaxToolCalls: cfg.AIMaxToolCalls,
		MaxHistory:   12,
		Model:        cfg.AIModel,
	})

	// 5. HTTP-сервер.
	srv := api.NewServer(api.Deps{
		Config:    *cfg,
		Auth:      authSvc,
		Projects:  projectSvc,
		Estimates: estimateSvc,
		Documents: documentSvc,
		Normative: normativeSvc,
		Activity:  activitySvc,
		Assistant: assistant,
		Tokens:    tokens,
	})

	httpServer := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      90 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	// 6. Graceful shutdown по SIGINT/SIGTERM.
	errCh := make(chan error, 1)
	go func() {
		logger.Printf("СтройКонтроль API запущен addr=%s env=%s db=%s ai=%v",
			cfg.Addr, cfg.Env, cfg.DBDriver, assistant.Enabled())
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-errCh:
		return err
	case <-stop:
		logger.Print("получен сигнал остановки, завершаем работу")
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		return err
	}
	logger.Print("сервер остановлен корректно")
	return nil
}
