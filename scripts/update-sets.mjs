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
  const unit = m[2].toLowerCase();
  const ms = { second:1e3, minute:6e4, hour:36e5, day:864e5, week:6048e5, mo:2592e6, month:2592e6, year:31536e6 }[unit];
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