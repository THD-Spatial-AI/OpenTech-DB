package authhandler

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"platform.local/auth-service/internal/store"
	"platform.local/common/pkg/httputil"
	platformlogger "platform.local/platform/logger"

	"github.com/gin-gonic/gin"
)

const (
	providerStateCookieName   = "oauth_state"
	providerStateCookieMaxAge = 5 * 60
)

var allowedIdentityProviders = map[string]struct{}{
	"github": {},
	"orcid":  {},
}

func randomURLSafe(byteCount int) (string, error) {
	value := make([]byte, byteCount)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func codeChallenge(verifier string) string {
	digest := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func safeReturnTo(value string) string {
	if value == "" || !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") {
		return "/"
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.IsAbs() || parsed.Host != "" {
		return "/"
	}
	return parsed.String()
}

func (a *AuthHandler) callbackURL() string {
	return strings.TrimRight(a.cfg.AppURL, "/") + "/auth/callback"
}

func (a *AuthHandler) setProviderStateCookie(c *gin.Context, stateID string) {
	a.setSecureCookie(c, providerStateCookieName, stateID, providerStateCookieMaxAge, true)
}

func (a *AuthHandler) clearProviderStateCookie(c *gin.Context) {
	httputil.ClearCookieVariants(c, a.cookieOptions(), providerStateCookieName, true)
}

func providerStateMatches(c *gin.Context, expected string) bool {
	if c == nil || c.Request == nil || expected == "" {
		return false
	}
	values := make([]string, 0, 1)
	for _, cookie := range c.Request.Cookies() {
		if cookie.Name == providerStateCookieName && cookie.Value != "" {
			values = append(values, cookie.Value)
		}
	}
	return len(values) == 1 && len(values[0]) == len(expected) &&
		subtle.ConstantTimeCompare([]byte(values[0]), []byte(expected)) == 1
}

// ProviderLogin begins a Keycloak-brokered GitHub or ORCID authorization-code
// flow. State and the PKCE verifier are one-time values stored only in Redis.
func (a *AuthHandler) ProviderLogin(c *gin.Context) {
	provider := strings.ToLower(strings.TrimSpace(c.Param("provider")))
	if _, ok := allowedIdentityProviders[provider]; !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid identity provider"})
		return
	}

	stateID, err := randomURLSafe(32)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not start sign-in"})
		return
	}
	verifier, err := randomURLSafe(32)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not start sign-in"})
		return
	}

	redirectURI := a.callbackURL()
	stateData := store.AuthorizationState{
		CodeVerifier: verifier,
		RedirectURI:  redirectURI,
		ReturnTo:     safeReturnTo(c.Query("return_to")),
		Provider:     provider,
	}
	if err := a.authStore.SetState(c.Request.Context(), stateID, stateData); err != nil {
		platformlogger.WithFields(map[string]any{"component": "provider_login", "error": err}).
			Error("failed to store authorization state")
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "could not start sign-in"})
		return
	}
	a.setProviderStateCookie(c, stateID)

	authorizeURL := fmt.Sprintf(
		"%s/realms/%s/protocol/openid-connect/auth",
		strings.TrimRight(a.cfg.KeycloakPublicURL, "/"),
		url.PathEscape(a.cfg.Auth.Realm),
	)
	query := url.Values{}
	query.Set("client_id", a.cfg.Auth.ClientID)
	query.Set("redirect_uri", redirectURI)
	query.Set("response_type", "code")
	query.Set("scope", "openid profile email roles")
	query.Set("state", stateID)
	query.Set("code_challenge", codeChallenge(verifier))
	query.Set("code_challenge_method", "S256")
	query.Set("kc_idp_hint", provider)

	c.Redirect(http.StatusSeeOther, authorizeURL+"?"+query.Encode())
}

// ProviderCallback completes the one-time authorization flow, creates the
// same opaque Redis session used by password login, and returns to the SPA.
func (a *AuthHandler) ProviderCallback(c *gin.Context) {
	stateID := strings.TrimSpace(c.Query("state"))
	defer a.clearProviderStateCookie(c)
	if !providerStateMatches(c, stateID) {
		a.redirectAuthError(c, "invalid_oauth_state", "/")
		return
	}

	stateData, err := a.authStore.ConsumeState(c.Request.Context(), stateID)
	if err != nil || stateData == nil {
		a.redirectAuthError(c, "invalid_oauth_state", "/")
		return
	}
	if c.Query("error") != "" {
		a.redirectAuthError(c, "keycloak_denied", stateData.ReturnTo)
		return
	}
	code := strings.TrimSpace(c.Query("code"))
	if code == "" {
		a.redirectAuthError(c, "keycloak_denied", stateData.ReturnTo)
		return
	}

	tokens, err := a.exchangeProviderCode(c, code, stateData)
	if err != nil {
		platformlogger.WithFields(map[string]any{"component": "provider_callback", "error": err}).
			Warn("Keycloak authorization-code exchange failed")
		a.redirectAuthError(c, "keycloak_token_exchange", stateData.ReturnTo)
		return
	}
	userInfo, err := a.providerUserInfo(c, tokens.AccessToken)
	if err != nil {
		platformlogger.WithFields(map[string]any{"component": "provider_callback", "error": err}).
			Warn("Keycloak user-info lookup failed")
		a.redirectAuthError(c, "keycloak_token_exchange", stateData.ReturnTo)
		return
	}
	userInfo.AuthProvider = stateData.Provider
	if a.createUserSession(c, userInfo, tokens) == "" {
		a.redirectAuthError(c, "keycloak_token_exchange", stateData.ReturnTo)
		return
	}

	c.Redirect(http.StatusSeeOther, a.frontendDestination(stateData.ReturnTo, ""))
}

func (a *AuthHandler) exchangeProviderCode(
	c *gin.Context,
	code string,
	stateData *store.AuthorizationState,
) (*keycloakTokenResponse, error) {
	tokenURL := fmt.Sprintf(
		"%s/realms/%s/protocol/openid-connect/token",
		strings.TrimRight(a.cfg.Auth.BaseURL, "/"),
		url.PathEscape(a.cfg.Auth.Realm),
	)
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("client_id", a.cfg.Auth.ClientID)
	form.Set("client_secret", a.cfg.Auth.ClientSecret)
	form.Set("code", code)
	form.Set("redirect_uri", stateData.RedirectURI)
	form.Set("code_verifier", stateData.CodeVerifier)

	req, err := http.NewRequestWithContext(
		c.Request.Context(),
		http.MethodPost,
		tokenURL,
		strings.NewReader(form.Encode()),
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
		return nil, fmt.Errorf("Keycloak token endpoint returned status %d", response.StatusCode)
	}

	var tokens keycloakTokenResponse
	if err := json.NewDecoder(response.Body).Decode(&tokens); err != nil {
		return nil, err
	}
	if tokens.AccessToken == "" || tokens.RefreshToken == "" || tokens.ExpiresIn <= 0 {
		return nil, fmt.Errorf("Keycloak token response is incomplete")
	}
	return &tokens, nil
}

func (a *AuthHandler) providerUserInfo(c *gin.Context, accessToken string) (*keycloakUserInfo, error) {
	userInfoURL := fmt.Sprintf(
		"%s/realms/%s/protocol/openid-connect/userinfo",
		strings.TrimRight(a.cfg.Auth.BaseURL, "/"),
		url.PathEscape(a.cfg.Auth.Realm),
	)
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, userInfoURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", authorizationPrefix+accessToken)
	response, err := a.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Keycloak user-info endpoint returned status %d", response.StatusCode)
	}

	var userInfo keycloakUserInfo
	if err := json.NewDecoder(response.Body).Decode(&userInfo); err != nil {
		return nil, err
	}
	if userInfo.Sub == "" || userInfo.PreferredUsername == "" || userInfo.Email == "" {
		return nil, fmt.Errorf("Keycloak identity is missing required standard claims")
	}
	return &userInfo, nil
}

func (a *AuthHandler) redirectAuthError(c *gin.Context, code, returnTo string) {
	c.Redirect(http.StatusSeeOther, a.frontendDestination(returnTo, code))
}

func (a *AuthHandler) frontendDestination(returnTo, errorCode string) string {
	base, _ := url.Parse(a.cfg.FrontendURL)
	reference, _ := url.Parse(safeReturnTo(returnTo))
	destination := base.ResolveReference(reference)
	if errorCode != "" {
		query := destination.Query()
		query.Set("auth_error", errorCode)
		destination.RawQuery = query.Encode()
	}
	return destination.String()
}
