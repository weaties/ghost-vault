import { slugify } from '../model.js';

/**
 * Build a Ghost-import JSON document (the same shape Ghost's Migration tools ->
 * Export produces) from an array of Ghost post payloads. Upload the result via
 * Ghost Admin -> Settings -> Migration tools -> Import. Works on the Starter
 * plan — no Admin API / custom integration required.
 *
 * Post body is carried as a single HTML card inside mobiledoc, which the Ghost
 * importer reliably converts to its native (lexical) editor format.
 *
 * @param {Array<object>} payloads  Output of toGhostPost() for each post.
 * @param {number} exportedOn       Timestamp (ms) to stamp into meta.
 */
export function buildGhostImport(payloads, exportedOn) {
  const tagIndex = new Map(); // tag name -> id
  const tags = [];
  const postsTags = [];
  const posts = [];
  let pid = 0;
  let tid = 0;

  for (const p of payloads) {
    pid += 1;
    // Ghost's importer wants MySQL datetime ("YYYY-MM-DD HH:MM:SS", UTC). ISO 8601
    // with a "T"/"Z" is NOT parsed as an override and silently falls back to import
    // time — which is what reset every post's date on the first import.
    const when = mysqlDatetime(p.published_at || new Date(exportedOn).toISOString());
    posts.push({
      id: pid,
      title: p.title,
      slug: p.slug,
      mobiledoc: htmlCard(p.html),
      feature_image: p.feature_image || null,
      type: p.type || 'post',
      status: p.status || 'published',
      created_at: when,
      updated_at: when,
      published_at: when,
    });

    let sort = 0;
    for (const t of p.tags || []) {
      if (!tagIndex.has(t.name)) {
        tid += 1;
        tagIndex.set(t.name, tid);
        tags.push({ id: tid, name: t.name, slug: tagSlug(t.name) });
      }
      postsTags.push({ tag_id: tagIndex.get(t.name), post_id: pid, sort_order: sort++ });
    }
  }

  return {
    db: [
      {
        meta: { exported_on: exportedOn, version: '6.0.0' },
        data: { posts, tags, posts_tags: postsTags },
      },
    ],
  };
}

/** Convert an ISO date string to Ghost's MySQL datetime format (UTC). */
function mysqlDatetime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toISOString().slice(0, 19).replace('T', ' '); // "2024-04-01T12:00:00.000Z" -> "2024-04-01 12:00:00"
}

/** Wrap raw HTML in a mobiledoc HTML card. */
function htmlCard(html) {
  return JSON.stringify({
    version: '0.3.1',
    atoms: [],
    cards: [['html', { cardName: 'html', html: html || '' }]],
    markups: [],
    sections: [[10, 0]],
  });
}

/** Internal tags keep their '#'; Ghost slugs '#foo' as 'hash-foo'. */
function tagSlug(name) {
  return name.startsWith('#') ? `hash-${slugify(name.slice(1))}` : slugify(name);
}
