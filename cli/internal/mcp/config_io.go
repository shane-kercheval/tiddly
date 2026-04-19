package mcp

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

// backupTimestampFormat is the suffix format for backup files: UTC, sortable,
// no characters that need escaping on any common filesystem.
const backupTimestampFormat = "20060102T150405Z"

// backupClock is overridable in tests. Real code uses time.Now; tests inject
// deterministic timestamps to assert exact backup filenames.
var backupClock = func() time.Time { return time.Now().UTC() }

// backupCollisionLimit caps the retry loop so a pathological filesystem
// (e.g. permissions preventing stat) can't spin forever. A user who triggers
// 1000 backups in the same UTC second has bigger problems.
const backupCollisionLimit = 1000

// backupConfigFile copies the file at path to path.bak.<timestamp> before a
// destructive write, preserving the source file's permission bits (critical
// because these files hold PATs and are typically 0600).
//
// Returns an empty backupPath if the source file does not exist (no-op) or the
// new backup's absolute path on success. Callers surface backupPath to the user
// so they know where their recovery copy landed.
//
// Collision handling: if two destructive writes land in the same UTC second
// (back-to-back scripted runs, tests, accidental double-invokes), a naive
// timestamped filename would overwrite the earlier backup — silently defeating
// the safety net. On collision we append .1, .2, ... until a free name is
// found, capped by backupCollisionLimit.
func backupConfigFile(path string) (backupPath string, err error) {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", fmt.Errorf("reading config for backup: %w", err)
	}
	defer f.Close() //nolint:errcheck

	info, err := f.Stat()
	if err != nil {
		return "", fmt.Errorf("stat config for backup: %w", err)
	}

	data, err := io.ReadAll(f)
	if err != nil {
		return "", fmt.Errorf("reading config for backup: %w", err)
	}

	base := path + ".bak." + backupClock().Format(backupTimestampFormat)
	backupPath = base
	for suffix := 1; ; suffix++ {
		if _, statErr := os.Stat(backupPath); os.IsNotExist(statErr) {
			break
		}
		if suffix > backupCollisionLimit {
			return "", fmt.Errorf("backup collision retry exhausted after %d attempts at %s", backupCollisionLimit, base)
		}
		backupPath = fmt.Sprintf("%s.%d", base, suffix)
	}

	if err := os.WriteFile(backupPath, data, info.Mode().Perm()); err != nil {
		return "", fmt.Errorf("writing backup to %s: %w", backupPath, err)
	}
	return backupPath, nil
}

// atomicWriteFile writes data to a temp file in the same directory and renames it to path.
// This prevents corruption if the process is killed mid-write.
// If the file already exists, its permissions are preserved. Otherwise defaultPerm is used.
func atomicWriteFile(path string, data []byte, defaultPerm os.FileMode) error {
	// Preserve existing file permissions if the file already exists
	perm := defaultPerm
	if info, err := os.Stat(path); err == nil {
		perm = info.Mode().Perm()
	}

	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return fmt.Errorf("creating temp file: %w", err)
	}
	tmpPath := tmp.Name()

	closed := false
	cleanup := func() {
		if !closed {
			_ = tmp.Close()
		}
		_ = os.Remove(tmpPath)
	}

	if _, err := tmp.Write(data); err != nil {
		cleanup()
		return fmt.Errorf("writing temp file: %w", err)
	}
	if err := tmp.Chmod(perm); err != nil {
		cleanup()
		return fmt.Errorf("setting file permissions: %w", err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("closing temp file: %w", err)
	}
	closed = true

	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("renaming temp file: %w", err)
	}
	return nil
}
