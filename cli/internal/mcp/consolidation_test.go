package mcp

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDetectConsolidations__no_consolidation_when_single_entries(t *testing.T) {
	sr := StatusResult{
		Servers: []ServerMatch{
			{ServerType: ServerContent, Name: serverNameContent, MatchMethod: MatchByName},
			{ServerType: ServerPrompts, Name: serverNamePrompts, MatchMethod: MatchByName},
		},
	}
	groups := detectConsolidations(sr, nil)
	assert.Empty(t, groups, "one entry per type should not trigger consolidation")
}

func TestDetectConsolidations__multi_prompts_triggers_one_group(t *testing.T) {
	sr := StatusResult{
		Servers: []ServerMatch{
			{ServerType: ServerContent, Name: serverNameContent, MatchMethod: MatchByName},
			{ServerType: ServerPrompts, Name: "work_prompts", MatchMethod: MatchByURL},
			{ServerType: ServerPrompts, Name: "personal_prompts", MatchMethod: MatchByURL},
		},
	}
	groups := detectConsolidations(sr, nil)
	assert.Len(t, groups, 1, "two prompts entries should produce one group")
	assert.Equal(t, ServerPrompts, groups[0].ServerType)
	assert.Equal(t, []string{"personal_prompts", "work_prompts"},
		[]string{groups[0].Entries[0].Name, groups[0].Entries[1].Name})
	assert.Empty(t, groups[0].SurvivorName,
		"detectConsolidations must not populate SurvivorName — callers inject it from ExtractPATs")
}

func TestDetectConsolidations__multi_both_types_triggers_two_groups(t *testing.T) {
	sr := StatusResult{
		Servers: []ServerMatch{
			{ServerType: ServerContent, Name: "work_content", MatchMethod: MatchByURL},
			{ServerType: ServerContent, Name: "personal_content", MatchMethod: MatchByURL},
			{ServerType: ServerPrompts, Name: "work_prompts", MatchMethod: MatchByURL},
			{ServerType: ServerPrompts, Name: "personal_prompts", MatchMethod: MatchByURL},
		},
	}
	groups := detectConsolidations(sr, nil)
	assert.Len(t, groups, 2)
	assert.Equal(t, ServerContent, groups[0].ServerType)
	assert.Equal(t, ServerPrompts, groups[1].ServerType)
}

func TestDetectConsolidations__wantServers_filters_out_untargeted_type(t *testing.T) {
	sr := StatusResult{
		Servers: []ServerMatch{
			{ServerType: ServerContent, Name: "work_content", MatchMethod: MatchByURL},
			{ServerType: ServerContent, Name: "personal_content", MatchMethod: MatchByURL},
			{ServerType: ServerPrompts, Name: "work_prompts", MatchMethod: MatchByURL},
			{ServerType: ServerPrompts, Name: "personal_prompts", MatchMethod: MatchByURL},
		},
	}
	groups := detectConsolidations(sr, []string{ServerContent})
	assert.Len(t, groups, 1)
	assert.Equal(t, ServerContent, groups[0].ServerType)
}

func TestDetectConsolidations__empty_result(t *testing.T) {
	groups := detectConsolidations(StatusResult{}, nil)
	assert.Empty(t, groups)
}

func TestSurvivorNameFor(t *testing.T) {
	ext := PATExtraction{
		ContentName: "tiddly_notes_bookmarks",
		PromptName:  "work_prompts",
	}
	assert.Equal(t, "tiddly_notes_bookmarks", survivorNameFor(ext, ServerContent))
	assert.Equal(t, "work_prompts", survivorNameFor(ext, ServerPrompts))
	assert.Empty(t, survivorNameFor(ext, "unknown-type"),
		"unknown server type returns empty instead of panicking")
}

func TestWriteConsolidationWarning__empty_is_noop(t *testing.T) {
	var buf bytes.Buffer
	writeConsolidationWarning(&buf, "claude-desktop", nil, false)
	assert.Empty(t, buf.String(), "no groups means no output")
}

func TestWriteConsolidationWarning__oauth_discloses_surviving_entry(t *testing.T) {
	groups := []ConsolidationGroup{
		{
			ServerType: ServerPrompts,
			Entries: []ServerMatch{
				{ServerType: ServerPrompts, Name: "personal_prompts", MatchMethod: MatchByURL},
				{ServerType: ServerPrompts, Name: "work_prompts", MatchMethod: MatchByURL},
			},
			SurvivorName: "personal_prompts",
		},
	}
	var buf bytes.Buffer
	writeConsolidationWarning(&buf, "claude-desktop", groups, false)

	out := buf.String()
	assert.Contains(t, out, "claude-desktop:")
	assert.Contains(t, out, "consolidated into tiddly_prompts")
	assert.Contains(t, out, "personal_prompts")
	assert.Contains(t, out, "work_prompts")
	assert.Contains(t, out,
		`PAT from "personal_prompts" will be reused for tiddly_prompts`,
		"surviving entry must be disclosed explicitly")
}

func TestWriteConsolidationWarning__oauth_reflects_caller_supplied_survivor(t *testing.T) {
	// The warning must not compute its own survivor — it shows whatever
	// SurvivorName the caller (RunConfigure preflight via ExtractPATs) wrote.
	// This test proves that contract: if the caller says "zzz_custom wins"
	// despite canonical being present, the warning names zzz_custom.
	groups := []ConsolidationGroup{
		{
			ServerType: ServerPrompts,
			Entries: []ServerMatch{
				{ServerType: ServerPrompts, Name: "aaa_custom", MatchMethod: MatchByURL},
				{ServerType: ServerPrompts, Name: serverNamePrompts, MatchMethod: MatchByName},
				{ServerType: ServerPrompts, Name: "zzz_custom", MatchMethod: MatchByURL},
			},
			SurvivorName: "zzz_custom",
		},
	}
	var buf bytes.Buffer
	writeConsolidationWarning(&buf, "claude-desktop", groups, false)

	assert.Contains(t, buf.String(),
		`PAT from "zzz_custom" will be reused for tiddly_prompts`,
		"warning must use caller-supplied SurvivorName, not reinvent the selection rule")
}

func TestWriteConsolidationWarning__oauth_without_survivor_notes_mint(t *testing.T) {
	// No entry yielded an extractable PAT (all empty/malformed). The warning
	// should note that a fresh token will be minted rather than silently
	// marking some entry with a misleading (*).
	groups := []ConsolidationGroup{
		{
			ServerType: ServerPrompts,
			Entries: []ServerMatch{
				{ServerType: ServerPrompts, Name: "work_prompts", MatchMethod: MatchByURL},
				{ServerType: ServerPrompts, Name: "personal_prompts", MatchMethod: MatchByURL},
			},
			// SurvivorName intentionally empty
		},
	}
	var buf bytes.Buffer
	writeConsolidationWarning(&buf, "claude-desktop", groups, false)

	out := buf.String()
	assert.Contains(t, out, "new token will be minted for tiddly_prompts",
		"empty SurvivorName under OAuth must advertise the mint path")
	assert.NotContains(t, out, "    * ",
		"no entry should get the '*' survivor marker when there is no survivor")
}

func TestWriteConsolidationWarning__renders_both_content_and_prompts_groups(t *testing.T) {
	groups := []ConsolidationGroup{
		{
			ServerType: ServerContent,
			Entries: []ServerMatch{
				{ServerType: ServerContent, Name: "personal_content", MatchMethod: MatchByURL},
				{ServerType: ServerContent, Name: "work_content", MatchMethod: MatchByURL},
			},
			SurvivorName: "personal_content",
		},
		{
			ServerType: ServerPrompts,
			Entries: []ServerMatch{
				{ServerType: ServerPrompts, Name: "personal_prompts", MatchMethod: MatchByURL},
				{ServerType: ServerPrompts, Name: "work_prompts", MatchMethod: MatchByURL},
			},
			SurvivorName: "personal_prompts",
		},
	}
	var buf bytes.Buffer
	writeConsolidationWarning(&buf, "claude-desktop", groups, false)

	out := buf.String()
	assert.Contains(t, out, "consolidated into tiddly_notes_bookmarks")
	assert.Contains(t, out, "consolidated into tiddly_prompts")
	assert.Contains(t, out, `PAT from "personal_content" will be reused for tiddly_notes_bookmarks`)
	assert.Contains(t, out, `PAT from "personal_prompts" will be reused for tiddly_prompts`)
	assert.Contains(t, out, "personal_content")
	assert.Contains(t, out, "work_content")
	assert.Contains(t, out, "personal_prompts")
	assert.Contains(t, out, "work_prompts")
}

func TestWriteConsolidationWarning__pat_auth_frames_as_account_rebind(t *testing.T) {
	groups := []ConsolidationGroup{
		{
			ServerType: ServerPrompts,
			Entries: []ServerMatch{
				{ServerType: ServerPrompts, Name: "personal_prompts", MatchMethod: MatchByURL},
				{ServerType: ServerPrompts, Name: "work_prompts", MatchMethod: MatchByURL},
			},
			// SurvivorName not meaningful under PAT auth; ignored.
		},
	}
	var buf bytes.Buffer
	writeConsolidationWarning(&buf, "claude-desktop", groups, true)

	out := buf.String()
	assert.Contains(t, out, "current logged-in account",
		"PAT-auth warning must frame the consolidation as a login rebind")
	assert.NotContains(t, out, "PAT from",
		"PAT-auth mode must not claim a specific entry's PAT 'survives' — the login token replaces all")
}
