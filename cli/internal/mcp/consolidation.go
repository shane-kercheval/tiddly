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
type ConsolidationGroup struct {
	ServerType string
	Entries    []ServerMatch
}

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
// where each targeted type has zero or one existing entry.
func detectConsolidations(sr StatusResult, wantServers []string) []ConsolidationGroup {
	wantType := map[string]bool{}
	if len(wantServers) == 0 {
		wantType[ServerContent] = true
		wantType[ServerPrompts] = true
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
	for _, t := range []string{ServerContent, ServerPrompts} {
		if len(byType[t]) > 1 {
			entries := byType[t]
			sort.Slice(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })
			groups = append(groups, ConsolidationGroup{ServerType: t, Entries: entries})
		}
	}
	return groups
}

// survivingEntryName returns the config key whose PAT would be reused when
// the group is consolidated under OAuth auth. This mirrors ExtractPATs
// semantics: prefer a canonical-named entry (MatchByName) if present,
// otherwise the alphabetically-first entry. Entries in detectConsolidations
// output are already alphabetically sorted.
func survivingEntryName(g ConsolidationGroup) string {
	if len(g.Entries) == 0 {
		return ""
	}
	for _, e := range g.Entries {
		if e.MatchMethod == MatchByName {
			return e.Name
		}
	}
	return g.Entries[0].Name
}

// writeConsolidationWarning emits a human-readable warning describing the
// entries that will be consolidated, including which entry's PAT survives.
// Used by dry-run output and by the interactive prompt so the two paths
// stay consistent.
//
// isPATAuth changes the survivor semantics: under PAT auth the user's
// current login token replaces every entry (no "reused" PAT), so the
// message frames the loss as an account rebinding instead of a PAT
// discard.
func writeConsolidationWarning(w io.Writer, toolName string, groups []ConsolidationGroup, isPATAuth bool) {
	if len(groups) == 0 {
		return
	}
	for _, g := range groups {
		canonical := canonicalNameForServerType(g.ServerType)
		fmt.Fprintf(w, "  %s: %d existing Tiddly %s entries will be consolidated into %s:\n",
			toolName, len(g.Entries), g.ServerType, canonical)
		survivor := survivingEntryName(g)
		for _, e := range g.Entries {
			marker := "    - "
			if !isPATAuth && e.Name == survivor {
				marker = "    * "
			}
			fmt.Fprintf(w, "%s%s\n", marker, e.Name)
		}
		if isPATAuth {
			fmt.Fprintln(w, "    All entries will be replaced with a single entry bound to your current logged-in account.")
			fmt.Fprintln(w, "    Any separate Tiddly accounts these entries pointed to are no longer reachable from this tool.")
		} else {
			fmt.Fprintf(w, "    (*) PAT from %q will be reused for %s; other entries are deleted from the config file.\n",
				survivor, canonical)
		}
	}
}
