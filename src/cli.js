#!/usr/bin/env node
import fs from 'node:fs';
import { config } from './config.js';
import path from 'node:path';
import { parseObsidian } from './sources/obsidian.js';
import { parseWpcom, parseWxr } from './sources/wordpress.js';
import { preparePipeline } from './pipeline.js';
import { convertExport } from './vault/convert.js';
import { syncToVault } from './vault/sync.js';
import { log } from './lib/log.js';

const USAGE = `
blogport — migrate old blog content into Ghost (Starter plan, no Admin API)

Usage:
  blogport parse-obsidian              Parse Era 1 (Obsidian/Jekyll), print a summary
  blogport parse-wp                    Parse Era 2 (WordPress WXR), print a summary
  blogport reconcile   [--source=all]  Compare against a Ghost export; report dup-free plan (no file)
  blogport build-import [--source=all] Write an upload-ready Ghost import JSON to ./out
  blogport sync --from <export.json>   Mirror a Ghost export into the vault (Ghost -> Obsidian)

Options:
  --source=obsidian|wp|all   Which era(s) to process (default: all)
  --against=<file>           Ghost export JSON to reconcile against
                             (default: ${config.ghostExportPath})
  --from=<export.json>       Ghost export to mirror into the vault (sync)
  --out=<dir>               Vault output dir (default: VAULT_DIR, or ./out/vault-preview for dry-run)
  --dry-run                  sync: write to ./out/vault-preview instead of the real vault
  --drafts                   sync: include draft posts
  --no-images                sync: keep images as Ghost URLs (skip local download)
  --force                    sync: rewrite/redownload even if unchanged
  --limit=<n>                sync: only process the first n posts (for testing)

Import workflow (Obsidian/WP -> Ghost): build-import then upload via Migration tools.
Mirror workflow (Ghost -> Obsidian vault): see docs/ghost-to-vault.md and runbooks/.
`;

function arg(name, fallback) {
  // Supports both --name=value and --name value.
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return fallback;
}

/** Resolve the Ghost export to reconcile against: --against, else config default if it exists. */
function resolveAgainst() {
  const explicit = arg('against', null);
  if (explicit) return explicit;
  return fs.existsSync(config.ghostExportPath) ? config.ghostExportPath : null;
}

async function loadSource(which) {
  const posts = [];
  if (which === 'obsidian' || which === 'all') {
    posts.push(...parseObsidian(config.obsidian.repoPath));
  }
  if (which === 'wp' || which === 'all') {
    try {
      // Primary path: cached WordPress.com API responses. Fall back to a WXR export.
      posts.push(...parseWpcom(config.wordpress.postsPath, config.wordpress.commentsPath));
    } catch (e) {
      log.warn(`WordPress API cache unavailable: ${e.message}`);
      if (fs.existsSync(config.wordpress.wxrPath)) {
        log.info('Falling back to WXR export.');
        posts.push(...parseWxr(config.wordpress.wxrPath));
      } else if (which === 'wp') {
        throw e;
      }
    }
  }
  return posts;
}

async function main() {
  const cmd = process.argv[2];
  const source = arg('source', 'all');

  switch (cmd) {
    case 'parse-obsidian': {
      const posts = parseObsidian(config.obsidian.repoPath);
      printSummary(posts);
      break;
    }
    case 'parse-wp': {
      const posts = parseWpcom(config.wordpress.postsPath, config.wordpress.commentsPath);
      printSummary(posts);
      break;
    }
    case 'reconcile': {
      const against = resolveAgainst();
      if (!against) throw new Error('reconcile needs a Ghost export: pass --against=<file> (Migration tools -> Export).');
      const posts = await loadSource(source);
      preparePipeline(posts, { build: false, againstPath: against, label: `reconcile-${source}` });
      break;
    }
    case 'build-import': {
      const against = resolveAgainst();
      const posts = await loadSource(source);
      if (!against) log.warn('No Ghost export found — pass --against=<file> to skip already-imported posts.');
      preparePipeline(posts, { build: true, againstPath: against, label: `import-${source}` });
      break;
    }
    case 'sync': {
      const from = arg('from', null);
      if (!from) throw new Error('sync needs --from=<export.json> (a Ghost Migration-tools Export file).');
      if (!fs.existsSync(from)) throw new Error(`Export not found: ${from}`);
      const dryRun = process.argv.includes('--dry-run');
      const outDir = arg('out', null) || (dryRun ? path.join(config.outDir, 'vault-preview') : config.vaultDir);
      if (!outDir) {
        throw new Error('No vault dir: set VAULT_DIR in .env, pass --out=<dir>, or use --dry-run (writes ./out/vault-preview).');
      }
      const noImages = process.argv.includes('--no-images');
      const force = process.argv.includes('--force');
      const limit = Number(arg('limit', 0)) || 0;
      const doc = JSON.parse(fs.readFileSync(from, 'utf8'));
      let files = convertExport(doc, {
        includeDrafts: process.argv.includes('--drafts'),
        siteUrl: config.ghostSiteUrl,
        localizeImages: !noImages,
      });
      if (limit > 0) files = files.slice(0, limit);

      const { stats, moves, deletions, img } = await syncToVault(files, outDir, { force, noImages });

      log.ok(
        `sync: ${stats.created} new, ${stats.updated} updated, ${stats.moved} moved, ${stats.unchanged} unchanged ` +
          `-> ${outDir}${dryRun ? '  (dry-run)' : ''}`,
      );
      for (const m of moves) log.info(`  moved: ${m.from} -> ${m.to}`);
      if (noImages) {
        log.info('images left as Ghost URLs (--no-images).');
      } else {
        log.ok(`images: ${img.ok} downloaded, ${img.copied} copied, ${img.skipped} already present, ${img.failed} failed`);
        for (const f of img.failures.slice(0, 10)) log.warn(`  image failed: ${f.url} (${f.error})`);
        if (img.failures.length > 10) log.warn(`  …and ${img.failures.length - 10} more`);
      }
      if (deletions.length) {
        log.warn(`${deletions.length} post(s) in the vault are no longer in Ghost (NOT deleted — review):`);
        for (const d of deletions.slice(0, 20)) log.dim(`  gone: ${d.relPath}`);
        if (deletions.length > 20) log.dim(`  …and ${deletions.length - 20} more`);
      }
      break;
    }
    default:
      process.stdout.write(USAGE);
      process.exit(cmd ? 1 : 0);
  }
}

function printSummary(posts) {
  const byStatus = posts.reduce((acc, p) => ((acc[p.status] = (acc[p.status] || 0) + 1), acc), {});
  const tags = new Set(posts.flatMap((p) => p.tags));
  log.ok(`${posts.length} item(s): ${JSON.stringify(byStatus)}`);
  log.info(`tags: ${[...tags].sort().join(', ')}`);
  log.info(`pages: ${posts.filter((p) => p.type === 'page').length}, posts: ${posts.filter((p) => p.type === 'post').length}`);
  log.info(`with images: ${posts.filter((p) => p.images.length).length}, with comments: ${posts.filter((p) => p.comments.length).length}`);
}

main().catch((e) => {
  log.error(e.stack || e.message);
  process.exit(1);
});
