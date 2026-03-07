package skills

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// ScanResult holds the outcome of scanning a single tool+scope skills directory.
type ScanResult struct {
	Tool       string   // "claude-code" or "codex"
	Scope      string   // "global" or "project"
	Path       string   // resolved directory path
	SkillNames []string // subdirectory names containing SKILL.md
	Err        error
}

// ScanSkillsDir scans a single directory for skill subdirectories (those containing SKILL.md).
// Returns sorted skill names. Non-existent directories return empty results (not an error).
func ScanSkillsDir(dirPath string) ([]string, error) {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var names []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		skillFile := filepath.Join(dirPath, entry.Name(), "SKILL.md")
		if _, err := os.Stat(skillFile); err == nil {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

// ScanAllSkills scans all tool+scope combinations for installed skills.
// Claude Desktop is excluded (its skills aren't file-accessible).
func ScanAllSkills(projectPath string) []ScanResult {
	type combo struct {
		tool  string
		scope string
	}
	combos := []combo{
		{"claude-code", ScopeGlobal},
		{"claude-code", ScopeProject},
		{"codex", ScopeGlobal},
		{"codex", ScopeProject},
	}

	var results []ScanResult
	for _, c := range combos {
		dirPath, err := resolveToolPath(c.tool, c.scope)
		if err != nil {
			results = append(results, ScanResult{
				Tool:  c.tool,
				Scope: c.scope,
				Err:   err,
			})
			continue
		}

		// Project-scope paths are relative; join with projectPath
		if !filepath.IsAbs(dirPath) {
			if projectPath == "" {
				results = append(results, ScanResult{
					Tool:  c.tool,
					Scope: c.scope,
					Path:  dirPath,
					Err:   fmt.Errorf("no project path available"),
				})
				continue
			}
			dirPath = filepath.Join(projectPath, dirPath)
		}

		names, err := ScanSkillsDir(dirPath)
		results = append(results, ScanResult{
			Tool:       c.tool,
			Scope:      c.scope,
			Path:       dirPath,
			SkillNames: names,
			Err:        err,
		})
	}
	return results
}
