import { markdownToHtml } from '../lib/markdown.js';

/**
 * Convert a NormalizedPost into a Ghost Admin API post payload.
 *
 * @param {NormalizedPost} post
 * @param {Map<string,string>} [imageUrlMap]  originalRef -> uploaded Ghost URL
 * @returns {object} Ghost post payload (use with api.posts.add(payload, { source: 'html' }))
 */
export function toGhostPost(post, imageUrlMap) {
  const bodyHtml =
    post.bodyHtml != null && post.bodyHtml !== ''
      ? rewriteHtmlImages(post.bodyHtml, imageUrlMap)
      : markdownToHtml(post.bodyMarkdown, imageUrlMap);

  const html = bodyHtml + renderCommentsAppendix(post.comments) + renderLocationNote(post.location);

  // Ghost tags: public tags by name; internal tags keep their '#' prefix.
  const tags = [...post.tags.map((name) => ({ name })), ...post.internalTags.map((name) => ({ name }))];

  const payload = {
    title: post.title,
    slug: post.slug,
    status: post.status,
    type: post.type || 'post',
    tags,
    html,
  };
  if (post.publishedAt) payload.published_at = post.publishedAt;

  // Explicit feature image (WP) wins; otherwise use the first uploaded/hotlinked image.
  const feature = post.featureImage || post.images.find((i) => i.uploadedUrl)?.uploadedUrl;
  if (feature) payload.feature_image = feature;

  return payload;
}

/** Rewrite <img src> for the WordPress-HTML path once uploads exist. */
function rewriteHtmlImages(html, imageUrlMap) {
  if (!imageUrlMap || imageUrlMap.size === 0) return html;
  let out = html;
  for (const [originalRef, url] of imageUrlMap) {
    out = out.split(originalRef).join(url);
  }
  return out;
}

/**
 * Comments cannot be imported as native Ghost comments (no API), so we append
 * them as a styled section at the bottom of the post body. See CLAUDE.md.
 */
function renderCommentsAppendix(comments) {
  if (!comments || comments.length === 0) return '';
  const items = comments
    .map((c) => {
      const when = c.date ? ` <span class="ported-comment-date">${formatDate(c.date)}</span>` : '';
      return `  <li class="ported-comment"><strong>${escapeHtml(c.author)}</strong>${when}<div>${c.html}</div></li>`;
    })
    .join('\n');
  return `\n<hr>\n<section class="ported-comments">\n<h3>Comments (imported)</h3>\n<ul>\n${items}\n</ul>\n</section>\n`;
}

/** Carry lat/long forward as a small note (Ghost has no native geo field). */
function renderLocationNote(location) {
  if (!location) return '';
  const [lat, lng] = location;
  return `\n<p class="ported-location" data-lat="${lat}" data-lng="${lng}"><small>📍 ${lat}, ${lng}</small></p>\n`;
}

function formatDate(iso) {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
