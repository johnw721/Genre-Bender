# Daily Learning — June 5, 2026

## Bug: "Error generating blend. Check the AI endpoint configuration."

Genre Bender's AI features (blend, guitar tab, notation, piano, composer) all
failed to generate after pasting an API key in Settings. The single button
masked a chain of five separate problems, each one hidden behind the previous.
Fixing them one at a time peeled the onion until generation worked.

## The five bugs, in the order they surfaced

### 1. Invalid model string
`js/config.js` shipped `model: "sonnet-4.6"`, which is not a valid Anthropic
model ID. Every request would 400 even if everything else were correct.
**Fix:** changed default to `claude-sonnet-4-6`, and added a guard in
`js/api.js` so the old `sonnet-4.6` value cached in browser `localStorage`
can't override the fix.

### 2. Direct browser calls are blocked by CORS
Pasting a key and calling `api.anthropic.com` straight from the browser doesn't
work — the Anthropic API rejects direct browser requests. The intended design
is a thin local proxy (`server/proxy.js`) that injects the key server-side.
**Fix:** chose the proxy path; pointed the default endpoint at it.

### 3. Proxy CORS allow-list too narrow
The browser always sends an `Anthropic-Version` header, but the proxy's
`Access-Control-Allow-Headers` only listed `Content-Type`. The preflight failed,
so the real request never went through — even with the proxy running.
**Fix:** broadened allowed headers to include `Anthropic-Version`, `x-api-key`,
and `anthropic-dangerous-direct-browser-access`.

### 4. Port collision (Grafana on 3000)
The proxy defaulted to port 3000, which Grafana already owned on this machine.
Requests to `localhost:3000/v1/messages` hit Grafana, which returned its HTML
login page. The app tried to `JSON.parse` that HTML → "Unexpected token '<',
'<!DOCTYPE'... is not valid JSON".
**Fix:** moved the proxy to port 8787; added HTML-response detection in
`js/api.js` so this failure now reports a clear "endpoint returned HTML, not
JSON — likely a port collision" message instead of a raw parse error.

### 5. Proxy never loaded its own .env
`server/proxy.js` read `process.env.PROXY_PORT` and `ANTHROPIC_API_KEY` but had
no `dotenv` (or any) call to actually load `.env`. So the port fell back to the
hardcoded 3000 (→ `EADDRINUSE` against Grafana) and the key was never read.
**Fix:** added a tiny zero-dependency `.env` loader at the top of `proxy.js`.

## Also caught: leaked API key
`server/.env.example` had a **real** Anthropic key committed in it. Replaced it
with a placeholder. Action items: revoke/rotate that key, keep the real key only
in `.env`, and add `.env` to `.gitignore` (it was not ignored).

## Final working setup
- Proxy on port **8787** (app served separately, e.g. 8080 — the two must differ).
- Settings endpoint: `http://localhost:8787/v1/messages`
- Model: `claude-sonnet-4-6`
- Key lives in `server/.env`, loaded by the new loader, injected server-side —
  never stored in the browser.
- Sanity check: opening the endpoint URL in a browser returns
  `{"type":"error",...,"message":"Method Not Allowed"}` — that's correct,
  because a browser GET hits a POST-only endpoint. JSON (not HTML) = healthy.

## Lessons
- A generic catch-all error message ("check the configuration") hid five
  distinct failures. Surfacing the real underlying error early would have
  collapsed this from five round-trips to one or two. We added that to blend,
  guitar, and piano.
- "Reads `process.env.X`" is not the same as "loads `.env`." Without dotenv or a
  loader, an env file is inert.
- `<!DOCTYPE` where JSON is expected almost always means a request hit the wrong
  server (proxy down, wrong port, or a catch-all returning index.html).
- Check for port collisions with whatever else runs locally (Grafana, etc.)
  before assuming defaults are free.
- Never commit real secrets to `.env.example`; gitignore `.env`.

## Files changed
- `js/config.js` — valid model, proxy endpoint
- `js/api.js` — legacy-model guard, HTML-response detection, safer JSON parsing
- `js/blend.js`, `js/guitar.js`, `js/piano.js` — surface real error text
- `server/proxy.js` — broadened CORS headers, zero-dependency `.env` loader
- `server/.env.example` — removed leaked key, port 8787, CORS guidance
