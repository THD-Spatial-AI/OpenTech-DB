package middleware

import (
	"sync"
	"time"
)

type LoginAttempt struct {
	Count        int
	FirstAttempt time.Time
	LockedUntil  *time.Time
}

type AccountLockout struct {
	attempts      map[string]*LoginAttempt
	mu            sync.RWMutex
	MaxAttempts   int
	LockoutWindow time.Duration
	LockoutPeriod time.Duration
}

func NewAccountLockout(maxAttempts int, lockoutWindow, lockoutPeriod time.Duration) *AccountLockout {
	al := &AccountLockout{
		attempts:      make(map[string]*LoginAttempt),
		MaxAttempts:   maxAttempts,
		LockoutWindow: lockoutWindow,
		LockoutPeriod: lockoutPeriod,
	}

	go al.cleanupOldAttempts()

	return al
}

func (al *AccountLockout) RecordFailedAttempt(identifier string) (shouldLock bool, lockedUntil time.Time, attemptsRemaining int) {
	al.mu.Lock()
	defer al.mu.Unlock()

	now := time.Now()

	attempt, exists := al.attempts[identifier]
	if !exists {
		al.attempts[identifier] = &LoginAttempt{
			Count:        1,
			FirstAttempt: now,
		}
		return false, time.Time{}, al.MaxAttempts - 1
	}

	if now.Sub(attempt.FirstAttempt) > al.LockoutWindow {
		attempt.Count = 1
		attempt.FirstAttempt = now
		attempt.LockedUntil = nil
		return false, time.Time{}, al.MaxAttempts - 1
	}

	attempt.Count++

	if attempt.Count >= al.MaxAttempts {
		lockUntil := now.Add(al.LockoutPeriod)
		attempt.LockedUntil = &lockUntil
		return true, lockUntil, 0
	}

	return false, time.Time{}, al.MaxAttempts - attempt.Count
}

func (al *AccountLockout) IsLocked(identifier string) (bool, time.Time) {
	al.mu.RLock()
	defer al.mu.RUnlock()

	attempt, exists := al.attempts[identifier]
	if !exists {
		return false, time.Time{}
	}

	if attempt.LockedUntil == nil {
		return false, time.Time{}
	}

	now := time.Now()
	if now.After(*attempt.LockedUntil) {
		return false, time.Time{}
	}

	return true, *attempt.LockedUntil
}

func (al *AccountLockout) ResetAttempts(identifier string) {
	al.mu.Lock()
	defer al.mu.Unlock()

	delete(al.attempts, identifier)
}

func (al *AccountLockout) GetAttemptCount(identifier string) int {
	al.mu.RLock()
	defer al.mu.RUnlock()

	attempt, exists := al.attempts[identifier]
	if !exists {
		return 0
	}

	now := time.Now()
	if now.Sub(attempt.FirstAttempt) > al.LockoutWindow {
		return 0
	}

	if attempt.LockedUntil != nil && now.After(*attempt.LockedUntil) {
		return 0
	}

	return attempt.Count
}

func (al *AccountLockout) cleanupOldAttempts() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		al.mu.Lock()
		now := time.Now()

		for key, attempt := range al.attempts {
			if shouldRemoveAttempt(attempt, now, al.LockoutWindow) {
				delete(al.attempts, key)
			}
		}
		al.mu.Unlock()
	}
}

func shouldRemoveAttempt(attempt *LoginAttempt, now time.Time, lockoutWindow time.Duration) bool {
	if attempt.LockedUntil == nil {
		return now.Sub(attempt.FirstAttempt) > lockoutWindow
	}
	return now.After(*attempt.LockedUntil)
}

func DefaultLoginLockout() *AccountLockout {
	return NewAccountLockout(5, 10*time.Minute, 15*time.Minute)
}
