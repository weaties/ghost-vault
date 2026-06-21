#!/usr/bin/env bash
#
# Watch-folder ingest: find the newest Ghost export in WATCH_DIR (default
# ~/Downloads) and mirror it into the vault. Triggered by launchd WatchPaths
# whenever the folder changes (see deploy/launchd/). The only manual step in the
# whole pipeline is clicking "Export" in Ghost — the file lands in Downloads and
# this does the rest. Idempotent: `ingest` dedups, so repeated triggers are cheap.
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

if [[ -f .env ]]; then
  set -a; . ./.env; set +a
fi
: "${VAULT_DIR:?VAULT_DIR must be set in .env}"

WATCH_DIR="${WATCH_DIR:-$HOME/Downloads}"

# Newest file that looks like a Ghost export (named like *.ghost.*.json).
EXPORT_FILE="$(ls -t "$WATCH_DIR"/*ghost*.json 2>/dev/null | head -1 || true)"
if [[ -z "${EXPORT_FILE:-}" || ! -f "$EXPORT_FILE" ]]; then
  exit 0   # nothing to do (folder changed for some other reason)
fi

# Ingest validates it's really a Ghost export, dedups, syncs, and archives.
node src/cli.js ingest --from "$EXPORT_FILE"

# Commit the change in the vault repo (if it is one).
if git -C "$VAULT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$VAULT_DIR" add -A
  if ! git -C "$VAULT_DIR" diff --cached --quiet; then
    git -C "$VAULT_DIR" commit -q -m "mirror: $(date +%F-%H%M)"
    echo "ingest-downloads: committed changes"
  fi
fi
