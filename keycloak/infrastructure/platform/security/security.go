package security

import (
	"github.com/gin-gonic/gin"
)

func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")

		if c.Request.TLS != nil || c.Request.Header.Get("X-Forwarded-Proto") == "https" {
			c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}

		csp := "default-src 'self'; " +
			"script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; " +
			"style-src 'self' 'unsafe-inline'; " +
			"img-src 'self' data: https: blob:; " +
			"font-src 'self' data:; " +
			"connect-src 'self' https://nominatim.openstreetmap.org https://basemaps.cartocdn.com https://*.cartocdn.com; " +
			"worker-src 'self' blob:; " +
			"frame-ancestors 'none'; " +
			"base-uri 'self'; " +
			"form-action 'self'; " +
			"object-src 'none'"
		c.Header("Content-Security-Policy", csp)

		c.Header("Permissions-Policy", "geolocation=(), microphone=(), camera=()")

		c.Next()
	}
}
