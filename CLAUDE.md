# Blog content tooling — Ghost ⇄ Obsidian

This repo holds the tooling that lets the user own and control their blog content. Two phases:

- **Phase 1 (done) — migrate IN:** consolidate historical content from two source eras into the Ghost site. See "Phase 1" below.
- **Phase 2 (active) — mirror OUT:** continuously mirror the Ghost site into a private local Obsidian vault, so Ghost stays the authoring tool but the content lives, versioned, on disk and can be rehosted anytime. See "Phase 2" and `docs/ghost-to-vault.md`.

This file is the working brief. Read it before starting any task.

> ## ⛔ PRIVACY GUARDRAIL — read first
> The mirror target (**`VAULT_DIR`**, set in `.env`) is a subdirectory **inside the user's personal Obsidian vault, which contains private journals**. Claude/LLMs must **NEVER read, list, open, or `cd` into `VAULT_DIR` or its parent vault** — not for "verification", not for debugging, not ever. The path is deliberately kept out of this repo (it's in `.env`, gitignored) so it never enters context.
> - To develop or eyeball mirror output, use **`--dry-run`**, which writes only public blog content to `./out/vault-preview/` (in-repo, gitignored). That is the only place to inspect converted notes.
> - Writing to the real vault is done **only by unattended launchd scripts**, never by Claude interactively.
> - If a task seems to require reading the vault, stop and ask the user instead.

## Repo / sharing

This is a standalone git repo intended to be shared (public GitHub remote OK). It contains **only tooling** — no blog content, no vault, no secrets. `.gitignore` excludes `sources/`, `out/`, `.env`, and any `vault*`/`inbox/` paths. Keep it that way: never commit exported content, the vault, or credentials.

## Phase 1 — migrate IN (Goal)

Consolidate all historical blog content into the Ghost site, preserving **images/media**, **post metadata** (dates, titles, tags), and **reader comments** as faithfully as the target platform allows.

## Source eras

### Era 1 — Obsidian → GitHub Pages (Jekyll)
- **Repo:** https://github.com/weaties/blog (an Obsidian vault published via the [GitHub Publisher](https://github.com/ObsidianPublisher/obsidian-github-publisher) plugin to GitHub Pages with Jekyll).
- **Format:** Markdown files with YAML frontmatter. Observed properties:
  - `share: true` — publish flag
  - `title:` — human title (keeps spaces/punctuation; may differ from filename)
  - `tags:` — e.g. `letter-to-mom`
  - `location:` — `[lat, long]` array (from Obsidian Map View)
- **Filenames** are date-prefixed and dash-slugified: `YYYY-MM-DD-slug.md`. The date lives in the filename, not always in frontmatter.
- **Structure:**
  - `letters-to-mom/` — ~73 posts (weekly letters)
  - `trip-reports/` — one subfolder per trip, each with day-by-day posts and an `index.md`
    - `2024-eclipse-texas-roadtrip/`, `2024-11-Sonoma-thanksgiving/`, `2025-02-Washington-DC/`, `2025-05-Bruge-to-Amsterdam-Bike-and-Barge/`
  - Top-level pages: `about-this-blog.md`, `about-how-this-blog-is-created.md`, `index.md`, `music-found.md`, `Shows-seen.md`, `letters-to-mom.md`, `todolist.md`
  - `attachments/` — ~1800 image files, referenced as `![alt](../attachments/NAME.jpeg)` (relative paths; some names contain spaces or are URL-encoded with `%20`).
- **Gotchas:**
  - **Duplicate posts** exist from curly-quote vs straight-quote variants of the same title (e.g. `...expedia-layoffs---i-am-ok.md` vs `...expedia-layoff's---i'm-ok.md`, and two "eclipse week 2" files). These must be deduped — keep the better/newer copy.
  - **Dataview-generated index pages** (`index.md`, `letters-to-mom.md`) are auto-listings rendered to markdown at publish time. Do **not** migrate these (see decisions).
  - **`<iframe>` embeds** (gaiagps map tracks) appear inline in trip posts. Preserve these.
  - Image references use relative `../attachments/` paths and inconsistent encoding — normalize when uploading to Ghost.

### Era 2 — WordPress.com (2021 road trip)
- **Site:** `weatiesroadtrip2021.com` — the full **2021 Pacific-coast road trip + Anacortes Race Week**. Live.
- **Platform:** Hosted **WordPress.com**. The standard `/wp-json/` REST path is gated (404), but the **WordPress.com public API** is open: `https://public-api.wordpress.com/rest/v1.1/sites/weatiesroadtrip2021.com/{posts,comments}` — no login.
- **Scope (actual):** **50 published posts**, 2021-04-27 → 2021-06-27 (not "a handful" — the brief's earlier estimate was wrong). **1 comment** total (Nick Dallett on "Day 2"). All categorized "mom letters".
- **Access:** `scripts/fetch-wpcom.mjs` pulls posts + comments from the public API and caches them to `sources/wpcom-{posts,comments}.json`. `parseWpcom()` reads the cache. The WXR path is kept only as a fallback. **No manual export needed.**
- **Images:** already absolute public URLs on the wordpress.com CDN → **hotlinked** (same as Era 1, no upload). 48/50 posts have a `featured_image`, carried to Ghost `feature_image`.
- **Comments:** the 1 comment is appended to its post via the styled body appendix (Ghost has no native comment import).

## Target — Ghost (Starter plan)

- Hosted Ghost at `weaties.ghost.io`, on the **Starter plan**. **The Admin/Content API and custom integrations are gated behind higher tiers** (confirmed 2026-06-19 — "Add custom integration" prompts to upgrade). We deliberately **avoid the API** and use the free built-in **Migration tools** instead:
  - **Export** (Settings → Migration tools → Export) → downloads a JSON of all current site content. We reconcile against this file locally.
  - **Import** (Settings → Migration tools → Import) → upload a Ghost-format JSON file we generate. No API key needed.
- **Images are not uploaded.** The JSON import doesn't bundle media, so Era-1 images are **hotlinked** from their public GitHub raw URLs (`https://raw.githubusercontent.com/weaties/blog/main/attachments/<name>`, percent-encoded). Tradeoff: images keep living in the GitHub repo (keep it alive); reversible later if the Admin API ever becomes available. WP-era images TBD.
- **Import file shape:** the Ghost DB-export format — `db[0].data.{posts,tags,posts_tags}`. Post body is carried as a single **HTML card inside `mobiledoc`** (the importer converts it to lexical). Internal tags keep their `#`; Ghost slugs `#source-obsidian` → `hash-source-obsidian`. See `src/ghost/importfile.js`.
- **DATE GOTCHA (learned the hard way):** the importer only honors dates in **MySQL datetime format** (`YYYY-MM-DD HH:MM:SS`, UTC). ISO-8601 with `T`/`Z` is silently ignored and every post falls back to the *import* time. `meta.version` is set to `6.0.0`. The first Era-1 import (ISO dates) reset all dates to import day; fixed in `mysqlDatetime()`. Apply the same to the WP era.
- **Undo path for a bad import:** every imported post carries internal tag `#source-obsidian` (slug `hash-source-obsidian`), which no pre-existing Ghost post had. To redo: filter by that tag in Ghost Admin → bulk-delete → re-import the corrected file. The 14 reconciled duplicates lack this tag, so they're untouched.
- **Trip-post dates:** posts in trip subfolders often lack a filename/frontmatter date; we infer one from the trip folder's `YYYY-MM` + the "Day N" in the title (`inferTripDate`). Loose planning files in `trip-reports/` root and two "this is a test" notes are dropped.

## Decisions made

- **Structure → tags.** Map folder groupings to Ghost tags:
  - Public tags: `letters-to-mom`, `trip-reports`, plus a per-trip tag (the trip folder name, e.g. `2024-eclipse-texas-roadtrip`), and `roadtrip-2021` for the WP era.
  - Redundant frontmatter tag variants are **merged** onto the canonical tag (`letter-to-mom` → `letters-to-mom`, `Trip-report` → `trip-reports`) via `TAG_ALIASES` in `src/model.js`.
  - Internal tags (Ghost `#`-prefixed, hidden from readers) for provenance: `#source-obsidian`, `#source-wordpress`.
- **Pages:** import `music-found` and `shows-seen` as Ghost pages. **Skip** the two `about-*` pages — Ghost already has an About page; importing ours would duplicate it.
- **Drop Dataview index pages** — Ghost auto-generates tag/archive listing pages, so the manual `index.md` / `letters-to-mom.md` listings are not migrated.
- **Keep gaiagps `<iframe>` embeds** — preserve as HTML cards in the Ghost post body.
- **Keep location data** — carry `lat/long` into post metadata where Ghost allows (currently appended as a small note in the post body; Ghost has no geo field). Don't silently drop it.
- **Dedupe quote-variant files** — detect curly-vs-straight-quote (and other near-duplicate) posts and merge to a single canonical copy before import.
- **Hotlink Era-1 images from GitHub** (no upload) — see Target section.
- **Preserve original publish dates** via `published_at` (from filename date prefix for Era 1, from WXR `pubDate` for Era 2).
- **Reconcile before importing — never create duplicates.** Some posts were already hand-imported into `weaties.ghost.io` (from either era). We match our posts against a **Ghost Export JSON** (not the API — it's gated) on multiple signals: exact slug, normalized title + publish day, and a **content fingerprint** (normalized, punctuation-free body prefix) that catches matches even when the hand-imported title/slug differ. Each post is bucketed `duplicate` (skip), `review` (uncertain — held for a human), or `new`. The generated import file contains only the `new` bucket; `review` is never auto-included. See `src/ghost/reconcile.js`.

## Open questions / to confirm

- **WP "About me" post:** WordPress slug `example-post-3`, title "About me" (2021-04-27) — the trip's intro. Distinct from Ghost's current About page, so currently **kept** as a roadtrip-2021 post. Confirm keep vs skip vs reslug.
- **WP era status:** import file generated at `out/import-wp.ghost-import.json` — **50 posts**, tagged `roadtrip-2021` + `trip-reports`, feature images + the 1 comment preserved, reconciled (all 50 are new). Test sample at `out/test-wp-import.ghost-import.json`. Not yet uploaded.
- **Comments → Ghost:** Ghost's native (members-based) comments have **no official import API** and are created in real time tied to a member account, so WP comments generally **cannot** be imported as native Ghost comments. Decide a fallback: most likely **append preserved comments as a styled section at the bottom of each post body** (author + date + text), or archive them separately. Confirm preferred treatment.
- **Era-1 import status:** First import (103 posts) succeeded but used ISO dates → all posts landed on the import day (see DATE GOTCHA). Regenerated with MySQL dates, trip-date inference, and junk/planning files dropped → **98 posts** (96 posts + `music-found`/`shows-seen` pages), reconciled to skip the 14 already in Ghost. User must **delete the first bad batch** (filter Ghost by `hash-source-obsidian` tag → bulk-delete) then re-import `out/import-obsidian.ghost-import.json`.

## Working notes

- A scratch clone of the Era 1 repo was made at `/tmp/blog_inspect` during scoping (not committed here). Re-clone fresh when doing the real migration.
- This repo (`ghost-vault`) is the tooling/workspace, not the content itself. It contains no blog content, vault, or secrets (see Repo/sharing).
- The tooling never writes to Ghost directly — it only produces files under `out/` for you to review, then you upload via Migration tools. `out/<label>.summary.json` carries the reconcile plan (duplicate/review/new) and dropped-duplicate list; `out/<label>.ghost-import.json` is the upload file.
- Workflow: (1) Ghost → Migration tools → **Export** → save JSON; (2) `node src/cli.js build-import --source=obsidian --against=<export.json>`; (3) review `out/`; (4) Ghost → Migration tools → **Import** the generated file.

## Phase 2 — mirror OUT (Ghost → Obsidian vault)

**Goal:** keep Ghost as the authoring platform; continuously mirror its content one-way into a private, git-tracked Obsidian vault of clean markdown + (eventually) local images, so the user owns the content and can rehost later. Ghost is authoritative; the vault is a downstream copy. Full design in `docs/ghost-to-vault.md`; operational steps in `runbooks/`.

- **Source of truth = the Ghost Export JSON** (Migration tools → Export). Faithful and free on Starter. RSS is capped at the 3 newest posts here, so it's only a change *tripwire*, not a source. The export can be scripted on Starter via staff-session auth (`POST /ghost/api/admin/session/` → cookie → `GET /ghost/api/admin/db/`) — no integration API needed; watch for Ghost(Pro) 2FA on new-device logins.
- **`__GHOST_URL__`:** Ghost exports store asset/link URLs as this placeholder; the converter substitutes `GHOST_SITE_URL` (default `https://weaties.ghost.io`).
- **Layout:** posts at `./<YYYY>/<MM>/<slug>.md`; images in a top-level `./attachments/` folder (`<slug>__<n>.<ext>` / `<slug>__feature.<ext>`), referenced post-relative (e.g. `../../attachments/…`). Frontmatter carries `slug` + `ghost_id`/`ghost_uuid` as stable identity (re-runs update in place → clean git diffs; round-trip stays lossless). Iframes/embeds preserved as raw HTML; figcaptions → italic caption lines. **Layout migration:** a `--force` re-sync **moves** images already beside posts into `attachments/` (no re-download) and rewrites refs — `force` reprocesses posts but never forces image re-fetch (`downloadImages` always skips files on disk).
- **Command:** `node src/cli.js sync --from <export.json> [--out <dir>] [--dry-run] [--drafts] [--no-images] [--force] [--limit N]`. **Always** test with `--dry-run` (writes `out/vault-preview/`); only launchd writes the real `VAULT_DIR`.
- **Incremental (M3):** the sync reads existing vault frontmatter (keyed by `ghost_id`) and acts per post: *unchanged* (`updated_at` matches → skipped, no rewrite/redownload), *updated*, *moved* (slug/date changed → old files + attachments removed, canonical path written), *new*. Posts in the vault but absent from the export are **reported, never deleted**. Orphan `<slug>__*` attachments are pruned when a post's image set changes. `--force` rewrites/redownloads everything.
- **Images:** only `http(s)` srcs are downloaded into the top-level `attachments/` folder as `<slug>__feature.<ext>` / `<slug>__<n>.<ext>`; markdown + `feature_image` rewritten to post-relative refs. The `src=` parser uses a matched-quote capture so **literal apostrophes** in URLs (e.g. `…/A-380's….png`, from Era-1 GitHub hotlinks — `encodeURIComponent` leaves `'` unescaped) don't truncate. Non-URL refs (relative `../attachments/…` that were never rewritten because the source image was missing) are **left as-is and reported as broken**, not fetched. Idempotent; same URL reused across posts fetched once then copied. See `src/vault/images.js` + `convert.js`.
- **Full-mirror size:** the populated site (223 posts incl. migrated Era-1/2 content) pulls **~2976 images / ~3.5GB, 0 failures** — much larger than native-only. Mind where `VAULT_DIR` lives if the vault is cloud-synced.
- **Archive (M4):** `node src/cli.js archive --from <export.json>` copies the raw export into `ARCHIVE_DIR` (named by `meta.exported_on`) and prunes to a **sparse retention** set — keeps newest + everything within `--keep-recent-days` (default 7) + one per power-of-two age band + the oldest forever. ~O(log age) files retained. Idempotent. The launchd wrapper runs it after each sync. See `src/vault/archive.js`.
- **Scripted export (M5):** `node src/cli.js fetch-export` logs in with staff creds (`GHOST_ADMIN_EMAIL`/`PASSWORD` in `.env`) → session cookie → `GET /ghost/api/admin/db/` → writes a fresh export to `inbox/`. The launchd wrapper tries it first and falls back to a manual `inbox/` export on failure. **Built on `node:https`, NOT `fetch`** — fetch silently strips the forbidden headers `Origin`/`Referer`/`Cookie` that Ghost's admin routes require (no Origin → 404, no Cookie → 403). See `src/ghost/fetchExport.js`.
- **M5 caveats (the fragile link — UNVERIFIED LIVE):** could not be tested end-to-end here — no creds, and probing the live login tripped rate-limiting (429). Two real blockers for unattended use: (1) **Ghost(Pro) staff 2FA** (often default-on) emails a code on new-device login and stops scripted auth cold — detected and surfaced, but then you must use manual export; (2) rate-limiting on repeated logins. The manual-export → `inbox/` → launchd flow remains the bulletproof path; fetch-export is a best-effort convenience.
- **Automation = watch the Downloads folder (the answer to 2FA).** Confirmed: this Ghost(Pro) account has staff 2FA — scripted/unattended login is impossible (emails a code every attempt). So instead of logging in, we watch where exports already land: `ghost-vault ingest --from <file>` validates a Ghost export, dedups (skip if its `exported_on` stamp is already in `ARCHIVE_DIR`), then syncs + archives. `bin/ingest-downloads.sh` picks the newest `*ghost*.json` in `WATCH_DIR` (default `~/Downloads`) and ingests + commits. A launchd agent with `WatchPaths` on Downloads runs it on any folder change (cheap no-op when nothing new). The only manual step in the whole pipeline is clicking **Export** in Ghost. See `deploy/launchd/` (`com.weaties.ghost-vault-watch`).
- **M5/M6 status:** `fetch-export` (staff-session via `node:https`) is built but **defeated by 2FA** for this account and unused by the watcher. RSS watch (M6) **skipped** — pointless without unattended export. The watch-Downloads agent supersedes both.
- **Build status:** Milestones 1–4 done & verified; automation solved via watch-Downloads (verified: ingest syncs 221 posts, archives, and dedups on re-run). Phase 2 is functionally complete.
