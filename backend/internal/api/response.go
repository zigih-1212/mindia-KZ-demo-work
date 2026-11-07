// Package api реализует HTTP-слой: маршрутизацию, middleware, обработчики
// и единообразное сопоставление доменных ошибок с HTTP-статусами.
package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
)

// errorBody — единый формат ошибки API.
type errorBody struct {
	Error   string `json:"error"`
	Message string `json:"message"`
	Field   string `json:"field,omitempty"`
}

// writeJSON пишет JSON-ответ с заданным статусом.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	_ = json.NewEncoder(w).Encode(v)
}

// decodeJSON читает тело запроса в v, отклоняя неизвестные поля и слишком большие тела.
func decodeJSON(w http.ResponseWriter, r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return domain.NewValidation("body", "некорректное тело запроса: "+err.Error())
	}
	return nil
}

// writeError сопоставляет доменную ошибку с HTTP-статусом и телом ответа.
func writeError(w http.ResponseWriter, err error) {
	var ve *domain.ValidationError
	var ce *domain.ConflictError
	var pe *domain.PreconditionError

	switch {
	case errors.Is(err, domain.ErrValidation), errors.As(err, &ve):
		body := errorBody{Error: "validation_error", Message: err.Error()}
		if errors.As(err, &ve) {
			if ve.Field != "" {
				body.Field = ve.Field
			}
			if ve.Message != "" {
				body.Message = ve.Message
			}
		}
		writeJSON(w, http.StatusUnprocessableEntity, body)
	case errors.Is(err, domain.ErrNotFound):
		writeJSON(w, http.StatusNotFound, errorBody{Error: "not_found", Message: "ресурс не найден"})
	case errors.Is(err, domain.ErrConflict), errors.As(err, &ce):
		body := errorBody{Error: "conflict", Message: "конфликт данных"}
		if ce.Message != "" {
			body.Message = ce.Message
		}
		writeJSON(w, http.StatusConflict, body)
	case errors.Is(err, domain.ErrPreconditionFailed), errors.As(err, &pe):
		body := errorBody{Error: "precondition_failed", Message: "операция недопустима"}
		if pe.Message != "" {
			body.Message = pe.Message
		}
		writeJSON(w, http.StatusPreconditionFailed, body)
	case errors.Is(err, domain.ErrVersionMismatch):
		writeJSON(w, http.StatusConflict, errorBody{
			Error: "version_mismatch", Message: "данные изменены другим пользователем — обновите страницу",
		})
	case errors.Is(err, domain.ErrForbidden):
		writeJSON(w, http.StatusForbidden, errorBody{Error: "forbidden", Message: "недостаточно прав"})
	case errors.Is(err, domain.ErrUnauthorized):
		writeJSON(w, http.StatusUnauthorized, errorBody{Error: "unauthorized", Message: "требуется вход"})
	default:
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal_error", Message: "внутренняя ошибка сервера"})
	}
}
