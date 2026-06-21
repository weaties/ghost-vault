import fs from 'node:fs';
import path from 'node:path';

/**
 * Rolling archive of raw Ghost exports with sparse retention: dense near "now",
 * thinning exponentially with age, and the very oldest export is never dropped.
 * Retained count is O(log(age)) — a blog spanning years keeps ~12-15 files no
 * matter how often you export. See docs/ghost-to-vault.md §4.
 */

const TS_RE = /(\d{8})T(\d{6})Z/;
const DAY_MS = 86400000;

/** Compact, sortable UTC stamp for a filename: 1781938552620 -> "20260620T..." */
export function stampFromMs(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Parse the stamp back out of an archive filename -> ms (or null). */
export function msFromName(name) {
  const m = name.match(TS_RE);
  if (!m) return null;
  const [, d, t] = m;
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Decide which archive entries to keep. Always keeps the newest and the oldest;
 * keeps everything within `keepRecentDays`; otherwise keeps one representative
 * (the oldest) per power-of-two age band.
 *
 * @param {{name:string, ts:number}[]} items
 * @param {{ keepRecentDays?: number }} [opts]
 * @returns {{ keep: typeof items, drop: typeof items }}
 */
export function planRetention(items, opts = {}) {
  const keepRecentDays = opts.keepRecentDays || 0;
  if (items.length <= 2) return { keep: [...items], drop: [] };

  const sorted = [...items].sort((a, b) => b.ts - a.ts); // newest first
  const now = sorted[0].ts;
  const keep = new Set([sorted[0].name, sorted[sorted.length - 1].name]); // newest + oldest

  const byBand = new Map(); // band -> oldest item in band
  for (const it of sorted) {
    const ageDays = (now - it.ts) / DAY_MS;
    if (ageDays <= keepRecentDays) {
      keep.add(it.name);
      continue;
    }
    const band = ageDays < 1 ? 0 : Math.floor(Math.log2(ageDays)) + 1;
    const cur = byBand.get(band);
    if (!cur || it.ts < cur.ts) byBand.set(band, it);
  }
  for (const it of byBand.values()) keep.add(it.name);

  return {
    keep: sorted.filter((it) => keep.has(it.name)),
    drop: sorted.filter((it) => !keep.has(it.name)),
  };
}

/** List archived exports in a dir as {name, ts}, newest first. */
export function listArchive(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.startsWith('ghost-export-') && n.endsWith('.json'))
    .map((name) => ({ name, ts: msFromName(name) ?? fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.ts - a.ts);
}

/**
 * Archive an export file into `dir` (named by its meta.exported_on), then prune
 * to the sparse retention set. Idempotent: re-archiving the same export is a no-op.
 *
 * @param {string} exportFile
 * @param {string} dir
 * @param {{ keepRecentDays?: number, dryRun?: boolean }} [opts]
 */
export function archiveExport(exportFile, dir, opts = {}) {
  const doc = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
  const exportedOn = doc?.db?.[0]?.meta?.exported_on || fs.statSync(exportFile).mtimeMs;
  const name = `ghost-export-${stampFromMs(exportedOn)}.json`;
  const dest = path.join(dir, name);

  let archived = false;
  if (!opts.dryRun) {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(exportFile, dest);
      archived = true;
    }
  }

  // Compute retention over what's on disk (+ the new entry if dry-run).
  const items = listArchive(dir);
  if (opts.dryRun && !items.some((i) => i.name === name)) {
    items.push({ name, ts: exportedOn });
  }
  const { keep, drop } = planRetention(items, { keepRecentDays: opts.keepRecentDays });

  if (!opts.dryRun) {
    for (const d of drop) fs.rmSync(path.join(dir, d.name), { force: true });
  }

  return { name, archived, kept: keep.length, dropped: drop.map((d) => d.name) };
}
