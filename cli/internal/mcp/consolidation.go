package mcp

import (
	"fmt"
	"io"
	"sort"
)

// ConsolidationGroup describes a set of existing Tiddly MCP entries of the
// same ServerType that a configure operation will collapse into a single
// canonical entry. Surfaced before the write so users can see the potential
// data loss — each entry may hold a distinct PAT, and only one survives.
//
// SurvivorName holds the config key whose PAT will actually be reused during
// the rewrite. It is authoritative, populated by the RunConfigure preflight
// from handler.ExtractPATs — so the warning and the eventual write cannot
// disagree. Empty under PAT auth (not applicable) or when no entry has an
// extractable PAT.
type ConsolidationGroup struct {
	ServerType   string
	Entries      []ServerMatch
	SurvivorName string
}

// allServerTypes is the canonical list of tiddly server types. Anything
// iterating "for each type" should use this rather than hardcoding a literal
// slice, so adding a future type has one place to update.
var allServerTypes = []string{ServerContent, ServerPrompts}

// canonicalNameForServerType returns the canonical config key name that
// configure will write for the given server type.
func canonicalNameForServerType(serverType string) string {
	switch serverType {
	case ServerContent:
		return serverNameContent
	case ServerPrompts:
		return serverNamePrompts
	default:
		return serverType
	}
}

// detectConsolidations inspects a pre-configure StatusResult and returns a
// ConsolidationGroup for each ServerType in wantServers where the existing
// config has more than one matching entry. Empty wantServers means both
// types (the default --servers behavior).
//
// Returns nil when no consolidation would occur — the common, safe case
// where each targeted type has zero or one existing entry. SurvivorName on
// the returned groups is left empty; callers are responsible for populating
// it from handler.ExtractPATs.
func detectConsolidations(sr StatusResult, wantServers []string) []ConsolidationGroup {
	wantType := map[string]bool{}
	if len(wantServers) == 0 {
		for _, t := range allServerTypes {
			wantType[t] = true
		}
	} else {
		for _, s := range wantServers {
			wantType[s] = true
		}
	}

	byType := map[string][]ServerMatch{}
	for _, s := range sr.Servers {
		if !wantType[s.ServerType] {
			continue
		}
		byType[s.ServerType] = append(byType[s.ServerType], s)
	}

	var groups []ConsolidationGroup
	for _, t := range allServerTypes {
		if len(byType[t]) > 1 {
			entries := byType[t]
			sort.Slice(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })
			groups = append(groups, ConsolidationGroup{ServerType: t, Entries: entries})
		}
	}
	return groups
}

// survivorNameFor picks the right survivor field from a PATExtraction for a
// given server type. Returns "" if the type is unknown.
func survivorNameFor(ext PATExtraction, serverType string) string {
	switch serverType {
	case ServerContent:
		return ext.ContentName
	case ServerPrompts:
		return ext.PromptName
	default:
		return ""
	}
}

// writeConsolidationWarning emits a human-readable warning describing the
// entries that will be consolidated, including which entry's PAT survives.
// Used by dry-run output and by the interactive prompt so the two paths
// stay consistent.
//
// isPATAuth changes the survivor semantics: under PAT auth the user's
// current login token replaces every entry (no "reused" PAT), so the
// message frames the loss as an account rebinding instead of a PAT
// discard. Under OAuth the caller must populate ConsolidationGroup.
// SurvivorName from handler.ExtractPATs so the disclosure matches the
// eventual write.
func writeConsolidationWarning(w io.Writer, toolName string, groups []ConsolidationGroup, isPATAuth bool) {
	if len(groups) == 0 {
		return
	}
	for _, g := range groups {
		canonical := canonicalNameForServerType(g.ServerType)
		fmt.Fprintf(w, "  %s: %d existing Tiddly %s entries will be consolidated into %s:\n",
			toolName, len(g.Entries), g.ServerType, canonical)
		for _, e := range g.Entries {
			marker := "    - "
			if !isPATAuth && e.Name == g.SurvivorName {
				marker = "    * "
			}
			fmt.Fprintf(w, "%s%s\n", marker, e.Name)
		}
		switch {
		case isPATAuth:
			fmt.Fprintln(w, "    All entries will be replaced with a single entry bound to your current logged-in account.")
			fmt.Fprintln(w, "    Any separate Tiddly accounts these entries pointed to are no longer reachable from this tool.")
		case g.SurvivorName != "":
			// "if still valid" honestly describes the commit-phase
			// validate-then-mint fallback: if the survivor's PAT fails
			// validation, configure mints a fresh token instead. Keeps
			// preflight read-only (no /users/me probes) while making the
			// disclosure accurate about what the user might actually see.
			fmt.Fprintf(w, "    (*) PAT from %q will be reused for %s if still valid; otherwise a fresh token will be minted. Other entries are deleted from the config file.\n",
				g.SurvivorName, canonical)
		default:
			fmt.Fprintf(w, "    No reusable PAT found — a new token will be minted for %s; other entries are deleted.\n", canonical)
		}
	}
}
