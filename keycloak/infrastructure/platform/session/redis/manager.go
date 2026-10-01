package redisstore

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"platform.local/platform/session"

	goredis "github.com/redis/go-redis/v9"
)

const (
	MaxSessionLifetime = 8 * time.Hour
	onlineUserWindow   = 10 * time.Minute
)

type RedisSessionManager struct {
	client      *goredis.Client
	PrefixState string
	defaultTTL  time.Duration
}

func NewSessionRedisManager(rds *goredis.Client, ttlMinutes int) *RedisSessionManager {
	if ttlMinutes <= 0 {
		ttlMinutes = 60
	}

	return &RedisSessionManager{
		client:      rds,
		PrefixState: "session",
		defaultTTL:  time.Duration(ttlMinutes) * time.Minute,
	}
}
func (s *RedisSessionManager) buildKey(userID string) string {
	return fmt.Sprintf("%s:%s", s.PrefixState, userID)
}

func (s *RedisSessionManager) buildUserSessionsKey(userID string) string {
	return fmt.Sprintf("user_sessions:%s", userID)
}

func (s *RedisSessionManager) buildSessionActivityKey(sessionID string) string {
	return fmt.Sprintf("session_activity:%s", sessionID)
}

// SaveSession stores session data in Redis
func (s *RedisSessionManager) SaveSession(ctx context.Context,
	userID string,
	session *session.SessionData) error {

	// Here userID is actually the sessionID which we use as the Redis key suffix
	sessionID := userID
	key := s.buildKey(sessionID)
	now := time.Now()

	exists, err := s.client.Exists(ctx, key).Result()
	if err == nil && exists == 0 {
		if session.CreatedAt.IsZero() {
			session.CreatedAt = now
		}
	} else {
		existingSession, err := s.GetSession(ctx, userID)
		if err == nil && existingSession != nil && !existingSession.CreatedAt.IsZero() {
			session.CreatedAt = existingSession.CreatedAt
		} else if session.CreatedAt.IsZero() {
			session.CreatedAt = now
		}
	}
	session.LastSeenAt = now

	jsonData, err := json.Marshal(session)
	if err != nil {
		return fmt.Errorf("error marshaling session data: %w", err)
	}

	err = s.client.SetEx(ctx, key, string(jsonData), s.defaultTTL).Err()
	if err != nil {
		return fmt.Errorf("error saving session to redis: %w", err)
	}

	if err := s.saveSessionActivity(ctx, sessionID, now); err != nil {
		return err
	}

	// Maintain reverse index: user -> session IDs
	if session != nil && session.UserID != "" {
		setKey := s.buildUserSessionsKey(session.UserID)
		if err := s.client.SAdd(ctx, setKey, sessionID).Err(); err != nil {
			return fmt.Errorf("error indexing session for user: %w", err)
		}
		// Align set TTL with session key TTL
		_ = s.client.Expire(ctx, setKey, s.defaultTTL).Err()
	}

	return nil
}

// GetSession retrieves session data from Redis
func (s *RedisSessionManager) GetSession(ctx context.Context, userID string) (*session.SessionData, error) {
	// Here userID is actually the sessionID cookie value
	key := s.buildKey(userID)

	data, err := s.client.Get(ctx, key).Result()
	if err != nil {
		if err == goredis.Nil {
			return nil, nil
		}
		return nil, fmt.Errorf("error getting session from redis: %w", err)
	}

	var session session.SessionData
	if err := json.Unmarshal([]byte(data), &session); err != nil {
		return nil, fmt.Errorf("error unmarshaling session data: %w", err)
	}

	return &session, nil
}

// DeleteSession removes session from Redis
func (s *RedisSessionManager) DeleteSession(ctx context.Context, userID string) error {
	// Here userID is the sessionID
	sessionID := userID
	key := s.buildKey(sessionID)

	// Try to fetch to remove reverse index cleanly
	sess, _ := s.GetSession(ctx, sessionID)

	if err := s.client.Del(ctx, key).Err(); err != nil {
		return fmt.Errorf("error deleting session from redis: %w", err)
	}
	_ = s.client.Del(ctx, s.buildSessionActivityKey(sessionID)).Err()

	if sess != nil && sess.UserID != "" {
		setKey := s.buildUserSessionsKey(sess.UserID)
		// Remove this sessionID from the user's set
		_ = s.client.SRem(ctx, setKey, sessionID).Err()
		// Optionally expire the set if empty
		if count, err := s.client.SCard(ctx, setKey).Result(); err == nil && count == 0 {
			_ = s.client.Del(ctx, setKey).Err()
		}
	}

	return nil
}

// CheckSession verifies if a session exists
func (s *RedisSessionManager) CheckSession(ctx context.Context, userID string) (bool, error) {
	// Here userID is the sessionID
	key := s.buildKey(userID)
	exists, err := s.client.Exists(ctx, key).Result()
	if err != nil {
		return false, fmt.Errorf("error checking session existence: %w", err)
	}

	return exists == 1, nil
}

// RefreshSessionTTL extends the session TTL but respects max lifetime
func (s *RedisSessionManager) RefreshSessionTTL(ctx context.Context, userID string) error {
	// Here userID is the sessionID
	sessionID := userID
	key := s.buildKey(sessionID)

	session, err := s.GetSession(ctx, sessionID)
	if err != nil {
		return fmt.Errorf("error getting session: %w", err)
	}

	if session == nil {
		return fmt.Errorf("session does not exist")
	}

	if !session.CreatedAt.IsZero() {
		sessionAge := time.Since(session.CreatedAt)
		if sessionAge >= MaxSessionLifetime {
			_ = s.DeleteSession(ctx, userID)
			return fmt.Errorf("session exceeded maximum lifetime of %v", MaxSessionLifetime)
		}
	}

	err = s.client.Expire(ctx, key, s.defaultTTL).Err()
	if err != nil {
		return fmt.Errorf("error refreshing session TTL: %w", err)
	}
	if err := s.saveSessionActivity(ctx, sessionID, time.Now()); err != nil {
		return err
	}

	// Also bump the TTL on the reverse index set
	if session.UserID != "" {
		setKey := s.buildUserSessionsKey(session.UserID)
		_ = s.client.Expire(ctx, setKey, s.defaultTTL).Err()
	}

	return nil
}

// DeleteSessionsByUser removes all sessions for a given Keycloak user ID
func (s *RedisSessionManager) DeleteSessionsByUser(ctx context.Context, userID string) error {
	setKey := s.buildUserSessionsKey(userID)
	sessionIDs, err := s.client.SMembers(ctx, setKey).Result()
	if err != nil && err != goredis.Nil {
		return fmt.Errorf("error fetching user sessions: %w", err)
	}
	// Delete each session key
	for _, sid := range sessionIDs {
		key := s.buildKey(sid)
		_ = s.client.Del(ctx, key).Err()
		_ = s.client.Del(ctx, s.buildSessionActivityKey(sid)).Err()
	}
	// Remove the set mapping
	_ = s.client.Del(ctx, setKey).Err()
	return nil
}

// CountActiveSessions counts the number of active session keys in Redis.
func (s *RedisSessionManager) CountActiveSessions(ctx context.Context) (int64, error) {
	var count int64
	var cursor uint64
	pattern := fmt.Sprintf("%s:*", s.PrefixState)
	for {
		keys, nextCursor, err := s.client.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			return 0, fmt.Errorf("error scanning sessions: %w", err)
		}
		count += int64(len(keys))
		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}
	return count, nil
}

// CountActiveUsers counts distinct users with recent session activity.
func (s *RedisSessionManager) CountActiveUsers(ctx context.Context, userIDs ...string) (int64, error) {
	activeUsers := make(map[string]struct{})
	allowedUsers := userFilter(userIDs)
	var cursor uint64
	pattern := fmt.Sprintf("%s:*", s.PrefixState)
	now := time.Now()

	for {
		keys, nextCursor, err := s.client.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			return 0, fmt.Errorf("error scanning sessions: %w", err)
		}

		if len(keys) > 0 {
			values, activityValues, err := s.loadSessionValues(ctx, keys)
			if err != nil {
				return 0, err
			}
			countActiveUsersFromValues(values, activityValues, now, allowedUsers, activeUsers)
		}

		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}

	return int64(len(activeUsers)), nil
}

func (s *RedisSessionManager) loadSessionValues(ctx context.Context, keys []string) ([]interface{}, []interface{}, error) {
	values, err := s.client.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, nil, fmt.Errorf("error reading sessions: %w", err)
	}

	activityKeys := make([]string, 0, len(keys))
	prefix := s.PrefixState + ":"
	for _, key := range keys {
		sessionID := strings.TrimPrefix(key, prefix)
		activityKeys = append(activityKeys, s.buildSessionActivityKey(sessionID))
	}

	activityValues, err := s.client.MGet(ctx, activityKeys...).Result()
	if err != nil {
		return nil, nil, fmt.Errorf("error reading session activity: %w", err)
	}

	return values, activityValues, nil
}

func countActiveUsersFromValues(values, activityValues []interface{}, now time.Time, allowedUsers, activeUsers map[string]struct{}) {
	for i, value := range values {
		raw, ok := sessionJSON(value)
		if !ok {
			continue
		}

		var sessionData session.SessionData
		if err := json.Unmarshal(raw, &sessionData); err != nil {
			continue
		}

		var activityValue interface{}
		if i < len(activityValues) {
			activityValue = activityValues[i]
		}

		if isRecentlyActiveUserSession(sessionData, sessionActivityTime(activityValue), now, allowedUsers) {
			activeUsers[sessionData.UserID] = struct{}{}
		}
	}
}

func userFilter(userIDs []string) map[string]struct{} {
	if len(userIDs) == 0 {
		return nil
	}

	filter := make(map[string]struct{}, len(userIDs))
	for _, userID := range userIDs {
		if userID != "" {
			filter[userID] = struct{}{}
		}
	}
	return filter
}

func sessionJSON(value interface{}) ([]byte, bool) {
	switch v := value.(type) {
	case string:
		return []byte(v), true
	case []byte:
		return v, true
	default:
		return nil, false
	}
}

func sessionActivityTime(value interface{}) time.Time {
	raw, ok := sessionJSON(value)
	if !ok {
		return time.Time{}
	}

	activityTime, err := time.Parse(time.RFC3339Nano, string(raw))
	if err != nil {
		return time.Time{}
	}
	return activityTime
}

func isRecentlyActiveUserSession(sessionData session.SessionData, activityTime time.Time, now time.Time, allowedUsers map[string]struct{}) bool {
	if sessionData.UserID == "" {
		return false
	}
	if allowedUsers != nil {
		if _, ok := allowedUsers[sessionData.UserID]; !ok {
			return false
		}
	}

	lastSeen := activityTime
	if lastSeen.IsZero() {
		lastSeen = sessionData.LastSeenAt
	}
	if lastSeen.IsZero() {
		lastSeen = sessionData.CreatedAt
	}

	return !lastSeen.IsZero() && !lastSeen.Before(now.Add(-onlineUserWindow))
}

func (s *RedisSessionManager) saveSessionActivity(ctx context.Context, sessionID string, seenAt time.Time) error {
	key := s.buildSessionActivityKey(sessionID)
	value := seenAt.UTC().Format(time.RFC3339Nano)
	if err := s.client.SetEx(ctx, key, value, s.defaultTTL).Err(); err != nil {
		return fmt.Errorf("error saving session activity: %w", err)
	}
	return nil
}
