package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"

	"platform.local/platform/auth"
	platformconfig "platform.local/platform/config"

	goredis "github.com/redis/go-redis/v9"
)

type Config struct {
	Auth              auth.Config
	RedisConfig       goredis.Options
	AppPort           string
	AppHost           string
	AppURL            string
	FrontendURL       string
	AppEnv            string
	AppTimezone       string
	CookieDomain      string
	KeycloakPublicURL string
	InternalSecret    string
	SessionTTLMinutes int // Session timeout in minutes
}

func LoadFromEnv() (*Config, error) {
	if err := platformconfig.LoadEnvOnce(".", ".."); err != nil {
		return nil, err
	}

	redisDB, err := platformconfig.GetEnvInt("REDIS_DATABASE", 0)
	if err != nil {
		return nil, err
	}

	sessionTTL, err := platformconfig.GetEnvInt("SESSION_TTL_MINUTES", 60)
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		Auth:              platformconfig.AuthConfigFromEnv(),
		RedisConfig:       platformconfig.RedisOptionsFromEnv(redisDB),
		AppPort:           platformconfig.GetEnv("APP_PORT", "8001"),
		AppHost:           platformconfig.GetEnv("APP_HOST", "0.0.0.0"),
		AppURL:            os.Getenv("APP_URL"),
		FrontendURL:       platformconfig.GetEnv("FRONTEND_URL", "http://localhost:3000"),
		AppEnv:            platformconfig.GetEnv("APP_ENV", "development"),
		AppTimezone:       platformconfig.GetEnv("APP_TIMEZONE", "UTC"),
		CookieDomain:      os.Getenv("COOKIE_DOMAIN"),
		KeycloakPublicURL: platformconfig.GetEnv("KEYCLOAK_PUBLIC_URL", os.Getenv("KEYCLOAK_URL")),
		InternalSecret:    os.Getenv("AUTH_INTERNAL_SECRET"),
		SessionTTLMinutes: sessionTTL,
	}
	if err := validate(cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

func validate(cfg *Config) error {
	required := map[string]string{
		"APP_URL":                cfg.AppURL,
		"FRONTEND_URL":           cfg.FrontendURL,
		"KEYCLOAK_URL":           cfg.Auth.BaseURL,
		"KEYCLOAK_REALM":         cfg.Auth.Realm,
		"KEYCLOAK_CLIENT_ID":     cfg.Auth.ClientID,
		"KEYCLOAK_CLIENT_SECRET": cfg.Auth.ClientSecret,
		"KEYCLOAK_PUBLIC_URL":    cfg.KeycloakPublicURL,
		"REDIS_HOST":             cfg.RedisConfig.Addr,
		"AUTH_INTERNAL_SECRET":   cfg.InternalSecret,
	}
	for name, value := range required {
		if strings.TrimSpace(value) == "" || (name == "REDIS_HOST" && strings.HasPrefix(value, ":")) {
			return fmt.Errorf("environment variable %s is required", name)
		}
	}
	if len(cfg.InternalSecret) < 32 {
		return fmt.Errorf("AUTH_INTERNAL_SECRET must contain at least 32 characters")
	}
	for name, value := range map[string]string{
		"APP_URL":             cfg.AppURL,
		"FRONTEND_URL":        cfg.FrontendURL,
		"KEYCLOAK_PUBLIC_URL": cfg.KeycloakPublicURL,
	} {
		parsed, err := url.Parse(value)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return fmt.Errorf("environment variable %s must be an absolute HTTP(S) URL", name)
		}
	}
	return nil
}
