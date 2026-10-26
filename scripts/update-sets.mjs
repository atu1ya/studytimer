#!/usr/bin/env node
/* ==========================================================================
   Deep Work — set-list updater
   ==========================================================================
   Pulls likely full DJ sets from two public, key-free sources:

     YouTube     each channel's /videos page (the RSS feeds were retired)
     SoundCloud  public artist pages + the public oEmbed endpoint

   No API keys, no paid services, no dependencies. Node 20+ (global fetch).

   Channel IDs are never guessed: a handle is resolved from the channel page's
   canonical link and then cached back into sources.json.

   Usage
     node scripts/update-sets.mjs              update data/sets.json
     node scripts/update-sets.mjs --dry-run    report only, write nothing
     node scripts/update-sets.mjs --youtube    skip SoundCloud
     node scripts/update-sets.mjs --soundcloud skip YouTube
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
const ONLY_YT    = argv.has('--youtube');
const ONLY_SC    = argv.has('--soundcloud');
const DO_YOUTUBE = !ONLY_SC;
const DO_SC      = !ONLY_YT;

/* A plain desktop user agent: some public pages serve a stub to unknown ones. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const log   = (...a) => console.log(...a);
const vlog  = (...a) => { if (VERBOSE) console.log('   ', ...a); };
const warn  = (...a) => console.warn('  ! ', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- http -------------------------------------------------------- */
async function fetchText(url, { timeoutMs = 25000 } = {}) {
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
  } finally {
    clearTimeout(t);
  }
}
async function fetchJson(url, opts) { return JSON.parse(await fetchText(url, opts)); }

/* ---------- small helpers ---------------------------------------------- */
function decodeEntities(s = '') {
  return s
    .replace(/&(?:amp|#38);/g, '&')
    .replace(/&(?:lt|#60);/g, '<')
    .replace(/&(?:gt|#62);/g, '>')
    .replace(/&(?:quot|#34);/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
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

/** Parse a channel /videos page into raw video records. */
function parseChannelVideos(html) {
  const data = extractYtInitialData(html);
  if (!data) return [];

  const lockups = deepFind(data, n => n.lockupViewModel && n.lockupViewModel.contentId)
    .map(n => n.lockupViewModel);

  const seen = new Set();
  const out = [];

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
      durationMs: durationToMs(badge),
      published: agoToIso(agoText),
      publishedApprox: true,
    });
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
   SOUNDCLOUD
   --------------------------------------------------------------------------
   Two passes, both key-free:
     1. the artist page, whose server-rendered __sc_hydration blob carries
        full metadata including duration — the best "is this a full set" signal
     2. anything still missing a title is filled in via the public oEmbed
        endpoint (https://soundcloud.com/oembed)
   ========================================================================== */

/** Pull track objects out of a SoundCloud page's hydration data. */
function parseScHydration(html) {
  const m = html.match(/window\.__sc_hydration\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) return [];
  let data;
  try { data = JSON.parse(m[1]); } catch { return []; }

  const found = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }

    const isTrack =
      typeof node.permalink_url === 'string' &&
      /soundcloud\.com\//.test(node.permalink_url) &&
      (node.kind === 'track' || node.kind === 'playlist' || typeof node.duration === 'number');

    if (isTrack) {
      found.push({
        scId: node.id ?? null,
        kind: node.kind || 'track',
        url: node.permalink_url.split('?')[0],
        title: node.title || '',
        user: node.user?.username || node.user?.full_name || '',
        published: node.display_date || node.created_at || node.last_modified || null,
        durationMs: typeof node.duration === 'number' ? node.duration : null,
        artwork: (node.artwork_url || node.calculated_artwork_url || '')
          .replace('-large.', '-t200x200.') || null,
      });
    }
    Object.values(node).forEach(walk);
  };
  walk(data);

  /* de-duplicate by URL, keeping the richest record for each */
  const byUrl = new Map();
  for (const t of found) {
    const prev = byUrl.get(t.url);
    if (!prev || (!prev.durationMs && t.durationMs) || (!prev.title && t.title)) byUrl.set(t.url, t);
  }
  return [...byUrl.values()];
}

/** Fallback: the crawler-facing microdata on a SoundCloud page. */
function parseScMicrodata(html, baseUser) {
  const urls = uniq([...html.matchAll(/itemprop="url"\s+href="(\/[^"]+)"/g)].map(m => m[1]));
  return urls
    .filter(u => u.split('/').filter(Boolean).length >= 2)       // /user/track
    .map(u => ({
      scId: null, kind: 'track',
      url: `https://soundcloud.com${u}`,
      title: '', user: baseUser || '', published: null, durationMs: null, artwork: null,
    }));
}

/** Public oEmbed lookup — fills in title, artist and artwork. */
async function scOembed(url) {
  const api = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  const j = await fetchJson(api);
  return {
    title: decodeEntities(j.title || ''),
    user: decodeEntities(j.author_name || ''),
    artwork: j.thumbnail_url || null,
  };
}

async function collectSoundcloud(sources, known) {
  const out = [];
  const delay = sources.options?.requestDelayMs ?? 350;
  const perUser = sources.options?.perSoundcloudUser ?? 10;
  const minMs = (sources.options?.soundcloudMinMinutes ?? 20) * 60000;

  /* --- artist and label pages --- */
  for (const src of sources.soundcloud || []) {
    const base = String(src.url).replace(/\/+$/, '');
    let candidates = [];

    for (const suffix of ['/tracks', '/sets', '']) {
      try {
        const html = await fetchText(base + suffix);
        let found = parseScHydration(html);
        if (!found.length) found = parseScMicrodata(html, src.name);
        candidates.push(...found);
        await sleep(delay);
        if (candidates.length >= perUser * 2) break;
      } catch (err) {
        vlog(`${base}${suffix} -> ${err.message}`);
      }
    }

    if (!candidates.length) {
      warn(`${src.name}: nothing readable at ${base} — skipped. TODO: check the URL, or add specific set links to "soundcloudPicks".`);
      continue;
    }

    /* keep the artist's own uploads, newest first */
    candidates = candidates
      .filter(t => t.url.startsWith(base + '/') || t.url === base)
      .sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));

    let kept = 0;
    for (const t of candidates) {
      if (kept >= perUser) break;
      const id = `sc:${t.url.replace(/^https?:\/\/(www\.)?soundcloud\.com\//, '')}`;
      if (known.has(id) || out.some(o => o.id === id)) continue;

      /* Duration is the honest filter for a full set. Where it is unknown,
         fall back to the same keyword test used as a backstop elsewhere. */
      let title = t.title, user = t.user, artwork = t.artwork;
      if (!title) {
        try {
          const meta = await scOembed(t.url);
          title = meta.title; user = user || meta.user; artwork = artwork || meta.artwork;
          await sleep(delay);
        } catch (err) { vlog(`oembed ${t.url} -> ${err.message}`); continue; }
      }
      if (!title) continue;

      const longEnough = t.durationMs ? t.durationMs >= minMs : null;
      const isSet = t.kind === 'playlist' ? true
                  : longEnough === null ? looksLikeSet(title, user || src.name, sources)
                  : longEnough;
      if (!isSet) { vlog(`skip (${t.durationMs ? Math.round(t.durationMs / 60000) + 'm' : 'title'}): ${title}`); continue; }

      out.push({
        id,
        source: 'soundcloud',
        url: t.url,
        title,
        channel: user || src.name,
        published: t.published || null,
        durationMs: t.durationMs || null,
        thumb: artwork || null,
        tags: buildTags(title, user || src.name, src.tags, sources),
      });
      kept++;
    }
    log(`  ${src.name} (SoundCloud): ${kept} kept of ${candidates.length} found`);
  }

  /* --- hand-picked permalinks --- */
  for (const pick of sources.soundcloudPicks || []) {
    const url = (typeof pick === 'string' ? pick : pick.url || '').split('?')[0];
    if (!url) continue;
    const id = `sc:${url.replace(/^https?:\/\/(www\.)?soundcloud\.com\//, '')}`;
    if (known.has(id) || out.some(o => o.id === id)) continue;
    try {
      const meta = await scOembed(url);
      if (!meta.title) continue;
      out.push({
        id, source: 'soundcloud', url,
        title: meta.title,
        channel: meta.user,
        published: (typeof pick === 'object' && pick.published) || null,
        durationMs: null,
        thumb: meta.artwork,
        tags: buildTags(meta.title, meta.user, (typeof pick === 'object' && pick.tags) || [], sources),
      });
      log(`  pick: ${meta.title}`);
      await sleep(delay);
    } catch (err) {
      warn(`pick ${url} failed — ${err.message}`);
    }
  }

  return out;
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

  if (DO_YOUTUBE) {
    log('YouTube');
    const r = await collectYoutube(sources);
    fresh.push(...r.sets);
    resolvedAny = r.resolvedAny;
    log('');
  }
  if (DO_SC) {
    log('SoundCloud');
    fresh.push(...await collectSoundcloud(sources, known));
    log('');
  }

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
