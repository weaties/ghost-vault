#!/usr/bin/env bash
#
# Mirror the latest Ghost export into the private vault, then commit.
# Intended to be run UNATTENDED by launchd (see deploy/launchd/). This is the
# only sanctioned path that writes to the real VAULT_DIR.
#
# If GHOST_ADMIN_EMAIL/PASSWORD are set, it tries a scripted export first; on any
# failure (2FA, rate-limit, etc.) it falls back to the newest export in inbox/
# (from a manual "Migration tools -> Export"). It is safe to re-run.
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

# Load config (VAULT_DIR, GHOST_SITE_URL, GHOST_ADMIN_*). .env is gitignored.
if [[ -f .env ]]; then
  set -a; . ./.env; set +a
fi
: "${VAULT_DIR:?VAULT_DIR must be set in .env}"

# Scripted export is OPT-IN (AUTO_FETCH_EXPORT=1) and OFF by default: with staff
# 2FA enabled, every attempt emails a one-time code and then fails, so an
# unattended scheduled run must NOT try it. Default flow = process inbox/.
if [[ "${AUTO_FETCH_EXPORT:-0}" == "1" && -n "${GHOST_ADMIN_EMAIL:-}" && -z "${1:-}" ]]; then
  node src/cli.js fetch-export --out inbox \
    || echo "mirror-sync: scripted export failed (2FA/rate-limit?) — using newest inbox/ export" >&2
fi

# Pick the newest export from inbox/ (override with $1).
EXPORT_FILE="${1:-$(ls -t inbox/*.json 2>/dev/null | head -1 || true)}"
if [[ -z "${EXPORT_FILE:-}" || ! -f "$EXPORT_FILE" ]]; then
  echo "mirror-sync: no export file found (set GHOST_ADMIN_* for auto-export, or drop one in inbox/)" >&2
  exit 1
fi

echo "mirror-sync: syncing $EXPORT_FILE -> $VAULT_DIR"
node src/cli.js sync --from "$EXPORT_FILE"

# Archive the raw export with sparse retention (keeps oldest forever, thins the rest).
if [[ -n "${ARCHIVE_DIR:-}" ]]; then
  node src/cli.js archive --from "$EXPORT_FILE" --archive-dir "$ARCHIVE_DIR"
fi

# Commit the change in the vault repo (if it is a git repo).
if git -C "$VAULT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$VAULT_DIR" add -A
  if ! git -C "$VAULT_DIR" diff --cached --quiet; then
    git -C "$VAULT_DIR" commit -q -m "mirror: $(date +%F-%H%M)"
    echo "mirror-sync: committed changes"
  else
    echo "mirror-sync: no changes"
  fi
fi

