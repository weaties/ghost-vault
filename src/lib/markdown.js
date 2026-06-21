import matter from 'gray-matter';
import { marked } from 'marked';

// Preserve raw HTML (iframes, gaiagps embeds) when rendering markdown -> HTML.
marked.setOptions({ gfm: true, breaks: false });

/** Split a markdown file into { data: frontmatter, content: body }. */
export function parseFrontmatter(raw) {
  const { data, content } = matter(raw);
  return { data: data || {}, content: content || '' };
}

/**
 * Extract image references from a markdown body.
 * Handles `![alt](path)` and inline `<img src="path">`. Paths are URL-decoded
 * so `attachments/foo%20bar.png` resolves to the real file on disk.
 * @returns {{ originalRef: string, rawPath: string, decodedPath: string, alt: string }[]}
 */
export function extractImageRefs(body) {
  const refs = [];
  // Path may contain literal parens (e.g. ".../Foo (Bar) baz.png") and %20-encoded
  // spaces, so allow one level of balanced inner parens before the closing ")".
  const mdImg = /!\[([^\]]*)\]\(([^()]*(?:\([^()]*\)[^()]*)*)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = mdImg.exec(body)) !== null) {
    const rawPath = m[2];
    if (/^https?:\/\//i.test(rawPath)) continue; // remote image, leave as-is for now
    refs.push({ originalRef: m[0], rawPath, decodedPath: safeDecode(rawPath), alt: m[1] || '' });
  }
  const htmlImg = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  while ((m = htmlImg.exec(body)) !== null) {
    const rawPath = m[1];
    if (/^https?:\/\//i.test(rawPath)) continue;
    refs.push({ originalRef: m[0], rawPath, decodedPath: safeDecode(rawPath), alt: '' });
  }
  return refs;
}

function safeDecode(p) {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

/** True if the body contains an <iframe> (gaiagps embeds we want to preserve). */
export function hasIframe(body) {
  return /<iframe\b/i.test(body);
}

/**
 * Render markdown to HTML for Ghost (which accepts html source and converts to
 * lexical). Optionally rewrite image refs to their uploaded Ghost URLs first.
 * @param {string} body
 * @param {Map<string,string>} [urlMap]  originalRef -> uploaded URL
 */
export function markdownToHtml(body, urlMap) {
  let src = body;
  if (urlMap) {
    for (const [originalRef, url] of urlMap) {
      src = src.split(originalRef).join(`![](${url})`);
    }
  }
  return marked.parse(src);
}
