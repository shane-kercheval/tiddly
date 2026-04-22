#!/usr/bin/env bash
# shellcheck shell=bash
#
# Optional helpers for cli/tests_agentic/agent_instructions.md.
#
# Sourcing is OPTIONAL. The procedure does not mandate these helpers — the
# agent is free to write its own shell/jq/python checks per test. These
# exist only because a few operations are genuinely worth defining once:
#
#   sha_of                        portable SHA256 (macOS + Linux)
#   assert_no_plaintext_bearers   defense-in-depth: PAT-leak guard
#   sanitize_canonical_json       Phase 0 hard-strip of canonical Tiddly keys
#   sanitize_canonical_toml       same, for Codex TOML
#   write_multi_entry_prompts     fixture used by several tests
#
# None of these maintain state; sourcing has no side effects beyond binding
# one conditional function. Safe to source any number of times.
#
# Nothing in this file contains secrets.

# ---------------------------------------------------------------------------
# Portable SHA256 (macOS ships shasum; Linux ships sha256sum)
# ---------------------------------------------------------------------------

if command -v sha256sum >/dev/null 2>&1; then
    _sha256_cmd() { sha256sum "$@"; }
else
    _sha256_cmd() { shasum -a 256 "$@"; }
fi

# sha_of FILE
#   -> hash on stdout, or "MISSING" if the file doesn't exist.
# Fails loud (non-zero rc, stderr note) if the underlying tool misbehaves;
# silent empty output would cascade into false "file changed" asserts.
sha_of() {
    if [ ! -e "$1" ]; then
        echo "MISSING"
        return 0
    fi
    local out
    out=$(_sha256_cmd "$1" 2>/dev/null | awk '{print $1}')
    if [ -z "$out" ]; then
        echo "sha_of: empty output from sha256 tool on $1 (PATH issue?)" >&2
        return 1
    fi
    echo "$out"
}

# ---------------------------------------------------------------------------
# PAT-leak guard
# ---------------------------------------------------------------------------
#
# The CLI redacts `Bearer bm_<plaintext>` to `Bearer bm_REDACTED` before
# printing configure/remove/dry-run output. This is a defense-in-depth check:
# call it on any captured CLI output before echoing, and it FATALs (exit 1)
# if a real token slipped through. Never use this on `tokens create` output
# — that command is the one legitimate plaintext surface.

assert_no_plaintext_bearers() {
    local blob="$1" label="${2:-unlabeled}"
    if echo "$blob" | awk '
            /Bearer[ \t]+bm_/ {
                while (match($0, /Bearer[ \t]+bm_[A-Za-z0-9_-]+/)) {
                    tok = substr($0, RSTART, RLENGTH)
                    gsub(/^Bearer[ \t]+/, "", tok)
                    if (tok != "bm_REDACTED") { found = 1 }
                    $0 = substr($0, RSTART + RLENGTH)
                }
            }
            END { exit (found ? 0 : 1) }
        '; then
        echo "FATAL [$label]: plaintext 'Bearer bm_...' value found in output." >&2
        echo "                The CLI redactor has regressed, or a new code path prints tokens raw." >&2
        echo "                NOT echoing the offending blob (it contains a live token)." >&2
        echo "                Stop and report to the engineer before running anything else." >&2
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# Canonical-Tiddly strippers (Phase 0 sanitize)
# ---------------------------------------------------------------------------
#
# `mcp remove` strips by URL — so it leaves alone any `tiddly_*` entries
# whose URL is NOT the current local $TIDDLY_*_MCP_URL (e.g. the user's real
# production entries). Phase 0 needs to hard-strip the two canonical names
# regardless of URL so the tests start from a guaranteed-clean slate. The
# user's originals are already in $BACKUP_DIR at that point and will be
# restored by Phase 9.

sanitize_canonical_json() {
    local cfg="$1" tmp
    [ -f "$cfg" ] || return 0
    tmp=$(mktemp)
    jq '
        (.mcpServers //= {})
        | del(.mcpServers.tiddly_notes_bookmarks, .mcpServers.tiddly_prompts)
        | if (.projects|type) == "object"
            then .projects |= with_entries(
                .value.mcpServers |= (. // {} | del(.tiddly_notes_bookmarks, .tiddly_prompts)))
            else . end
    ' "$cfg" > "$tmp" && mv "$tmp" "$cfg"
    chmod 0600 "$cfg"
}

sanitize_canonical_toml() {
    local cfg="$1"
    local tmp="$cfg.tmp"
    [ -f "$cfg" ] || return 0
    awk '
        /^\[mcp_servers\.(tiddly_notes_bookmarks|tiddly_prompts)(\.|\])/ { skip=1; next }
        /^\[/                                                             { skip=0 }
        !skip                                                             { print }
    ' "$cfg" > "$tmp" && mv "$tmp" "$cfg"
    chmod 0600 "$cfg"
}

# ---------------------------------------------------------------------------
# Multi-entry fixture (T2.11, T4.4, T5.8)
# ---------------------------------------------------------------------------
#
# Writes two non-CLI-managed prompt entries (`work_prompts`, `personal_prompts`)
# pointing at $TIDDLY_PROMPT_MCP_URL, each with its own PAT. Used to simulate
# a multi-account setup. Strips any pre-existing canonical CLI-managed
# entries so the caller can rely on starting from "user already had
# multi-account, no CLI-managed yet".
#
#   write_multi_entry_prompts <pat_work> <pat_personal> [config_path]
#
# The third argument defaults to $CLAUDE_CODE_CONFIG (every current caller
# targets claude-code). Pass an explicit path only if you need a different
# target file.
#
# Requires $TIDDLY_PROMPT_MCP_URL to be exported.

write_multi_entry_prompts() {
    local pat_work="$1" pat_personal="$2" cfg="${3:-${CLAUDE_CODE_CONFIG:-}}" tmp
    [ -n "$pat_work" ] && [ -n "$pat_personal" ] \
        || { echo "write_multi_entry_prompts: usage: <pat_work> <pat_personal> [config_path]" >&2; return 1; }
    [ -n "$cfg" ] \
        || { echo "write_multi_entry_prompts: no config path — pass one or export CLAUDE_CODE_CONFIG" >&2; return 1; }
    [ -n "${TIDDLY_PROMPT_MCP_URL:-}" ] \
        || { echo "write_multi_entry_prompts: TIDDLY_PROMPT_MCP_URL not set" >&2; return 1; }
    tmp=$(mktemp)
    [ -f "$cfg" ] || echo "{}" > "$cfg"
    jq --arg url "$TIDDLY_PROMPT_MCP_URL" --arg w "$pat_work" --arg p "$pat_personal" '
        .mcpServers = (.mcpServers // {})
        | .mcpServers.work_prompts     = {type:"http", url:$url, headers:{Authorization:("Bearer "+$w)}}
        | .mcpServers.personal_prompts = {type:"http", url:$url, headers:{Authorization:("Bearer "+$p)}}
        | del(.mcpServers.tiddly_notes_bookmarks, .mcpServers.tiddly_prompts)
    ' "$cfg" > "$tmp" && mv "$tmp" "$cfg"
    chmod 0600 "$cfg"
}
