/**
 * Fetch the Era-2 WordPress.com site (weatiesroadtrip2021.com) via the public
 * WordPress.com REST API and cache the raw responses under sources/. No login
 * needed — the site is public. This is preferred over a manual WXR export
 * because the API returns everything we need (posts, HTML, dates, categories,
 * image URLs, and the comments) in a stable shape.
 *
 *   node scripts/fetch-wpcom.mjs
 *
 * Writes: sources/wpcom-posts.json, sources/wpcom-comments.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';

const site = new URL(config.wordpress.siteUrl).host; // weatiesroadtrip2021.com
const API = `https://public-api.wordpress.com/rest/v1.1/sites/${site}`;
const outDir = path.resolve('sources');
fs.mkdirSync(outDir, { recursive: true });

async function fetchAll(kind, key) {
  const items = [];
  let page = 1;
  for (;;) {
    const url = `${API}/${kind}/?number=100&page=${page}&order=ASC`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${kind} page ${page}: HTTP ${res.status}`);
    const data = await res.json();
    const batch = data[key] || [];
    items.push(...batch);
    process.stderr.write(`  ${kind}: page ${page} -> ${batch.length} (total ${items.length}/${data.found})\n`);
    if (items.length >= data.found || batch.length === 0) break;
    page += 1;
  }
  return items;
}

const posts = await fetchAll('posts', 'posts');
const comments = await fetchAll('comments', 'comments');

fs.writeFileSync(path.join(outDir, 'wpcom-posts.json'), JSON.stringify(posts, null, 2));
fs.writeFileSync(path.join(outDir, 'wpcom-comments.json'), JSON.stringify(comments, null, 2));
console.error(`\nWrote ${posts.length} posts and ${comments.length} comment(s) to sources/`);
