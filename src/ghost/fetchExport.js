import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { URL } from 'node:url';
import { stampFromMs } from '../vault/archive.js';

/**
 * Fetch a full Ghost export via STAFF-SESSION auth (no integration/Admin API key,
 * so it works on the Starter plan). Mirrors what the browser does:
 *   POST /ghost/api/admin/session/  {username,password}  -> session cookie
 *   GET  /ghost/api/admin/db/       (with cookie)        -> full export JSON
 *
 * IMPORTANT: this uses node:https, NOT global fetch — fetch silently drops the
 * "forbidden" headers Origin / Referer / Cookie, all of which Ghost's admin
 * routes require (no Origin -> 404; no Cookie -> 403).
 *
 * Caveats (the fragile link — see docs/ghost-to-vault.md §2):
 *  - Ghost(Pro) may challenge a new-device/new-IP login with an emailed 2FA code,
 *    which blocks unattended scripting (detected and surfaced clearly).
 *  - Repeated attempts trip rate-limiting (HTTP 429). Run sparingly.
 *
 * @param {{ siteUrl:string, email:string, password:string, outDir:string }} o
 * @returns {Promise<{ outFile:string, posts:number, exportedOn:number }>}
 */
export async function fetchGhostExport({ siteUrl, email, password, outDir }) {
  const base = siteUrl.replace(/\/$/, '');
  const baseHeaders = {
    Origin: base,
    Referer: `${base}/ghost/`,
    'Accept-Version': 'v5.0',
    Accept: 'application/json',
  };

  // 1. Create a session.
  const body = JSON.stringify({ username: email, password });
  const sres = await httpsRequest(`${base}/ghost/api/admin/session/`, {
    method: 'POST',
    headers: { ...baseHeaders, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    body,
  });
  if (sres.status === 429) throw new Error('Ghost login rate-limited (HTTP 429). Wait a few minutes and retry, or export manually.');
  if (sres.status === 401 || sres.status === 403) {
    const detail = errDetail(sres.body);
    if (/2fa|two.?factor|verif/i.test(detail)) {
      throw new Error(`Ghost requires a 2FA code (${detail}). Scripted export blocked — do a manual Export into inbox/.`);
    }
    throw new Error(`Ghost login failed (HTTP ${sres.status}: ${detail}). Check GHOST_ADMIN_EMAIL / GHOST_ADMIN_PASSWORD.`);
  }
  if (sres.status !== 200 && sres.status !== 201) {
    throw new Error(`Ghost session: unexpected HTTP ${sres.status}. ${errDetail(sres.body)}`);
  }

  const setCookie = sres.headers['set-cookie'] || [];
  const cookie = setCookie.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
  if (!cookie) throw new Error('Ghost session created but no cookie returned.');

  // 2. Pull the DB export.
  const eres = await httpsRequest(`${base}/ghost/api/admin/db/`, {
    method: 'GET',
    headers: { ...baseHeaders, Cookie: cookie },
  });
  if (eres.status !== 200) throw new Error(`Ghost export request failed (HTTP ${eres.status}). ${errDetail(eres.body)}`);

  let doc;
  try {
    doc = JSON.parse(eres.body);
  } catch {
    throw new Error('Ghost export: response was not JSON (auth/endpoint issue).');
  }
  const posts = doc?.db?.[0]?.data?.posts;
  if (!Array.isArray(posts)) throw new Error('Ghost export: unexpected shape (no db[0].data.posts).');

  const exportedOn = doc.db[0].meta?.exported_on || Date.now();
  const outFile = path.join(outDir, `ghost-export-${stampFromMs(exportedOn)}.json`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, eres.body);
  return { outFile, posts: posts.length, exportedOn };
}

/** Minimal https request that honors Origin/Referer/Cookie (fetch strips these). */
function httpsRequest(urlStr, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request(
      { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function errDetail(bodyText) {
  try {
    const j = JSON.parse(bodyText);
    return j?.errors?.[0]?.type || j?.errors?.[0]?.message || JSON.stringify(j).slice(0, 200);
  } catch {
    return (bodyText || '').slice(0, 120);
  }
}
