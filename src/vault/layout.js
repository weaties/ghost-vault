import path from 'node:path';

/**
 * Vault layout: ./<YYYY>/<MM>/<slug>.md with attachments beside the post,
 * named <slug>__<n>.<ext> (slug-prefixed so multiple posts can share a MM/
 * folder without image-name collisions).
 */

/** Year/month folder from an ISO date, or 'undated' if missing/unparseable. */
export function yearMonth(iso) {
  if (!iso) return ['undated', ''];
  const d = new Date(iso);
  if (isNaN(d)) return ['undated', ''];
  const y = String(d.getUTCFullYear());
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return [y, m];
}

/** Relative path (POSIX, from vault root) for a post's markdown file. */
export function postRelPath(post) {
  const [y, m] = yearMonth(post.published_at || post.created_at);
  const dir = m ? `${y}/${m}` : y;
  return `${dir}/${post.slug}.md`;
}

/** Relative path for the Nth attachment of a post (kind: 'feature' or a number). */
export function attachmentRelPath(post, kind, ext) {
  const [y, m] = yearMonth(post.published_at || post.created_at);
  const dir = m ? `${y}/${m}` : y;
  const tag = kind === 'feature' ? 'feature' : String(kind);
  return `${dir}/${post.slug}__${tag}${ext}`;
}

/** Just the filename portion of an attachment (what the markdown links to). */
export function attachmentFileName(post, kind, ext) {
  return path.posix.basename(attachmentRelPath(post, kind, ext));
}
