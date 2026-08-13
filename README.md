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
├── css/        # tokens, base, header-tabs, mixer, metronome, notation
└── js/         # config, util, store, api, theory, swing, audio, metronome,
                # sequencer, loopers, cards, blend, guitar, piano, midi, ui,
                # library, main
```

Full module responsibilities and the dependency graph are in
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## External dependencies

- **Tonal.js** (loaded via CDN in `index.html`, exposed as `window.Tonal`) — chord validation and note parsing. No build step, no npm install.

There is no bundler and no framework. The whole app is vanilla JS modules,
plain CSS, and one CDN script.
