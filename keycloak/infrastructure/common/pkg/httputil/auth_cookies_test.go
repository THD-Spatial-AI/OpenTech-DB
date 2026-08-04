package httputil

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCookieDeletionDomainsIncludesConfiguredAndRequestHost(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "http://app.example.com/api", nil)

	got := CookieDeletionDomains(c, "Example.com.")
	want := []string{"", "example.com", "app.example.com"}

	if len(got) != len(want) {
		t.Fatalf("domains = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("domains = %v, want %v", got, want)
		}
	}
}

func TestNormalizedCookieDomainDropsLocalhostAndIP(t *testing.T) {
	for _, domain := range []string{"", "localhost", "127.0.0.1", "::1"} {
		if got := NormalizedCookieDomain(domain); got != "" {
			t.Fatalf("NormalizedCookieDomain(%q) = %q, want empty", domain, got)
		}
	}
	if got := NormalizedCookieDomain("Example.com."); got != "example.com" {
		t.Fatalf("NormalizedCookieDomain = %q, want example.com", got)
	}
}

func TestSetAuthCookieUsesExpectedDefaults(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "http://localhost/api", nil)

	SetAuthCookie(c, CookieOptions{Domain: "localhost"}, "session_id", "sid", 3600, true)

	cookie := w.Result().Cookies()[0]
	if cookie.Domain != "" || cookie.Path != "/" || cookie.SameSite != http.SameSiteStrictMode || cookie.Secure {
		t.Fatalf("cookie = %#v", cookie)
	}
}
