package server

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

const (
	httpScheme  = "http://"
	httpsScheme = "https://"
)

// InitGin creates a Gin Engine with recovery and trusted proxy configuration.
func InitGin(trustedProxies []string, middleware ...gin.HandlerFunc) (*gin.Engine, error) {
	r := gin.New()
	err := r.SetTrustedProxies(trustedProxies)
	r.Use(gin.Recovery())
	for _, m := range middleware {
		if m != nil {
			r.Use(m)
		}
	}
	return r, err
}

// HTTPServerConfig provides common knobs for HTTP server creation.
type HTTPServerConfig struct {
	Addr              string
	Handler           http.Handler
	ReadHeaderTimeout time.Duration
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
}

// NewHTTPServer creates an http.Server with sensible defaults.
func NewHTTPServer(cfg HTTPServerConfig) *http.Server {
	readHeader := cfg.ReadHeaderTimeout
	if readHeader == 0 {
		readHeader = 10 * time.Second
	}

	readTimeout := cfg.ReadTimeout
	if readTimeout == 0 {
		readTimeout = 30 * time.Second
	}

	writeTimeout := cfg.WriteTimeout
	if writeTimeout == 0 {
		writeTimeout = 30 * time.Second
	}

	idleTimeout := cfg.IdleTimeout
	if idleTimeout == 0 {
		idleTimeout = 90 * time.Second
	}

	return &http.Server{
		Addr:              cfg.Addr,
		Handler:           cfg.Handler,
		ReadHeaderTimeout: readHeader,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
	}
}

// RunWithGracefulShutdown starts the HTTP server and listens for termination
// signals to shut it down gracefully within the provided timeout.
func RunWithGracefulShutdown(srv *http.Server, log logrus.FieldLogger, shutdownTimeout time.Duration) {
	if shutdownTimeout <= 0 {
		shutdownTimeout = 10 * time.Second
	}

	go func() {
		log.WithFields(logrus.Fields{"addr": srv.Addr}).Info("HTTP server starting")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Info("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Errorf("Server forced to shutdown: %v", err)
		return
	}

	log.Info("Server exited gracefully")
}

// HealthHandler returns a Gin handler that reports a consistent health payload.
func HealthHandler(service string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "healthy",
			"service": service,
			"time":    time.Now().Format(time.RFC3339),
		})
	}
}

// URL uses http or https
func BuildCORSOrigins(appURL string, extra ...string) []string {
	origins := []string{
		"http://localhost:3000",
		"http://localhost:5173",
	}

	origins = append(origins, extra...)

	normalized := make([]string, 0, len(origins)+2)
	seen := make(map[string]struct{})

	add := func(value string) {
		v := strings.TrimSpace(value)
		if v == "" {
			return
		}
		if _, ok := seen[v]; ok {
			return
		}
		seen[v] = struct{}{}
		normalized = append(normalized, v)
	}

	for _, origin := range origins {
		add(origin)
		if alt := alternateScheme(origin); alt != "" {
			add(alt)
		}
	}

	add(appURL)
	if alt := alternateScheme(appURL); alt != "" {
		add(alt)
	}

	return normalized
}

func alternateScheme(value string) string {
	switch {
	case strings.HasPrefix(value, httpScheme):
		return httpsScheme + strings.TrimPrefix(value, httpScheme)
	case strings.HasPrefix(value, httpsScheme):
		return httpScheme + strings.TrimPrefix(value, httpsScheme)
	default:
		return ""
	}
}
