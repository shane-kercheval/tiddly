# Clerk instance configuration (config-as-code)

`config.dev.json` is the committed source of truth for the **development** Clerk instance's
configuration (auth strategies, session-token claims, session settings, sign-up mode, etc.).
It is the normalized output of `clerk config pull` (keys sorted for clean diffs) and contains
**no secrets** — publishable/secret keys and OAuth client secrets are never part of `config pull`.
Instance/app IDs are likewise not stored here; they live in local env and a private note.

Part of the Auth0 → Clerk migration (see `docs/implementation_plans/2026-07-02-clerk-migration.md`).

## Update it when the dev instance config changes

Any time the dev instance's configuration changes (e.g. M4 adds the CLI OAuth app, M5 enables
DCR), re-pull and re-commit so git tracks the evolution:

```sh
clerk config pull | python3 -c "import json,sys; json.dump(json.load(sys.stdin), sys.stdout, indent=2, sort_keys=True); print()" > clerk/config.dev.json
```

## Drift check (is the live instance still what we committed?)

```sh
diff <(clerk config pull | python3 -c "import json,sys; json.dump(json.load(sys.stdin), sys.stdout, indent=2, sort_keys=True); print()") clerk/config.dev.json
```

An empty diff means the live dev instance matches the committed config. A non-empty diff means
someone changed the live instance out-of-band (or the file is stale) — reconcile before relying on it.

## Promotion to production (M3)

At M3, production instance config is derived from this committed dev config — via `clerk deploy`
(clones dev → prod) and/or `clerk config put --instance prod --file clerk/config.dev.json`.
Production-specific values that differ from dev (real Google OAuth credentials, the production
Frontend API domain) are applied on top and are **not** in this file.
