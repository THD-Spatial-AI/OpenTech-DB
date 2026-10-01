package httputil

import (
	"errors"
	"net/http"

	apperrors "platform.local/common/pkg/errors"

	"github.com/gin-gonic/gin"
)

func ErrorResponse(c *gin.Context, statusCode int, message string) {
	c.JSON(statusCode, gin.H{"error": message})
}

func ErrorResponseWithDetails(c *gin.Context, statusCode int, message string, details string) {
	c.JSON(statusCode, gin.H{"error": message, "details": details})
}

func BadRequest(c *gin.Context, message string) {
	ErrorResponse(c, http.StatusBadRequest, message)
}

func BadRequestWithDetails(c *gin.Context, message string, details string) {
	ErrorResponseWithDetails(c, http.StatusBadRequest, message, details)
}

func Unauthorized(c *gin.Context, message string) {
	ErrorResponse(c, http.StatusUnauthorized, message)
}

func Forbidden(c *gin.Context, message string) {
	ErrorResponse(c, http.StatusForbidden, message)
}

func NotFound(c *gin.Context, message string) {
	ErrorResponse(c, http.StatusNotFound, message)
}

func InternalError(c *gin.Context, message string) {
	ErrorResponse(c, http.StatusInternalServerError, message)
}

func InternalErrorWithDetails(c *gin.Context, message string, details string) {
	ErrorResponseWithDetails(c, http.StatusInternalServerError, message, details)
}

func Conflict(c *gin.Context, message string) {
	ErrorResponse(c, http.StatusConflict, message)
}

func ConflictWithData(c *gin.Context, data interface{}) {
	c.JSON(http.StatusConflict, data)
}

func BadGateway(c *gin.Context, message string) {
	ErrorResponse(c, http.StatusBadGateway, message)
}

func SuccessResponse(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

func SuccessMessage(c *gin.Context, message string) {
	c.JSON(http.StatusOK, gin.H{"success": true, "message": message})
}

func Created(c *gin.Context, data interface{}) {
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": data})
}

func NoContent(c *gin.Context) {
	c.Status(http.StatusNoContent)
}

func HandleError(c *gin.Context, err error) {
	if err == nil {
		return
	}

	var appErr *apperrors.AppError
	if errors.As(err, &appErr) {
		ErrorResponse(c, appErr.StatusCode, appErr.Message)
		return
	}

	// Check for specific error messages (backwards compatibility)
	errMsg := err.Error()
	switch errMsg {
	case "record not found", "not found":
		NotFound(c, errMsg)
		return
	case "feedback not found":
		NotFound(c, "feedback not found")
		return
	case "webservice not found":
		NotFound(c, "webservice not found")
		return
	}

	// Default to internal server error
	InternalError(c, err.Error())
}
