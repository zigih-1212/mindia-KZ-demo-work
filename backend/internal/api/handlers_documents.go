package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/service"
)

func (s *Server) handleDocumentList(w http.ResponseWriter, r *http.Request) {
	limit, offset := pageFrom(r)
	q := r.URL.Query()
	res, err := s.documents.List(r.Context(), service.DocumentFilter{
		ProjectID: q.Get("projectId"), Status: q.Get("status"), Type: q.Get("type"), Search: q.Get("search"),
	}, domain.Page{Limit: limit, Offset: offset}.Normalize())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

type documentRequest struct {
	ProjectID   string `json:"projectId"`
	Type        string `json:"type"`
	Number      string `json:"number"`
	Title       string `json:"title"`
	PeriodFrom  string `json:"periodFrom"`
	PeriodTo    string `json:"periodTo"`
	AmountMinor int64  `json:"amountMinor"`
}

func (s *Server) handleDocumentCreate(w http.ResponseWriter, r *http.Request) {
	var req documentRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)
		return
	}
	actor, _ := userFrom(r.Context())
	d, err := s.documents.Create(r.Context(), actor, service.CreateDocumentInput{
		ProjectID: req.ProjectID, Type: domain.DocumentType(req.Type), Number: req.Number,
		Title: req.Title, PeriodFrom: req.PeriodFrom, PeriodTo: req.PeriodTo, AmountMinor: req.AmountMinor,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, d)
}

func (s *Server) handleDocumentGet(w http.ResponseWriter, r *http.Request) {
	d, err := s.documents.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

type transitionDocumentRequest struct {
	Status          string `json:"status"`
	ExpectedVersion int    `json:"expectedVersion"`
}

func (s *Server) handleDocumentTransition(w http.ResponseWriter, r *http.Request) {
	var req transitionDocumentRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)
		return
	}
	actor, _ := userFrom(r.Context())
	d, err := s.documents.Transition(r.Context(), actor, chi.URLParam(r, "id"),
		domain.DocumentStatus(req.Status), req.ExpectedVersion)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) handleDocumentDelete(w http.ResponseWriter, r *http.Request) {
	actor, _ := userFrom(r.Context())
	if err := s.documents.Delete(r.Context(), actor, chi.URLParam(r, "id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
