import fs from 'node:fs';
import path from 'node:path';

/**
 * Download a batch of images into the vault. Used by `sync` after the converter
 * has planned local filenames. Makes the vault self-contained.
 *
 * Behaviour:
 *  - Skips files that already exist on disk → idempotent re-runs (only new/
 *    changed images are fetched). Pass force:true to re-download.
 *  - Caches by source URL within a run: if the same image is reused across
 *    posts, it's fetched once and copied to each post's folder.
 *  - A failed download leaves the markdown pointing at the local name but logs
 *    the failure (reported by the caller) — never throws the whole run.
 *
 * @param {{url:string, absPath:string}[]} tasks
 * @param {{ cache?: Map<string,string>, concurrency?: number, force?: boolean }} [opts]
 * @returns {Promise<{ok:number, copied:number, skipped:number, failed:number, failures:{url:string,error:string}[]}>}
 */
export async function downloadImages(tasks, opts = {}) {
  const cache = opts.cache || new Map();
  const concurrency = opts.concurrency || 6;
  const stats = { ok: 0, copied: 0, skipped: 0, failed: 0, failures: [] };

  async function run(task) {
    try {
      if (!opts.force && fs.existsSync(task.absPath)) {
        stats.skipped += 1;
        cache.set(task.url, task.absPath);
        return;
      }
      const cachedFrom = cache.get(task.url);
      if (cachedFrom && fs.existsSync(cachedFrom) && cachedFrom !== task.absPath) {
        fs.mkdirSync(path.dirname(task.absPath), { recursive: true });
        fs.copyFileSync(cachedFrom, task.absPath);
        stats.copied += 1;
        return;
      }
      const res = await fetch(task.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(task.absPath), { recursive: true });
      fs.writeFileSync(task.absPath, buf);
      cache.set(task.url, task.absPath);
      stats.ok += 1;
    } catch (e) {
      stats.failed += 1;
      stats.failures.push({ url: task.url, error: e.message });
    }
  }

  const queue = [...tasks];
  const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, async () => {
    while (queue.length) await run(queue.shift());
  });
  await Promise.all(workers);
  return stats;
}
