# Deep Work

A focus timer for long sessions, with a DJ sets panel. Static site — plain HTML,
CSS and vanilla JS, no framework and no build step. Drop it on GitHub Pages and
it runs.

## What it does

- **Focus / short break / long break**, fully customisable, with 25/5, 50/10 and
  90/20 presets, auto-start, and a long break every N sessions.
- **Accurate in a background tab.** The timer is driven by a stored end
  timestamp, not by counting `setInterval` ticks, so throttling, sleep and tab
  switches cannot make it drift. The page title shows the remaining time
  (`42:13 · Focus`) so you can read it from another tab.
- **Synthesised chimes** — soft bell, warm synth pad, two-tone marimba and a
  deep 808 hit, all generated with the Web Audio API. No audio files, nothing
  copyrighted. Separate choice for focus-finished and break-finished, a volume
  slider, previews, an optional one-minute warning, and optional browser
  notifications (permission is requested only when you switch them on).
- **DJ sets** from YouTube and SoundCloud in one list, with genre and artist
  filter chips, shuffle, surprise-me, and favourites.
- Dark by default with a light toggle, four accents, a progress ring that pulses
  through the final minute, and a fullscreen focus mode.
- Everything persists in `localStorage`, every access wrapped in `try/catch`.

### Shortcuts

`Space` start/pause · `R` reset · `S` skip · `F` focus mode · `T` theme ·
`D` sets panel · `X` random set · `?` shortcut list · `Esc` exit

## Setup

### 1. Enable GitHub Pages

**Settings → Pages → Build and deployment → Source: Deploy from a branch**,
then pick `main` and `/ (root)`. Save. The site appears at
`https://<you>.github.io/<repo>/` within a minute or two.

### 2. Give the Action write permission

The updater commits `data/sets.json` back to the repo, so:

**Settings → Actions → General → Workflow permissions → Read and write
permissions**. Save. Without this the daily run fails at the push step.

### 3. Fill the set list

`data/sets.json` ships empty, because the only honest way to get real video IDs
and channel IDs is to fetch them. Run the updater once:

```bash
node scripts/update-sets.mjs