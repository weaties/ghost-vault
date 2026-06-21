/**
 * Build a small, clearly-labeled TEST import file so you can see how posts look
 * in Ghost before committing the full migration. Picks real posts that exercise
 * each rendering feature, relabels them "TEST —" with a dedicated `zz-test-import`
 * tag and `test-` slugs (collision-free), and adds a synthetic comment so you can
 * see the comments appendix that the WordPress era will use.
 *
 * After importing, filter by the `zz-test-import` tag in Ghost to bulk-delete.
 *
 *   node scripts/make-test-import.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseObsidian } from '../src/sources/obsidian.js';
import { dedupePosts, makePost } from '../src/model.js';
import { hasIframe } from '../src/lib/markdown.js';
import { toGhostPost } from '../src/ghost/convert.js';
import { buildGhostImport } from '../src/ghost/importfile.js';
import { githubUrlMap } from '../src/images/github.js';
import { config } from '../src/config.js';

const TEST_TAG = 'zz-test-import';
const all = dedupePosts(parseObsidian(config.obsidian.repoPath)).kept;

const pick = (pred) => all.find(pred);
const withImages = pick((p) => p.images.filter((i) => i.localPath).length >= 2);
const withIframe = pick((p) => hasIframe(p.bodyMarkdown) && p !== withImages);
const withLocation = pick((p) => p.location && p !== withImages && p !== withIframe);
const aPage = pick((p) => p.type === 'page');
const aTrip = pick((p) => p.tags.includes('trip-reports') && ![withImages, withIframe, withLocation].includes(p));

const chosen = [withImages, withIframe, withLocation, aTrip, aPage].filter(Boolean);
// De-dup selection while preserving order.
const seen = new Set();
const unique = chosen.filter((p) => (seen.has(p.sourceRef) ? false : (seen.add(p.sourceRef), true)));

// Synthetic comments to demo the appendix (this is how WP comments will render).
const demoComments = [
  { author: 'Mom', date: '2024-01-16T15:04:00.000Z', html: '<p>So good to hear from you! Love the photos. ❤️</p>' },
  { author: 'Aunt Glo', date: '2024-01-17T09:12:00.000Z', html: '<p>Safe travels in the van!</p>' },
];

const testPosts = unique.map((p, i) =>
  makePost({
    ...p,
    title: `TEST — ${p.title}`,
    slug: `test-${p.slug}`,
    tags: [TEST_TAG, ...p.tags],
    internalTags: ['#source-obsidian', '#test'],
    comments: i === 0 ? demoComments : [],
  }),
);

const payloads = testPosts.map((p) => {
  const urlMap = githubUrlMap(p, config.obsidian.repoPath, config.obsidian.rawBase);
  return toGhostPost(p, urlMap);
});

const doc = buildGhostImport(payloads, Date.now());
const outPath = path.join(config.outDir, 'test-import.ghost-import.json');
fs.mkdirSync(config.outDir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(doc, null, 2));

console.log(`\nWrote ${outPath} with ${payloads.length} TEST post(s):`);
for (const [i, p] of testPosts.entries()) {
  const feats = [
    p.images.filter((x) => x.localPath).length ? `${p.images.filter((x) => x.localPath).length} img` : null,
    hasIframe(p.bodyMarkdown) ? 'iframe' : null,
    p.location ? 'location' : null,
    p.comments.length ? `${p.comments.length} comments` : null,
    p.type === 'page' ? 'PAGE' : null,
  ].filter(Boolean);
  console.log(`  ${i + 1}. ${p.slug}  [${feats.join(', ')}]  <- ${p.sourceRef}`);
}
console.log(`\nAll tagged "${TEST_TAG}" — filter by it in Ghost to bulk-delete after reviewing.`);
