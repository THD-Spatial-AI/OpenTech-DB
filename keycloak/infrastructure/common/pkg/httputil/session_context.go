package httputil

import (
	"net/http"

	platformsession "platform.local/platform/session"

	"github.com/gin-gonic/gin"
)

const sessionIDCookieName = "session_id"

// GetSessionFromContext retrieves session data from context (set by auth middleware)
func GetSessionFromContext(c *gin.Context) (*platformsession.SessionData, bool) {
	sessionData, exists := c.Get("session_data")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Session not found in context"})
		c.Abort()
		return nil, false
	}

	session, ok := sessionData.(*platformsession.SessionData)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid session data"})
		c.Abort()
		return nil, false
	}

	return session, true
}

// Legacy compatibility - now gets session from context instead of store
func GetSessionOrAbort(c *gin.Context, _ interface{}) (*platformsession.SessionData, bool) {
	return GetSessionFromContext(c)
}

// GetSessionCookie retrieves the session_id cookie from the request
func GetSessionCookie(c *gin.Context) (string, error) {
	values := GetSessionCookieValues(c)
	if len(values) != 1 {
		return "", http.ErrNoCookie
	}
	return values[0], nil
}

// GetSessionCookieOrEmpty retrieves the session_id cookie, returns empty string if not found
func GetSessionCookieOrEmpty(c *gin.Context) string {
	sessionID, _ := GetSessionCookie(c)
	return sessionID
}

// GetSessionCookieValues returns every session_id cookie value in browser order.
func GetSessionCookieValues(c *gin.Context) []string {
	if c == nil || c.Request == nil {
		return nil
	}

	values := make([]string, 0, 1)
	for _, cookie := range c.Request.Cookies() {
		if cookie.Name == sessionIDCookieName && cookie.Value != "" {
			values = append(values, cookie.Value)
		}
	}
	return values
}

// SetSessionContext sets user data in gin context from session data
func SetSessionContext(c *gin.Context, sessionData *platformsession.SessionData) {
	c.Set("session_data", sessionData)
	c.Set("user_id", sessionData.UserID)
	if sessionData.UserInfoData != nil {
		c.Set("user_name", sessionData.UserInfoData.Username)
	}
}
