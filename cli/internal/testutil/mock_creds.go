package testutil

import (
	"github.com/shane-kercheval/tiddly/cli/internal/auth"
)

// MockCredStore is an in-memory CredentialStore for tests.
type MockCredStore struct {
	creds  map[string]string
	GetErr error // if non-nil, Get always returns this error
}

// NewMockCredStore creates an empty MockCredStore.
func NewMockCredStore() *MockCredStore {
	return &MockCredStore{creds: make(map[string]string)}
}

// CredsWithPAT creates a MockCredStore pre-populated with a PAT.
func CredsWithPAT(token string) *MockCredStore {
	store := NewMockCredStore()
	store.creds[auth.AccountPAT] = token
	return store
}

// CredsWithOAuth creates a MockCredStore pre-populated with OAuth tokens.
func CredsWithOAuth(accessToken, refreshToken string) *MockCredStore {
	store := NewMockCredStore()
	store.creds[auth.AccountOAuthAccess] = accessToken
	if refreshToken != "" {
		store.creds[auth.AccountOAuthRefresh] = refreshToken
	}
	return store
}

func (m *MockCredStore) Get(account string) (string, error) {
	if m.GetErr != nil {
		return "", m.GetErr
	}
	val, ok := m.creds[account]
	if !ok {
		return "", auth.ErrNotFound
	}
	return val, nil
}

func (m *MockCredStore) Set(account string, value string) error {
	m.creds[account] = value
	return nil
}

func (m *MockCredStore) SetMultiple(entries map[string]string) error {
	for k, v := range entries {
		m.creds[k] = v
	}
	return nil
}

func (m *MockCredStore) Delete(account string) error {
	delete(m.creds, account)
	return nil
}
