package httputil

import (
	"strconv"

	"github.com/gin-gonic/gin"
)

// ParseUintParam extracts and validates a uint parameter from the URL
func ParseUintParam(c *gin.Context, paramName string, errorMsg string) (uint, bool) {
	idStr := c.Param(paramName)
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil || id <= 0 {
		if errorMsg == "" {
			errorMsg = "Invalid " + paramName
		}
		BadRequest(c, errorMsg)
		return 0, false
	}
	return uint(id), true
}
