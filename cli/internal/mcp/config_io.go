package mcp

import (
	"errors"
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
	// Use O_CREATE|O_EXCL so "does the target exist?" and "claim the
	// target" are a single atomic operation. Avoids the Stat→WriteFile
	// TOCTOU race where a concurrent run could silently overwrite a
	// backup we just saw as vacant. Non-EEXIST errors surface directly
	// (EACCES on the dir, I/O errors) instead of being masked as
	// collisions.
	for suffix := 1; ; suffix++ {
		f, openErr := os.OpenFile(backupPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, info.Mode().Perm())
		if openErr == nil {
			if _, writeErr := f.Write(data); writeErr != nil {
				_ = f.Close()
				return "", fmt.Errorf("writing backup to %s: %w", backupPath, writeErr)
			}
			if closeErr := f.Close(); closeErr != nil {
				return "", fmt.Errorf("closing backup %s: %w", backupPath, closeErr)
			}
			return backupPath, nil
		}
		if !errors.Is(openErr, os.ErrExist) {
			// Non-collision errors (permission, I/O) must surface directly
			// rather than be treated as "file exists, try another name."
			return "", fmt.Errorf("creating backup %s: %w", backupPath, openErr)
		}
		if suffix > backupCollisionLimit {
			return "", fmt.Errorf("backup collision retry exhausted after %d attempts at %s", backupCollisionLimit, base)
		}
		backupPath = fmt.Sprintf("%s.%d", base, suffix)
	}
}

// restoreConfigBackup copies a backup made by backupConfigFile back over path.
// Used by the post-write integrity guard to roll back a write that would have
// corrupted the config (e.g. dropped a non-managed MCP server), so a writer bug
// can never leave a user's real config in a broken state. Writes via
// atomicWriteFileFunc so tests can deterministically simulate a restore failure.
func restoreConfigBackup(backupPath, path string) error {
	data, err := os.ReadFile(backupPath)
	if err != nil {
		return fmt.Errorf("reading backup %s: %w", backupPath, err)
	}
	if err := atomicWriteFileFunc(path, data, 0600); err != nil {
		return fmt.Errorf("restoring backup %s to %s: %w", backupPath, path, err)
	}
	return nil
}

// restoreAfterIntegrityFailure rolls back a write that failed its post-write
// integrity check and returns an error that truthfully reflects the outcome.
// It always returns a non-nil error so the command exits non-zero — the honesty
// fix is worthless if a corrupted-but-unrestorable config quietly returns success.
// Format-agnostic (pure file ops); the format-specific validation lives in each
// writer's verify*Integrity.
func restoreAfterIntegrityFailure(path, backupPath string, integrityErr error) error {
	if backupPath == "" {
		// Brand-new config (no prior file) — there is nothing to restore, and the
		// just-written file may be invalid. Surface that rather than claim a restore.
		return fmt.Errorf("config integrity check failed and no prior config existed to restore; the file at %s may be invalid: %w", path, integrityErr)
	}
	if rerr := restoreConfigBackup(backupPath, path); rerr != nil {
		return fmt.Errorf("config integrity check failed (%w); AUTOMATIC RESTORE ALSO FAILED (%v) — recover manually from the backup at %s", integrityErr, rerr, backupPath)
	}
	return fmt.Errorf("config integrity check failed; restored previous config from %s: %w", backupPath, integrityErr)
}

// atomicWriteFileFunc is the write function used by writeJSONConfig /
// writeCodexConfig. Overridable in tests to simulate write failures
// that happen AFTER the backup has been taken — the specific ordering
// we need to verify (backup path returned even when the subsequent
// write fails) can't be reliably simulated through filesystem state
// because backup and write share the same parent directory.
var atomicWriteFileFunc = atomicWriteFile

// AtomicWriteFileFunc returns the current write function. Exposed so
// out-of-package tests (cmd layer) can save-and-restore the hook while
// simulating write failures.
func AtomicWriteFileFunc() func(path string, data []byte, perm os.FileMode) error {
	return atomicWriteFileFunc
}

// SetAtomicWriteFileFunc swaps the write function. Test-only; production
// code never calls this. Pair with AtomicWriteFileFunc + t.Cleanup to
// restore the original.
func SetAtomicWriteFileFunc(f func(path string, data []byte, perm os.FileMode) error) {
	atomicWriteFileFunc = f
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
