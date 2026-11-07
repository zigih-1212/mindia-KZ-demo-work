package ai

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
)

// fakeAIRepo — in-memory реализация service.AIRepository для тестов ассистента.
type fakeAIRepo struct {
	mu       sync.Mutex
	convs    map[string]*domain.AIConversation
	messages map[string][]domain.AIMessage
	usage    domain.AIUsage
}

func newFakeAIRepo() *fakeAIRepo {
	return &fakeAIRepo{convs: map[string]*domain.AIConversation{}, messages: map[string][]domain.AIMessage{}}
}

func (r *fakeAIRepo) CreateConversation(_ context.Context, c *domain.AIConversation) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.convs[c.ID] = c
	return nil
}

func (r *fakeAIRepo) GetConversation(_ context.Context, id string) (*domain.AIConversation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if c, ok := r.convs[id]; ok {
		return c, nil
	}
	return nil, domain.ErrNotFound
}

func (r *fakeAIRepo) ListConversations(_ context.Context, userID string, _ int) ([]domain.AIConversation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []domain.AIConversation{}
	for _, c := range r.convs {
		if c.UserID == userID {
			out = append(out, *c)
		}
	}
	return out, nil
}

func (r *fakeAIRepo) TouchConversation(_ context.Context, id, title string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if c, ok := r.convs[id]; ok && title != "" {
		c.Title = title
	}
	return nil
}

func (r *fakeAIRepo) AppendMessage(_ context.Context, m *domain.AIMessage) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.messages[m.ConversationID] = append(r.messages[m.ConversationID], *m)
	return nil
}

func (r *fakeAIRepo) ListMessages(_ context.Context, conversationID string, limit int) ([]domain.AIMessage, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	all := r.messages[conversationID]
	if limit > 0 && len(all) > limit {
		all = all[len(all)-limit:]
	}
	return all, nil
}

func (r *fakeAIRepo) Usage(_ context.Context) (domain.AIUsage, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.usage, nil
}

func (r *fakeAIRepo) AddUsage(_ context.Context, tokensIn, tokensOut int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.usage.TokensIn += int64(tokensIn)
	r.usage.TokensOut += int64(tokensOut)
	r.usage.Requests++
	return nil
}

// newTestAssistant собирает ассистента с отключённым LLM (офлайн-режим).
func newTestAssistant(t *testing.T, repo *fakeAIRepo) *Assistant {
	t.Helper()
	// Пустой base URL/ключ => client.Enabled() == false => детерминированный офлайн.
	client := NewClient("", "", "test-model", time.Second)
	return NewAssistant(client, repo, ToolDeps{}, Config{Enabled: true, BudgetTokens: 500000})
}

func TestPickOfflineTool_Routing(t *testing.T) {
	cases := []struct {
		q    string
		want string
	}{
		{"какие сметы ждут согласования?", "list_pending_approvals"},
		{"что сказано про фундамент в нормативах", "search_normative"},
		{"покажи документы кс-2", "list_documents"},
		{"сколько у нас объектов и бюджет", "project_overview"},
		{"рецепт борща", ""}, // вне области продукта
	}
	for _, c := range cases {
		got, _ := pickOfflineTool(strings.ToLower(c.q))
		if got != c.want {
			t.Errorf("pickOfflineTool(%q) = %q, ожидалось %q", c.q, got, c.want)
		}
	}
}

func TestAssistant_OffTopicRefusal(t *testing.T) {
	repo := newFakeAIRepo()
	a := newTestAssistant(t, repo)
	actor := &domain.User{ID: "u1", Role: domain.RoleForeman, IsActive: true}

	res, err := a.Ask(context.Background(), actor, "", "Напиши мне рецепт борща")
	if err != nil {
		t.Fatalf("Ask: %v", err)
	}
	if !strings.Contains(res.Message.Content, "Я помогаю только по работе с платформой") {
		t.Errorf("ожидался вежливый отказ вне области продукта, получено: %q", res.Message.Content)
	}
}

func TestAssistant_BudgetExhausted(t *testing.T) {
	repo := newFakeAIRepo()
	repo.usage = domain.AIUsage{TokensIn: 500000} // лимит исчерпан
	a := newTestAssistant(t, repo)
	actor := &domain.User{ID: "u1", Role: domain.RoleAdmin, IsActive: true}

	res, err := a.Ask(context.Background(), actor, "", "сколько объектов?")
	if err != nil {
		t.Fatalf("Ask: %v", err)
	}
	if !res.Limited {
		t.Error("ожидалось Limited=true при исчерпанном бюджете")
	}
	if !strings.Contains(res.Message.Content, "закончился") {
		t.Errorf("ожидалось сообщение о конце демо-режима, получено: %q", res.Message.Content)
	}
}
