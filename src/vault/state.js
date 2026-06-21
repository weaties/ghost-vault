import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

/**
 * Read the current state of a vault directory: every mirrored post keyed by its
 * ghost_id (the stable identity). Used by the incremental sync to decide which
 * posts are new / changed / moved / deleted without re-reading content.
 *
 * Files without a ghost_id (hand-authored notes) are ignored — the mirror only
 * manages what it created.
 *
 * @returns {Map<string, {ghostId, slug, updated, relPath, absPath}>}
 */
export function readVaultState(dir) {
  const byId = new Map();
  if (!dir || !fs.existsSync(dir)) return byId;
  for (const abs of walkMd(dir)) {
    let data;
    try {
      data = matter.read(abs).data || {};
    } catch {
      continue; // unparseable frontmatter — leave it alone
    }
    if (!data.ghost_id) continue;
    byId.set(data.ghost_id, {
      ghostId: data.ghost_id,
      slug: data.slug || null,
      updated: data.updated || null,
      relPath: path.relative(dir, abs),
      absPath: abs,
    });
  }
  return byId;
}

function walkMd(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMd(p));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}
