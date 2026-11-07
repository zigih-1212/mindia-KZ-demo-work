package domain

import (
	"errors"
	"fmt"
)

// Сентинельные ошибки домена. Слой API маппит их в HTTP-статусы,
// не разбирая текст ошибки.
var (
	// ErrNotFound — сущность не найдена.
	ErrNotFound = errors.New("not found")
	// ErrConflict — нарушение уникальности или конкурентного изменения.
	ErrConflict = errors.New("conflict")
	// ErrValidation — некорректные входные данные.
	ErrValidation = errors.New("validation")
	// ErrForbidden — недостаточно прав.
	ErrForbidden = errors.New("forbidden")
	// ErrUnauthorized — не аутентифицирован.
	ErrUnauthorized = errors.New("unauthorized")
	// ErrPreconditionFailed — статус сущности не допускает операцию.
	ErrPreconditionFailed = errors.New("precondition failed")
	// ErrVersionMismatch — оптимистическая блокировка: сущность изменена другим пользователем.
	ErrVersionMismatch = errors.New("version mismatch")
)

// ValidationError несёт человекочитаемое пояснение к ErrValidation.
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	if e.Field == "" {
		return "validation: " + e.Message
	}
	return fmt.Sprintf("validation: %s: %s", e.Field, e.Message)
}

// Unwrap позволяет errors.Is(err, ErrValidation) работать.
func (e *ValidationError) Unwrap() error { return ErrValidation }

// NewValidation создаёт ошибку валидации по полю.
func NewValidation(field, message string) error {
	return &ValidationError{Field: field, Message: message}
}

// ConflictError несёт пояснение к ErrConflict.
type ConflictError struct{ Message string }

func (e *ConflictError) Error() string { return "conflict: " + e.Message }
func (e *ConflictError) Unwrap() error { return ErrConflict }

// NewConflict создаёт ошибку конфликта.
func NewConflict(message string) error { return &ConflictError{Message: message} }

// PreconditionError несёт пояснение к ErrPreconditionFailed.
type PreconditionError struct{ Message string }

func (e *PreconditionError) Error() string { return "precondition failed: " + e.Message }
func (e *PreconditionError) Unwrap() error { return ErrPreconditionFailed }

// NewPrecondition создаёт ошибку нарушения предусловия перехода статуса.
func NewPrecondition(message string) error { return &PreconditionError{Message: message} }

// Page — параметры пагинации.
type Page struct {
	Limit  int
	Offset int
}

// Normalize приводит параметры пагинации к допустимым границам.
func (p Page) Normalize() Page {
	if p.Limit <= 0 {
		p.Limit = 20
	}
	if p.Limit > 100 {
		p.Limit = 100
	}
	if p.Offset < 0 {
		p.Offset = 0
	}
	return p
}

// ListResult — обёртка над списком с общим количеством.
type ListResult[T any] struct {
	Items []T `json:"items"`
	Total int `json:"total"`
	Limit int `json:"limit"`
	Offset int `json:"offset"`
}
