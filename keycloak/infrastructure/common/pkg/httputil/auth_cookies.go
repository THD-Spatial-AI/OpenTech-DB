package httputil

import (
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	csrfTokenCookieName = "csrf_token"
)

type CookieOptions struct {
	Domain       string
	IsProduction bool
}

func SetAuthCookie(c *gin.Context, opts CookieOptions, name, value string, maxAge int, httpOnly bool) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     name,
		Value:    value,
		MaxAge:   maxAge,
		Path:     "/",
		Domain:   NormalizedCookieDomain(opts.Domain),
		Secure:   ShouldUseSecureCookie(c, opts.IsProduction),
		HttpOnly: httpOnly,
		SameSite: SameSiteForCookie(name),
	})
}

func ClearAuthCookies(c *gin.Context, opts CookieOptions) {
	ClearCookieVariants(c, opts, sessionIDCookieName, true)
	ClearCookieVariants(c, opts, csrfTokenCookieName, false)
}

func ClearCookieVariants(c *gin.Context, opts CookieOptions, name string, httpOnly bool) {
	for _, domain := range CookieDeletionDomains(c, opts.Domain) {
		http.SetCookie(c.Writer, &http.Cookie{
			Name:     name,
			Value:    "",
			MaxAge:   -1,
			Expires:  time.Unix(0, 0),
			Path:     "/",
			Domain:   domain,
			Secure:   ShouldUseSecureCookie(c, opts.IsProduction),
			HttpOnly: httpOnly,
			SameSite: SameSiteForCookie(name),
		})
	}
}

func CookieDeletionDomains(c *gin.Context, configuredDomain string) []string {
	domains := []string{""}
	seen := map[string]struct{}{"": {}}
	addDomain := func(domain string) {
		domain = NormalizedCookieDomain(domain)
		if _, ok := seen[domain]; ok {
			return
		}
		seen[domain] = struct{}{}
		domains = append(domains, domain)
	}

	addDomain(configuredDomain)
	if c != nil && c.Request != nil {
		addDomain(RequestHostCookieDomain(c.Request.Host))
	}

	return domains
}

func SameSiteForCookie(name string) http.SameSite {
	if name == sessionIDCookieName {
		return http.SameSiteStrictMode
	}
	return http.SameSiteLaxMode
}

func NormalizedCookieDomain(domain string) string {
	domain = strings.TrimSpace(strings.ToLower(strings.TrimSuffix(domain, ".")))
	if domain == "" || domain == "localhost" || net.ParseIP(domain) != nil {
		return ""
	}
	return domain
}

func RequestHostCookieDomain(host string) string {
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	return NormalizedCookieDomain(host)
}

func ShouldUseSecureCookie(c *gin.Context, isProduction bool) bool {
	if isProduction {
		return true
	}
	if c == nil || c.Request == nil {
		return false
	}
	return c.Request.Header.Get("X-Forwarded-Proto") == "https" || c.Request.TLS != nil
}
