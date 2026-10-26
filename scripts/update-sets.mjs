#!/usr/bin/env node
/* ==========================================================================
   Deep Work — set-list updater
   ==========================================================================
   Pulls likely full DJ sets from YouTube, with no API key:

     YouTube     each channel's /videos page (the RSS feeds were retired)

   No API keys, no paid services, no dependencies. Node 20+ (global fetch).

   Channel IDs are never guessed: a handle is resolved from the channel page's
   canonical link and then cached back into sources.json.

   Usage
     node scripts/update-sets.mjs              update data/sets.json
     node scripts/update-sets.mjs --dry-run    report only, write nothing
     node scripts/update-sets.mjs --verbose    log every decision
   ========================================================================== */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE         = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_FILE = path.join(HERE, 'sources.json');
const OUT_FILE     = path.join(HERE, '..', 'data', 'sets.json');

const argv       = new Set(process.argv.slice(2));
const DRY        = argv.has('--dry-run');
const VERBOSE    = argv.has('--verbose');

/* A plain desktop user agent: some public pages serve a stub to unknown ones. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const log   = (...a) => console.log(...a);
const vlog  = (...a) => { if (VERBOSE) console.log('   ', ...a); };
const warn  = (...a) => console.warn('  ! ', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- http -------------------------------------------------------- */
async function fetchText(url, { timeoutMs = 25000, retries = 2 } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    /* YouTube starts refusing connections after a burst of requests, so
       back off and try again rather than dropping the result */
    if (attempt > 0) await sleep(1500 * attempt * attempt);

    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctl.signal,
        redirect: 'follow',
        headers: { 'user-agent': UA, 'accept-language': 'en-GB,en;q=0.9' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      vlog(`${url} attempt ${attempt + 1} -> ${err.message}`);
    } finally {
      clearTimeout(t);
    }
  }
  throw lastError;
}
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const uniq = arr => [...new Set(arr)];

/* ==========================================================================
   TAGGING
   ========================================================================== */
function buildTags(title, author, baseTags, sources) {
  const hay = norm(`${title} ${author}`);
  const tags = [...(baseTags || [])];

  for (const a of sources.artists || []) {
    if (hay.includes(norm(a.name))) tags.push(...(a.tags || [norm(a.name)]));
  }
  for (const [genre, words] of Object.entries(sources.genreKeywords || {})) {
    if (words.some(w => hay.includes(norm(w)))) tags.push(genre);
  }
  return uniq(tags.map(t => String(t).toLowerCase().trim()).filter(Boolean)).slice(0, 8);
}

/** Fallback test for sources that do not expose a duration. */
function looksLikeSet(title, author, sources) {
  const hay = norm(`${title} ${author}`);
  if (/\b(shorts?|teaser|trailer|snippet|preview|announcement|out now|official video|official audio|lyric video)\b/.test(hay)) {
    return false;
  }
  if ((sources.keywords || []).some(k => hay.includes(norm(k)))) return true;
  if ((sources.artists  || []).some(a => hay.includes(norm(a.name)))) return true;
  return false;
}

/* ==========================================================================
   YOUTUBE
   --------------------------------------------------------------------------
   The channel RSS feeds (youtube.com/feeds/videos.xml) were retired — every
   parameter form now returns 404 — so uploads are read from the channel's
   /videos page instead, which embeds them in ytInitialData.

   Upside: that data carries each video's duration, so a full set can be
   identified by length rather than guessed from its title.
   Downside: upload dates are relative ("2 days ago") and so approximate.
   ========================================================================== */

/** Pull the ytInitialData JSON blob out of a YouTube page. */
function extractYtInitialData(html) {
  const m = html.match(/ytInitialData"\]\s*=\s*(\{[\s\S]*?\});\s*<\/script>/)
         || html.match(/var\s+ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** Every object in a tree matching a predicate. YouTube nests deeply and
    reshuffles its layout often, so searching beats fixed paths. */
function deepFind(node, pred, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const v of node) deepFind(v, pred, out); return out; }
  if (pred(node)) out.push(node);
  for (const k in node) deepFind(node[k], pred, out);
  return out;
}

/** "1:02:11" -> ms */
function durationToMs(txt) {
  const parts = String(txt || '').trim().split(':').map(Number);
  if (!parts.length || parts.some(n => Number.isNaN(n))) return null;
  const secs = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2]
             : parts.length === 2 ? parts[0] * 60 + parts[1]
             : parts[0];
  return secs * 1000;
}

/** "2 days ago" -> an approximate ISO timestamp. Good enough to sort by. */
function agoToIso(txt) {
  const m = String(txt || '').match(/(\d+)\s*(second|minute|hour|day|week|mo|month|year)/i);
  if (!m) return null;
  const ms = { second:1e3, minute:6e4, hour:36e5, day:864e5, week:6048e5, mo:2592e6, month:2592e6, year:31536e6 }[m[2].toLowerCase()];
  if (!ms) return null;
  return new Date(Date.now() - Number(m[1]) * ms).toISOString();
}

/**
 * Resolve a handle such as "@boilerroom" to its UC… channel ID.
 * Only the canonical link and externalId are trusted: a bare /channel/UC…
 * match anywhere in the page picks up unrelated channels from sidebars.
 */
async function resolveChannelId(handle) {
  const slug = String(handle).replace(/^@/, '');
  const candidates = [
    `https://www.youtube.com/@${encodeURIComponent(slug)}`,
    `https://www.youtube.com/c/${encodeURIComponent(slug)}`,
    `https://www.youtube.com/user/${encodeURIComponent(slug)}`,
  ];
  for (const url of candidates) {
    try {
      const html = await fetchText(url);
      const canon  = html.match(/<link\s+rel="canonical"\s+href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/);
      const strict = html.match(/"(?:externalChannelId|externalId)"\s*:\s*"(UC[\w-]{22})"/);
      if (canon && strict && canon[1] !== strict[1]) {
        warn(`${handle}: canonical and externalId disagree — not trusting either.`);
        continue;
      }
      const id = canon?.[1] || strict?.[1];
      if (id) {
        const name = (html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/) || [])[1] || '';
        return { id, name };
      }
      vlog(`no trustworthy channel id in ${url}`);
    } catch (err) {
      vlog(`${url} -> ${err.message}`);
    }
  }
  return null;
}

/**
 * Parse any YouTube page that lists videos — a channel's /videos tab or a
 * search results page. Channel pages use lockupViewModel, search results
 * mostly use videoRenderer, so both are handled.
 */
function parseChannelVideos(html) {
  const data = extractYtInitialData(html);
  if (!data) return [];

  const seen = new Set();
  const out = [];

  /* search results */
  for (const node of deepFind(data, n => n.videoRenderer && n.videoRenderer.videoId)) {
    const v = node.videoRenderer;
    if (seen.has(v.videoId)) continue;
    const title = v.title?.runs?.[0]?.text || v.title?.simpleText || '';
    if (!title) continue;
    seen.add(v.videoId);
    out.push({
      videoId: v.videoId,
      title,
      channel: v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || '',
      durationMs: durationToMs(v.lengthText?.simpleText),
      published: agoToIso(v.publishedTimeText?.simpleText),
      publishedApprox: true,
    });
  }

  const lockups = deepFind(data, n => n.lockupViewModel && n.lockupViewModel.contentId)
    .map(n => n.lockupViewModel);

  for (const lu of lockups) {
    /* Shorts and playlists carry a different contentType, so this also
       takes care of excluding them. */
    if (lu.contentType && lu.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') continue;
    const videoId = lu.contentId;
    if (!videoId || seen.has(videoId)) continue;

    const meta = lu.metadata?.lockupMetadataViewModel;
    const title = meta?.title?.content;
    if (!title) continue;

    /* metadataRows hold view count and the relative upload date */
    const parts = (meta?.metadata?.contentMetadataViewModel?.metadataRows || [])
      .flatMap(r => r.metadataParts || [])
      .map(p => p.text?.content)
      .filter(Boolean);
    const agoText = parts.find(t => /ago$/i.test(t)) || '';

    /* the duration sits in a thumbnail badge, e.g. "45:56" */
    const badge = deepFind(lu.contentImage || {}, n => n.thumbnailBadgeViewModel)
      .map(n => n.thumbnailBadgeViewModel.text)
      .find(t => /^\d+(:\d+)+$/.test(String(t || '').trim()));

    seen.add(videoId);
    out.push({
      videoId,
      title,
      channel: parts.find(p => !/view|ago/i.test(p)) || '',
      durationMs: durationToMs(badge),
      published: agoToIso(agoText),
      publishedApprox: true,
    });
  }
  return out;
}

/**
 * Search-based collection.
 *
 * Several artists post only short clips on their own channels, so their
 * full sets live on festival, radio and label channels instead. Each query
 * must still name the artist in the title, which keeps unrelated results out.
 */
async function collectSearch(sources) {
  const out = [];
  const searches = sources.searches || [];
  /* searches are rate-limited harder than channel pages, so they go slower */
  const delay = sources.options?.searchDelayMs ?? 1500;
  const perSearch = sources.options?.perSearch ?? 15;
  const minMs = (sources.options?.youtubeMinMinutes ?? 20) * 60000;

  for (const entry of searches) {
    const query = typeof entry === 'string' ? entry : entry.query;
    if (!query) continue;
    const mustMatch = norm((typeof entry === 'object' && entry.match) || query.split(/\s+/).slice(0, 2).join(' '));

    try {
      const html = await fetchText(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
      const vids = parseChannelVideos(html);
      let kept = 0;

      for (const v of vids) {
        if (kept >= perSearch) break;
        if (!v.durationMs || v.durationMs < minMs) continue;
        /* the artist has to actually be named, or search drift creeps in */
        if (!norm(`${v.title} ${v.channel}`).includes(mustMatch)) {
          vlog(`skip (no name match): ${v.title}`);
          continue;
        }

        out.push({
          id: `yt:${v.videoId}`,
          source: 'youtube',
          videoId: v.videoId,
          url: `https://www.youtube.com/watch?v=${v.videoId}`,
          title: v.title,
          channel: v.channel || 'YouTube',
          published: v.published,
          publishedApprox: true,
          durationMs: v.durationMs,
          tags: buildTags(v.title, v.channel, (typeof entry === 'object' && entry.tags) || [], sources),
        });
        kept++;
      }
      log(`  "${query}": ${kept} of ${vids.length}`);
    } catch (err) {
      warn(`search "${query}" failed — ${err.message}`);
    }
    await sleep(delay);
  }

  return out;
}

async function collectYoutube(sources) {
  const out = [];
  const channels = sources.youtube || [];
  const delay = sources.options?.requestDelayMs ?? 350;
  const perChannel = sources.options?.perYoutubeChannel ?? 12;
  const minMs = (sources.options?.youtubeMinMinutes ?? 20) * 60000;
  let resolvedAny = false;

  for (const ch of channels) {
    if (!ch.channelId) {
      if (!ch.handle) { warn(`${ch.name}: no channelId and no handle — skipped. TODO: add one.`); continue; }
      log(`  resolving ${ch.name} (${ch.handle})…`);
      const found = await resolveChannelId(ch.handle);
      await sleep(delay);
      if (!found) {
        warn(`${ch.name}: could not resolve ${ch.handle} — skipped, nothing guessed. TODO: paste the UC… id into sources.json by hand.`);
        continue;
      }
      ch.channelId = found.id;
      resolvedAny = true;
      log(`    -> ${found.id}${found.name ? `  (${found.name})` : ''}`);
    }

    try {
      const html = await fetchText(`https://www.youtube.com/channel/${ch.channelId}/videos`);
      const vids = parseChannelVideos(html);

      if (!vids.length) {
        warn(`${ch.name}: no videos parsed from the channel page. TODO: check the channel id, or YouTube changed its page shape.`);
        await sleep(delay);
        continue;
      }

      let kept = 0;
      for (const v of vids) {
        if (kept >= perChannel) break;

        /* Duration is the honest test. Where it is missing, fall back to the
           title heuristic. */
        const isSet = v.durationMs ? v.durationMs >= minMs
                                   : looksLikeSet(v.title, ch.name, sources);
        if (!isSet) {
          vlog(`skip (${v.durationMs ? Math.round(v.durationMs / 60000) + 'm' : 'title'}): ${v.title}`);
          continue;
        }

        out.push({
          id: `yt:${v.videoId}`,
          source: 'youtube',
          videoId: v.videoId,
          url: `https://www.youtube.com/watch?v=${v.videoId}`,
          title: v.title,
          channel: ch.name,
          published: v.published,
          publishedApprox: true,
          durationMs: v.durationMs,
          tags: buildTags(v.title, ch.name, ch.tags, sources),
        });
        kept++;
      }
      log(`  ${ch.name}: ${kept} of ${vids.length} look like sets`);
    } catch (err) {
      warn(`${ch.name}: channel page failed — ${err.message}`);
    }
    await sleep(delay);
  }

  return { sets: out, resolvedAny };
}

/* ==========================================================================
   MERGE + WRITE
   ========================================================================== */
async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch { return fallback; }
}

function mergeSets(existing, fresh, max) {
  const byId = new Map();
  /* existing first, so a first-seen date is never lost; fresh data then
     overwrites the mutable fields */
  for (const s of existing) if (s && s.id) byId.set(s.id, s);
  for (const s of fresh) {
    const prev = byId.get(s.id);
    byId.set(s.id, prev
      ? { ...prev, ...s, firstSeen: prev.firstSeen || prev.addedAt || null }
      : { ...s, firstSeen: new Date().toISOString() });
  }

  return [...byId.values()]
    .sort((a, b) => {
      const da = Date.parse(a.published) || Date.parse(a.firstSeen) || 0;
      const db = Date.parse(b.published) || Date.parse(b.firstSeen) || 0;
      return db - da;
    })
    .slice(0, max);
}

async function main() {
  const sources = await readJson(SOURCES_FILE, null);
  if (!sources) { console.error(`Cannot read ${SOURCES_FILE}`); process.exit(1); }

  const prev = await readJson(OUT_FILE, { updatedAt: null, sets: [] });
  const existing = Array.isArray(prev) ? prev : (prev.sets || []);
  const known = new Set(existing.map(s => s.id));
  const max = sources.options?.maxSets ?? 150;

  log(`Deep Work updater — ${existing.length} sets on file\n`);

  const fresh = [];
  let resolvedAny = false;

  log('Channels');
  const collected = await collectYoutube(sources);
  fresh.push(...collected.sets);
  resolvedAny = collected.resolvedAny;
  log('');

  log('Searches');
  fresh.push(...await collectSearch(sources));
  log('');

  const merged = mergeSets(existing, fresh, max);
  const added = merged.filter(s => !known.has(s.id)).length;

  /* Compare the sets only: a changed updatedAt must not itself look like a change. */
  const changed = JSON.stringify(existing) !== JSON.stringify(merged);

  log(`Found ${fresh.length} candidates · ${added} new · ${merged.length} on file after merge`);

  if (DRY) { log('\n--dry-run: nothing written.'); return; }

  if (changed) {
    await writeFile(OUT_FILE, JSON.stringify({ updatedAt: new Date().toISOString(), sets: merged }, null, 2) + '\n', 'utf8');
    log(`Wrote ${path.relative(process.cwd(), OUT_FILE)}`);
  } else {
    log('No change — data/sets.json left alone.');
  }

  /* Cache any newly resolved channel IDs so later runs skip the lookup. */
  if (resolvedAny) {
    await writeFile(SOURCES_FILE, JSON.stringify(sources, null, 2) + '\n', 'utf8');
    log(`Cached resolved channel IDs in ${path.relative(process.cwd(), SOURCES_FILE)}`);
  }
}

main().catch(err => { console.error('\nUpdater failed:', err); process.exit(1); });
