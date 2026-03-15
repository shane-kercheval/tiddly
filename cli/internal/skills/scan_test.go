package skills

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestScanSkillsDir__finds_skills(t *testing.T) {
	dir := t.TempDir()

	// Create two skill dirs with SKILL.md
	for _, name := range []string{"beta-skill", "alpha-skill"} {
		skillDir := filepath.Join(dir, name)
		require.NoError(t, os.MkdirAll(skillDir, 0755))
		require.NoError(t, os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte("# Skill"), 0644))
	}

	names, err := ScanSkillsDir(dir)
	require.NoError(t, err)
	assert.Equal(t, []string{"alpha-skill", "beta-skill"}, names)
}

func TestScanSkillsDir__ignores_dirs_without_skill_md(t *testing.T) {
	dir := t.TempDir()

	// Dir with SKILL.md
	skillDir := filepath.Join(dir, "real-skill")
	require.NoError(t, os.MkdirAll(skillDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte("# Skill"), 0644))

	// Dir without SKILL.md
	noSkillDir := filepath.Join(dir, "not-a-skill")
	require.NoError(t, os.MkdirAll(noSkillDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(noSkillDir, "README.md"), []byte("# Readme"), 0644))

	// Regular file (not a dir)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "file.txt"), []byte("hi"), 0644))

	names, err := ScanSkillsDir(dir)
	require.NoError(t, err)
	assert.Equal(t, []string{"real-skill"}, names)
}

func TestScanSkillsDir__nonexistent_dir_returns_empty(t *testing.T) {
	names, err := ScanSkillsDir("/nonexistent/path/that/does/not/exist")
	require.NoError(t, err)
	assert.Empty(t, names)
}

func TestScanAllSkills__returns_all_tool_scope_combos(t *testing.T) {
	projectDir := t.TempDir()

	// Set up claude-code user skills
	globalDir := t.TempDir()
	skillDir := filepath.Join(globalDir, "my-skill")
	require.NoError(t, os.MkdirAll(skillDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte("# Skill"), 0644))
	cleanupCCGlobal := SetToolPathOverride("claude-code", ScopeUser, globalDir)
	t.Cleanup(cleanupCCGlobal)

	// Set up claude-code directory skills
	ccProjectDir := filepath.Join(projectDir, ".claude", "skills")
	ccSkillDir := filepath.Join(ccProjectDir, "project-skill")
	require.NoError(t, os.MkdirAll(ccSkillDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(ccSkillDir, "SKILL.md"), []byte("# Skill"), 0644))

	// Set up codex user skills (empty)
	codexGlobalDir := t.TempDir()
	cleanupCxGlobal := SetToolPathOverride("codex", ScopeUser, codexGlobalDir)
	t.Cleanup(cleanupCxGlobal)

	// Override deprecated path to empty dir so real ~/.codex/skills/ is not scanned
	t.Cleanup(SetToolPathOverride("codex", "deprecated-user", t.TempDir()))

	results := ScanAllSkills(projectDir)

	require.Len(t, results, 4)

	// claude-code user
	assert.Equal(t, "claude-code", results[0].Tool)
	assert.Equal(t, ScopeUser, results[0].Scope)
	assert.Equal(t, []string{"my-skill"}, results[0].SkillNames)
	assert.NoError(t, results[0].Err)

	// claude-code directory
	assert.Equal(t, "claude-code", results[1].Tool)
	assert.Equal(t, ScopeDirectory, results[1].Scope)
	assert.Equal(t, []string{"project-skill"}, results[1].SkillNames)
	assert.NoError(t, results[1].Err)

	// codex user — empty dir, 0 skills
	assert.Equal(t, "codex", results[2].Tool)
	assert.Equal(t, ScopeUser, results[2].Scope)
	assert.Empty(t, results[2].SkillNames)
	assert.NoError(t, results[2].Err)

	// codex directory — no dir created, 0 skills
	assert.Equal(t, "codex", results[3].Tool)
	assert.Equal(t, ScopeDirectory, results[3].Scope)
	assert.Empty(t, results[3].SkillNames)
	assert.NoError(t, results[3].Err)
}

func TestScanAllSkills__empty_project_path_returns_errors_for_directory_scope(t *testing.T) {
	// User overrides so we get predictable results
	globalDir := t.TempDir()
	cleanupCC := SetToolPathOverride("claude-code", ScopeUser, globalDir)
	t.Cleanup(cleanupCC)
	codexDir := t.TempDir()
	cleanupCx := SetToolPathOverride("codex", ScopeUser, codexDir)
	t.Cleanup(cleanupCx)

	// Override deprecated path to empty dir
	t.Cleanup(SetToolPathOverride("codex", "deprecated-user", t.TempDir()))

	results := ScanAllSkills("")

	require.Len(t, results, 4)

	// User scopes should work fine
	assert.NoError(t, results[0].Err) // claude-code user
	assert.NoError(t, results[2].Err) // codex user

	// Directory scopes should have errors
	assert.Error(t, results[1].Err) // claude-code directory
	assert.Contains(t, results[1].Err.Error(), "no project path")
	assert.Error(t, results[3].Err) // codex directory
	assert.Contains(t, results[3].Err.Error(), "no project path")
}
