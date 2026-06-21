#!/usr/bin/env bash
#
# Install + load the watch-Downloads launchd agent. Fills the plist template with
# this repo's path, the watched folder (WATCH_DIR or ~/Downloads), and the real
# `node` directory (so launchd's minimal PATH can find an nvm/homebrew node).
# Safe to re-run (reloads). RunAtLoad ingests whatever export is already in the
# folder on load (and on every login) — dedup makes repeat runs cheap no-ops.
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

[[ -f .env ]] && { set -a; . ./.env; set +a; }
WATCH_DIR="${WATCH_DIR:-$HOME/Downloads}"

NODE_BIN="$(command -v node || true)"
[[ -n "$NODE_BIN" ]] || { echo "install: 'node' not found on PATH" >&2; exit 1; }
NODE_DIR="$(dirname "$NODE_BIN")"

LABEL="com.weaties.ghost-vault-watch"
TEMPLATE="deploy/launchd/$LABEL.plist.template"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

mkdir -p "$HOME/Library/LaunchAgents" out
chmod +x bin/ingest-downloads.sh

sed -e "s|__REPO_DIR__|$REPO_DIR|g" \
    -e "s|__WATCH_DIR__|$WATCH_DIR|g" \
    -e "s|__NODE_BIN__|$NODE_DIR|g" \
    "$TEMPLATE" > "$PLIST"

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "installed + loaded: $LABEL"
echo "  repo:  $REPO_DIR"
echo "  watch: $WATCH_DIR"
echo "  node:  $NODE_DIR"
echo "  plist: $PLIST"
echo "  logs:  out/ingest.log  out/ingest.err.log"
