# Runbook — Ghost → Obsidian vault mirror

Operational steps for Phase 2 (mirror Ghost content into the private vault).
Design rationale lives in `docs/ghost-to-vault.md`; this is the "how to run it".

> ⛔ The real vault (`VAULT_DIR`) is inside the user's personal Obsidian vault
> (private journals). Never read it. Inspect output only via `--dry-run`
> (`out/vault-preview/`). Real writes happen only through launchd.

## One-time setup

1. Copy env and set the vault path (kept out of git):
   ```sh
   cp .env.example .env
   # edit .env:
   #   VAULT_DIR=/Users/<you>/ObsidianVault/blog-mirror      # the private mirror dir
   #   GHOST_SITE_URL=https://weaties.ghost.io
   ```
2. `npm install`
3. (Recommended) make the mirror dir its own git repo for history:
   ```sh
   git -C "$VAULT_DIR" init
   ```

## Routine: mirror the latest content

### A. Get a Ghost export
- **Manual (always works):** Ghost Admin → Settings → Migration tools → **Export**.
  Save the JSON to `inbox/ghost-export.json` (gitignored).
- **Scripted (Tier 2, once built):** `node src/cli.js fetch-export` — staff-session
  login + DB export. Falls back to manual if Ghost(Pro) prompts for a 2FA code.

### B. Preview the conversion (safe — no vault writes)
```sh
node src/cli.js sync --from inbox/ghost-export.json --dry-run
# inspect out/vault-preview/<YYYY>/<MM>/<slug>.md
```

### C. Write to the real vault
```sh
node src/cli.js sync --from inbox/ghost-export.json     # uses VAULT_DIR from .env
git -C "$VAULT_DIR" add -A && git -C "$VAULT_DIR" commit -m "mirror: $(date +%F)"
```

Re-running is safe and idempotent: files are keyed by slug, so edits update in
place and `git diff` shows exactly what changed in Ghost since last run.

## Flags

| Flag | Effect |
|------|--------|
| `--from <file>` | Ghost export JSON to mirror (required) |
| `--dry-run` | Write to `out/vault-preview/` instead of `VAULT_DIR` |
| `--out <dir>` | Override the output dir explicitly |
| `--drafts` | Include draft posts (default: published only) |

## Scheduling (launchd)

Templates live in `deploy/launchd/`. They run a wrapper (`bin/mirror-sync.sh`)
that: picks the newest export, runs `sync` to `VAULT_DIR`, prunes the JSON
archive, and commits. See `deploy/launchd/README.md` to install. Until Tier-2
auto-export exists, the wrapper expects a fresh export in `inbox/`.

## Gotchas

- **2FA:** scripted export can be blocked by a Ghost(Pro) email code on new-device
  logins. Run from a stable machine/IP and persist the session; else use manual export.
- **Images:** downloaded locally beside each post (Milestone 2) → the vault is
  self-contained. Full-resolution originals, so the mirror is large (~940MB for
  ~68 image-heavy posts). Re-runs skip images already on disk. Use `--no-images`
  to keep them as Ghost URLs (fast), or `--limit N` to process a subset.
- **Deletions:** a post removed in Ghost won't be re-emitted but is **not** deleted
  from the vault automatically — the sync reports it so you decide.
