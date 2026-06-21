import 'dotenv/config';
import path from 'node:path';

/** Resolve a possibly-relative path from .env against the project root. */
function resolveMaybe(p) {
  if (!p) return undefined;
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

export const config = {
  ghost: {
    url: process.env.GHOST_ADMIN_API_URL,
    key: process.env.GHOST_ADMIN_API_KEY,
    version: process.env.GHOST_API_VERSION || 'v5.0',
  },
  obsidian: {
    repoPath: resolveMaybe(process.env.OBSIDIAN_REPO_PATH || './sources/blog'),
    // Public base for hotlinking Era-1 attachments (no upload needed).
    rawBase: process.env.OBSIDIAN_RAW_BASE || 'https://raw.githubusercontent.com/weaties/blog/main',
  },
  // Path to a Ghost Migration-tools Export JSON, used to reconcile (skip dups)
  // without the Admin API. Override per-run with --against=<file>.
  ghostExportPath: resolveMaybe(process.env.GHOST_EXPORT_PATH || './sources/ghost-export.json'),

  // Public Ghost site URL. Ghost exports store asset/link URLs as the portable
  // placeholder "__GHOST_URL__"; the vault mirror substitutes this real base.
  ghostSiteUrl: (process.env.GHOST_SITE_URL || 'https://weaties.ghost.io').replace(/\/$/, ''),
  wordpress: {
    // Primary: cached WordPress.com public-API responses (run scripts/fetch-wpcom.mjs).
    postsPath: resolveMaybe(process.env.WP_POSTS_PATH || './sources/wpcom-posts.json'),
    commentsPath: resolveMaybe(process.env.WP_COMMENTS_PATH || './sources/wpcom-comments.json'),
    // Fallback: a manual WXR export, if the API is ever unavailable.
    wxrPath: resolveMaybe(process.env.WP_WXR_PATH || './sources/wordpress-export.xml'),
    siteUrl: process.env.WP_SITE_URL || 'https://weatiesroadtrip2021.com',
  },
  outDir: resolveMaybe('./out'),

  // Ghost -> vault mirror. The vault is a PRIVATE directory inside the user's
  // personal Obsidian vault — set VAULT_DIR in .env (never committed). Claude/LLMs
  // must never read it; only launchd-run scripts write to it. See CLAUDE.md.
  vaultDir: resolveMaybe(process.env.VAULT_DIR), // undefined until configured

  // Durable archive of raw Ghost exports (sparse retention). Defaults beside the
  // vault if unset. Holds full content JSON — keep it private like the vault.
  archiveDir: resolveMaybe(process.env.ARCHIVE_DIR),
};
