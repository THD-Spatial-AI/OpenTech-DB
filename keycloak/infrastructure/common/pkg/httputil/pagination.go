package httputil

import (
	"strconv"

	"github.com/gin-gonic/gin"
)

// PaginationParams holds pagination parameters
type PaginationParams struct {
	Page    int
	PerPage int
	Offset  int
}

// PaginationOptions allows configuring pagination limits
type PaginationOptions struct {
	DefaultPage    int
	DefaultPerPage int
	MaxPerPage     int
}

// DefaultPaginationOptions provides sensible defaults
var DefaultPaginationOptions = PaginationOptions{
	DefaultPage:    1,
	DefaultPerPage: 10,
	MaxPerPage:     100,
}

// ParsePagination extracts and validates pagination parameters from query string
func ParsePagination(c *gin.Context, opts *PaginationOptions) PaginationParams {
	if opts == nil {
		opts = &DefaultPaginationOptions
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", strconv.Itoa(opts.DefaultPage)))
	if page < 1 {
		page = opts.DefaultPage
	}

	perPage, _ := strconv.Atoi(c.DefaultQuery("per_page", strconv.Itoa(opts.DefaultPerPage)))
	if perPage < 1 {
		perPage = opts.DefaultPerPage
	}
	if perPage > opts.MaxPerPage {
		perPage = opts.MaxPerPage
	}

	offset := (page - 1) * perPage

	return PaginationParams{
		Page:    page,
		PerPage: perPage,
		Offset:  offset,
	}
}

// PaginatedResponse provides a standard pagination wrapper
type PaginatedResponse struct {
	Data       interface{} `json:"data"`
	Total      int64       `json:"total"`
	Page       int         `json:"page"`
	PerPage    int         `json:"per_page"`
	TotalPages int         `json:"total_pages"`
}
