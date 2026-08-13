Local Anthropic proxy

This small Express proxy lets your browser call a local endpoint that injects your Anthropic API key server-side.

Quick start

1. Install dependencies

```bash
cd server
npm install
```

2. Create `.env` from the example and set `ANTHROPIC_API_KEY` and optionally `ALLOWED_ORIGIN`:

```bash
cp .env.example .env
# edit .env and paste your key
```

3. Run the proxy

```bash
npm start
```

4. Point the app at the proxy endpoint (in the app Settings modal or `js/config.js`):

- `http://localhost:3000/v1/messages`

Security notes

- The API key must remain in server environment variables; do NOT store it in the browser.
- For production, deploy this as a serverless function or a small server behind a firewall and set `ALLOWED_ORIGIN` to your site origin.
