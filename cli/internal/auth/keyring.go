package auth

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/zalando/go-keyring"
)

const (
	serviceName    = "tiddly-cli"
	keyringTimeout = 3 * time.Second

	AccountOAuthAccess  = "oauth-access-token"
	AccountOAuthRefresh = "oauth-refresh-token"
	AccountPAT          = "pat"
)

// CredentialStore abstracts credential storage for testability.
type CredentialStore interface {
	Get(account string) (string, error)
	Set(account string, value string) error
	Delete(account string) error
}

// KeyringMode controls credential storage backend.
type KeyringMode string

const (
	KeyringAuto  KeyringMode = "auto"
	KeyringForce KeyringMode = "force"
	KeyringFile  KeyringMode = "file"
)

// ErrNotFound is returned when a credential doesn't exist.
var ErrNotFound = errors.New("credential not found")

// NewCredentialStore creates a CredentialStore based on the mode and environment.
// configDir is the directory for file-based fallback storage.
func NewCredentialStore(mode KeyringMode, configDir string) CredentialStore {
	if mode == KeyringFile {
		return &fileStore{dir: configDir}
	}

	if mode == KeyringForce || keyringAvailable() {
		store := &keyringStore{}
		// Verify keyring works with a timeout
		if mode == KeyringForce || testKeyringWithTimeout() {
			return store
		}
	}

	return &fileStore{dir: configDir}
}

// keyringAvailable checks if a desktop session exists (Linux-specific).
func keyringAvailable() bool {
	if runtime.GOOS != "linux" {
		return true
	}
	return os.Getenv("DISPLAY") != "" || os.Getenv("WAYLAND_DISPLAY") != ""
}

// testKeyringWithTimeout attempts a keyring operation with a timeout to detect
// hangs on misconfigured Linux systems (go-keyring has no context parameter).
func testKeyringWithTimeout() bool {
	type result struct {
		err error
	}
	ch := make(chan result, 1)
	go func() {
		// Try to get a non-existent key; ErrNotFound is fine, other errors mean keyring is broken
		_, err := keyring.Get(serviceName, "__test__")
		ch <- result{err: err}
	}()

	select {
	case r := <-ch:
		return r.err == nil || r.err == keyring.ErrNotFound
	case <-time.After(keyringTimeout):
		return false
	}
}

// keyringStore uses the system keyring.
type keyringStore struct{}

func (s *keyringStore) Get(account string) (string, error) {
	val, err := keyring.Get(serviceName, account)
	if err == keyring.ErrNotFound {
		return "", ErrNotFound
	}
	return val, err
}

func (s *keyringStore) Set(account string, value string) error {
	return keyring.Set(serviceName, account, value)
}

func (s *keyringStore) Delete(account string) error {
	err := keyring.Delete(serviceName, account)
	if err == keyring.ErrNotFound {
		return nil // deleting non-existent key is not an error
	}
	return err
}

// fileStore stores credentials in a JSON file with 0600 permissions.
type fileStore struct {
	dir string
}

func (s *fileStore) path() string {
	return filepath.Join(s.dir, "credentials")
}

func (s *fileStore) load() (map[string]string, error) {
	data, err := os.ReadFile(s.path())
	if err != nil {
		if os.IsNotExist(err) {
			return make(map[string]string), nil
		}
		return nil, fmt.Errorf("reading credentials file: %w", err)
	}
	var creds map[string]string
	if err := json.Unmarshal(data, &creds); err != nil {
		return nil, fmt.Errorf("parsing credentials file: %w", err)
	}
	return creds, nil
}

func (s *fileStore) save(creds map[string]string) error {
	if err := os.MkdirAll(s.dir, 0700); err != nil {
		return fmt.Errorf("creating credentials directory: %w", err)
	}
	data, err := json.MarshalIndent(creds, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding credentials: %w", err)
	}
	return os.WriteFile(s.path(), data, 0600)
}

func (s *fileStore) Get(account string) (string, error) {
	creds, err := s.load()
	if err != nil {
		return "", err
	}
	val, ok := creds[account]
	if !ok {
		return "", ErrNotFound
	}
	return val, nil
}

func (s *fileStore) Set(account string, value string) error {
	creds, err := s.load()
	if err != nil {
		return err
	}
	creds[account] = value
	return s.save(creds)
}

func (s *fileStore) Delete(account string) error {
	creds, err := s.load()
	if err != nil {
		return err
	}
	delete(creds, account)
	return s.save(creds)
}
