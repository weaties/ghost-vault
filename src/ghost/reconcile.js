/**
 * Reconcile our NormalizedPost[] against posts already in Ghost (some were
 * hand-imported from either era). Goal: never create a duplicate.
 *
 * Matching uses several signals, because a hand-imported post may have a
 * different slug/title than our generated one:
 *   - slug equality                      (strong)
 *   - normalized title + same publish day(strong)
 *   - content fingerprint overlap        (strongest — survives title edits)
 *   - normalized title equality          (strong)
 *   - title token similarity (Jaccard)   (weak — only enough to flag for review)
 *
 * Each of our posts is bucketed:
 *   'duplicate' — confident match in Ghost -> SKIP (don't re-create)
 *   'review'    — a plausible but uncertain match -> HOLD for manual decision
 *   'new'       — no match -> safe to create
 */

const DUP_THRESHOLD = 0.9;
const REVIEW_THRESHOLD = 0.6;
const SIG_LEN = 160;
const SIG_PREFIX = 120;

export function normTitle(t) {
  return String(t || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenSet(s) {
  return new Set(normTitle(s).split(' ').filter(Boolean));
}

function jaccard(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Normalized, punctuation-free fingerprint of a post body (markdown/html/plaintext). */
export function contentSig(text, n = SIG_LEN) {
  return String(text || '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ') // strip html tags
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // strip md image refs (paths differ post-upload)
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, n);
}

function day(iso) {
  return iso ? String(iso).slice(0, 10) : null;
}

function ourText(post) {
  return post.bodyMarkdown && post.bodyMarkdown.trim() ? post.bodyMarkdown : post.bodyHtml || '';
}

/** Score how likely a Ghost post is the same as one of ours. Returns { score, reasons }. */
function scoreMatch(our, ghost, ourSig) {
  const reasons = [];
  let score = 0;
  const bump = (v, why) => {
    if (v > score) score = v;
    reasons.push(why);
  };

  if (ghost.slug && our.slug && ghost.slug === our.slug) bump(1, 'slug');

  const sameTitle = normTitle(our.title) === normTitle(ghost.title) && normTitle(our.title) !== '';
  const sameDay = day(our.publishedAt) && day(our.publishedAt) === day(ghost.published_at);
  if (sameTitle && sameDay) bump(0.97, 'title+date');

  const gSig = contentSig(ghost.plaintext || ghost.html);
  if (ourSig && gSig && ourSig.length >= 40) {
    const a = ourSig.slice(0, SIG_PREFIX);
    const b = gSig.slice(0, SIG_PREFIX);
    if (a && (a.startsWith(b.slice(0, 60)) || b.startsWith(a.slice(0, 60)))) bump(0.95, 'content');
  }

  if (sameTitle) bump(0.85, 'title');

  const jac = jaccard(our.title, ghost.title);
  if (jac >= 0.6) bump(0.5 + jac * 0.4, `title~${jac.toFixed(2)}`);

  return { score, reasons };
}

/**
 * @param {NormalizedPost[]} ourPosts
 * @param {Array<{id,slug,title,published_at,url,plaintext,html}>} ghostPosts
 * @returns {Array<{post, decision, score, reasons, match}>}
 */
export function planReconciliation(ourPosts, ghostPosts) {
  return ourPosts.map((post) => {
    const ourSig = contentSig(ourText(post));
    let best = null;
    for (const g of ghostPosts) {
      const { score, reasons } = scoreMatch(post, g, ourSig);
      if (!best || score > best.score) best = { score, reasons, ghost: g };
    }

    let decision = 'new';
    if (best && best.score >= DUP_THRESHOLD) decision = 'duplicate';
    else if (best && best.score >= REVIEW_THRESHOLD) decision = 'review';

    const match =
      decision === 'new' || !best
        ? null
        : {
            ghostId: best.ghost.id,
            ghostSlug: best.ghost.slug,
            ghostTitle: best.ghost.title,
            ghostUrl: best.ghost.url,
            reasons: best.reasons,
          };

    return { post, decision, score: best ? Number(best.score.toFixed(3)) : 0, match };
  });
}

/** Compact, serializable view of a plan for the out/ report. */
export function summarizePlan(plan) {
  const counts = plan.reduce((a, e) => ((a[e.decision] = (a[e.decision] || 0) + 1), a), {});
  return {
    counts,
    entries: plan.map((e) => ({
      sourceRef: e.post.sourceRef,
      ourSlug: e.post.slug,
      ourTitle: e.post.title,
      decision: e.decision,
      score: e.score,
      match: e.match,
    })),
  };
}
