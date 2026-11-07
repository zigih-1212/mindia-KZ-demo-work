package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/service"
)

func (s *Server) handleProjectList(w http.ResponseWriter, r *http.Request) {
	limit, offset := pageFrom(r)
	q := r.URL.Query()
	res, err := s.projects.List(r.Context(), service.ProjectFilter{
		Status: q.Get("status"), ManagerID: q.Get("managerId"), Search: q.Get("search"),
	}, domain.Page{Limit: limit, Offset: offset}.Normalize())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

type projectRequest struct {
	Code                string `json:"code"`
	Name                string `json:"name"`
	Customer            string `json:"customer"`
	Address             string `json:"address"`
	Status              string `json:"status"`
	BudgetMinor         int64  `json:"budgetMinor"`
	ContractAmountMinor int64  `json:"contractAmountMinor"`
	StartDate           string `json:"startDate"`
	PlannedEndDate      string `json:"plannedEndDate"`
	ActualEndDate       string `json:"actualEndDate"`
	ManagerID           string `json:"managerId"`
	ProgressPercent     int    `json:"progressPercent"`
	Version             int    `json:"version"`
}

func (s *Server) handleProjectCreate(w http.ResponseWriter, r *http.Request) {
	var req projectRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)
		return
	}
	actor, _ := userFrom(r.Context())
	p, err := s.projects.Create(r.Context(), actor, service.CreateProjectInput{
		Code: req.Code, Name: req.Name, Customer: req.Customer, Address: req.Address,
		Status: domain.ProjectStatus(req.Status), BudgetMinor: req.BudgetMinor,
		ContractAmountMinor: req.ContractAmountMinor, StartDate: req.StartDate,
		PlannedEndDate: req.PlannedEndDate, ManagerID: req.ManagerID, ProgressPercent: req.ProgressPercent,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) handleProjectGet(w http.ResponseWriter, r *http.Request) {
	p, err := s.projects.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) handleProjectUpdate(w http.ResponseWriter, r *http.Request) {
	var req projectRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)
		return
	}
	actor, _ := userFrom(r.Context())
	p, err := s.projects.Update(r.Context(), actor, chi.URLParam(r, "id"), service.UpdateProjectInput{
		Code: req.Code, Name: req.Name, Customer: req.Customer, Address: req.Address,
		Status: domain.ProjectStatus(req.Status), BudgetMinor: req.BudgetMinor,
		ContractAmountMinor: req.ContractAmountMinor, StartDate: req.StartDate,
		PlannedEndDate: req.PlannedEndDate, ActualEndDate: req.ActualEndDate,
		ManagerID: req.ManagerID, ProgressPercent: req.ProgressPercent, Version: req.Version,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) handleProjectDelete(w http.ResponseWriter, r *http.Request) {
	actor, _ := userFrom(r.Context())
	if err := s.projects.Delete(r.Context(), actor, chi.URLParam(r, "id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleProjectStages(w http.ResponseWriter, r *http.Request) {
	stages, err := s.projects.Stages(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": stages})
}
