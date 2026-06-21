/**
 * Vault layout: posts at ./<YYYY>/<MM>/<slug>.md; images in a top-level
 * ./attachments/ folder named <slug>__<n>.<ext> / <slug>__feature.<ext>
 * (slug-prefixed so they never collide). Image paths/refs are computed in
 * convert.js (post-relative, e.g. `../../attachments/<slug>__1.jpg`).
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
