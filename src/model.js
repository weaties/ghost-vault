/**
 * The normalized intermediate model. Both source eras (Obsidian/Jekyll and
 * WordPress.com) parse into NormalizedPost[]; the Ghost converter consumes it.
 * Keeping a single shape in the middle is what lets the two eras share dedupe,
 * tag mapping, image handling, and the dry-run/import pipeline.
 *
 * @typedef {Object} ImageRef
 * @property {string} originalRef  The exact string used in the source body (for find/replace on rewrite).
 * @property {string} alt          Alt text.
 * @property {string} [localPath]  Absolute path on disk (Obsidian attachments).
 * @property {string} [remoteUrl]  Source URL (WordPress media).
 * @property {string} [uploadedUrl] Filled in after upload to Ghost.
 *
 * @typedef {Object} Comment
 * @property {string} author
 * @property {string} [date]       ISO date if known.
 * @property {string} html         Comment body as HTML.
 *
 * @typedef {Object} NormalizedPost
 * @property {'obsidian'|'wordpress'} source
 * @property {string} sourceRef           File path or source URL (provenance/debugging).
 * @property {string} title
 * @property {string} slug
 * @property {string|null} publishedAt    ISO 8601, or null if unknown.
 * @property {string[]} tags              Public tags (folder/trip/category derived).
 * @property {string[]} internalTags      Ghost internal tags, '#'-prefixed (provenance).
 * @property {[number,number]|null} location  [lat, long] if present.
 * @property {string} bodyMarkdown        Raw body (markdown for Obsidian).
 * @property {string} [bodyHtml]          Raw body as HTML (WordPress).
 * @property {ImageRef[]} images
 * @property {Comment[]} comments
 * @property {'published'|'draft'} status
 * @property {'post'|'page'} type
 */

/**
 * Canonicalize redundant source tags. The folder gives e.g. `letters-to-mom`
 * while Obsidian frontmatter carries `letter-to-mom` / `Trip-report`; these are
 * the same group, so fold the variants onto one clean tag (keys are lowercased).
 */
export const TAG_ALIASES = {
  'letter-to-mom': 'letters-to-mom',
  'trip-report': 'trip-reports',
};

export function normalizeTag(t) {
  const key = String(t).trim().toLowerCase();
  return TAG_ALIASES[key] || String(t).trim();
}

/** Slugify a title/filename into a Ghost-safe slug. */
export function slugify(input) {
  return String(input)
    .normalize('NFKD')
    .replace(/[‘’“”]/g, '') // strip smart quotes entirely
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Dedupe key used to detect the curly-quote vs straight-quote (and other
 * near-duplicate) variants in the Obsidian era. Normalizes away the things
 * that differ between variants: smart quotes, case, punctuation, whitespace.
 */
export function dedupeKey(post) {
  const datePart = post.publishedAt ? post.publishedAt.slice(0, 10) : 'nodate';
  const titlePart = String(post.title)
    .normalize('NFKD')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${datePart}::${titlePart}`;
}

/**
 * Collapse near-duplicate posts, keeping the "best" copy per dedupeKey.
 * Heuristic: prefer the one with the longer body (more complete), then the
 * one whose title uses straight quotes (cleaner). Returns { kept, dropped }.
 */
export function dedupePosts(posts) {
  const byKey = new Map();
  const dropped = [];
  for (const post of posts) {
    const key = dedupeKey(post);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, post);
      continue;
    }
    const incumbentLen = (existing.bodyMarkdown || existing.bodyHtml || '').length;
    const challengerLen = (post.bodyMarkdown || post.bodyHtml || '').length;
    if (challengerLen > incumbentLen) {
      byKey.set(key, post);
      dropped.push({ key, droppedRef: existing.sourceRef, keptRef: post.sourceRef });
    } else {
      dropped.push({ key, droppedRef: post.sourceRef, keptRef: existing.sourceRef });
    }
  }
  return { kept: [...byKey.values()], dropped };
}

/** Create an empty NormalizedPost with sane defaults. */
export function makePost(partial) {
  return {
    source: 'obsidian',
    sourceRef: '',
    title: '',
    slug: '',
    publishedAt: null,
    tags: [],
    internalTags: [],
    location: null,
    bodyMarkdown: '',
    bodyHtml: undefined,
    featureImage: undefined, // explicit feature image URL (WP); else first uploaded image is used
    images: [],
    comments: [],
    status: 'published',
    type: 'post',
    ...partial,
  };
}
