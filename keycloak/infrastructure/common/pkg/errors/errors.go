package errors

import (
	"fmt"
	"net/http"
)

// AppError represents an application error with HTTP status
type AppError struct {
	Code       string
	Message    string
	StatusCode int
	Err        error
}

func (e *AppError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Err)
	}
	return e.Message
}

func (e *AppError) Unwrap() error {
	return e.Err
}

func (e *AppError) GetHTTPStatus() int {
	return e.StatusCode
}

// Common errors
var (
	ErrNotFound     = &AppError{Code: "NOT_FOUND", Message: "Resource not found", StatusCode: http.StatusNotFound}
	ErrUnauthorized = &AppError{Code: "UNAUTHORIZED", Message: "Unauthorized", StatusCode: http.StatusUnauthorized}
	ErrForbidden    = &AppError{Code: "FORBIDDEN", Message: "Forbidden", StatusCode: http.StatusForbidden}
	ErrBadRequest   = &AppError{Code: "BAD_REQUEST", Message: "Bad request", StatusCode: http.StatusBadRequest}
	ErrConflict     = &AppError{Code: "CONFLICT", Message: "Resource conflict", StatusCode: http.StatusConflict}
	ErrInternal     = &AppError{Code: "INTERNAL_ERROR", Message: "Internal server error", StatusCode: http.StatusInternalServerError}
	ErrValidation   = &AppError{Code: "VALIDATION_ERROR", Message: "Validation failed", StatusCode: http.StatusBadRequest}
)

// New creates a new AppError
func New(code, message string, statusCode int) *AppError {
	return &AppError{
		Code:       code,
		Message:    message,
		StatusCode: statusCode,
	}
}
