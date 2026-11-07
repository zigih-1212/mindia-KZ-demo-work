package store

import (
	"context"
	"database/sql"
	"errors"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/service"
)

// AIRepo — реализация service.AIRepository.
type AIRepo struct{ db *DB }

// NewAIRepo создаёт репозиторий диалогов ассистента.
func NewAIRepo(db *DB) *AIRepo { return &AIRepo{db: db} }

var _ service.AIRepository = (*AIRepo)(nil)

// CreateConversation создаёт диалог.
func (r *AIRepo) CreateConversation(ctx context.Context, c *domain.AIConversation) error {
	_, err := r.db.ExecContext(ctx, r.db.Rebind(`
		INSERT INTO ai_conversations (id, user_id, title, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)`),
		c.ID, c.UserID, c.Title, fmtTime(c.CreatedAt), fmtTime(c.UpdatedAt))
	return err
}

// GetConversation возвращает диалог по идентификатору.
func (r *AIRepo) GetConversation(ctx context.Context, id string) (*domain.AIConversation, error) {
	var c domain.AIConversation
	var created, updated string
	err := r.db.QueryRowContext(ctx, r.db.Rebind(`
		SELECT id, user_id, title, created_at, updated_at FROM ai_conversations WHERE id = ?`), id).
		Scan(&c.ID, &c.UserID, &c.Title, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	c.CreatedAt = parseTime(created)
	c.UpdatedAt = parseTime(updated)
	return &c, nil
}

// ListConversations возвращает диалоги пользователя, свежие первыми.
func (r *AIRepo) ListConversations(ctx context.Context, userID string, limit int) ([]domain.AIConversation, error) {
	rows, err := r.db.QueryContext(ctx, r.db.Rebind(`
		SELECT id, user_id, title, created_at, updated_at FROM ai_conversations
		WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?`), userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.AIConversation{}
	for rows.Next() {
		var c domain.AIConversation
		var created, updated string
		if err := rows.Scan(&c.ID, &c.UserID, &c.Title, &created, &updated); err != nil {
			return nil, err
		}
		c.CreatedAt = parseTime(created)
		c.UpdatedAt = parseTime(updated)
		out = append(out, c)
	}
	return out, rows.Err()
}

// TouchConversation обновляет заголовок и метку времени диалога.
func (r *AIRepo) TouchConversation(ctx context.Context, id, title string) error {
	if title == "" {
		_, err := r.db.ExecContext(ctx, r.db.Rebind(`
			UPDATE ai_conversations SET updated_at = ? WHERE id = ?`), fmtTime(nowUTC()), id)
		return err
	}
	_, err := r.db.ExecContext(ctx, r.db.Rebind(`
		UPDATE ai_conversations SET title = ?, updated_at = ? WHERE id = ?`),
		title, fmtTime(nowUTC()), id)
	return err
}

// AppendMessage добавляет сообщение в диалог.
func (r *AIRepo) AppendMessage(ctx context.Context, m *domain.AIMessage) error {
	_, err := r.db.ExecContext(ctx, r.db.Rebind(`
		INSERT INTO ai_messages (id, conversation_id, role, content, tool_name, tokens_in, tokens_out, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
		m.ID, m.ConversationID, m.Role, m.Content, m.ToolName, m.TokensIn, m.TokensOut, fmtTime(m.CreatedAt))
	return err
}

// ListMessages возвращает последние сообщения диалога в хронологическом порядке.
func (r *AIRepo) ListMessages(ctx context.Context, conversationID string, limit int) ([]domain.AIMessage, error) {
	rows, err := r.db.QueryContext(ctx, r.db.Rebind(`
		SELECT id, conversation_id, role, content, tool_name, tokens_in, tokens_out, created_at
		FROM ai_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?`),
		conversationID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	reversed := []domain.AIMessage{}
	for rows.Next() {
		var m domain.AIMessage
		var created string
		if err := rows.Scan(&m.ID, &m.ConversationID, &m.Role, &m.Content, &m.ToolName,
			&m.TokensIn, &m.TokensOut, &created); err != nil {
			return nil, err
		}
		m.CreatedAt = parseTime(created)
		reversed = append(reversed, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Разворачиваем в хронологический порядок.
	out := make([]domain.AIMessage, len(reversed))
	for i := range reversed {
		out[len(reversed)-1-i] = reversed[i]
	}
	return out, nil
}

// Usage возвращает накопленный расход токенов демо-режима.
func (r *AIRepo) Usage(ctx context.Context) (domain.AIUsage, error) {
	var u domain.AIUsage
	err := r.db.QueryRowContext(ctx, r.db.Rebind(`
		SELECT COALESCE(tokens_in,0), COALESCE(tokens_out,0), COALESCE(requests,0)
		FROM ai_usage WHERE scope = ?`), "global").
		Scan(&u.TokensIn, &u.TokensOut, &u.Requests)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.AIUsage{}, nil
	}
	return u, err
}

// AddUsage атомарно увеличивает счётчики расхода токенов (upsert).
func (r *AIRepo) AddUsage(ctx context.Context, tokensIn, tokensOut int) error {
	if r.db.IsPostgres() {
		_, err := r.db.ExecContext(ctx, `
			INSERT INTO ai_usage (scope, tokens_in, tokens_out, requests)
			VALUES ('global', $1, $2, 1)
			ON CONFLICT (scope) DO UPDATE SET
				tokens_in = ai_usage.tokens_in + EXCLUDED.tokens_in,
				tokens_out = ai_usage.tokens_out + EXCLUDED.tokens_out,
				requests = ai_usage.requests + 1`, tokensIn, tokensOut)
		return err
	}
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO ai_usage (scope, tokens_in, tokens_out, requests)
		VALUES ('global', ?, ?, 1)
		ON CONFLICT (scope) DO UPDATE SET
			tokens_in = tokens_in + excluded.tokens_in,
			tokens_out = tokens_out + excluded.tokens_out,
			requests = requests + 1`, tokensIn, tokensOut)
	return err
}
