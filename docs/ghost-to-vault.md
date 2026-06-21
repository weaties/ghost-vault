# Spec — Ghost → Obsidian vault mirror

**Goal:** Ghost stays the authoring platform (editor, email, members). A one-way
job continuously mirrors all published content into a local, git-tracked
Obsidian vault of clean markdown + local images, so you own the content and can
rehost anywhere later. One-directional: Ghost is authoritative, the vault is a
faithful downstream copy. No pushing back into Ghost.

This is the inverse of the existing import tooling and reuses most of it
(`ghostExport.js`, the normalized model, image handling).

---

## 1. Architecture / data flow

```
                 ┌─ manual: click Export in Ghost ─┐
trigger ─────────┼─ scripted: session-login hack  ─┼──▶ ghost-export-<ts>.json
(cron / RSS)     └─ (RSS tripwire decides "now")  ─┘            │
                                                                ▼
                                                      convert (this spec)
                                                                │
                              ┌─────────────────────────────────┼───────────────┐
                              ▼                                  ▼               ▼
                        ./YYYY/MM/<slug>.md            ./YYYY/MM/<slug>__*.jpg   ./archive/*.json
                        (markdown + frontmatter)       (downloaded images)       (sparse retention)
                                                                │
                                                                ▼
                                                           git commit
                                                     (diff = your changelog)
```

Every run regenerates files keyed by slug, so **git history is the edit log** —
each export-and-sync shows exactly what changed.

---

## 2. Acquiring the export

The export JSON is the only fully-faithful source on the Starter plan (RSS is
lossy/capped). Three tiers, increasing automation:

### Tier 1 — Manual + watched folder (robust, recommended to start)
You click **Ghost Admin → Settings → Migration tools → Export**, drop the file
in `inbox/`. A file-watch (`fswatch`/`chokidar`) runs the converter on drop.
Zero auth risk; you just have to remember to export.

### Tier 2 — Scripted session login (automatable)
Confirmed reachable on `weaties.ghost.io` (probed 2026-06-21):
- `POST /ghost/api/admin/session/` → **401** (login endpoint live)
- `GET  /ghost/api/admin/db/` → **403** (export endpoint live, auth-gated)

Flow:
```
POST /ghost/api/admin/session/   body {username: <email>, password: <pw>}
   → response sets cookie  ghost-admin-api-session
GET  /ghost/api/admin/db/         with that cookie
   → full export JSON (same file as the manual Export button)
```
Uses **staff session auth**, not the gated integration API — so it works on
Starter. Credentials live in `.env` (never committed).

**Gotcha — 2FA:** Ghost(Pro) may challenge a new-device/new-IP login with an
emailed code, which blocks unattended scripting. Mitigations: run from a stable
IP and persist the session cookie across runs (re-auth only when it expires); or
fall back to Tier 1 when a challenge appears. This is the one fragile link in
full automation — design it to degrade gracefully to Tier 1.

### Tier 3 — RSS-triggered (closes the loop)
Poll `https://weaties.ghost.io/rss/` on a short interval. The feed carries full
`content:encoded` but is **capped at the 3 most recent posts here** (`/rss/2/`
is 404), so treat it purely as a *tripwire*: hash the feed; on change, fire a
Tier-2 export. Pair with a **periodic unconditional full export** (e.g. daily)
as the safety net, because RSS can't see an edit to an older post — but every
export is the complete DB, so the periodic run reconciles everything.

> Net: RSS = "mirror new posts promptly"; cron full export = "never miss an old
> edit". The converter is identical either way.

---

## 3. The converter (export JSON → vault)

### 3.1 Per-post mapping
Source: `db[0].data.posts[]` (+ `tags`, `posts_tags` for tag names). For each
post with `status` in {published, draft} (configurable whether to include drafts):

| Vault output | From Ghost field |
|---|---|
| body markdown | `html` → markdown via **turndown** (GFM plugin) |
| `title` | `title` |
| `slug` | `slug` (canonical identity; = filename) |
| `date` | `published_at` (fallback `created_at`) |
| `updated` | `updated_at` (used for change detection) |
| `status` | `status` |
| `tags` | joined from `posts_tags`→`tags`, internal `#` tags kept |
| `feature_image` | downloaded, rewritten to local relative path |
| `excerpt` | `custom_excerpt` (or derived) |
| `ghost_id`, `ghost_uuid` | `id`, `uuid` — preserved for lossless round-trip |

### 3.2 HTML → markdown card handling
Ghost bodies contain cards that need deliberate handling, not naive stripping:
- **Images / galleries** → download each, emit `![alt](local.jpg)`.
- **`<figure><figcaption>`** → image + caption line.
- **Bookmark / embed / `<iframe>` cards** (e.g. gaiagps, YouTube) → keep as raw
  HTML in the markdown (Obsidian renders it; a future SSG can too). Do **not**
  let turndown drop them.
- **Code cards** → fenced code blocks with language.
- Unknown cards → preserve inner HTML rather than lose content.

### 3.3 Images → local
The whole point of a real backup. For every image URL (body, gallery, feature):
1. Download into the **same folder as the post**.
2. Name it `<slug>__<n>.<ext>` (slug-prefixed → no collisions when multiple
   slugs share a `MM/` folder).
3. Rewrite the reference to the relative local filename.
4. Cache by source URL within a run (don't download the same asset twice).
5. If a download fails, leave the original URL and log it (never silently drop).

Images come from Ghost's own CDN today; once local, the vault is self-contained.

### 3.4 Layout (your chosen structure)
```
vault/
  2021/
    05/
      day-1-seattle-to-nahalem.md
      day-1-seattle-to-nahalem__1.jpg
      day-2-nehalem-to-newport.md
      day-2-nehalem-to-newport__1.jpg ...
  2026/
    06/
      moving-friends-and-family.md
      moving-friends-and-family__1.jpg
  archive/
    ghost-export-2026-06-21T1443.json
  inbox/            # Tier-1 drop folder (gitignored)
```
- Path = `./<YYYY>/<MM>/<slug>.md`, year/month from `published_at`.
- Attachments live **beside** their post (your preference), slug-prefixed.

### 3.5 Frontmatter schema
```yaml
---
title: Day 2 – Nehalem to Newport
slug: day-2-nehalem-to-newport
date: 2021-05-05T12:53:12-07:00
updated: 2021-05-05T12:53:12-07:00
status: published
type: post                       # post | page
tags: [roadtrip-2021, trip-reports]
feature_image: day-2-nehalem-to-newport__feature.jpg
excerpt: "..."
ghost_id: 6489a1c2e4b0...        # identity for lossless round-trip
ghost_uuid: 0f1e2d3c-...
---
```

### 3.6 Idempotency & change detection
- Stable filename per slug → re-runs **update in place** → clean git diffs.
- Skip unchanged posts: compare frontmatter `updated` vs the export's
  `updated_at`; only rewrite (and re-download images) when it advanced. A
  `--force` flag rewrites everything.
- **Slug changed in Ghost?** Old file would orphan. Match on `ghost_id` first;
  if the slug moved, `git mv` the old file to the new path so history follows.
- **Post deleted in Ghost?** It simply won't be in the next export. Don't delete
  from the vault automatically — instead report "in vault but not in latest
  export" so you decide (deletion is destructive; the vault is your archive).

---

## 4. JSON archive — sparse retention

Keep a rolling archive of raw exports, dense near *now* and thinning with age,
**never dropping the very oldest**. This matches the "keep newest, keep oldest,
keep the midpoint, recurse" intuition — formally, **exponential age-bucketing**:

- Always keep the **newest** and the **oldest** export.
- Bucket every other export by age-in-days into power-of-two bands:
  `(0,1], (1,2], (2,4], (4,8], (8,16], (16,32], (32,64], …`
- Keep **one** representative per band (the oldest within the band, so spacing
  stays even); delete the rest.

Result: retained count is **O(log(age))** — a blog spanning years keeps ~12–15
exports regardless of how often you run. Pruning runs after each new export.

```
Example — daily exports for ~6 months, after pruning keep roughly:
  today, yesterday, ~2d, ~4d, ~9d, ~17d, ~33d, ~65d, ~130d ago, …and the oldest.
```

(Tunable: a "keep all from last N days" floor before the exponential bands kick
in, if you want denser recent coverage.)

---

## 5. Scheduling / closing the loop

- **Cron (safety net):** daily/weekly → Tier-2 export → convert → prune archive
  → `git commit` (+ optional `push` to a private remote = offsite backup).
- **RSS tripwire (promptness):** every ~30–60 min → hash `/rss/` → on change,
  fire the same job immediately.
- Both call one entry point: `sync` (acquire-or-accept export → convert → prune
  → commit). Manual `sync --from inbox/<file>.json` covers Tier 1.

---

## 6. Module layout (fits existing repo)

```
src/
  ghost/ghostExport.js     # (exists) load + normalize an export file
  vault/convert.js         # NEW: post → markdown + frontmatter (turndown + cards)
  vault/images.js          # NEW: download + rewrite to local relative paths
  vault/layout.js          # NEW: YYYY/MM/<slug> paths, slug-move via git mv
  vault/archive.js         # NEW: sparse-retention pruning
  ghost/fetchExport.js     # NEW: Tier-2 session-login + db export (Tier-1 = just a file)
  rss/watch.js             # NEW: poll /rss/, hash, trigger
  cli.js                   # add: `sync`, `watch`
deps: turndown (+ turndown-plugin-gfm)
```

---

## 7. Build order (milestones)

1. **Converter MVP** — `sync --from <export.json>`: posts → `YYYY/MM/<slug>.md`
   + frontmatter, **images kept as URLs** (no download yet). Run against the
   export we already have; eyeball a few notes. *Fastest path to "it works."*
2. **Local images** — download + rewrite; vault becomes self-contained.
3. **Idempotency + git** — change detection, slug-move handling, auto-commit.
4. **Archive retention** — sparse pruning of `archive/*.json`.
5. **Tier-2 fetch** — scripted session login + db export (handle/raise on 2FA).
6. **RSS watch** — tripwire that fires the sync.

Milestone 1 alone delivers the back-port (the one-time "pull everything Ghost
has into the vault") — it just happens to be re-runnable forever after.
