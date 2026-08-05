package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

type RateLimiter struct {
	limiters   map[string]*limiterEntry
	mu         sync.Mutex
	rate       rate.Limit
	burst      int
	entryTTL   time.Duration
	maxEntries int
}

type limiterEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

func NewRateLimiter(r rate.Limit, b int) *RateLimiter {
	return &RateLimiter{
		limiters:   make(map[string]*limiterEntry),
		rate:       r,
		burst:      b,
		entryTTL:   30 * time.Minute,
		maxEntries: 10_000,
	}
}

func (rl *RateLimiter) getLimiter(key string) *rate.Limiter {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	if entry, exists := rl.limiters[key]; exists {
		entry.lastSeen = now
		return entry.limiter
	}

	if len(rl.limiters) >= rl.maxEntries {
		rl.evictEntries(now)
	}
	limiter := rate.NewLimiter(rl.rate, rl.burst)
	rl.limiters[key] = &limiterEntry{limiter: limiter, lastSeen: now}
	return limiter
}

func (rl *RateLimiter) evictEntries(now time.Time) {
	for key, entry := range rl.limiters {
		if now.Sub(entry.lastSeen) >= rl.entryTTL {
			delete(rl.limiters, key)
		}
	}
	if len(rl.limiters) < rl.maxEntries {
		return
	}

	var oldestKey string
	var oldestSeen time.Time
	for key, entry := range rl.limiters {
		if oldestKey == "" || entry.lastSeen.Before(oldestSeen) {
			oldestKey = key
			oldestSeen = entry.lastSeen
		}
	}
	if oldestKey != "" {
		delete(rl.limiters, oldestKey)
	}
}

func (rl *RateLimiter) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		clientIP := c.ClientIP()
		limiter := rl.getLimiter(clientIP)

		if !limiter.Allow() {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":   "Too many requests",
				"message": "Rate limit exceeded. Please try again later.",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

func AuthRateLimiter() *RateLimiter {
	return NewRateLimiter(rate.Every(12*time.Second), 5)
}

func StrictAuthRateLimiter() *RateLimiter {
	return NewRateLimiter(rate.Every(20*time.Second), 3)
}
