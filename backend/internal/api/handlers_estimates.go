package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/service"
)

func (s *Server) handleEstimateList(w http.ResponseWriter, r *http.Request) {
	limit, offset := pageFrom(r)
	q := r.URL.Query()
	res, err := s.estimates.List(r.Context(), service.EstimateFilter{
		ProjectID: q.Get("projectId"), Status: q.Get("status"), Search: q.Get("search"),
	}, domain.Page{Limit: limit, Offset: offset}.Normalize())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

type estimateItemRequest struct {
	Code           string  `json:"code"`
	Name           string  `json:"name"`
	Unit           string  `json:"unit"`
	Quantity       float64 `json:"quantity"`
	UnitPriceMinor int64   `json:"unitPriceMinor"`
	Category       string  `json:"category"`
}

type estimateRequest struct {
	ProjectID string                 `json:"projectId"`
	StageID   string                 `json:"stageId"`
	Number    string                 `json:"number"`
	Name      string                 `json:"name"`
	Currency  string                 `json:"currency"`
	Items     []estimateItemRequest  `json:"items"`
}

func toItemInputs(in []estimateItemRequest) []service.EstimateItemInput {
	out := make([]service.EstimateItemInput, 0, len(in))
	for _, it := range in {
		out = append(out, service.EstimateItemInput{
			Code: it.Code, Name: it.Name, Unit: it.Unit,
			Quantity: it.Quantity, UnitPriceMinor: it.UnitPriceMinor, Category: it.Category,
		})
	}
	return out
}

func (s *Server) handleEstimateCreate(w http.ResponseWriter, r *http.Request) {
	var req estimateRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)
		return
	}
	actor, _ := userFrom(r.Context())
	e, err := s.estimates.Create(r.Context(), actor, service.CreateEstimateInput{
		ProjectID: req.ProjectID, StageID: req.StageID, Number: req.Number,
		Name: req.Name, Currency: req.Currency, Items: toItemInputs(req.Items),
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, e)
}

func (s *Server) handleEstimateGet(w http.ResponseWriter, r *http.Request) {
	e, err := s.estimates.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, e)
}

func (s *Server) handleEstimateItems(w http.ResponseWriter, r *http.Request) {
	items, err := s.estimates.Items(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

type replaceItemsRequest struct {
	Items []estimateItemRequest `json:"items"`
}

func (s *Server) handleEstimateReplaceItems(w http.ResponseWriter, r *http.Request) {
	var req replaceItemsRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)
		return
	}
	actor, _ := userFrom(r.Context())
	e, err := s.estimates.ReplaceItems(r.Context(), actor, chi.URLParam(r, "id"), toItemInputs(req.Items))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, e)
}

type transitionEstimateRequest struct {
	Status          string `json:"status"`
	ExpectedVersion int    `json:"expectedVersion"`
}

func (s *Server) handleEstimateTransition(w http.ResponseWriter, r *http.Request) {
	var req transitionEstimateRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)
		return
	}
	actor, _ := userFrom(r.Context())
	e, err := s.estimates.Transition(r.Context(), actor, chi.URLParam(r, "id"),
		domain.EstimateStatus(req.Status), req.ExpectedVersion)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, e)
}

func (s *Server) handleEstimateAnalyze(w http.ResponseWriter, r *http.Request) {
	a, err := s.estimates.Analyze(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, a)
}

func (s *Server) handleEstimateDelete(w http.ResponseWriter, r *http.Request) {
	actor, _ := userFrom(r.Context())
	if err := s.estimates.Delete(r.Context(), actor, chi.URLParam(r, "id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
