# Genre Bender

**Live site: [genre-bender.netlify.app](https://genre-bender.netlify.app)**

A browser-based practice and writing companion for guitarists. Say *"I want to learn
that song"* and get its chords, key and BPM into a track you can loop, study against
the video, and see on a color map of the key — then blend genres with AI to write
something of your own.

Vanilla ES modules, plain CSS, no framework. Everything you make is stored locally in
your browser.

---

## What you can do

The app has four places, plus a transport bar at the bottom (tempo, key and your
current progression) that stays on every page.

**Songs — learn a song.** Three ways in, and they cross-check each other:
- *Paste chords* — Ultimate Guitar copy/paste, ChordPro `[Am]`, or bar notation
  `| Am | F | x2`. Each section is reduced to its repeating loop, the key is inferred
  with a confidence, and everything is shown in Roman numerals. Lyrics are never stored.
- *Look up BPM / key* by title + artist (GetSongBPM, via a server function).
- *Listen to the audio* — an audio/video file (an iPhone screen recording works) or a
  playing tab's audio (desktop Chrome/Edge). Key, BPM and a chord sketch come from
  analysis in the browser.

Saving makes a song *unit* and a matching **My chords** track. Saving again updates
the same one.

**Play — one resizable workspace.** Video, color map and your chords side by side or
stacked. Drag the dividers, hide or maximize any pane; on a phone the panes become tabs.
- *Video* — paste a YouTube / Instagram / TikTok / X link anywhere (Ctrl/⌘ V) and it
  opens here, with A–B loop and speed. Chords named in a caption become tappable chips.
- *Color map* — every chord in the key, colored by function (tonic / predominant /
  dominant), with in-scale, out-of-scale and parallel views and a melody lens.
  Out-of-key chords are spelled the way they read (♭VII in C is B♭, not A♯).
- *My chords* — tracks you build by name, by frets, or by dragging shapes from the
  chord library. The library follows the color map's key and rebuilds when it changes.
- On touch screens, tapping a chord shows its diagram with **+ track / + keep**.

**Practice.** Spaced-repetition drills (shape ↔ scale degree, scale shapes, moving
shapes, progression ID, color-map functions), a speed trainer, and three short daily
plans with a streak — see [`PRACTICE.md`](./PRACTICE.md).

**Create.** Pick 2–4 genres, set blend ratios, and get AI creative direction,
production techniques, a chord & rhythm guide and reference tracks — each with
YouTube / Spotify / Apple Music links. Generate a guitar tab and piano chart (checked
with [Tonal.js](https://github.com/tonaljs/tonal)), play them on a tempo-locked
sequencer with per-card loops and a Compose mode, and export MIDI. A guided workflow
walks the whole path from reference clip to play-along.

**Everywhere.**
- **Find a chord** — `/` or Ctrl/⌘ K. Type a chord for its shapes, notes and where it
  sits on the color map. Paste a reel caption and every chord in it is pulled out.
  It also runs commands: `new track Verse`, `color map in E`, `practice`, `dark`.
- **Keyboard** — Space loops your progression (or plays the melody, if Play has one),
  ← / → step through it, 1–7 play scale degrees, `?` shows the full list.
- **Undo, not "are you sure"** — deleting or clearing something happens straight away,
  with Undo in the toast for a few seconds.
- **Less text** — how-to text is hidden; ⋯ → *Show tips* brings it back, ⋯ → *Quick
  tour* replays the 3-step intro.
- **Saved clips, seed packs, backup** — clips keep a label, key/BPM/genre tags and
  notes; seed packs (`seeds/*.pack.json`) load pre-filled tracks; ⚙ → *export
  everything* writes one JSON backup (never your API key).
- Light and dark themes.

---

## Running it locally

Needs Node 18+.

```bash
npm run setup     # installs the app and the small proxy server
npm start         # proxy on :3000 + Vite dev server on :5500 (opens the browser)
```

`npm run web` runs only the front end. The proxy (`server/proxy.js`) adds your
Anthropic key to AI requests and serves the BPM/key lookup; put its settings in
`server/.env`:

```
ANTHROPIC_API_KEY=...
GETSONGBPM_API_KEY=...      # free key at getsongbpm.com/api (optional)
```

### Build and deploy

```bash
npm run share     # builds dist/genre-bender.html (one self-contained file) and runs the checks
```

The live site is that single file. Copy it to `dist/netlify/index.html` and drag it
onto Netlify, or deploy with the BPM/key function included:

```bash
npx netlify-cli deploy --prod --dir dist/netlify --functions netlify/functions
```

The function needs `GETSONGBPM_API_KEY` set in the Netlify site's environment.

### Tests

| Command | Checks |
|---|---|
| `npm run verify:single` | the built file end to end in jsdom (~160 checks) |
| `npm run verify:song` | chord-sheet parsing, key inference, song units |
| `npm run verify:clips` | link parsing for each platform |
| `npm run verify:seeds` / `verify:seeds:e2e` | seed packs |

### A note on the AI calls

The default endpoint in [`js/config.js`](./js/config.js) is
`https://api.anthropic.com/v1/messages`, which a browser can't call directly (no key,
and CORS blocks it). Point it at a proxy that adds the key server-side — the local
`server/proxy.js`, or your own (example below) — or set the endpoint, model and key in
the app under ⚙ AI. If the AI is unreachable you get a clear error; everything else
keeps working.

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
Genre-Bender/
├── index.html
├── css/                 # tokens, theme, layout + one file per area
├── js/                  # ES modules — one per feature (see ARCHITECTURE.md)
├── shared/              # code used by both the browser and the server (BPM/key lookup)
├── server/              # local proxy: AI requests + BPM/key lookup
├── netlify/functions/   # the same BPM/key lookup as a Netlify function
├── seeds/               # seed packs
└── build/               # single-file build + test scripts
```

Module responsibilities and how they talk to each other are in
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## External dependencies

- **Tonal.js** — chord validation and note parsing (CDN script in `index.html`).
- **Vite** — dev server only; the build is a custom script, not a bundler.
- The video player uses each platform's official embed, the only third-party requests
  the app makes (and only once you open a clip). Short links like `vm.tiktok.com/…`
  can't be resolved in the browser; paste the full URL.
