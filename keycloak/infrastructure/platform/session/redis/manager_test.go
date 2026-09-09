package redisstore

import (
	"encoding/json"
	"testing"
	"time"

	"platform.local/platform/session"
)

func TestCountActiveUsersFromValuesCountsDistinctRecentUsers(t *testing.T) {
	now := time.Date(2026, 5, 8, 12, 0, 0, 0, time.UTC)
	values := []interface{}{
		mustSessionJSON(t, session.SessionData{UserID: "user-a", CreatedAt: now.Add(-1 * time.Hour)}),
		mustSessionJSON(t, session.SessionData{UserID: "user-a", CreatedAt: now.Add(-1 * time.Hour)}),
		mustSessionJSON(t, session.SessionData{UserID: "user-b", LastSeenAt: now.Add(-onlineUserWindow - time.Second)}),
		mustSessionJSON(t, session.SessionData{UserID: "user-c", CreatedAt: now.Add(-3 * time.Minute)}),
		mustSessionJSON(t, session.SessionData{UserID: "user-d", LastSeenAt: now.Add(-onlineUserWindow - time.Second)}),
		mustSessionJSON(t, session.SessionData{LastSeenAt: now}),
		"not-json",
		nil,
	}
	activityValues := []interface{}{
		mustActivityValue(now.Add(-1 * time.Minute)),
		mustActivityValue(now.Add(-2 * time.Minute)),
		nil,
		nil,
		mustActivityValue(now.Add(-1 * time.Minute)),
		nil,
		nil,
		nil,
	}
	activeUsers := make(map[string]struct{})

	countActiveUsersFromValues(values, activityValues, now, nil, activeUsers)

	if got, want := len(activeUsers), 3; got != want {
		t.Fatalf("active user count = %d, want %d", got, want)
	}
	if _, ok := activeUsers["user-a"]; !ok {
		t.Fatalf("expected user-a to be counted")
	}
	if _, ok := activeUsers["user-c"]; !ok {
		t.Fatalf("expected legacy session with recent created_at to be counted")
	}
	if _, ok := activeUsers["user-d"]; !ok {
		t.Fatalf("expected session with recent activity key to be counted")
	}
	if _, ok := activeUsers["user-b"]; ok {
		t.Fatalf("did not expect stale user-b session to be counted")
	}
}

func TestCountActiveUsersFromValuesAppliesUserFilter(t *testing.T) {
	now := time.Date(2026, 5, 8, 12, 0, 0, 0, time.UTC)
	values := []interface{}{
		mustSessionJSON(t, session.SessionData{UserID: "user-a", CreatedAt: now}),
		mustSessionJSON(t, session.SessionData{UserID: "user-b", CreatedAt: now}),
	}
	allowedUsers := userFilter([]string{"user-b"})
	activeUsers := make(map[string]struct{})

	countActiveUsersFromValues(values, nil, now, allowedUsers, activeUsers)

	if got, want := len(activeUsers), 1; got != want {
		t.Fatalf("active user count = %d, want %d", got, want)
	}
	if _, ok := activeUsers["user-b"]; !ok {
		t.Fatalf("expected user-b to be counted")
	}
	if _, ok := activeUsers["user-a"]; ok {
		t.Fatalf("did not expect filtered user-a to be counted")
	}
}

func mustSessionJSON(t *testing.T, sessionData session.SessionData) string {
	t.Helper()

	data, err := json.Marshal(sessionData)
	if err != nil {
		t.Fatalf("marshal session: %v", err)
	}
	return string(data)
}

func mustActivityValue(seenAt time.Time) string {
	return seenAt.UTC().Format(time.RFC3339Nano)
}
