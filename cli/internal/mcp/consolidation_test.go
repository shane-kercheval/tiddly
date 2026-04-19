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

func TestSurvivingEntryName__canonical_wins_over_custom(t *testing.T) {
	g := ConsolidationGroup{
		ServerType: ServerPrompts,
		Entries: []ServerMatch{
			{Name: "aaa_custom", MatchMethod: MatchByURL},
			{Name: serverNamePrompts, MatchMethod: MatchByName},
			{Name: "zzz_custom", MatchMethod: MatchByURL},
		},
	}
	assert.Equal(t, serverNamePrompts, survivingEntryName(g),
		"canonical-named entry should win regardless of alphabetical position")
}

func TestSurvivingEntryName__alphabetical_first_when_no_canonical(t *testing.T) {
	// Entries come in alphabetical order (invariant from detectConsolidations).
	g := ConsolidationGroup{
		ServerType: ServerPrompts,
		Entries: []ServerMatch{
			{Name: "personal_prompts", MatchMethod: MatchByURL},
			{Name: "work_prompts", MatchMethod: MatchByURL},
		},
	}
	assert.Equal(t, "personal_prompts", survivingEntryName(g),
		"with no canonical entry, alphabetical-first wins — mirrors ExtractPATs")
}

func TestSurvivingEntryName__empty_group(t *testing.T) {
	assert.Empty(t, survivingEntryName(ConsolidationGroup{}))
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

func TestWriteConsolidationWarning__oauth_canonical_survives_when_mixed(t *testing.T) {
	// Mixed: canonical + custom. Canonical wins.
	groups := []ConsolidationGroup{
		{
			ServerType: ServerPrompts,
			Entries: []ServerMatch{
				{ServerType: ServerPrompts, Name: "custom_prompts", MatchMethod: MatchByURL},
				{ServerType: ServerPrompts, Name: serverNamePrompts, MatchMethod: MatchByName},
			},
		},
	}
	var buf bytes.Buffer
	writeConsolidationWarning(&buf, "claude-desktop", groups, false)

	out := buf.String()
	assert.Contains(t, out,
		`PAT from "tiddly_prompts" will be reused for tiddly_prompts`,
		"canonical entry must survive even when alphabetically later")
}

func TestWriteConsolidationWarning__renders_both_content_and_prompts_groups(t *testing.T) {
	// When both server types need consolidation, every group must render.
	// Guards against accidental `break` in the loop or a regression where
	// writeConsolidationWarning exits after the first group.
	groups := []ConsolidationGroup{
		{
			ServerType: ServerContent,
			Entries: []ServerMatch{
				{ServerType: ServerContent, Name: "personal_content", MatchMethod: MatchByURL},
				{ServerType: ServerContent, Name: "work_content", MatchMethod: MatchByURL},
			},
		},
		{
			ServerType: ServerPrompts,
			Entries: []ServerMatch{
				{ServerType: ServerPrompts, Name: "personal_prompts", MatchMethod: MatchByURL},
				{ServerType: ServerPrompts, Name: "work_prompts", MatchMethod: MatchByURL},
			},
		},
	}
	var buf bytes.Buffer
	writeConsolidationWarning(&buf, "claude-desktop", groups, false)

	out := buf.String()

	// Both canonical targets appear, with their respective survivor lines.
	assert.Contains(t, out, "consolidated into tiddly_notes_bookmarks")
	assert.Contains(t, out, "consolidated into tiddly_prompts")
	assert.Contains(t, out, `PAT from "personal_content" will be reused for tiddly_notes_bookmarks`)
	assert.Contains(t, out, `PAT from "personal_prompts" will be reused for tiddly_prompts`)

	// All four entry names must surface (content keys + prompts keys).
	assert.Contains(t, out, "personal_content")
	assert.Contains(t, out, "work_content")
	assert.Contains(t, out, "personal_prompts")
	assert.Contains(t, out, "work_prompts")
}

func TestWriteConsolidationWarning__pat_auth_frames_as_account_rebind(t *testing.T) {
	// Under PAT auth, every entry gets the user's login token — there's no
	// "surviving PAT," just a rebind. The warning should reflect that so
	// users understand work/personal distinctions collapse to the login account.
	groups := []ConsolidationGroup{
		{
			ServerType: ServerPrompts,
			Entries: []ServerMatch{
				{ServerType: ServerPrompts, Name: "personal_prompts", MatchMethod: MatchByURL},
				{ServerType: ServerPrompts, Name: "work_prompts", MatchMethod: MatchByURL},
			},
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
