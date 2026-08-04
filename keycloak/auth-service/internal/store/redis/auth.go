// Package redis implements the browser authorization state store.
// The layout is adapted from Storcito-Wildfire's RedisAuthManager.
package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"platform.local/auth-service/internal/store"

	goredis "github.com/redis/go-redis/v9"
)

type AuthManager struct {
	client     *goredis.Client
	prefix     string
	defaultTTL time.Duration
}

func NewAuthManager(client *goredis.Client) *AuthManager {
	return &AuthManager{
		client:     client,
		prefix:     "oidc_state",
		defaultTTL: 5 * time.Minute,
	}
}

func (m *AuthManager) key(stateID string) string {
	return fmt.Sprintf("%s:%s", m.prefix, stateID)
}

func (m *AuthManager) SetState(
	ctx context.Context,
	stateID string,
	data store.AuthorizationState,
) error {
	payload, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshal authorization state: %w", err)
	}
	if err := m.client.Set(ctx, m.key(stateID), payload, m.defaultTTL).Err(); err != nil {
		return fmt.Errorf("save authorization state: %w", err)
	}
	return nil
}

func (m *AuthManager) ConsumeState(
	ctx context.Context,
	stateID string,
) (*store.AuthorizationState, error) {
	payload, err := m.client.GetDel(ctx, m.key(stateID)).Bytes()
	if err != nil {
		if err == goredis.Nil {
			return nil, fmt.Errorf("authorization state is missing or expired")
		}
		return nil, fmt.Errorf("consume authorization state: %w", err)
	}

	var data store.AuthorizationState
	if err := json.Unmarshal(payload, &data); err != nil {
		return nil, fmt.Errorf("decode authorization state: %w", err)
	}
	return &data, nil
}
