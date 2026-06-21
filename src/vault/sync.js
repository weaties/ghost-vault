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
      // Migration: relocate any image that an older layout left beside the post
      // into its new attachments/ location, so we move bytes instead of refetching.
      for (const d of f.downloads) {
        const target = path.join(dir, d.fileName); // resolves into attachments/
        const beside = path.join(dir, path.basename(d.fileName));
        if (beside !== target && fs.existsSync(beside) && !fs.existsSync(target)) {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          try { fs.renameSync(beside, target); } catch { /* fall through to download */ }
        }
      }
      if (f.downloads.length) {
        // Note: do NOT pass `force` here — images already on disk (incl. ones just
        // moved into attachments/) should be skipped, not re-fetched. `force`
        // reprocesses posts (rewrite md, relocate images), not re-download bytes.
        const tasks = f.downloads.map((d) => ({ url: d.url, absPath: path.join(dir, d.fileName) }));
        const s = await downloadImages(tasks, { cache: imgCache });
        for (const k of ['ok', 'copied', 'skipped', 'failed']) img[k] += s[k];
        img.failures.push(...s.failures);
      }
      // Remove any images still sitting beside the post (old layout / orphans).
      removeBySlugPrefix(dir, f.post.slug);
      // Prune orphans for this slug in the attachments dir (image set changed).
      pruneOrphanAttachments(path.join(outDir, 'attachments'), f.post.slug, f.downloads.map((d) => path.basename(d.fileName)));
    }
  }

  // Posts present in the vault but absent from the export: report, never delete.
  const deletions = [...existing.values()].filter((e) => !seen.has(e.ghostId));

  return { stats, moves, deletions, img, brokenRefs };
}

/** Remove a post's old markdown + its slug-prefixed attachments (on slug/dir move). */
function removeOldFiles(outDir, prior) {
  safeRm(path.join(outDir, prior.relPath));
  if (prior.slug) {
    removeBySlugPrefix(path.dirname(path.join(outDir, prior.relPath)), prior.slug); // legacy alongside
    removeBySlugPrefix(path.join(outDir, 'attachments'), prior.slug); // current location
  }
}

/** Remove every <slug>__* file directly in a dir. */
function removeBySlugPrefix(dir, slug) {
  if (!slug || !fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(`${slug}__`)) safeRm(path.join(dir, name));
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
