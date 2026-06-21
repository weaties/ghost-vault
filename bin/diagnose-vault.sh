#!/usr/bin/env bash
#
# Report the vault's image layout: how many images sit beside posts vs. in the
# top-level attachments/ folder, with sample paths and one post's refs. Read-only.
# Uses VAULT_DIR from .env, or pass a path as the first argument.
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"
[[ -f .env ]] && { set -a; . ./.env; set +a; }

V="${1:-${VAULT_DIR:?set VAULT_DIR in .env or pass the vault path as an argument}}"

# Images that are NOT inside any attachments/ folder.
find_strays() {
  find "$V" -path '*/attachments/*' -prune -o \
    \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \
       -o -iname '*.gif' -o -iname '*.webp' -o -iname '*.mov' \) -print 2>/dev/null
}

echo "vault: $V"
echo "images NOT in attachments/: $(find_strays | wc -l | tr -d ' ')"
echo "images in attachments/:     $(ls "$V/attachments" 2>/dev/null | wc -l | tr -d ' ')"

echo "--- up to 5 sample stray image paths (relative) ---"
find_strays | head -5 | sed "s|$V/||"

echo "--- one post's frontmatter feature_image + first image refs ---"
md="$(find "$V" -name '*.md' 2>/dev/null | head -1)"
echo "post: ${md#"$V"/}"
grep -m3 -E 'feature_image:|!\[' "$md" 2>/dev/null || true
