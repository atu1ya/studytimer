# Deep Work

A focus timer for long sessions, with a panel of YouTube DJ sets. Static site —
plain HTML, CSS and vanilla JS in ES modules. No framework, no build step, no
runtime dependencies. Deploys to GitHub Pages unchanged.

Live at <https://atu1ya.github.io/studytimer/>.

## What it does

- **Focus / short break / long break**, customisable, with 25/5, 50/10 and
  90/20 presets, auto-start, and a long break every N sessions.
- **Accurate in a background tab.** The timer runs off a stored end timestamp,
  not by counting `setInterval` ticks, so throttling, sleep and tab switches
  cannot make it drift. The page title shows the remaining time
  (`42:13 · Focus`) so you can read it from another tab.
- **An alarm you cannot miss.** When a phase ends it **pauses whatever set is
  playing**, then rings repeatedly until dismissed — stopping at 9 repeats or
  25 seconds, whichever comes first — behind a full-screen card. Any key, Escape
  or the Stop button clears it.
- **Six alarm sounds.** Five are synthesised with the Web Audio API (dub siren,
  UKG organ stab, soft bell, warm synth pad, two-tone marimba, deep 808). One,
  `audio/og-dub-siren.mp3`, is a supplied recording — see
  [Audio files](#audio-files). Separate choice for focus and break, volume
  slider, previews, optional one-minute warning, and optional browser
  notifications whose permission is only requested when you switch them on.
- **400 DJ sets** from YouTube, filtered by genre and artist, with shuffle,
  surprise-me and favourites. The sidebar is collapsible and drag-resizable.
- Follows your system light/dark setting by default, with a manual override and
  four system accent colours. Honours `prefers-reduced-motion` and
  `prefers-contrast`.
- Everything persists in `localStorage`, every access wrapped in `try/catch`.

### Shortcuts

| Key | Action |
| --- | --- |
| `Space` | Start or pause |
| `R` | Reset the phase |
| `S` | Skip to the next phase |
| `F` | Focus mode (fullscreen) |
| `T` | Cycle light → dark → system |
| `D` | Show or hide the sets panel |
| `X` | Play a random set |
| `?` | Shortcut list |
| `Esc` | Stop the alarm, or close what is open |

Shortcuts never fire while you are typing in a field or while a dialog is open.

## Running it

**It must be served over HTTP.** The app uses ES modules and `fetch`, both of
which browsers block on `file://`, so opening `index.html` by double-clicking
will show a blank page. Any static server works:

```bash
python -m http.server 8080
```

Then visit <http://localhost:8080>.

## Setup

### 1. Enable GitHub Pages

**Settings → Pages → Build and deployment → Source: Deploy from a branch**,
then pick `main` and `/ (root)`. Save. The site appears at
`https://<you>.github.io/<repo>/` within a minute or two. Every path in the
site is relative, so a project subpath works fine.

### 2. Give the Action write permission

The updater commits `data/sets.json` back to the repo, so:

**Settings → Actions → General → Workflow permissions → Read and write
permissions**. Save. Without this the daily run does all its work and then
fails at the push step.

### 3. Fill the set list

`data/sets.json` is committed with real data, so the site works immediately.
To refresh it by hand:

```bash
node scripts/update-sets.mjs
```

Node 20 or newer, no `npm install` — there are no dependencies. The run takes
a couple of minutes. After that the Action keeps it current daily, and you can
trigger it from **Actions → Update DJ sets → Run workflow**.

Flags:

```bash
node scripts/update-sets.mjs --dry-run   # report, write nothing
node scripts/update-sets.mjs --verbose   # log every keep/skip decision
```

## How the updater works

No API keys, no paid services, no dependencies. It gathers sets two ways and
merges them.

**Channels.** For each entry in `sources.json`, it reads that channel's
`/videos` page and parses the video list out of the embedded `ytInitialData`.
It does *not* use the RSS feeds: `youtube.com/feeds/videos.xml` was retired and
now returns 404 for every parameter form.

**Searches.** Several artists only post short clips on their own channels —
their actual sets live on festival, radio and label channels. So each entry in
`searches` runs a YouTube search and keeps the long results, requiring the
artist to be named in the title or channel so unrelated results do not creep in.

Both paths filter by **duration**: anything under `youtubeMinMinutes` is not a
set. That is a far better test than guessing from the title, and it excludes
Shorts automatically. Results are merged, de-duplicated by video ID, sorted
newest first and trimmed to `maxSets`. The file is only rewritten when the list
actually changed, so the Action does not produce an empty commit every day.

Channel IDs are never guessed. A handle is resolved from the channel page's
canonical link, cross-checked against the channel name, and cached back into
`sources.json`. Anything that cannot be verified is logged and skipped.

## Adding channels, artists and searches

Everything lives in `scripts/sources.json`.

**A channel** — append to `youtube`. Give the handle and leave the ID `null`;
the updater resolves and caches it on the next run:

```json
{ "name": "Some Label", "handle": "@somelabel", "channelId": null, "tags": ["house"] }
```

If a handle will not resolve, the updater warns and skips rather than guessing.
Paste the real `UC…` ID in by hand — open the channel, View Source, search for
`"channelId"`.

**An artist's sets** — append to `searches`. `match` is the text that must
appear in the title or channel for a result to be kept:

```json
{ "query": "Some Artist dj set", "match": "some artist", "tags": ["some artist", "house"] }
```

**An artist name for tagging** — append to `artists`. Names there are matched
against every title from every source, so a B2B on someone else's channel still
gets tagged and filtered correctly.

**Tuning** — `options`:

| Key | Meaning |
| --- | --- |
| `maxSets` | Total kept in `data/sets.json`, newest first |
| `perYoutubeChannel` | Most sets taken per channel per run |
| `perSearch` | Most sets taken per search query per run |
| `youtubeMinMinutes` | Duration below which a video is not a set |
| `requestDelayMs` | Pause between channel requests |
| `searchDelayMs` | Pause between searches, which are rate-limited harder |

## Audio files

Five of the six alarms are synthesised at runtime and ship as code. The sixth,
`audio/og-dub-siren.mp3`, is a recording added by the repo owner and is **not**
covered by this project's licence — if you fork this, supply your own file or
pick one of the synthesised options. If the file is missing or will not decode,
the app falls back to the synthesised dub siren rather than failing.

## Project layout

```
index.html                 markup and the settings/shortcut dialogs
styles.css                 tokens, base, layout, components, utilities
js/main.js                 wiring, phase-end behaviour, shortcut map
js/state.js                single store, get/set/subscribe, JSDoc typedefs
js/storage.js              guarded localStorage and settings migration
js/timer.js                timestamp-driven timer logic
js/audio.js                synthesised chimes, samples, repeating alarm
js/player.js               lazy YouTube embed, pause via postMessage
js/sets.js                 loading and filtering data/sets.json
js/notifications.js        opt-in notifications
js/shortcuts.js            key handling
js/ui/*.js                 render functions, one per region
audio/og-dub-siren.mp3     supplied alarm sound
data/sets.json             the set list, written by the updater
scripts/update-sets.mjs    the updater
scripts/sources.json       channels, searches, artists, keywords, tuning
.github/workflows/         daily cron and manual dispatch
```

## Stored data

All keys are namespaced `dw.` and are read defensively, so a corrupt or missing
value falls back to a default rather than breaking the app.

| Key | Holds |
| --- | --- |
| `dw.settings` | Durations, theme, accent, sound and notification choices |
| `dw.timer` | Current phase, end timestamp, cycle position |
| `dw.stats` | Today's session count and focus minutes |
| `dw.task` / `dw.subs` | The task line and its three steps |
| `dw.favs` | Favourited set IDs |
| `dw.sidebarWidth` / `dw.panelOpen` | Sidebar size and visibility |

Settings carry a `schema` number and are migrated in place, never reset. The
current migration remaps old accent names onto system colours and falls back to
a known chime if a stored one no longer exists.

## Caveats

- **Upload dates are approximate.** YouTube gives relative times ("2 days ago")
  on these pages, so stored timestamps can be off by up to a day, and anything
  reported in months is rough. Ordering is still correct.
- **The parser is pinned to YouTube's current page shape.** It searches the
  embedded JSON rather than following fixed paths, which survives most
  reshuffling, but a large redesign would break it. If a run reports "no videos
  parsed" for every channel, that is what happened — it warns loudly rather than
  silently writing an empty list.
- **Searches get rate-limited.** The updater retries with backoff and spaces
  searches out; if many still fail in one run, raise `searchDelayMs`.
- Scheduled Action runs can be delayed at busy times, and a repo with no
  activity for 60 days has its schedules disabled until you push again.
