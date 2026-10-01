package middleware

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"net/http"
	"time"

	"platform.local/common/pkg/httputil"

	"github.com/gin-gonic/gin"
)

const (
	csrfHeaderName = "X-CSRF-Token"
)

// CSRFConfig holds CSRF middleware configuration
type CSRFConfig struct {
	CookieDomain        string
	CookieMaxAge        int
	IsProduction        bool
	EnableRotation      bool          // Enable per-request token rotation
	RotationGracePeriod time.Duration // Grace period for accepting old tokens
}

var csrfConfig *CSRFConfig

func SetCSRFConfig(config *CSRFConfig) {
	csrfConfig = config
}

func CSRFMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if isReadOnlyMethod(c.Request.Method) {
			c.Next()
			return
		}

		if err := validateCSRFToken(c); err != nil {
			c.Abort()
			return
		}

		c.Set("csrf_old_token", c.GetHeader(csrfHeaderName))
		c.Next()

		rotateCSRFTokenIfNeeded(c)
	}
}

func isReadOnlyMethod(method string) bool {
	return method == "GET" || method == "HEAD" || method == "OPTIONS"
}

func validateCSRFToken(c *gin.Context) error {
	csrfCookie, err := c.Cookie("csrf_token")
	if err != nil || csrfCookie == "" {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "CSRF token missing",
			"code":  "CSRF_TOKEN_MISSING",
		})
		return fmt.Errorf("csrf token missing in cookie")
	}

	csrfHeader := c.GetHeader(csrfHeaderName)
	if csrfHeader == "" {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "CSRF token missing in request header",
			"code":  "CSRF_TOKEN_MISSING",
		})
		return fmt.Errorf("csrf token missing in header")
	}

	if len(csrfCookie) != len(csrfHeader) ||
		subtle.ConstantTimeCompare([]byte(csrfCookie), []byte(csrfHeader)) != 1 {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "CSRF token validation failed",
			"code":  "CSRF_TOKEN_INVALID",
		})
		return fmt.Errorf("csrf token mismatch")
	}

	return nil
}

func rotateCSRFTokenIfNeeded(c *gin.Context) {
	if csrfConfig == nil || !csrfConfig.EnableRotation || c.Writer.Status() >= 400 {
		return
	}

	newToken := GenerateCSRFToken()

	// HttpOnly is intentionally set to false for CSRF tokens
	// because JavaScript must read this cookie to include it in the X-CSRF-Token header.
	// This is required for the double-submit cookie CSRF protection pattern.
	httputil.SetAuthCookie(c, csrfCookieOptions(csrfConfig), "csrf_token", newToken, csrfConfig.CookieMaxAge, false)
	c.Header(csrfHeaderName, newToken)
}

func GenerateCSRFToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic("CSRF: Failed to generate secure random token: " + err.Error())
	}
	return base64.URLEncoding.EncodeToString(b)
}

func SetCSRFTokenCookie(c *gin.Context, token string, config *CSRFConfig) {
	// HttpOnly is intentionally set to false for CSRF tokens
	// because JavaScript must read this cookie to include it in the X-CSRF-Token header.
	// This is required for the double-submit cookie CSRF protection pattern.
	httputil.SetAuthCookie(c, csrfCookieOptions(config), "csrf_token", token, config.CookieMaxAge, false)
}

func csrfCookieOptions(config *CSRFConfig) httputil.CookieOptions {
	return httputil.CookieOptions{
		Domain:       config.CookieDomain,
		IsProduction: config.IsProduction,
	}
}
