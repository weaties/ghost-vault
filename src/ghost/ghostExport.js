import fs from 'node:fs';

/**
 * Load posts already in Ghost from a Migration-tools Export JSON file, mapped
 * into the shape planReconciliation() expects. This replaces the Admin API read
 * for plans on the Starter plan: Ghost Admin -> Settings -> Migration tools ->
 * Export downloads this file; point --against at it.
 *
 * @param {string} filePath
 * @returns {Array<{id,slug,title,published_at,url,status,plaintext,html}>}
 */
export function loadGhostExport(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Ghost export not found: ${filePath}. In Ghost Admin: Settings -> Migration tools -> Export, then save the JSON here (or pass --against=<file>).`,
    );
  }
  const doc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const data = doc?.db?.[0]?.data || doc?.data || {};
  const posts = Array.isArray(data.posts) ? data.posts : [];
  return posts.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    published_at: p.published_at,
    url: p.url || null,
    status: p.status,
    html: p.html || '',
    plaintext: p.plaintext || extractText(p),
  }));
}

/** Pull readable text from an exported post that has no plaintext/html field. */
function extractText(p) {
  if (p.html) return p.html;
  if (p.mobiledoc) {
    try {
      const md = JSON.parse(p.mobiledoc);
      const cards = md.cards || [];
      const htmlCards = cards
        .filter((c) => c[0] === 'html' || c[0] === 'markdown')
        .map((c) => c[1].html || c[1].markdown || '')
        .join(' ');
      if (htmlCards) return htmlCards;
    } catch {
      /* ignore malformed mobiledoc */
    }
  }
  if (p.lexical) {
    try {
      // Cheap text harvest: pull any "text" fields out of the lexical JSON.
      return [...String(p.lexical).matchAll(/"text":"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join(' ');
    } catch {
      /* ignore */
    }
  }
  return '';
}
