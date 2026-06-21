import fs from 'node:fs';
import path from 'node:path';
import GhostAdminAPI from '@tryghost/admin-api';
import { log } from '../lib/log.js';

/**
 * Thin wrapper over the Ghost Admin API with a dry-run mode.
 *
 * In dry-run, nothing hits the network: image uploads return a deterministic
 * placeholder URL and createPost just returns the payload. The pipeline writes
 * everything to out/ so you can review before a real import.
 */
export class GhostClient {
  constructor({ url, key, version = 'v5.0', dryRun = true }) {
    this.dryRun = dryRun;
    if (!dryRun) {
      if (!url || !key) throw new Error('GHOST_ADMIN_API_URL and GHOST_ADMIN_API_KEY are required for a real import.');
      this.api = new GhostAdminAPI({ url, key, version });
    }
    this._uploadCache = new Map(); // localPath/remoteUrl -> uploaded URL
  }

  /** Upload one image, returning its Ghost URL. Cached by source path. */
  async uploadImage(localPath) {
    if (this._uploadCache.has(localPath)) return this._uploadCache.get(localPath);
    let url;
    if (this.dryRun) {
      url = `DRYRUN://uploads/${path.basename(localPath)}`;
    } else {
      const res = await this.api.images.upload({ file: localPath });
      url = res.url;
    }
    this._uploadCache.set(localPath, url);
    return url;
  }

  /**
   * Fetch every existing post in the Ghost site (all statuses) with plaintext,
   * for reconciliation. Read-only; requires real credentials.
   */
  async listAllPosts() {
    if (this.dryRun) {
      throw new Error('Reconciliation needs real Ghost credentials — set GHOST_ADMIN_API_URL/KEY in .env.');
    }
    const posts = await this.api.posts.browse({
      limit: 'all',
      formats: 'plaintext',
      filter: 'status:[published,draft,scheduled]',
    });
    return posts.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      published_at: p.published_at,
      url: p.url,
      status: p.status,
      plaintext: p.plaintext,
      html: p.html,
    }));
  }

  /** Create a post from a Ghost payload (html source). Returns { id, url } or the payload in dry-run. */
  async createPost(payload) {
    if (this.dryRun) return { dryRun: true, payload };
    const res = await this.api.posts.add(payload, { source: 'html' });
    return { id: res.id, url: res.url };
  }

  /** Sanity check that credentials work (real mode only). */
  async ping() {
    if (this.dryRun) {
      log.dim('dry-run: skipping Ghost connectivity check');
      return true;
    }
    await this.api.site.read();
    return true;
  }
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
