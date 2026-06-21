# launchd agents

Two ways to keep the vault current. Both are sanctioned unattended writers of the
real `VAULT_DIR`; pick one (the **watch agent is recommended**).

## Recommended: watch the Downloads folder (`ghost-vault-watch`)

Your Ghost exports land in `~/Downloads` when you click **Migration tools →
Export**. This agent watches that folder and ingests any new export
automatically — no login, no 2FA, no file-moving. The only manual step is the
Export click.

```sh
bin/install-watch-agent.sh        # run from the repo root
```

The installer fills the plist with this repo's path, `WATCH_DIR` (from `.env`, or
`~/Downloads`), and your real `node` directory (so launchd's minimal `PATH` finds
an nvm/homebrew node), then loads the agent. Safe to re-run. Re-run it if you
change node versions (nvm) so the baked-in node path stays valid.

`WatchPaths` fires on any change in the folder; the script exits instantly when
there's no new Ghost export, so frequent triggers are cheap. `ingest` dedups via
the archive, so re-triggers do no redundant work. `RunAtLoad` means it processes
whatever export is already in the folder on load (and each login) — the first
load does your initial populate.

## Alternative: scheduled inbox processing (`ghost-mirror`)

Runs `bin/mirror-sync.sh` every 6h against the newest export in `inbox/` (you drop
exports there manually). Use this instead of the watcher if you prefer a fixed
cadence over folder-watching.

```sh
PLIST="$HOME/Library/LaunchAgents/com.weaties.ghost-mirror.plist"
sed "s|__REPO_DIR__|$(pwd)|g" deploy/launchd/com.weaties.ghost-mirror.plist.template > "$PLIST"
chmod +x bin/mirror-sync.sh
launchctl load "$PLIST"
```

## Prerequisites (both)

- `.env` has `VAULT_DIR`, `GHOST_SITE_URL`, and (recommended) `ARCHIVE_DIR`.
- Optional: `git init` inside `VAULT_DIR` so each run commits a diff.
- launchd has a minimal environment — the plist sets `PATH`; adjust if your `node`
  lives elsewhere (`which node`).

## Operate

```sh
launchctl start com.weaties.ghost-vault-watch     # run now
tail -f out/ingest.log                            # watch
launchctl unload "$HOME/Library/LaunchAgents/com.weaties.ghost-vault-watch.plist"   # disable
```

## Note on scripted export

`fetch-export` (staff-session login) is **not** used by either agent — with
Ghost(Pro) staff 2FA enabled it emails a code on every login and can't run
unattended. The watch-Downloads approach is the reliable answer.
