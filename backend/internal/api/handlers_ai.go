package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

func (s *Server) handleAIConversations(w http.ResponseWriter, r *http.Request) {
	actor, _ := userFrom(r.Context())
	items, err := s.assistant.Conversations(r.Context(), actor)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

type aiChatRequest struct {
	ConversationID string `json:"conversationId"`
	Message        string `json:"message"`
}

func (s *Server) handleAIChat(w http.ResponseWriter, r *http.Request) {
	if !s.assistant.Enabled() {
		writeJSON(w, http.StatusServiceUnavailable, errorBody{
			Error: "ai_disabled", Message: "ИИ-ассистент отключён в этой конфигурации",
		})
		return
	}
	var req aiChatRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)
		return
	}
	actor, _ := userFrom(r.Context())
	res, err := s.assistant.Ask(r.Context(), actor, req.ConversationID, req.Message)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleAIMessages(w http.ResponseWriter, r *http.Request) {
	actor, _ := userFrom(r.Context())
	items, err := s.assistant.Messages(r.Context(), actor, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleAIUsage(w http.ResponseWriter, r *http.Request) {
	usage, err := s.assistant.Usage(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, usage)
}
