# launchd — scheduled Ghost → vault mirror

Runs `bin/mirror-sync.sh` on a schedule so the vault stays current without you
remembering to run it. This is the **only** sanctioned unattended writer of the
real `VAULT_DIR`.

## Install

```sh
REPO_DIR="$(pwd)"   # run from the repo root
PLIST="$HOME/Library/LaunchAgents/com.weaties.ghost-mirror.plist"

# Fill the template with this repo's path.
sed "s|__REPO_DIR__|$REPO_DIR|g" \
  deploy/launchd/com.weaties.ghost-mirror.plist.template > "$PLIST"

chmod +x bin/mirror-sync.sh
launchctl load "$PLIST"
```

## Prerequisites

- `.env` has `VAULT_DIR` (and `GHOST_SITE_URL`) set.
- An export is available: drop a `Migration tools → Export` JSON into `inbox/`
  (until Tier-2 auto-export is built, the wrapper reads the newest `inbox/*.json`).
- Optional: `git init` inside `VAULT_DIR` so each run commits a diff.

## Operate

```sh
launchctl start com.weaties.ghost-mirror     # run now
tail -f out/mirror-sync.log                  # watch
launchctl unload "$PLIST"                     # disable
```

## Notes

- `StartInterval` is 6h (21600s); edit the plist to taste. A future RSS-watch
  agent (Milestone 6) can trigger a run promptly after you publish.
- launchd runs with a minimal environment — the plist sets `PATH`; adjust if your
  `node` lives elsewhere (`which node`).
- The wrapper is safe to re-run: the sync is idempotent (keyed by slug).
