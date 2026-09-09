package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/joho/godotenv"
)

var (
	envMutex  sync.Mutex
	envLoaded bool
)

// environment variables
func LoadEnvOnce(paths ...string) error {
	envMutex.Lock()
	defer envMutex.Unlock()

	if envLoaded {
		return nil
	}

	candidates := candidateEnvPaths(paths)
	for _, path := range candidates {
		if _, err := os.Stat(path); err == nil {
			if err := godotenv.Load(path); err != nil {
				return fmt.Errorf("load env file %s: %w", path, err)
			}
			envLoaded = true
			return nil
		}
	}

	return nil
}

func candidateEnvPaths(paths []string) []string {
	if len(paths) == 0 {
		return []string{filepath.Join(".", ".env")}
	}

	out := make([]string, 0, len(paths))
	for _, p := range paths {
		if p == "" {
			continue
		}
		candidate := p
		if !strings.HasSuffix(candidate, ".env") {
			candidate = filepath.Join(candidate, ".env")
		}
		out = append(out, filepath.Clean(candidate))
	}
	return out
}

// GetEnv returns the value of key or defaultValue when unset.
func GetEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// GetEnvBool parses the environment variable as bool, returning defaultValue
// when unset or unparsable.
func GetEnvBool(key string, defaultValue bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return defaultValue
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return defaultValue
	}
	return parsed
}

// GetEnvInt parses an environment variable as int
func GetEnvInt(key string, defaultValue int) (int, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return defaultValue, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", key, err)
	}
	return parsed, nil
}

// RequireEnv returns the value of key or an error when it is empty.
func RequireEnv(key string) (string, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return "", fmt.Errorf("environment variable %s is required", key)
	}
	return value, nil
}

// RequireEnvInt parses a required integer environment variable.
func RequireEnvInt(key string) (int, error) {
	value, err := RequireEnv(key)
	if err != nil {
		return 0, err
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", key, err)
	}
	return parsed, nil
}
