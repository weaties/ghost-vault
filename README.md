# ghost-vault

Migration tooling to move two eras of blog content into **Ghost** (`weaties.ghost.io`):

- **Era 1** — Obsidian vault published to Jekyll/GitHub Pages (`github.com/weaties/blog`)
- **Era 2** — WordPress.com (`weatiesroadtrip2021.com`, 2021 road trip)

The site is on Ghost's **Starter plan**, so the Admin API is unavailable. This
tool uses Ghost's free built-in **Migration tools (Import/Export)** instead: it
generates an upload-ready import JSON and never talks to an API. Era-1 images are
hotlinked from GitHub (no upload). See [`CLAUDE.md`](./CLAUDE.md) for the full brief.

## Setup

```sh
npm install
cp .env.example .env        # optional: override source paths / raw image base

# Era 1 source: clone the blog repo where .env points (default ./sources/blog)
git clone https://github.com/weaties/blog.git sources/blog

# Era 2 source: in WordPress.com, Tools -> Export, save the .xml to ./sources/wordpress-export.xml
```

## Workflow (no upgrade needed)

```sh
# 1. In Ghost Admin -> Settings -> Migration tools -> Export, download the JSON.
#    Save it as ./sources/ghost-export.json (or pass --against=<path>).

npm run parse:obsidian                                   # sanity-check the parse (no writes)

node src/cli.js reconcile   --source=obsidian            # report: how many new / duplicate / review
node src/cli.js build-import --source=obsidian           # write ./out/import-obsidian.ghost-import.json

# 2. Upload that file via Ghost Admin -> Settings -> Migration tools -> Import.
```

`reconcile` and `build-import` compare against the Ghost **export** file and skip
posts already in Ghost — matching on slug, title+date, and a content fingerprint
(which catches matches even when the hand-imported title/slug differ). The import
file contains only the `new` bucket; `review` (uncertain) matches are held for you
to resolve. Reports land in `out/<label>.summary.json`.

## How it works

```
sources/obsidian.js  ─┐                                    ┌ reconcile vs Ghost export (ghost/ghostExport.js + reconcile.js)
sources/wordpress.js ─┤→ NormalizedPost[] → dedupe ────────┤
                       (model.js)          (model.js)      └ hotlink images → Ghost payload → Ghost import JSON
                                                             (images/github)  (ghost/convert)  (ghost/importfile)
```

Both eras normalize into a single `NormalizedPost` shape (`src/model.js`), so
dedupe, tag mapping, image handling, reconciliation, and import-file generation
are shared. `pipeline.js` orchestrates it.

## Decisions baked into the tooling (see CLAUDE.md)

- Folder groups → Ghost **tags**; provenance tracked via internal tags `#source-obsidian` / `#source-wordpress`.
- Dataview index/listing pages are **dropped**.
- `<iframe>` embeds and lat/long **location** are preserved (location as a small note; Ghost has no geo field).
- Quote-variant **duplicate** posts are merged (`dedupePosts`), keeping the longer body.
- Original publish dates preserved via `published_at`.
- **Comments** are appended to the post body as a styled section — Ghost has no native comment-import API. (Open question: confirm this treatment.)

## Phase 2 — mirror Ghost → Obsidian vault

Keep Ghost as the editor; mirror its content one-way into a private, git-tracked
Obsidian vault so you own it and can rehost later. Design: `docs/ghost-to-vault.md`.
Runbook: `runbooks/ghost-mirror.md`.

```sh
node src/cli.js sync --from <export>.json --dry-run   # preview -> out/vault-preview/
node src/cli.js sync --from <export>.json             # write VAULT_DIR (from .env)
```

**Hands-off:** install the `ghost-vault-watch` launchd agent (`deploy/launchd/`)
to watch `~/Downloads`. Then your whole workflow is clicking **Export** in Ghost —
the agent runs `ingest` (validate + dedup + sync + archive) on the new file
automatically. No login, no 2FA. (Staff 2FA rules out scripted export.)

> ⛔ The real vault is inside a personal Obsidian vault (private journals). It is
> set via `VAULT_DIR` in `.env` (never committed) and **must never be read by an
> LLM**. Develop with `--dry-run` only; real writes happen via the launchd agents
> (`deploy/launchd/`, `bin/ingest-downloads.sh`).

## Status

**Phase 1 — migrate IN (done)**
- ✅ Era 1 (Obsidian/Jekyll) parser — tested against the real repo
- ✅ Era 2 (WordPress.com API) parser — 50 posts, comments, feature images
- ✅ Reconciliation against a Ghost export (dup-free) — slug / title+date / content fingerprint
- ✅ Ghost import-file generator + image hotlinking — both eras imported

**Phase 2 — mirror OUT (functionally complete)**
- ✅ Milestone 1: converter MVP — `sync` → `YYYY/MM/<slug>.md` + frontmatter (verified)
- ✅ Milestone 2: local image download — self-contained vault (verified, 0 failures)
- ✅ Milestone 3: incremental change-detection — unchanged/updated/moved/deleted (re-sync skips all, 0 downloads)
- ✅ Milestone 4: sparse JSON-archive retention — exponential thinning, oldest kept forever (verified)
- ✅ Automation: **watch-Downloads** launchd agent → `ingest` (validate + dedup + sync + archive)
- ⛔ `fetch-export` (scripted login) built but defeated by Ghost(Pro) staff 2FA; RSS-trigger dropped as moot
