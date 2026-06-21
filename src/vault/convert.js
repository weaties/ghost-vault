import path from 'node:path';
import matter from 'gray-matter';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { postRelPath } from './layout.js';

/**
 * Convert a Ghost export document into vault files (markdown + frontmatter).
 * Milestone 1: images are left as their original Ghost URLs (local download is
 * a later milestone). One-directional — Ghost is authoritative.
 */

function makeTurndown() {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
  });
  td.use(gfm);
  // Preserve embeds/iframes (gaiagps, YouTube) as raw HTML — never drop them.
  td.keep(['iframe']);
  // Figure captions -> a caption line under the image.
  td.addRule('figcaption', {
    filter: 'figcaption',
    replacement: (content) => (content.trim() ? `\n*${content.trim()}*\n` : ''),
  });
  // Ghost bookmark cards -> a simple link (keep the destination, drop the chrome).
  td.addRule('bookmark', {
    filter: (node) => node.nodeName === 'FIGURE' && /kg-bookmark-card/.test(node.className || ''),
    replacement: (_content, node) => {
      const a = node.querySelector?.('a.kg-bookmark-container, a');
      const href = a?.getAttribute?.('href');
      const title = node.querySelector?.('.kg-bookmark-title')?.textContent?.trim();
      return href ? `\n[${title || href}](${href})\n` : '';
    },
  });
  return td;
}

/**
 * Join a post's tag names from the export's posts_tags + tags tables.
 * Internal ('#'-prefixed) tags are preserved.
 */
function tagNamesFor(postId, tagsById, postsTags) {
  return postsTags
    .filter((pt) => pt.post_id === postId)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((pt) => tagsById.get(pt.tag_id))
    .filter(Boolean);
}

/** Ghost exports use this placeholder for the site base; swap in the real URL. */
function resolveGhostUrls(s, siteUrl) {
  return s == null ? s : String(s).split('__GHOST_URL__').join(siteUrl);
}

const IMG_TAG_RE = /<img\b[^>]*>/gi;
// Capture the src value between matching quotes so a literal apostrophe inside a
// double-quoted URL (e.g. .../A-380's....png) doesn't truncate the match.
const SRC_RE = /\bsrc=(["'])([\s\S]*?)\1/i;

const isHttp = (u) => /^https?:\/\//i.test(String(u || ''));

/** File extension for a local copy, derived from the URL path (defaults .jpg). */
function extFromUrl(url) {
  try {
    const m = new URL(url).pathname.match(/\.([A-Za-z0-9]{1,5})$/);
    return m ? `.${m[1].toLowerCase()}` : '.jpg';
  } catch {
    return '.jpg';
  }
}

/**
 * Plan local filenames for a post's images and rewrite the HTML body + feature
 * URL to point at them. Only http(s) images are localized/downloaded; relative or
 * otherwise non-URL refs (e.g. broken `../attachments/...` never rewritten upstream)
 * are left exactly as-is and counted as `skipped` — they're already broken in Ghost,
 * so the mirror preserves them faithfully rather than erroring on a fetch. Images go
 * in a top-level `attachments/` dir; refs are post-relative (e.g. `../../attachments/…`).
 */
function localizeImages(html, featureUrl, slug, relPath) {
  // Post-relative path to the vault's top-level attachments/ dir (depth-aware,
  // so it's correct for `2024/02/post.md` -> `../../attachments` and undated -> `../attachments`).
  const toAttach = path.posix.relative(path.posix.dirname(relPath), 'attachments');
  const map = new Map(); // url -> post-relative ref (dedup within the post)
  let n = 0;
  let skipped = 0;
  let feature = featureUrl;
  if (isHttp(featureUrl)) {
    const fn = `${toAttach}/${slug}__feature${extFromUrl(featureUrl)}`;
    map.set(featureUrl, fn);
    feature = fn;
  }
  const rewritten = html.replace(IMG_TAG_RE, (tag) => {
    const m = tag.match(SRC_RE);
    if (!m) return tag;
    const src = m[2];
    if (!isHttp(src)) {
      skipped += 1; // relative / broken ref — leave untouched, don't download
      return tag;
    }
    let fn = map.get(src);
    if (!fn) {
      fn = `${toAttach}/${slug}__${++n}${extFromUrl(src)}`;
      map.set(src, fn);
    }
    return tag.replace(src, fn);
  });
  const downloads = [...map].map(([url, fileName]) => ({ url, fileName }));
  return { html: rewritten, feature, downloads, skipped };
}

/**
 * @param {object} exportDoc  parsed Ghost export JSON
 * @param {{ includeDrafts?: boolean, siteUrl?: string, localizeImages?: boolean }} [opts]
 * @returns {Array<{ relPath, markdown, downloads, post }>}  one entry per post
 */
export function convertExport(exportDoc, opts = {}) {
  const data = exportDoc?.db?.[0]?.data || exportDoc?.data || {};
  const posts = Array.isArray(data.posts) ? data.posts : [];
  const tagsById = new Map((data.tags || []).map((t) => [t.id, t.name]));
  const postsTags = data.posts_tags || [];
  const siteUrl = (opts.siteUrl || 'https://example.ghost.io').replace(/\/$/, '');
  const doLocalize = opts.localizeImages !== false; // default on (Milestone 2)
  const td = makeTurndown();

  const out = [];
  for (const p of posts) {
    const status = p.status || 'published';
    if (status !== 'published' && !opts.includeDrafts) continue;

    const relPath = postRelPath({ ...p, slug: p.slug });
    let html = resolveGhostUrls(p.html || '', siteUrl);
    let feature = resolveGhostUrls(p.feature_image, siteUrl) || null;
    let downloads = [];
    let brokenRefs = 0;
    if (doLocalize) {
      const planned = localizeImages(html, feature, p.slug, relPath);
      html = planned.html;
      feature = planned.feature;
      downloads = planned.downloads;
      brokenRefs = planned.skipped;
    }

    let body = html ? td.turndown(html) : '';
    body = body.replace(/\n{3,}/g, '\n\n').trim() + '\n';

    const tags = tagNamesFor(p.id, tagsById, postsTags);

    // Frontmatter — slug + ghost_id are the stable identity for re-runs/round-trip.
    const fm = {
      title: p.title || 'Untitled',
      slug: p.slug,
      date: p.published_at || p.created_at || null,
      updated: p.updated_at || null,
      status,
      type: p.type || 'post',
      tags,
      feature_image: feature || null,
      excerpt: p.custom_excerpt || null,
      ghost_id: p.id,
      ghost_uuid: p.uuid || null,
    };
    // Drop null/empty keys to keep frontmatter clean.
    for (const k of Object.keys(fm)) {
      if (fm[k] == null || (Array.isArray(fm[k]) && fm[k].length === 0)) delete fm[k];
    }

    // lineWidth:-1 stops js-yaml from wrapping long values (URLs) across lines.
    const markdown = matter.stringify(body, fm, { lineWidth: -1 });
    out.push({ relPath, markdown, downloads, brokenRefs, post: p });
  }
  return out;
}
