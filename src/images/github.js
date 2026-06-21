import path from 'node:path';

/**
 * Build a public raw.githubusercontent.com URL for an attachment, so Ghost can
 * hotlink Era-1 images without any upload (no Admin API / no upgrade needed).
 *
 * @param {string} localPath  Absolute path to the attachment on disk.
 * @param {string} repoRoot   Absolute path to the cloned repo root.
 * @param {string} rawBase    e.g. https://raw.githubusercontent.com/weaties/blog/main
 * @returns {string} URL with each path segment percent-encoded.
 */
export function githubRawUrl(localPath, repoRoot, rawBase) {
  const rel = path.relative(repoRoot, localPath);
  const encoded = rel.split(path.sep).map(encodeURIComponent).join('/');
  return `${rawBase.replace(/\/$/, '')}/${encoded}`;
}

/**
 * Build the originalRef -> hotlink-URL map for a post's on-disk images.
 * Images without a resolved localPath (genuine gaps) are skipped.
 */
export function githubUrlMap(post, repoRoot, rawBase) {
  const map = new Map();
  for (const img of post.images) {
    if (!img.localPath) continue;
    const url = githubRawUrl(img.localPath, repoRoot, rawBase);
    img.uploadedUrl = url;
    map.set(img.originalRef, url);
  }
  return map;
}
