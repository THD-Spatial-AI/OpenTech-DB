// Package store defines short-lived browser authorization state storage.
// This is adapted from Storcito-Wildfire's Redis-backed auth state store.
package store

import "context"

type AuthorizationState struct {
	CodeVerifier string `json:"code_verifier"`
	RedirectURI  string `json:"redirect_uri"`
	ReturnTo     string `json:"return_to"`
	Provider     string `json:"provider"`
}

type AuthStore interface {
	SetState(ctx context.Context, state string, data AuthorizationState) error
	ConsumeState(ctx context.Context, state string) (*AuthorizationState, error)
}
