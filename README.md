# Genre Bender

An AI-assisted genre-blending music production assistant that runs entirely
in the browser. Pick 2–4 genres, dial in blend ratios, and get creative
direction, a guitar tab, and a piano chord chart you can play back on a
tempo-locked sequencer, loop per-card, sync in Compose mode, and export to
MIDI.

> Refactored from a single 1083-line HTML file into a small, dependency-clear
> ES-module project. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the file
> hierarchy and module map.

---

## Features

- **Visual Mixer** — genre library, multi-select chips, blend-ratio sliders, AI creative direction.
- **Metronome** — BPM, time signature, tap tempo, swing presets, visual beat grid.
- **Notation generator** — AI-generated guitar tab + piano chord chart, validated against music theory with [Tonal.js](https://github.com/tonaljs/tonal).
- **Playback** — tempo-locked sequencer, per-card loopers, drag-to-reorder cards, and a **Compose** mode that plays guitar and piano on one clock.
- **MIDI export** — pure-JS Standard MIDI File (type-1) writer, no dependencies.
- **Reference clips** — paste X / Instagram / TikTok / YouTube links (or just
  Ctrl/Cmd+V anywhere on the page) and they play in the left rail — or in a
  floating, draggable window (⇱) — while you work; the metronome and loopers keep
  running across tab switches. Clips save locally with a label, key / BPM / genre
  tags and notes, hand their BPM to the tempo keeper (or capture the BPM you tapped
  along), and export/import as JSON. **Seed mixer** turns a clip into input: its
  genre tags become the mixer selection, its key the app key, its BPM the tempo,
  and *Generate blend* is told to blend toward it. Platforms block their normal
  pages inside frames, so the player uses each one's official embed endpoint —
  the one place the app makes third-party requests (only once you open a clip).
  Short links like `vm.tiktok.com/…` can't be resolved in-browser; paste the full URL.
- **Analyze Track (v1)** — pick a saved clip, paste its caption or describe what you
  hear, and the AI proposes catalog genres with confidence, a BPM/key guess and a
  feel. Write the result back to the clip's tags or seed the mixer from it in one
  click. It reasons from text — it cannot hear the embed. Real audio fingerprinting
  (upload) is still to come and will land in the same panel.
- **Shell** — four places instead of five tabs and a sidebar: **Songs** (your library + Learn a
  song), **Play** (My chords, Color map), **Practice** (today's plan, drills, speed trainer) and
  **Create** (genre mixer, guided workflow). A transport bar at the bottom keeps the metronome,
  key and the current track's chords on every page; less-used tools live in the ⋯ menu.
  Light and dark themes (☀ in the top bar).
- **Study view** — paste a link anywhere (or ⤢ study in the transport bar / clips player / ⋯ menu)
  and one screen holds the video (A–B loop, speed, caption chords), the color map (with melody
  lens) and My chords + the chord library. Drag the dividers to resize, flip between side-by-side
  and stacked, hide or maximize any pane (double-click its header); Esc closes. On a phone the
  video sits on top and you switch between Color map and Chords below.
- **Chord library follows the key** — the chord table leads with the color map key's chords
  (triads, 7ths, or both) and rebuilds whenever the key changes; tap + (or drag) to keep one in
  your own shapes. Turn it off with ⟳ follow key.
- **Find a chord** — 🔎 in the top bar (or `/`, Ctrl/⌘ K). Type a chord for its shapes, notes and
  where it sits in the color map (with keys it's diatonic in), then hear it, add it to the track or
  jump to it on the map. Paste a reel/TikTok caption or a shared link and every chord in it is
  pulled out — make a track, open the map in the likely key, or save the link as a clip.
  Clicking a color-map chord shows its diagram for a moment; chords named in a clip's caption
  show up as tappable chips in the clips player and the color map.
- **Learn a song** — tab 03. Turn "I want to learn that song" into a saved *unit*
  (BPM, key, color-map key, closest chord progression) and a prefilled **My chords**
  track, from any of three paths that cross-check each other:
  1. *Paste chords* — any chord sheet (Ultimate Guitar copy/paste, ChordPro `[Am]`,
     bar notation `| Am | F | x2`). Chords are extracted per section, each section is
     reduced to its repeating loop, the key is inferred with a confidence and runner-up
     keys, and everything is shown in Roman numerals. Pasted text (lyrics) is never stored.
  2. *Look up BPM / key* by title + artist — GetSongBPM via a server function
     (`netlify/functions/songmeta.mjs`; same handler in `server/proxy.js` for `npm start`).
     Needs `GETSONGBPM_API_KEY` set server-side (free key at getsongbpm.com/api; their
     terms require the backlink the panel shows).
  3. *Listen to the audio* — pick an audio/video file (an iPhone screen recording works)
     or capture a playing tab's audio (desktop Chrome/Edge). Key + BPM come from chroma
     and onset analysis in the browser; chords are a beat-synced major/minor sketch.
  Agreement between sources raises confidence; a relative major/minor or half/double-time
  disagreement is flagged, and you can override any field. **Save unit → My chords** is
  idempotent: the same title/artist (or linked clip) updates the same unit and track.
- **Hover tab** — in Shape trainer → *My chords*, **⧉ hover tab** floats the active track's
  progression in a small draggable panel that stays on screen while you scroll, switch tabs
  or play: chords with Roman numerals (in the saved song's key, else the app key, else a
  guess), the current chord highlighted, a tempo-locked strum loop from any chord, ◀ ▶ step,
  beats-per-chord, and a track switcher. It follows edits live; position and state persist.
- **Two-pane shell** — a sticky left rail holds the always-on things (tempo keeper,
  current key, selected genres, the reference you're blending toward, the clip
  player); the tabs live in the main column. Below 1180px the rail stacks on top.
- **Guided Workflow** — tab 02 is a live stepper over the actions above: drop in a
  reference → tag it → seed the mixer → generate the blend → get a tab → play along.
  Each step reads the real app state (done / current / locked) and its button is a
  shortcut to the existing action, so you can work in any order.
- **Chord table** — inside Shape trainer → *My chords*, every track sits above a
  customizable table of chord diagrams. Add shapes by name, pin an exact fingering
  from the fret squares (*+ add to table*), or fill a key's triads / sevenths in one
  click; then drag a diagram onto the track to drop it in exactly that spot (the
  voicing comes with it), drag track chords to reorder, or drag one down to the
  table to keep its shape. The table is shared across tracks and persists locally.
- **Practice** — tab 04 holds three 10–20 minute plans (see [`PRACTICE.md`](./PRACTICE.md)):
  *Trainer-first* (daily; the drill mode rotates by weekday and the step counts today's
  quiz answers), *Clip → chart* (transcribe a reference into a My chords track) and
  *Blend & play* (the whole pipeline). Steps the app can observe tick themselves off;
  the rest are one-click "mark done" ticks stored per day. A fully done plan counts
  toward a streak shown in the header.
- **Seed packs** — pre-filled My chords tracks (link, key, BPM, color chart) from
  `seeds/*.pack.json`; load with *⤓ seed pack*, a `#seed=` link, or a console
  snippet. Re-applying is safe (idempotent). See [seeds/README.md](seeds/README.md).
- **Backup** — ⚙ AI → *export everything* writes session, clips, trainer progress,
  the chord table and label prefs to one JSON file (never your API key); *import
  backup* restores it.

---

## Running it

This is an **ES-module** project, so it must be served over HTTP. Opening
`index.html` directly with `file://` will fail (browsers block module imports
on the file protocol).

```bash
# from the project root
python -m http.server 8000
# then open http://localhost:8000
```

Any static server works (`npx serve`, `php -S`, nginx, etc.).

### A note on the AI calls
The default endpoint in [`js/config.js`](./js/config.js) is
`https://api.anthropic.com/v1/messages`. That works **without an API key only
inside the Claude.ai artifact sandbox**, which injects auth for you. When you
self-host, the browser cannot call that endpoint directly — there's no key and
CORS will block it. Point `API_CONFIG.endpoint` at your own thin proxy that
adds the key server-side (see below). You can also enter the endpoint, model,
and API key directly in the app using the new ⚙ AI settings button in the
header. The AI features degrade gracefully with a clear error message if the
endpoint is unreachable; everything else (metronome, playback, MIDI export of
existing data) still works.

---

## Self-hosting the AI endpoint (AWS Lambda example)

The proxy only needs to accept the same JSON body the app sends
(`{ model, max_tokens, messages }`), forward it to Anthropic with your key,
and return the response unchanged. A Lambda behind a Function URL (or API
Gateway) is enough.

```python
# lambda_function.py  — Python 3.12 runtime
import json, os, urllib.request

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"

def handler(event, _ctx):
    origin = os.environ.get("ALLOWED_ORIGIN", "*")
    cors = {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
    }
    if event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS":
        return {"statusCode": 204, "headers": cors, "body": ""}

    body = event.get("body") or "{}"
    req = urllib.request.Request(
        ANTHROPIC_URL,
        data=body.encode(),
        headers={
            "content-type": "application/json",
            "x-api-key": os.environ["ANTHROPIC_API_KEY"],  # set in Lambda env
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            payload = r.read().decode()
            return {"statusCode": 200, "headers": {**cors, "content-type": "application/json"}, "body": payload}
    except urllib.error.HTTPError as e:
        return {"statusCode": e.code, "headers": cors, "body": e.read().decode()}
    except Exception as e:
        return {"statusCode": 502, "headers": cors, "body": json.dumps({"error": str(e)})}
```

Set two environment variables on the function: `ANTHROPIC_API_KEY` (your key)
and `ALLOWED_ORIGIN` (your site's origin, e.g. `https://genrebender.example`).
Then update the app:

```js
// js/config.js
export const API_CONFIG = {
  endpoint: "https://<your-function-url>.lambda-url.us-east-1.on.aws/",
  model: "sonnet-4.6"
};
```

> Keep the key in the Lambda environment (or, better, Secrets Manager) — never
> ship it to the browser. Lock `ALLOWED_ORIGIN` to your real origin rather than
> `*` in production, and consider a usage cap / WAF rate rule in front of the
> Function URL.

---

## Project layout

```
genre-bender/
├── index.html
├── css/        # tokens, base, header-tabs, mixer, metronome, notation, trainer, clips, shell
└── js/         # config, util, store, storage, actions, api, theory, swing, audio,
                # metronome, sequencer, loopers, cards, blend, guitar, piano, midi,
                # ui, library, clips, analyze, guided, main
```

Full module responsibilities and the dependency graph are in
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## External dependencies

- **Tonal.js** (loaded via CDN in `index.html`, exposed as `window.Tonal`) — chord validation and note parsing. No build step, no npm install.

There is no bundler and no framework. The whole app is vanilla JS modules,
plain CSS, and one CDN script.
