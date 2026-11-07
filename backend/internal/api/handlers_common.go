package api

import "net/http"

func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	sum, err := s.projects.Summary(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sum)
}

func (s *Server) handleActivity(w http.ResponseWriter, r *http.Request) {
	limit, _ := pageFrom(r)
	items, err := s.activity.List(r.Context(), limit)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleNormativeList(w http.ResponseWriter, r *http.Request) {
	items, err := s.normative.List(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
