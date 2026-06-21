import fs from 'node:fs';
import path from 'node:path';
import { dedupePosts } from './model.js';
import { toGhostPost } from './ghost/convert.js';
import { buildGhostImport } from './ghost/importfile.js';
import { loadGhostExport } from './ghost/ghostExport.js';
import { planReconciliation, summarizePlan } from './ghost/reconcile.js';
import { githubUrlMap } from './images/github.js';
import { ensureDir } from './ghost/client.js';
import { config } from './config.js';
import { log } from './lib/log.js';

/**
 * No-upgrade workflow (Ghost Starter plan): produce an upload-ready Ghost import
 * JSON file, reconciling against an exported copy of the current site so we
 * never duplicate posts that were already hand-imported.
 *
 *   reconcile : read the Ghost export, plan, write a report. Builds nothing.
 *   build     : the above, then write out/ghost-import-<source>.json to upload.
 *
 * @param {NormalizedPost[]} posts
 * @param {{ build:boolean, againstPath?:string|null, label:string }} opts
 */
export function preparePipeline(posts, { build, againstPath, label }) {
  const { kept, dropped } = dedupePosts(posts);
  if (dropped.length) {
    log.warn(`Deduped ${dropped.length} near-duplicate source post(s):`);
    for (const d of dropped) log.dim(`  dropped ${d.droppedRef}  (kept ${d.keptRef})`);
  }

  // --- Reconcile against the existing Ghost site (optional but recommended) ---
  let plan = null;
  let toBuild = kept;
  if (againstPath) {
    const existing = loadGhostExport(againstPath);
    log.info(`Ghost export has ${existing.length} post(s); reconciling…`);
    plan = planReconciliation(kept, existing);
    const counts = plan.reduce((a, e) => ((a[e.decision] = (a[e.decision] || 0) + 1), a), {});
    log.ok(`reconcile: ${counts.new || 0} new, ${counts.duplicate || 0} duplicate (skip), ${counts.review || 0} need review`);
    for (const e of plan.filter((x) => x.decision === 'duplicate')) {
      log.dim(`  duplicate: ${e.post.sourceRef}  ≈  ${e.match.ghostSlug} [${e.match.reasons.join(',')}]`);
    }
    for (const e of plan.filter((x) => x.decision === 'review')) {
      log.warn(`  review: ${e.post.sourceRef}  ?  ${e.match.ghostSlug} (score ${e.score}) [${e.match.reasons.join(',')}]`);
    }
    toBuild = plan.filter((e) => e.decision === 'new').map((e) => e.post);
  } else {
    log.warn('No --against export given — building ALL posts without dedup against Ghost.');
  }

  // --- Convert to Ghost payloads (images hotlinked, no upload) ---
  const payloads = toBuild.map((post) => {
    const urlMap =
      post.source === 'obsidian'
        ? githubUrlMap(post, config.obsidian.repoPath, config.obsidian.rawBase)
        : new Map(); // WordPress bodies already carry absolute image URLs (handled later)
    return toGhostPost(post, urlMap);
  });

  // --- Outputs ---
  ensureDir(config.outDir);
  const stamp = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  let importPath = null;
  if (build) {
    const doc = buildGhostImport(payloads, Date.now());
    importPath = path.join(config.outDir, `${stamp}.ghost-import.json`);
    fs.writeFileSync(importPath, JSON.stringify(doc, null, 2));
    log.ok(`wrote import file: ${importPath}  (${payloads.length} post(s))`);
    log.info('Upload it via Ghost Admin -> Settings -> Migration tools -> Import.');
  }

  const summary = {
    label,
    builtImportFile: importPath,
    counts: { kept: kept.length, droppedDuplicateSources: dropped.length, toBuild: toBuild.length },
    droppedSources: dropped,
    reconcile: plan ? summarizePlan(plan) : null,
    posts: payloads.map((p) => ({ slug: p.slug, title: p.title, type: p.type, status: p.status })),
  };
  const summaryPath = path.join(config.outDir, `${stamp}.summary.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  log.info(`wrote ${summaryPath}`);

  return { payloads, plan, importPath, summaryPath };
}
