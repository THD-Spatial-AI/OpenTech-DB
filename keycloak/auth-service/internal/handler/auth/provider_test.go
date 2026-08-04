package authhandler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"platform.local/auth-service/internal/config"

	"github.com/gin-gonic/gin"
)

func TestCodeChallengeRFC7636Vector(t *testing.T) {
	verifier := "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	want := "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
	if got := codeChallenge(verifier); got != want {
		t.Fatalf("codeChallenge() = %q, want %q", got, want)
	}
}

func TestSafeReturnToRejectsExternalDestinations(t *testing.T) {
	tests := map[string]string{
		"":                             "/",
		"/profile?tab=security#active": "/profile?tab=security#active",
		"//evil.example/steal":         "/",
		"https://evil.example/steal":   "/",
		"javascript:alert(1)":          "/",
	}
	for input, want := range tests {
		if got := safeReturnTo(input); got != want {
			t.Errorf("safeReturnTo(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestFrontendDestinationStaysOnConfiguredFrontend(t *testing.T) {
	handler := &AuthHandler{cfg: &config.Config{FrontendURL: "https://app.example.org"}}
	got := handler.frontendDestination("//evil.example/steal", "invalid_oauth_state")
	want := "https://app.example.org/?auth_error=invalid_oauth_state"
	if got != want {
		t.Fatalf("frontendDestination() = %q, want %q", got, want)
	}
}

func TestProviderStateMustMatchSingleBrowserCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name     string
		cookies  []*http.Cookie
		expected string
		want     bool
	}{
		{name: "matching", cookies: []*http.Cookie{{Name: providerStateCookieName, Value: "state-123"}}, expected: "state-123", want: true},
		{name: "missing", expected: "state-123", want: false},
		{name: "different", cookies: []*http.Cookie{{Name: providerStateCookieName, Value: "other"}}, expected: "state-123", want: false},
		{name: "duplicate", cookies: []*http.Cookie{{Name: providerStateCookieName, Value: "state-123"}, {Name: providerStateCookieName, Value: "state-123"}}, expected: "state-123", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			context, _ := gin.CreateTestContext(httptest.NewRecorder())
			context.Request = httptest.NewRequest(http.MethodGet, "http://localhost/api/auth/callback", nil)
			for _, cookie := range test.cookies {
				context.Request.AddCookie(cookie)
			}
			if got := providerStateMatches(context, test.expected); got != test.want {
				t.Fatalf("providerStateMatches() = %v, want %v", got, test.want)
			}
		})
	}
}
