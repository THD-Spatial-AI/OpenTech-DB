package authhandler

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"platform.local/auth-service/internal/config"
	"platform.local/auth-service/internal/middleware"
	"platform.local/auth-service/internal/store"
	"platform.local/common/pkg/httputil"
	utils "platform.local/common/pkg/utils"
	platformauth "platform.local/platform/auth"
	platformlogger "platform.local/platform/logger"
	platformsession "platform.local/platform/session"

	"github.com/gin-gonic/gin"
)

const authorizationPrefix = "Bearer "

type AuthHandler struct {
	cfg                *config.Config
	sessionStore       platformsession.SessionStore
	authStore          store.AuthStore
	adminTokenProvider *platformauth.AdminTokenProvider
	httpClient         *http.Client
	loginLockout       LoginLockout
}

type LoginLockout interface {
	RecordFailedAttempt(identifier string) (shouldLock bool, lockedUntil time.Time, attemptsRemaining int)
	IsLocked(identifier string) (bool, time.Time)
	ResetAttempts(identifier string)
	GetAttemptCount(identifier string) int
}

type keycloakUserInfo struct {
	Sub               string         `json:"sub"`
	PreferredUsername string         `json:"preferred_username"`
	Email             string         `json:"email"`
	RealmAccess       map[string]any `json:"realm_access"`
	AuthProvider      string         `json:"-"`
}

type keycloakTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
}

func New(
	cfg *config.Config,
	sessionStore platformsession.SessionStore,
	authStore store.AuthStore,
	adminTokenProvider *platformauth.AdminTokenProvider,
	loginLockout LoginLockout,
) *AuthHandler {
	return &AuthHandler{
		cfg:                cfg,
		sessionStore:       sessionStore,
		authStore:          authStore,
		adminTokenProvider: adminTokenProvider,
		loginLockout:       loginLockout,
		httpClient:         utils.NewDefaultHTTPClient(),
	}
}

func generateSecureSessionID() string {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(value)
}

func applicationRoles(realmAccess map[string]any) []string {
	allowed := map[string]bool{"contributor": true, "admin": true}
	roles := make([]string, 0, 2)
	rawRoles, ok := realmAccess["roles"]
	if !ok {
		return roles
	}

	appendRole := func(value string) {
		if !allowed[value] {
			return
		}
		for _, existing := range roles {
			if existing == value {
				return
			}
		}
		roles = append(roles, value)
	}

	switch values := rawRoles.(type) {
	case []any:
		for _, value := range values {
			if role, ok := value.(string); ok {
				appendRole(role)
			}
		}
	case []string:
		for _, role := range values {
			appendRole(role)
		}
	}
	sort.Strings(roles)
	return roles
}

func roleEnabled(roles []string, expected string) bool {
	for _, role := range roles {
		if role == expected {
			return true
		}
	}
	return false
}

func normalizedAuthProvider(provider string) string {
	switch provider {
	case "github", "orcid":
		return provider
	default:
		return "keycloak"
	}
}

func (a *AuthHandler) setSecureCookie(
	c *gin.Context,
	name string,
	value string,
	maxAge int,
	httpOnly bool,
) {
	httputil.SetAuthCookie(c, a.cookieOptions(), name, value, maxAge, httpOnly)
}

func (a *AuthHandler) setLoginCookies(c *gin.Context, sessionID string) {
	cookieMaxAge := a.cfg.SessionTTLMinutes * 60
	a.clearAuthCookies(c)
	a.setSecureCookie(c, "session_id", sessionID, cookieMaxAge, true)
	a.setSecureCookie(c, "csrf_token", middleware.GenerateCSRFToken(), cookieMaxAge, false)
}

func (a *AuthHandler) clearAuthCookies(c *gin.Context) {
	httputil.ClearAuthCookies(c, a.cookieOptions())
}

func (a *AuthHandler) cookieOptions() httputil.CookieOptions {
	return httputil.CookieOptions{
		Domain:       a.cfg.CookieDomain,
		IsProduction: a.cfg.AppEnv == "production",
	}
}

func (a *AuthHandler) Login(c *gin.Context) {
	var loginData struct {
		Username string `json:"username" binding:"required"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&loginData); err != nil {
		httputil.BadRequest(c, "username and password are required")
		return
	}

	identifier := strings.ToLower(strings.TrimSpace(loginData.Username))
	if a.checkLoginLockout(c, identifier) {
		return
	}

	tokenResponse, errorHandled := a.authenticateWithKeycloak(c, identifier, loginData.Password)
	if tokenResponse == nil {
		if !errorHandled {
			a.handleFailedLogin(c, identifier)
		}
		return
	}

	userInfo, ok := a.fetchUserInfo(c, tokenResponse.AccessToken)
	if !ok {
		return
	}

	sessionID := a.createUserSession(c, userInfo, tokenResponse)
	if sessionID == "" {
		httputil.InternalError(c, "failed to create secure session")
		return
	}
	if a.loginLockout != nil {
		a.loginLockout.ResetAttempts(identifier)
	}
	a.sendLoginSuccessResponse(c, userInfo)
}

func (a *AuthHandler) checkLoginLockout(c *gin.Context, identifier string) bool {
	if a.loginLockout == nil {
		return false
	}
	isLocked, lockedUntil := a.loginLockout.IsLocked(identifier)
	if !isLocked {
		return false
	}
	remainingTime := time.Until(lockedUntil)
	httputil.ErrorResponse(c, http.StatusTooManyRequests, fmt.Sprintf(
		"Account temporarily locked. Please try again in %d minutes.",
		int(remainingTime.Minutes())+1,
	))
	return true
}

func (a *AuthHandler) authenticateWithKeycloak(
	c *gin.Context,
	username string,
	password string,
) (*keycloakTokenResponse, bool) {
	tokenURL := fmt.Sprintf(
		"%s/realms/%s/protocol/openid-connect/token",
		strings.TrimRight(a.cfg.Auth.BaseURL, "/"),
		a.cfg.Auth.Realm,
	)
	formData := url.Values{}
	formData.Set("grant_type", "password")
	formData.Set("client_id", a.cfg.Auth.ClientID)
	formData.Set("client_secret", a.cfg.Auth.ClientSecret)
	formData.Set("username", username)
	formData.Set("password", password)
	formData.Set("scope", "openid profile email roles")

	resp, err := a.httpClient.Post(
		tokenURL,
		"application/x-www-form-urlencoded",
		strings.NewReader(formData.Encode()),
	)
	if err != nil {
		platformlogger.WithFields(map[string]any{"component": "auth", "error": err}).
			Error("failed to connect to Keycloak")
		httputil.BadGateway(c, "failed to connect to authentication server")
		return nil, true
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, a.handleKeycloakAuthError(c, resp)
	}

	var tokenResponse keycloakTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResponse); err != nil {
		httputil.InternalError(c, "failed to parse authentication response")
		return nil, true
	}
	if tokenResponse.AccessToken == "" || tokenResponse.RefreshToken == "" {
		httputil.InternalError(c, "authentication response is incomplete")
		return nil, true
	}
	return &tokenResponse, false
}

func (a *AuthHandler) handleKeycloakAuthError(c *gin.Context, resp *http.Response) bool {
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8*1024))
	var errorResponse struct {
		ErrorDescription string `json:"error_description"`
	}
	_ = json.Unmarshal(body, &errorResponse)
	description := strings.ToLower(errorResponse.ErrorDescription)
	if strings.Contains(description, "disabled") {
		httputil.Forbidden(c, "Your account has been disabled.")
		return true
	}
	return false
}

func (a *AuthHandler) handleFailedLogin(c *gin.Context, identifier string) {
	if a.loginLockout == nil {
		httputil.Unauthorized(c, "Invalid username or password")
		return
	}
	shouldLock, _, attemptsRemaining := a.loginLockout.RecordFailedAttempt(identifier)
	if shouldLock {
		httputil.ErrorResponse(
			c,
			http.StatusTooManyRequests,
			"Too many failed login attempts. Account locked for 15 minutes.",
		)
		return
	}
	if attemptsRemaining <= 2 && attemptsRemaining > 0 {
		httputil.ErrorResponse(c, http.StatusUnauthorized, fmt.Sprintf(
			"Invalid username or password. %d attempts remaining.",
			attemptsRemaining,
		))
		return
	}
	httputil.Unauthorized(c, "Invalid username or password")
}

func (a *AuthHandler) fetchUserInfo(
	c *gin.Context,
	accessToken string,
) (*keycloakUserInfo, bool) {
	userInfoURL := fmt.Sprintf(
		"%s/realms/%s/protocol/openid-connect/userinfo",
		strings.TrimRight(a.cfg.Auth.BaseURL, "/"),
		a.cfg.Auth.Realm,
	)
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, userInfoURL, nil)
	if err != nil {
		httputil.InternalError(c, "failed to create user-info request")
		return nil, false
	}
	req.Header.Set("Authorization", authorizationPrefix+accessToken)

	userResp, err := a.httpClient.Do(req)
	if err != nil {
		httputil.BadGateway(c, "failed to get user information")
		return nil, false
	}
	defer func() { _ = userResp.Body.Close() }()
	if userResp.StatusCode != http.StatusOK {
		httputil.Unauthorized(c, "failed to validate authenticated user")
		return nil, false
	}

	var userInfo keycloakUserInfo
	if err := json.NewDecoder(userResp.Body).Decode(&userInfo); err != nil {
		httputil.InternalError(c, "failed to parse user information")
		return nil, false
	}
	if userInfo.Sub == "" || userInfo.PreferredUsername == "" || userInfo.Email == "" {
		httputil.Unauthorized(c, "Keycloak identity is missing required standard claims")
		return nil, false
	}
	return &userInfo, true
}

func (a *AuthHandler) createUserSession(
	c *gin.Context,
	userInfo *keycloakUserInfo,
	tokenResponse *keycloakTokenResponse,
) string {
	sessionID := generateSecureSessionID()
	if sessionID == "" {
		return ""
	}
	sessionData := &platformsession.SessionData{
		UserID: userInfo.Sub,
		UserInfoData: &platformsession.UserInfoData{
			Username:     userInfo.PreferredUsername,
			Email:        userInfo.Email,
			AuthProvider: normalizedAuthProvider(userInfo.AuthProvider),
		},
		AccessToken:    tokenResponse.AccessToken,
		RefreshToken:   tokenResponse.RefreshToken,
		TokenExpiresAt: time.Now().Add(time.Duration(tokenResponse.ExpiresIn) * time.Second),
		Roles:          applicationRoles(userInfo.RealmAccess),
	}
	if err := a.sessionStore.SaveSession(c, sessionID, sessionData); err != nil {
		return ""
	}
	a.setLoginCookies(c, sessionID)
	return sessionID
}

func (a *AuthHandler) sendLoginSuccessResponse(c *gin.Context, userInfo *keycloakUserInfo) {
	roles := applicationRoles(userInfo.RealmAccess)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"user": gin.H{
			"id":             userInfo.Sub,
			"username":       userInfo.PreferredUsername,
			"email":          userInfo.Email,
			"avatar_url":     nil,
			"auth_provider":  normalizedAuthProvider(userInfo.AuthProvider),
			"roles":          roles,
			"realm":          a.cfg.Auth.Realm,
			"is_contributor": roleEnabled(roles, "contributor") || roleEnabled(roles, "admin"),
			"is_admin":       roleEnabled(roles, "admin"),
		},
		"session": gin.H{"timeout_minutes": a.cfg.SessionTTLMinutes},
	})
}

func (a *AuthHandler) RefreshToken(c *gin.Context) {
	sessionData, ok := httputil.GetSessionOrAbort(c, a.sessionStore)
	if !ok {
		return
	}
	sessionID := httputil.GetSessionCookieOrEmpty(c)
	if sessionData.RefreshToken == "" {
		httputil.Unauthorized(c, "No refresh token available")
		return
	}

	newToken, err := a.refreshKeycloakToken(c, sessionData.RefreshToken)
	if err != nil {
		_ = a.sessionStore.DeleteSession(c, sessionID)
		a.clearAuthCookies(c)
		httputil.Unauthorized(c, "Session expired")
		return
	}

	sessionData.AccessToken = newToken.AccessToken
	if newToken.RefreshToken != "" {
		sessionData.RefreshToken = newToken.RefreshToken
	}
	sessionData.TokenExpiresAt = time.Now().Add(time.Duration(newToken.ExpiresIn) * time.Second)
	if userInfo, ok := a.fetchUserInfo(c, newToken.AccessToken); ok {
		sessionData.UserID = userInfo.Sub
		sessionData.UserInfoData.Username = userInfo.PreferredUsername
		sessionData.UserInfoData.Email = userInfo.Email
		sessionData.Roles = applicationRoles(userInfo.RealmAccess)
	} else {
		_ = a.sessionStore.DeleteSession(c, sessionID)
		a.clearAuthCookies(c)
		return
	}
	if err := a.sessionStore.SaveSession(c, sessionID, sessionData); err != nil {
		httputil.InternalError(c, "Failed to save refreshed session")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// RefreshSessionIfNeeded refreshes expired/near-expiry Keycloak tokens and
// reloads realm roles before another service authorizes the session. This
// prevents a revoked admin role from remaining effective for the Redis TTL.
func (a *AuthHandler) RefreshSessionIfNeeded(
	c *gin.Context,
	sessionData *platformsession.SessionData,
	sessionID string,
) bool {
	if sessionData == nil || sessionID == "" {
		httputil.Unauthorized(c, "Invalid session")
		return false
	}
	if !sessionData.TokenExpiresAt.IsZero() &&
		time.Until(sessionData.TokenExpiresAt) > tokenRefreshThreshold {
		return true
	}
	if sessionData.RefreshToken == "" {
		_ = a.sessionStore.DeleteSession(c, sessionID)
		a.clearAuthCookies(c)
		httputil.Unauthorized(c, "Session expired")
		return false
	}

	newToken, err := a.refreshKeycloakToken(c, sessionData.RefreshToken)
	if err != nil {
		_ = a.sessionStore.DeleteSession(c, sessionID)
		a.clearAuthCookies(c)
		httputil.Unauthorized(c, "Session expired")
		return false
	}
	userInfo, ok := a.fetchUserInfo(c, newToken.AccessToken)
	if !ok {
		_ = a.sessionStore.DeleteSession(c, sessionID)
		a.clearAuthCookies(c)
		return false
	}

	sessionData.UserID = userInfo.Sub
	if sessionData.UserInfoData == nil {
		sessionData.UserInfoData = &platformsession.UserInfoData{}
	}
	sessionData.UserInfoData.Username = userInfo.PreferredUsername
	sessionData.UserInfoData.Email = userInfo.Email
	sessionData.AccessToken = newToken.AccessToken
	if newToken.RefreshToken != "" {
		sessionData.RefreshToken = newToken.RefreshToken
	}
	sessionData.TokenExpiresAt = time.Now().Add(time.Duration(newToken.ExpiresIn) * time.Second)
	sessionData.Roles = applicationRoles(userInfo.RealmAccess)
	if err := a.sessionStore.SaveSession(c, sessionID, sessionData); err != nil {
		httputil.InternalError(c, "Failed to save refreshed session")
		return false
	}
	return true
}

func (a *AuthHandler) RefreshClaimsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		sessionData, ok := httputil.GetSessionFromContext(c)
		if !ok {
			return
		}
		sessionID := httputil.GetSessionCookieOrEmpty(c)
		if !a.RefreshSessionIfNeeded(c, sessionData, sessionID) {
			c.Abort()
			return
		}
		c.Next()
	}
}

func (a *AuthHandler) refreshKeycloakToken(
	c *gin.Context,
	refreshToken string,
) (*keycloakTokenResponse, error) {
	tokenURL := fmt.Sprintf(
		"%s/realms/%s/protocol/openid-connect/token",
		strings.TrimRight(a.cfg.Auth.BaseURL, "/"),
		a.cfg.Auth.Realm,
	)
	formData := url.Values{}
	formData.Set("grant_type", "refresh_token")
	formData.Set("client_id", a.cfg.Auth.ClientID)
	formData.Set("client_secret", a.cfg.Auth.ClientSecret)
	formData.Set("refresh_token", refreshToken)
	req, err := http.NewRequestWithContext(
		c.Request.Context(),
		http.MethodPost,
		tokenURL,
		strings.NewReader(formData.Encode()),
	)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := a.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Keycloak refresh returned status %d", response.StatusCode)
	}
	var tokenResponse keycloakTokenResponse
	if err := json.NewDecoder(response.Body).Decode(&tokenResponse); err != nil {
		return nil, err
	}
	if tokenResponse.AccessToken == "" || tokenResponse.ExpiresIn <= 0 {
		return nil, fmt.Errorf("Keycloak refresh response is incomplete")
	}
	return &tokenResponse, nil
}

const tokenRefreshThreshold = time.Minute

func (a *AuthHandler) KeepAlive(c *gin.Context) {
	sessionData, ok := httputil.GetSessionOrAbort(c, a.sessionStore)
	if !ok {
		return
	}
	if !sessionData.TokenExpiresAt.IsZero() &&
		time.Until(sessionData.TokenExpiresAt) > tokenRefreshThreshold {
		c.JSON(http.StatusOK, gin.H{"success": true})
		return
	}
	a.RefreshToken(c)
}

func (a *AuthHandler) Logout(c *gin.Context) {
	for _, sessionID := range httputil.GetSessionCookieValues(c) {
		if sessionData, err := a.sessionStore.GetSession(c.Request.Context(), sessionID); err == nil && sessionData != nil {
			if err := a.revokeKeycloakSession(c, sessionData.RefreshToken); err != nil {
				platformlogger.WithFields(map[string]any{"component": "logout", "error": err}).
					Warn("failed to revoke Keycloak session")
			}
		}
		_ = a.sessionStore.DeleteSession(c, sessionID)
	}
	a.clearAuthCookies(c)
	httputil.SuccessMessage(c, "logged out")
}

func (a *AuthHandler) revokeKeycloakSession(c *gin.Context, refreshToken string) error {
	if refreshToken == "" {
		return nil
	}
	logoutURL := fmt.Sprintf(
		"%s/realms/%s/protocol/openid-connect/logout",
		strings.TrimRight(a.cfg.Auth.BaseURL, "/"),
		url.PathEscape(a.cfg.Auth.Realm),
	)
	formData := url.Values{}
	formData.Set("client_id", a.cfg.Auth.ClientID)
	formData.Set("client_secret", a.cfg.Auth.ClientSecret)
	formData.Set("refresh_token", refreshToken)
	requestContext, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(
		requestContext,
		http.MethodPost,
		logoutURL,
		strings.NewReader(formData.Encode()),
	)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := a.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusNoContent && response.StatusCode != http.StatusOK {
		return fmt.Errorf("Keycloak logout returned status %d", response.StatusCode)
	}
	return nil
}
