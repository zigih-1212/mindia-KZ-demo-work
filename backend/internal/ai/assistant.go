package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/service"
)

// Config — настройки ассистента.
type Config struct {
	Enabled      bool
	BudgetTokens int64 // общий лимит токенов демо-режима (вход+выход)
	MaxToolCalls int   // предохранитель от зацикливания
	MaxHistory   int   // сколько последних сообщений подавать в контекст
	Model        string
}

// Assistant — ИИ-ассистент строительной платформы.
//
// Ограничения (осознанные):
//   - область строго внутри продукта (system prompt + whitelist инструментов);
//   - расход токенов учитывается и жёстко ограничен бюджетом;
//   - доступ к данным только через сервисы с проверкой прав пользователя.
type Assistant struct {
	client    *Client
	repo      service.AIRepository
	deps      ToolDeps
	cfg       Config
	clock     func() time.Time
}

// NewAssistant собирает ассистента.
func NewAssistant(client *Client, repo service.AIRepository, deps ToolDeps, cfg Config) *Assistant {
	if cfg.MaxToolCalls <= 0 {
		cfg.MaxToolCalls = 6
	}
	if cfg.MaxHistory <= 0 {
		cfg.MaxHistory = 12
	}
	return &Assistant{client: client, repo: repo, deps: deps, cfg: cfg, clock: time.Now}
}

// Enabled сообщает, доступен ли ассистент (внешний LLM или офлайн-режим).
func (a *Assistant) Enabled() bool { return a.cfg.Enabled }

// systemPrompt задаёт область ассистента: строительство + данные платформы.
// Свободнее в рамках тематики (приветствия, общие вопросы по стройке), но без
// выдумывания цифр и без тем вне строительства.
const systemPrompt = `Ты — ассистент платформы «СтройКонтроль» для строительных компаний.
Ты можешь здороваться, поддерживать несложный разговор и отвечать на вопросы
по строительству в целом: объекты и этапы работ, сметы и ценообразование,
исполнительная документация (КС-2, КС-3, акты, счета), нормативная база
(ГОСТ, СНиП, СП, ФЕР), материалы и технологии, охрана труда и безопасность
на объекте, организация строительства, терминология.
Данные платформы (объекты, сметы, документы, нормативы) получай ТОЛЬКО через
инструменты — так ты видишь актуальные цифры. Никогда не выдумывай суммы,
даты, номера документов и нормы: если данных нет — скажи честно.
Отвечай по-русски, кратко и по делу, суммы указывай в тенге (₸).
Можешь помогать с вопросами по работе в самой платформе (куда нажать, что где).
Если вопрос совсем не про строительство и не про платформу (политика, медицина,
развлечения, чужой код и т.п.) — мягко откажись и предложи вернуться к теме стройки.`

// Ask обрабатывает сообщение пользователя и возвращает ответ ассистента.
func (a *Assistant) Ask(ctx context.Context, actor *domain.User, conversationID, userText string) (domain.AIChatResult, error) {
	if !a.cfg.Enabled {
		return domain.AIChatResult{}, domain.ErrPreconditionFailed
	}
	userText = strings.TrimSpace(userText)
	if userText == "" {
		return domain.AIChatResult{}, domain.NewValidation("message", "введите вопрос")
	}
	if len([]rune(userText)) > 2000 {
		return domain.AIChatResult{}, domain.NewValidation("message", "сообщение слишком длинное (максимум 2000 символов)")
	}

	conv, err := a.ensureConversation(ctx, actor, conversationID, userText)
	if err != nil {
		return domain.AIChatResult{}, err
	}

	// Сохраняем сообщение пользователя.
	userMsg := &domain.AIMessage{
		ID: uuid.NewString(), ConversationID: conv.ID, Role: "user",
		Content: userText, CreatedAt: a.clock().UTC(),
	}
	if err := a.repo.AppendMessage(ctx, userMsg); err != nil {
		return domain.AIChatResult{}, err
	}

	usage, err := a.repo.Usage(ctx)
	if err != nil {
		return domain.AIChatResult{}, err
	}
	usage.LimitTotal = a.cfg.BudgetTokens

	// Проверка бюджета демо-режима ДО обращения к модели.
	if a.budgetExhausted(usage) {
		reply := &domain.AIMessage{
			ID: uuid.NewString(), ConversationID: conv.ID, Role: "assistant",
			Content:   limitedMessage,
			CreatedAt: a.clock().UTC(),
		}
		_ = a.repo.AppendMessage(ctx, reply)
		_ = a.repo.TouchConversation(ctx, conv.ID, "")
		return domain.AIChatResult{
			ConversationID: conv.ID, Message: *reply, Usage: usage, Limited: true,
		}, nil
	}

	result, err := a.run(ctx, actor, conv, userText, usage)
	if err != nil {
		return domain.AIChatResult{}, err
	}
	return result, nil
}

// limitedMessage — ответ при исчерпании бюджета токенов.
const limitedMessage = "Демо-режим ассистента закончился: исчерпан лимит токенов (100 000 входящих и исходящих суммарно на весь сайт). " +
	"Ассистент отключён до сброса бюджета администратором. Остальные функции платформы работают в полном объёме."

func (a *Assistant) budgetExhausted(u domain.AIUsage) bool {
	if a.cfg.BudgetTokens <= 0 {
		return false
	}
	return u.TokensIn+u.TokensOut >= a.cfg.BudgetTokens
}

// run выполняет цикл «модель ↔ инструменты» и сохраняет ответ.
func (a *Assistant) run(ctx context.Context, actor *domain.User, conv *domain.AIConversation, userText string, usage domain.AIUsage) (domain.AIChatResult, error) {
	// Без подключённого LLM сразу идём в детерминированный офлайн-режим,
	// чтобы не тратить впустую заведомо неудачный HTTP-запрос к модели.
	if !a.client.Enabled() {
		return a.offline(ctx, actor, conv, nil, usage)
	}

	history, err := a.repo.ListMessages(ctx, conv.ID, a.cfg.MaxHistory)
	if err != nil {
		return domain.AIChatResult{}, err
	}

	messages := []Message{{Role: "system", Content: systemPrompt}}
	for _, m := range history {
		switch m.Role {
		case "user":
			messages = append(messages, Message{Role: "user", Content: m.Content})
		case "assistant":
			if strings.TrimSpace(m.Content) != "" {
				messages = append(messages, Message{Role: "assistant", Content: m.Content})
			}
		}
	}

	tools := ToolDefs(a.deps)
	traces := []domain.ToolCallTrace{}
	sources := []string{}
	var lastContent string
	totalIn, totalOut := 0, 0

	for i := 0; i <= a.cfg.MaxToolCalls; i++ {
		// Предохранитель: не превышаем бюджет даже в середине цикла.
		if a.cfg.BudgetTokens > 0 && int64(totalIn+totalOut)+usage.TokensIn+usage.TokensOut >= a.cfg.BudgetTokens {
			break
		}
		resp, err := a.client.Complete(ctx, ChatRequest{
			Model:       a.cfg.Model,
			Messages:    messages,
			Tools:       tools,
			Temperature: 0.2,
			MaxTokens:   1024,
		})
		if err != nil {
			return a.offlineOrError(ctx, actor, conv, traces, usage, err)
		}
		totalIn += resp.Usage.PromptTokens
		totalOut += resp.Usage.CompletionTokens
		if len(resp.Choices) == 0 {
			return a.offlineOrError(ctx, actor, conv, traces, usage, errors.New("пустой ответ модели"))
		}
		msg := resp.Choices[0].Message

		if len(msg.ToolCalls) == 0 {
			lastContent = strings.TrimSpace(msg.Content)
			break
		}
		// Добавляем запрос модели с вызовами и выполняем их.
		messages = append(messages, Message{Role: "assistant", Content: msg.Content, ToolCalls: msg.ToolCalls})
		for _, tc := range msg.ToolCalls {
			trace := domain.ToolCallTrace{Name: tc.Function.Name, Args: tc.Function.Arguments}
			out, callErr := callTool(ctx, a.deps, tc.Function.Name, tc.Function.Arguments, actor)
			if callErr != nil {
				trace.Error = callErr.Error()
				out = `{"error":` + jsonString(callErr.Error()) + `}`
			} else {
				trace.Result = truncate(out, 800)
			}
			traces = append(traces, trace)
			if tc.Function.Name == "search_normative" {
				sources = append(sources, extractCodes(out)...)
			}
			messages = append(messages, Message{Role: "tool", ToolCallID: tc.ID, Name: tc.Function.Name, Content: out})
		}
	}

	if lastContent == "" {
		lastContent = "Не удалось сформировать ответ. Уточните вопрос или попробуйте ещё раз."
	}

	// Фиксируем расход токенов.
	if totalIn > 0 || totalOut > 0 {
		if err := a.repo.AddUsage(ctx, totalIn, totalOut); err != nil {
			return domain.AIChatResult{}, err
		}
		usage.TokensIn += int64(totalIn)
		usage.TokensOut += int64(totalOut)
		usage.Requests++
	}

	reply := &domain.AIMessage{
		ID: uuid.NewString(), ConversationID: conv.ID, Role: "assistant",
		Content: lastContent, TokensIn: totalIn, TokensOut: totalOut, CreatedAt: a.clock().UTC(),
	}
	if err := a.repo.AppendMessage(ctx, reply); err != nil {
		return domain.AIChatResult{}, err
	}
	_ = a.repo.TouchConversation(ctx, conv.ID, "")

	limited := a.budgetExhausted(usage)
	return domain.AIChatResult{
		ConversationID: conv.ID,
		Message:        *reply,
		Usage:          usage,
		Limited:        limited,
		Sources:        dedupe(sources),
		ToolCalls:      traces,
	}, nil
}

// offlineOrError: при недоступности LLM переходим в детерминированный офлайн-режим
// (демо должно работать без API-ключа), иначе возвращаем ошибку.
func (a *Assistant) offlineOrError(ctx context.Context, actor *domain.User, conv *domain.AIConversation, traces []domain.ToolCallTrace, usage domain.AIUsage, err error) (domain.AIChatResult, error) {
	if a.client != nil && a.client.Enabled() {
		// Ключ настроен, но запрос упал — сообщаем честно.
		reply := &domain.AIMessage{
			ID: uuid.NewString(), ConversationID: conv.ID, Role: "assistant",
			Content:   "Ассистент временно недоступен (ошибка обращения к модели). Попробуйте позже или используйте разделы платформы напрямую.",
			CreatedAt: a.clock().UTC(),
		}
		_ = a.repo.AppendMessage(ctx, reply)
		return domain.AIChatResult{ConversationID: conv.ID, Message: *reply, Usage: usage, ToolCalls: traces}, nil
	}
	return a.offline(ctx, actor, conv, traces, usage)
}

// offline — детерминированный ответ без LLM: вызывает нужный инструмент по ключевым словам.
func (a *Assistant) offline(ctx context.Context, actor *domain.User, conv *domain.AIConversation, traces []domain.ToolCallTrace, usage domain.AIUsage) (domain.AIChatResult, error) {
	last, err := a.repo.ListMessages(ctx, conv.ID, 1)
	if err != nil {
		return domain.AIChatResult{}, err
	}
	question := ""
	if len(last) > 0 {
		question = strings.ToLower(last[len(last)-1].Content)
	}

	tool, args := pickOfflineTool(question)
	if tool == "__chat__" {
		reply := &domain.AIMessage{
			ID: uuid.NewString(), ConversationID: conv.ID, Role: "assistant",
			Content: "Здравствуйте! Я ассистент «СтройКонтроль» (сейчас — в офлайн-режиме, отвечаю по ключевым темам). " +
				"Помогу с объектами, сметами, документами (КС-2/КС-3/акты/счета), нормативами и вопросами по строительству. " +
				"Спросите, например: «какие сметы на проверке?» или «что такое КС-2?».",
			CreatedAt: a.clock().UTC(),
		}
		if err := a.repo.AppendMessage(ctx, reply); err != nil {
			return domain.AIChatResult{}, err
		}
		return domain.AIChatResult{ConversationID: conv.ID, Message: *reply, Usage: usage, ToolCalls: traces}, nil
	}
	if tool == "" {
		// Мягкий отказ на темы вне строительства/платформы.
		reply := &domain.AIMessage{
			ID: uuid.NewString(), ConversationID: conv.ID, Role: "assistant",
			Content: "Я могу помочь с вопросами по строительству и платформе «СтройКонтроль»: объекты, сметы, документы (КС-2/КС-3/акты/счета), нормативы (ГОСТ/СНиП/СП/ФЕР), материалы и организация работ. " +
				"Если вопрос на другую тему — переформулируйте в рамках стройки, пожалуйста.",
			CreatedAt: a.clock().UTC(),
		}
		if err := a.repo.AppendMessage(ctx, reply); err != nil {
			return domain.AIChatResult{}, err
		}
		return domain.AIChatResult{ConversationID: conv.ID, Message: *reply, Usage: usage, ToolCalls: traces}, nil
	}
	content := "Ассистент работает в демонстрационном (офлайн) режиме без подключённой LLM. "
	out, callErr := callTool(ctx, a.deps, tool, args, actor)
	trace := domain.ToolCallTrace{Name: tool, Args: args}
	if callErr != nil {
		trace.Error = callErr.Error()
	} else {
		trace.Result = truncate(out, 800)
	}
	traces = append(traces, trace)
	content += "\n\nВот актуальные данные по запросу:\n" + summarizeOffline(tool, out)
	content += "\n\nДля полноценных ответов подключите модель через переменные AI_BASE_URL и AI_API_KEY."

	reply := &domain.AIMessage{
		ID: uuid.NewString(), ConversationID: conv.ID, Role: "assistant",
		Content: content, CreatedAt: a.clock().UTC(),
	}
	if err := a.repo.AppendMessage(ctx, reply); err != nil {
		return domain.AIChatResult{}, err
	}
	return domain.AIChatResult{ConversationID: conv.ID, Message: *reply, Usage: usage, ToolCalls: traces}, nil
}

// pickOfflineTool выбирает инструмент по ключевым словам (офлайн-режим).
// "__chat__" — приветствия/болтовня: дружелюбный ответ без инструментов.
func pickOfflineTool(q string) (string, string) {
	switch {
	case containsAny(q, "привет", "здравствуй", "добрый день", "добрый вечер", "доброе утро", "как дела", "спасибо", "кто ты", "что ты умеешь"):
		return "__chat__", `{}`
	case containsAny(q, "норматив", "гост", "снип", "сп ", "фер", "правил", "документооборот", "материал", "фундамент", "отделк", "кровл", "монтаж", "сметн", "безопасност", "охран", "тб", "технолог", "неустойк"):
		return "search_normative", `{"query":` + jsonString(q) + `}`
	case containsAny(q, "смет", "аномал", "провер", "согласован"):
		return "list_pending_approvals", `{}`
	case containsAny(q, "документ", "кс-2", "кс2", "кс-3", "кс3", "акт", "счет", "счёт"):
		return "list_documents", `{}`
	case containsAny(q, "объект", "проект", "бюджет", "перерасход", "затрат", "портфел"):
		return "project_overview", `{}`
	default:
		return "", ``
	}
}

// summarizeOffline формирует краткое человекочитаемое резюме результата инструмента.
func summarizeOffline(tool, out string) string {
	switch tool {
	case "project_overview":
		return "Сводка по портфелю объектов:\n" + out
	case "list_documents":
		return "Документы:\n" + out
	case "search_normative":
		return "Найденные нормативные источники:\n" + out
	case "list_pending_approvals":
		return "Ожидают согласования:\n" + out
	default:
		return out
	}
}

func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func dedupe(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

// extractCodes достаёт коды документов (ГОСТ/СНиП/СП/ФЕР) из результата RAG.
func extractCodes(out string) []string {
	var payload struct {
		Items []struct {
			Code string `json:"code"`
		} `json:"items"`
	}
	if err := json.Unmarshal([]byte(out), &payload); err != nil {
		return nil
	}
	codes := make([]string, 0, len(payload.Items))
	for _, it := range payload.Items {
		if it.Code != "" {
			codes = append(codes, it.Code)
		}
	}
	return codes
}

// ensureConversation создаёт диалог при необходимости и проверяет владельца.
func (a *Assistant) ensureConversation(ctx context.Context, actor *domain.User, conversationID, firstText string) (*domain.AIConversation, error) {
	if conversationID != "" {
		conv, err := a.repo.GetConversation(ctx, conversationID)
		if err != nil {
			return nil, err
		}
		if conv.UserID != actor.ID {
			return nil, domain.ErrForbidden
		}
		return conv, nil
	}
	now := a.clock().UTC()
	conv := &domain.AIConversation{
		ID: uuid.NewString(), UserID: actor.ID,
		Title: truncate(firstText, 80), CreatedAt: now, UpdatedAt: now,
	}
	if err := a.repo.CreateConversation(ctx, conv); err != nil {
		return nil, err
	}
	return conv, nil
}

// Conversations возвращает диалоги пользователя.
func (a *Assistant) Conversations(ctx context.Context, actor *domain.User) ([]domain.AIConversation, error) {
	return a.repo.ListConversations(ctx, actor.ID, 30)
}

// Messages возвращает сообщения диалога с проверкой владельца.
func (a *Assistant) Messages(ctx context.Context, actor *domain.User, conversationID string) ([]domain.AIMessage, error) {
	conv, err := a.repo.GetConversation(ctx, conversationID)
	if err != nil {
		return nil, err
	}
	if conv.UserID != actor.ID {
		return nil, domain.ErrForbidden
	}
	return a.repo.ListMessages(ctx, conversationID, 100)
}

// Usage возвращает текущий расход бюджета.
func (a *Assistant) Usage(ctx context.Context) (domain.AIUsage, error) {
	u, err := a.repo.Usage(ctx)
	if err != nil {
		return domain.AIUsage{}, err
	}
	u.LimitTotal = a.cfg.BudgetTokens
	return u, nil
}
