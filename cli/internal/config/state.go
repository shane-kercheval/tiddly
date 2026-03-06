package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// State holds ephemeral state that should not be in config.yaml (avoids config churn).
type State struct {
	LastUpdateCheck time.Time `json:"last_update_check,omitempty"`
}

const stateFile = "state.json"

// ReadState reads the state file from the given config directory.
// Returns a zero State if the file does not exist.
func ReadState(configDir string) (*State, error) {
	path := filepath.Join(configDir, stateFile)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &State{}, nil
		}
		return nil, err
	}

	var s State
	if err := json.Unmarshal(data, &s); err != nil {
		return &State{}, nil // treat corrupt state as empty
	}
	return &s, nil
}

// WriteState writes the state file to the given config directory.
func WriteState(configDir string, s *State) error {
	if err := EnsureDir(configDir); err != nil {
		return err
	}

	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}

	path := filepath.Join(configDir, stateFile)
	return os.WriteFile(path, data, 0600)
}
