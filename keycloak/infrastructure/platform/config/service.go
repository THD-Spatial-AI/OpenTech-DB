package config

import (
	"fmt"
	"os"

	"platform.local/platform/auth"

	goredis "github.com/redis/go-redis/v9"
)

// AuthConfigFromEnv builds an auth.Config from the standard Keycloak env vars.
func AuthConfigFromEnv() auth.Config {
	return auth.Config{
		BaseURL:      os.Getenv("KEYCLOAK_URL"),
		ClientID:     os.Getenv("KEYCLOAK_CLIENT_ID"),
		RedirectURL:  os.Getenv("REDIRECT_URL"),
		ClientSecret: os.Getenv("KEYCLOAK_CLIENT_SECRET"),
		Realm:        os.Getenv("KEYCLOAK_REALM"),
	}
}

// RedisOptionsFromEnv returns Redis options derived from the shared env naming.
func RedisOptionsFromEnv(db int) goredis.Options {
	return goredis.Options{
		Addr:     fmt.Sprintf("%s:%s", os.Getenv("REDIS_HOST"), os.Getenv("REDIS_PORT")),
		Username: os.Getenv("REDIS_USERNAME"),
		Password: os.Getenv("REDIS_PASSWORD"),
		DB:       db,
	}
}
