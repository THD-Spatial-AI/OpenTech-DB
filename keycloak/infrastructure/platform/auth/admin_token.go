package auth

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// AdminTokenProvider manages admin access tokens for Keycloak with thread-safe caching
type AdminTokenProvider struct {
	baseURL      string
	realm        string
	clientID     string
	clientSecret string
	token        string
	expiry       time.Time
	mu           sync.RWMutex
}

func NewAdminTokenProvider(baseURL, realm, clientID, clientSecret string) *AdminTokenProvider {
	return &AdminTokenProvider{
		baseURL:      baseURL,
		realm:        realm,
		clientID:     clientID,
		clientSecret: clientSecret,
	}
}

func (p *AdminTokenProvider) GetToken() (string, error) {
	// Fast path: read lock to check cache
	p.mu.RLock()
	if p.token != "" && time.Now().Before(p.expiry) {
		token := p.token
		p.mu.RUnlock()
		return token, nil
	}
	p.mu.RUnlock()

	// Slow path: write lock to fetch new token
	p.mu.Lock()
	defer p.mu.Unlock()

	// Double-check: another goroutine might have fetched while we waited
	if p.token != "" && time.Now().Before(p.expiry) {
		return p.token, nil
	}

	// Fetch new token
	if p.clientSecret == "" {
		return "", fmt.Errorf("missing client secret for admin token")
	}

	// Trim trailing slash from BaseURL
	baseURL := p.baseURL
	if len(baseURL) > 0 && baseURL[len(baseURL)-1] == '/' {
		baseURL = baseURL[:len(baseURL)-1]
	}

	tokenURL := fmt.Sprintf("%s/realms/%s/protocol/openid-connect/token", baseURL, p.realm)
	formData := fmt.Sprintf("grant_type=client_credentials&client_id=%s&client_secret=%s",
		p.clientID, p.clientSecret)

	req, err := http.NewRequest("POST", tokenURL, bytes.NewBufferString(formData))
	if err != nil {
		return "", fmt.Errorf("failed to create token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to fetch admin token: %w", err)
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("admin token request failed with status %d", resp.StatusCode)
	}

	var tokenResponse struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&tokenResponse); err != nil {
		return "", fmt.Errorf("failed to decode token response: %w", err)
	}

	if tokenResponse.AccessToken == "" {
		return "", fmt.Errorf("received empty access token")
	}

	// Cache token with 60s buffer before expiration
	p.token = tokenResponse.AccessToken
	expiresIn := tokenResponse.ExpiresIn
	if expiresIn > 60 {
		expiresIn -= 60 // buffer 60s early expiration
	}
	p.expiry = time.Now().Add(time.Duration(expiresIn) * time.Second)

	return p.token, nil
}

func (p *AdminTokenProvider) Invalidate() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.token = ""
	p.expiry = time.Time{}
}
