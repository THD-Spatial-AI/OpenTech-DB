package middleware

import (
	"context"
	"errors"
	"fmt"
	"time"

	"platform.local/common/pkg/httputil"
	platformlogger "platform.local/platform/logger"
	platformsession "platform.local/platform/session"

	"github.com/gin-gonic/gin"
)

var (
	sessionCookieMaxAge       int
	sessionCookieDomain       string
	sessionCookieIsProduction bool
)

// SessionValidationMiddleware validates session integrity and expiration
func SessionValidationMiddleware(sessionStore platformsession.SessionStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		sessionID := httputil.GetSessionCookieOrEmpty(c)
		if sessionID == "" {
			httputil.Unauthorized(c, "Session not found")
			c.Abort()
			return
		}

		sessionData, err := getValidSessionData(c, sessionStore, sessionID)
		if err != nil {
			c.Abort()
			return
		}

		httputil.SetSessionContext(c, sessionData)
		c.Next()
	}
}

func getValidSessionData(c *gin.Context, sessionStore platformsession.SessionStore, sessionID string) (*platformsession.SessionData, error) {
	sessionData, err := sessionStore.GetSession(c.Request.Context(), sessionID)
	if err != nil {
		platformlogger.WithFields(map[string]interface{}{
			"component": "session_validation",
			"error":     err,
		}).Error("Failed to get session")
		httputil.Unauthorized(c, "Invalid session")
		return nil, fmt.Errorf("invalid session")
	}

	if sessionData == nil {
		httputil.Unauthorized(c, "Session expired")
		return nil, fmt.Errorf("session expired")
	}

	if err := validateSessionAge(c, sessionStore, sessionData, sessionID); err != nil {
		return nil, err
	}

	if sessionData.UserID == "" || sessionData.AccessToken == "" {
		httputil.Unauthorized(c, "Invalid session data")
		return nil, fmt.Errorf("invalid session data")
	}

	return sessionData, nil
}

func validateSessionAge(c *gin.Context, sessionStore platformsession.SessionStore, sessionData *platformsession.SessionData, sessionID string) error {
	if !sessionData.CreatedAt.IsZero() {
		sessionAge := time.Since(sessionData.CreatedAt)
		if sessionAge >= 8*time.Hour {
			_ = sessionStore.DeleteSession(c.Request.Context(), sessionID)
			httputil.Unauthorized(c, "Session expired")
			return fmt.Errorf("session expired")
		}
	}
	return nil
}

// SetSessionCookieMaxAge sets the session cookie max age for the refresh middleware
func SetSessionCookieMaxAge(maxAgeSeconds int) {
	sessionCookieMaxAge = maxAgeSeconds
}

// SetSessionCookieDomain sets the session cookie domain for the refresh middleware
func SetSessionCookieDomain(domain string) {
	sessionCookieDomain = domain
}

// SetSessionCookieIsProduction sets whether refreshed session cookies require Secure.
func SetSessionCookieIsProduction(isProduction bool) {
	sessionCookieIsProduction = isProduction
}

// SessionRefreshMiddleware refreshes session TTL on successful requests
func SessionRefreshMiddleware(sessionStore platformsession.SessionStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()

		if c.Writer.Status() < 200 || c.Writer.Status() >= 300 {
			return
		}

		sessionID := httputil.GetSessionCookieOrEmpty(c)
		if sessionID == "" {
			return
		}

		if err := sessionStore.RefreshSessionTTL(c.Request.Context(), sessionID); err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}
			platformlogger.WithFields(map[string]interface{}{
				"component": "session_refresh",
				"error":     err,
			}).Warn("Failed to refresh session TTL")
			return
		}

		if sessionCookieMaxAge > 0 {
			httputil.SetAuthCookie(c, httputil.CookieOptions{
				Domain:       sessionCookieDomain,
				IsProduction: sessionCookieIsProduction,
			}, "session_id", sessionID, sessionCookieMaxAge, true)
		}
	}
}

// ValidateSession validates a session and returns session data (used by internal endpoints)
func ValidateSession(c *gin.Context, sessionStore platformsession.SessionStore) (*platformsession.SessionData, string, error) {
	sessionID := httputil.GetSessionCookieOrEmpty(c)
	if sessionID == "" {
		return nil, "", fmt.Errorf("no session cookie")
	}

	sessionData, err := getValidSessionData(c, sessionStore, sessionID)
	if err != nil {
		return nil, sessionID, err
	}

	return sessionData, sessionID, nil
}
