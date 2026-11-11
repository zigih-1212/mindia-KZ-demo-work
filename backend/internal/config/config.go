// Package config загружает конфигурацию из переменных окружения.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config — конфигурация приложения.
type Config struct {
	Addr            string
	Env             string
	DBDriver        string // "sqlite" | "postgres"
	DatabaseURL     string
	DataDir         string
	JWTSecret       string
	JWTTTL          time.Duration
	FrontendOrigins []string

	// AI: бюджет и подключение к LLM.
	AIBudgetTokens int64
	AIEnabled      bool
	AIBaseURL      string
	AIAPIKey       string
	AIModel        string
	AITimeout      time.Duration
	AIMaxToolCalls int
}

// Load читает конфигурацию из окружения с безопасными значениями по умолчанию,
// пригодными для локального запуска без подготовленной инфраструктуры.
func Load() (*Config, error) {
	cfg := &Config{
		Addr:            env("APP_ADDR", ":8080"),
		Env:             env("APP_ENV", "development"),
		DBDriver:        strings.ToLower(env("DB_DRIVER", "sqlite")),
		DatabaseURL:     env("DATABASE_URL", ""),
		DataDir:         env("DATA_DIR", "./data"),
		JWTSecret:       env("JWT_SECRET", ""),
		JWTTTL:          envDuration("JWT_TTL", 12*time.Hour),
		FrontendOrigins: splitCSV(env("FRONTEND_ORIGINS", "http://localhost:5173,http://localhost:4173")),

		AIBudgetTokens: envInt64("AI_BUDGET_TOKENS", 250_000),
		AIEnabled:      envBool("AI_ENABLED", true),
		AIBaseURL:      env("AI_BASE_URL", ""),
		AIAPIKey:       env("AI_API_KEY", ""),
		AIModel:        env("AI_MODEL", "deepseek-v4.1"),
		AITimeout:      envDuration("AI_TIMEOUT", 45*time.Second),
		AIMaxToolCalls: envInt("AI_MAX_TOOL_CALLS", 6),
	}

	if cfg.DBDriver != "sqlite" && cfg.DBDriver != "postgres" {
		return nil, fmt.Errorf("unsupported DB_DRIVER %q (want sqlite|postgres)", cfg.DBDriver)
	}
	if cfg.DBDriver == "postgres" && cfg.DatabaseURL == "" {
		cfg.DatabaseURL = "postgres://mindia:mindia@localhost:5432/mindia?sslmode=disable"
	}
	if cfg.DBDriver == "sqlite" && cfg.DatabaseURL == "" {
		cfg.DatabaseURL = cfg.DataDir + "/mindia.db"
	}

	// В development допускается запуск без секрета (генерируется эфемерный),
	// в production отсутствие секрета — фатальная ошибка конфигурации.
	if cfg.JWTSecret == "" {
		if cfg.Env == "production" {
			return nil, fmt.Errorf("JWT_SECRET is required in production")
		}
		cfg.JWTSecret = "dev-insecure-secret-change-me"
	}
	if len(cfg.JWTSecret) < 16 {
		return nil, fmt.Errorf("JWT_SECRET must be at least 16 characters")
	}

	// AI_ENABLED управляет наличием ассистента как функции. Сам LLM
	// подключается отдельно: если AI_BASE_URL/AI_API_KEY не заданы, ассистент
	// работает в детерминированном офлайн-режиме (демо не падает без ключа).
	return cfg, nil
}

// IsProduction сообщает, запущено ли приложение в production-режиме.
func (c *Config) IsProduction() bool { return c.Env == "production" }

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && strings.TrimSpace(v) != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v, ok := os.LookupEnv(key); ok {
		if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
			return n
		}
	}
	return def
}

func envInt64(key string, def int64) int64 {
	if v, ok := os.LookupEnv(key); ok {
		if n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64); err == nil {
			return n
		}
	}
	return def
}

func envBool(key string, def bool) bool {
	if v, ok := os.LookupEnv(key); ok {
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "1", "true", "yes", "on":
			return true
		case "0", "false", "no", "off":
			return false
		}
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	if v, ok := os.LookupEnv(key); ok {
		if d, err := time.ParseDuration(strings.TrimSpace(v)); err == nil {
			return d
		}
	}
	return def
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
