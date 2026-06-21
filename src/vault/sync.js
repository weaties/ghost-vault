import fs from 'node:fs';
import path from 'node:path';
import { readVaultState } from './state.js';
import { downloadImages } from './images.js';

/**
 * Incrementally mirror converted posts into the vault. Idempotent: a post whose
 * Ghost `updated_at` matches what's already on disk is skipped entirely (no
 * rewrite, no image re-download). Handles slug/date moves and prunes orphaned
 * attachments; reports — but never applies — deletions.
 *
 * @param {Array<{relPath, markdown, downloads, post}>} files  from convertExport()
 * @param {string} outDir
 * @param {{ force?: boolean, noImages?: boolean }} [opts]
 */
export async function syncToVault(files, outDir, opts = {}) {
  const { force = false, noImages = false } = opts;
  const existing = readVaultState(outDir);
  const seen = new Set();

  const stats = { created: 0, updated: 0, moved: 0, unchanged: 0 };
  const moves = [];
  const imgCache = new Map();
  const img = { ok: 0, copied: 0, skipped: 0, failed: 0, failures: [] };
  let brokenRefs = 0;

  for (const f of files) {
    const id = f.post.id;
    seen.add(id);
    const prior = existing.get(id);
    const newAbs = path.join(outDir, f.relPath);

    let action;
    if (!prior) action = 'created';
    else if (prior.relPath !== f.relPath) action = 'moved';
    else if (!force && prior.updated && f.post.updated_at && prior.updated === f.post.updated_at) action = 'unchanged';
    else action = 'updated';

    if (action === 'unchanged') {
      stats.unchanged += 1;
      continue;
    }

    if (action === 'moved') {
      removeOldFiles(outDir, prior);
      moves.push({ from: prior.relPath, to: f.relPath });
    }

    fs.mkdirSync(path.dirname(newAbs), { recursive: true });
    fs.writeFileSync(newAbs, f.markdown);
    stats[action] += 1;
    brokenRefs += f.brokenRefs || 0;

    if (!noImages) {
      const dir = path.dirname(newAbs);
      if (f.downloads.length) {
        const tasks = f.downloads.map((d) => ({ url: d.url, absPath: path.join(dir, d.fileName) }));
        const s = await downloadImages(tasks, { cache: imgCache, force });
        for (const k of ['ok', 'copied', 'skipped', 'failed']) img[k] += s[k];
        img.failures.push(...s.failures);
      }
      // Drop attachments for this slug that are no longer referenced (image set changed).
      pruneOrphanAttachments(dir, f.post.slug, f.downloads.map((d) => d.fileName));
    }
  }

  // Posts present in the vault but absent from the export: report, never delete.
  const deletions = [...existing.values()].filter((e) => !seen.has(e.ghostId));

  return { stats, moves, deletions, img, brokenRefs };
}

/** Remove a post's old markdown + its slug-prefixed attachments (on move). */
function removeOldFiles(outDir, prior) {
  const oldAbs = path.join(outDir, prior.relPath);
  safeRm(oldAbs);
  const oldDir = path.dirname(oldAbs);
  if (prior.slug && fs.existsSync(oldDir)) {
    for (const name of fs.readdirSync(oldDir)) {
      if (name.startsWith(`${prior.slug}__`)) safeRm(path.join(oldDir, name));
    }
  }
}

/** Remove <slug>__* attachments in a dir that aren't in the keep set. */
function pruneOrphanAttachments(dir, slug, keepNames) {
  if (!slug || !fs.existsSync(dir)) return;
  const keep = new Set(keepNames);
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(`${slug}__`) && !keep.has(name)) safeRm(path.join(dir, name));
  }
}

function safeRm(p) {
  try {
    fs.rmSync(p, { force: true });
  } catch {
    /* ignore */
  }
}
