package utils

import (
	"net/http"
	"time"
)

// HTTP Client configurations
const (
	DefaultTimeout      = 30 * time.Second
	LongTimeout         = 120 * time.Second
	MaxIdleConns        = 100
	MaxIdleConnsPerHost = 10
	IdleConnTimeout     = 90 * time.Second
)

// NewDefaultHTTPClient creates an HTTP client with default timeout settings
func NewDefaultHTTPClient() *http.Client {
	transport := &http.Transport{
		MaxIdleConns:        MaxIdleConns,
		MaxIdleConnsPerHost: MaxIdleConnsPerHost,
		IdleConnTimeout:     IdleConnTimeout,
	}

	return &http.Client{
		Timeout:   DefaultTimeout,
		Transport: transport,
	}
}
