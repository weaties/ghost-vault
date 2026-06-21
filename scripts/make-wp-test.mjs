/**
 * Build a small TEST import from the WordPress era so the 2021 content can be
 * eyeballed in Ghost before committing all 50. Picks the post that has the
 * comment, one image-heavy post, and one more — relabels them "TEST —" with a
 * `zz-test-import` tag and `test-` slugs (collision-free, easy to bulk-delete).
 *
 *   node scripts/make-wp-test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseWpcom } from '../src/sources/wordpress.js';
import { makePost } from '../src/model.js';
import { toGhostPost } from '../src/ghost/convert.js';
import { buildGhostImport } from '../src/ghost/importfile.js';
import { config } from '../src/config.js';

const all = parseWpcom(config.wordpress.postsPath, config.wordpress.commentsPath);

const withComment = all.find((p) => p.comments.length);
const imgHeavy = all
  .filter((p) => p !== withComment)
  .sort((a, b) => (b.bodyHtml || '').length - (a.bodyHtml || '').length)[0];
const first = all.find((p) => p !== withComment && p !== imgHeavy);

const chosen = [withComment, imgHeavy, first].filter(Boolean);

const testPosts = chosen.map((p) =>
  makePost({
    ...p,
    title: `TEST — ${p.title}`,
    slug: `test-${p.slug}`,
    tags: ['zz-test-import', ...p.tags],
    internalTags: ['#source-wordpress', '#test'],
  }),
);

const payloads = testPosts.map((p) => toGhostPost(p, new Map()));
const doc = buildGhostImport(payloads, Date.now());
const outPath = path.join(config.outDir, 'test-wp-import.ghost-import.json');
fs.mkdirSync(config.outDir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(doc, null, 2));

console.error(`\nWrote ${outPath} with ${payloads.length} TEST post(s):`);
for (const p of testPosts) {
  const feats = [
    p.featureImage ? 'feature' : null,
    p.comments.length ? `${p.comments.length} comment(s)` : null,
  ].filter(Boolean);
  console.error(`  - ${p.slug}  [${feats.join(', ')}]`);
}
console.error(`\nAll tagged "zz-test-import" — filter by it in Ghost to bulk-delete after reviewing.`);
