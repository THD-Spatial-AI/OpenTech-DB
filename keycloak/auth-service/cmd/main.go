package main

import (
	"context"
	"crypto/subtle"
	"fmt"
	"net/http"
	"strings"
	"time"

	"platform.local/auth-service/internal/config"
	authhandler "platform.local/auth-service/internal/handler/auth"
	"platform.local/auth-service/internal/middleware"
	authredis "platform.local/auth-service/internal/store/redis"
	"platform.local/common/pkg/httputil"
	platformauth "platform.local/platform/auth"
	platformconfig "platform.local/platform/config"
	platformlogger "platform.local/platform/logger"
	platformsecurity "platform.local/platform/security"
	platformserver "platform.local/platform/server"
	platformsession "platform.local/platform/session"
	redisstore "platform.local/platform/session/redis"

	"github.com/gin-gonic/gin"
	goredis "github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"
)

const maxAuthRequestBytes int64 = 1 << 20

func main() {
	gin.SetMode(gin.ReleaseMode)

	if err := platformlogger.Init("logs", "opentech-auth-service"); err != nil {
		panic(fmt.Sprintf("failed to init logger: %v", err))
	}
	log := platformlogger.Logger

	cfg, err := config.LoadFromEnv()
	if err != nil {
		log.Fatalf("failed to load auth configuration: %v", err)
	}

	platformconfig.SetupTimezone(cfg.AppTimezone, log)
	serverAddr := fmt.Sprintf("%s:%s", cfg.AppHost, cfg.AppPort)

	appDeps := initializeInfrastructure(cfg, log)
	defer appDeps.Close()

	router := setupGinEngine(cfg, log)
	authHandler := initializeAuthHandler(cfg, appDeps)
	configureAuthRoutes(router, cfg, appDeps, authHandler)

	server := platformserver.NewHTTPServer(platformserver.HTTPServerConfig{
		Addr:    serverAddr,
		Handler: router,
	})
	platformserver.RunWithGracefulShutdown(server, log, 5*time.Second)
}

type AppDependencies struct {
	RedisClient        *goredis.Client
	AdminTokenProvider *platformauth.AdminTokenProvider
}

func (d *AppDependencies) Close() {
	if d.RedisClient != nil {
		_ = d.RedisClient.Close()
	}
}

func initializeInfrastructure(cfg *config.Config, log *logrus.Logger) *AppDependencies {
	ctx := context.Background()
	redisClient := goredis.NewClient(&cfg.RedisConfig)
	if err := redisClient.Ping(ctx).Err(); err != nil {
		log.Fatalf("failed to connect to Redis: %v", err)
	}
	log.WithField("component", "startup").Info("Redis connection successful")

	return &AppDependencies{
		RedisClient: redisClient,
		AdminTokenProvider: platformauth.NewAdminTokenProvider(
			cfg.Auth.BaseURL,
			cfg.Auth.Realm,
			cfg.Auth.ClientID,
			cfg.Auth.ClientSecret,
		),
	}
}

func setupGinEngine(cfg *config.Config, log *logrus.Logger) *gin.Engine {
	trustedProxies := []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"}
	router, err := platformserver.InitGin(trustedProxies, platformsecurity.SecurityHeaders())
	if err != nil {
		log.Warnf("failed to set trusted proxies: %v", err)
	}

	middleware.SetCSRFConfig(&middleware.CSRFConfig{
		CookieDomain:        cfg.CookieDomain,
		CookieMaxAge:        cfg.SessionTTLMinutes * 60,
		IsProduction:        cfg.AppEnv == "production",
		EnableRotation:      true,
		RotationGracePeriod: 5 * time.Second,
	})
	middleware.SetSessionCookieMaxAge(cfg.SessionTTLMinutes * 60)
	middleware.SetSessionCookieDomain(cfg.CookieDomain)
	middleware.SetSessionCookieIsProduction(cfg.AppEnv == "production")
	return router
}

func initializeAuthHandler(
	cfg *config.Config,
	deps *AppDependencies,
) *authhandler.AuthHandler {
	sessionStore := redisstore.NewSessionRedisManager(deps.RedisClient, cfg.SessionTTLMinutes)
	authStore := authredis.NewAuthManager(deps.RedisClient)
	return authhandler.New(
		cfg,
		sessionStore,
		authStore,
		deps.AdminTokenProvider,
		middleware.DefaultLoginLockout(),
	)
}

func configureAuthRoutes(
	router *gin.Engine,
	cfg *config.Config,
	deps *AppDependencies,
	authHandler *authhandler.AuthHandler,
) {
	sessionStore := redisstore.NewSessionRedisManager(deps.RedisClient, cfg.SessionTTLMinutes)
	sessionValidator := middleware.SessionValidationMiddleware(sessionStore)
	sessionRefresh := middleware.SessionRefreshMiddleware(sessionStore)
	authRateLimiter := middleware.AuthRateLimiter()

	api := router.Group("/api")
	api.Use(noStore(), limitRequestBody(maxAuthRequestBytes), middleware.CSRFMiddleware())
	{
		api.GET("/health", platformserver.HealthHandler("opentech-auth-service"))
		api.GET("/csrf-token", func(c *gin.Context) {
			csrfToken := middleware.GenerateCSRFToken()
			middleware.SetCSRFTokenCookie(c, csrfToken, &middleware.CSRFConfig{
				CookieDomain: cfg.CookieDomain,
				CookieMaxAge: cfg.SessionTTLMinutes * 60,
				IsProduction: cfg.AppEnv == "production",
			})
			c.JSON(http.StatusOK, gin.H{"csrf_token": csrfToken})
		})

		api.POST("/login", authRateLimiter.Middleware(), authHandler.Login)
		api.POST("/register", authRateLimiter.Middleware(), authHandler.Register)
		api.POST("/logout", authHandler.Logout)
		api.GET("/auth/provider/:provider", authRateLimiter.Middleware(), authHandler.ProviderLogin)
		api.GET("/auth/callback", authRateLimiter.Middleware(), authHandler.ProviderCallback)

		protected := api.Group("")
		protected.Use(sessionValidator, sessionRefresh)
		{
			protected.GET("/auth/me", authHandler.RefreshClaimsMiddleware(), currentUser(cfg.Auth.Realm))
			protected.POST("/auth/refresh-token", authHandler.RefreshToken)
			protected.POST("/auth/change-password", authHandler.ChangePassword)
			protected.GET("/auth/keep-alive", authHandler.KeepAlive)
			protected.GET("/auth/account", func(c *gin.Context) {
				accountURL := fmt.Sprintf(
					"%s/realms/%s/account/",
					strings.TrimRight(cfg.KeycloakPublicURL, "/"),
					cfg.Auth.Realm,
				)
				c.Redirect(http.StatusSeeOther, accountURL)
			})
		}
	}

	internal := router.Group("/internal")
	internal.Use(requireInternalSecret(cfg.InternalSecret), noStore())
	{
		internal.GET("/validate-session", func(c *gin.Context) {
			sessionData, sessionID, err := middleware.ValidateSession(c, sessionStore)
			if err != nil || sessionData == nil || sessionData.UserInfoData == nil {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
				return
			}
			if !authHandler.RefreshSessionIfNeeded(c, sessionData, sessionID) {
				return
			}
			if err := sessionStore.RefreshSessionTTL(c.Request.Context(), sessionID); err != nil {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "expired session"})
				return
			}
			c.JSON(http.StatusOK, gin.H{
				"success": true,
				"user":    publicUser(sessionData, cfg.Auth.Realm),
			})
		})
	}
}

func currentUser(realm string) gin.HandlerFunc {
	return func(c *gin.Context) {
		sessionData, ok := httputil.GetSessionFromContext(c)
		if !ok || sessionData == nil || sessionData.UserInfoData == nil {
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"user":    publicUser(sessionData, realm),
			"session": gin.H{"authenticated": true},
		})
	}
}

func publicUser(sessionData *platformsession.SessionData, realm string) gin.H {
	username := strings.TrimSpace(sessionData.UserInfoData.Username)
	return gin.H{
		"id":             sessionData.UserID,
		"username":       username,
		"email":          sessionData.UserInfoData.Email,
		"avatar_url":     nil,
		"auth_provider":  normalizedAuthProvider(sessionData.UserInfoData.AuthProvider),
		"roles":          sessionData.Roles,
		"realm":          realm,
		"is_contributor": hasRole(sessionData.Roles, "contributor") || hasRole(sessionData.Roles, "admin"),
		"is_admin":       hasRole(sessionData.Roles, "admin"),
	}
}

func normalizedAuthProvider(provider string) string {
	switch provider {
	case "github", "orcid":
		return provider
	default:
		return "keycloak"
	}
}

func hasRole(roles []string, expected string) bool {
	for _, role := range roles {
		if subtle.ConstantTimeCompare([]byte(role), []byte(expected)) == 1 {
			return true
		}
	}
	return false
}

func requireInternalSecret(expected string) gin.HandlerFunc {
	return func(c *gin.Context) {
		provided := c.GetHeader("X-Internal-Auth")
		if len(provided) != len(expected) ||
			subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "internal authentication required"})
			c.Abort()
			return
		}
		c.Next()
	}
}

func noStore() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Next()
	}
}

func limitRequestBody(maxBytes int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.ContentLength > maxBytes {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "request body too large"})
			c.Abort()
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
		c.Next()
	}
}
