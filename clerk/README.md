# Clerk instance configuration (config-as-code)

`config.dev.json` is the committed source of truth for the **development** Clerk instance's
configuration (auth strategies, session-token claims, session settings, sign-up mode, etc.).
It is the normalized output of `clerk config pull` (keys sorted for clean diffs) and contains
**no secrets** — publishable/secret keys and OAuth client secrets are never part of `config pull`.
Instance/app IDs are likewise not stored here; they live in local env and a private note.

Part of the Auth0 → Clerk migration (see `docs/implementation_plans/2026-07-02-clerk-migration.md`).

## Update it when the dev instance config changes

Any time the dev instance's configuration changes (e.g. adding the CLI OAuth app, enabling
dynamic client registration), re-pull and re-commit so git tracks the evolution:

```sh
clerk config pull | python3 -c "import json,sys; json.dump(json.load(sys.stdin), sys.stdout, indent=2, sort_keys=True); print()" > clerk/config.dev.json
```

## Drift check (is the live instance still what we committed?)

```sh
diff <(clerk config pull | python3 -c "import json,sys; json.dump(json.load(sys.stdin), sys.stdout, indent=2, sort_keys=True); print()") clerk/config.dev.json
```

An empty diff means the live dev instance matches the committed config. A non-empty diff means
someone changed the live instance out-of-band (or the file is stale) — reconcile before relying on it.

## Not covered by `config pull`: instance OAuth application settings

`clerk config pull` does **not** include the instance's `oauth_application_settings`
(discovered when enabling dynamic client registration produced no diff on re-pull).
Those settings are therefore recorded here instead — check the live values with:

```sh
clerk api /instance/oauth_application_settings --instance dev   # or --instance prod
```

Intended state (last verified 2026-07-15):

| Setting | dev | prod | Why |
|---|---|---|---|
| `dynamic_oauth_client_registration` | `true` | `true` (flips as part of the MCP-OAuth deploy) | Lets MCP OAuth clients (ChatGPT, Claude connectors) self-register |
| `oauth_jwt_access_tokens` | `true` | `true` | Required — opaque access tokens would 401 at the API |

## Promotion to production

Production instance config is derived from this committed dev config — via `clerk deploy`
(clones dev → prod) and/or `clerk config put --instance prod --file clerk/config.dev.json`.
Production-specific values that differ from dev (real Google OAuth credentials, the production
Frontend API domain) are applied on top and are **not** in this file.
