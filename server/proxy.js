// Load server/.env into process.env (zero-dependency; runs before config below).
const fs = require('fs');
const path = require('path');
(function loadEnv(){
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      let val = m[2].trim().replace(/^["']|["']$/g, '');
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  } catch (e) { console.warn('Could not read .env:', e.message); }
})();

const express = require('express');
const fetch = global.fetch || require('node-fetch');
const app = express();

const PORT = process.env.PROXY_PORT || 3000;
const TARGET = process.env.TARGET_ENDPOINT || 'https://api.anthropic.com/v1/messages';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

if (!API_KEY) console.warn('Warning: ANTHROPIC_API_KEY is not set. Requests will fail without a key.');

app.use(express.json({ limit: '1mb' }));

// Simple CORS for dev; set ALLOWED_ORIGIN in env for tighter security.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Anthropic-Version, x-api-key, anthropic-dangerous-direct-browser-access');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Proxy endpoint: POST /v1/messages
app.post('/v1/messages', async (req, res) => {
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Anthropic-Version': '2023-06-01'
    };
    if (API_KEY) headers['x-api-key'] = API_KEY;

    const response = await fetch(TARGET, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body),
      // Keep redirect / timeout defaults; this is meant for dev.
    });

    const text = await response.text();
    const contentType = response.headers.get('content-type') || 'application/json';
    res.status(response.status).set('Content-Type', contentType).send(text);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(502).json({ error: err.message });
  }
});

// Song metadata lookup (BPM / key) — same handler the Netlify Function uses,
// mounted at the same path so the browser code is identical in dev and prod.
// Needs GETSONGBPM_API_KEY in server/.env (free key: https://getsongbpm.com/api).
app.get('/.netlify/functions/songmeta', async (req, res) => {
  try {
    const { handleSongMeta } = await import('../shared/songmeta-core.mjs');
    const params = new URLSearchParams(req.query);
    const { status, body } = await handleSongMeta(params, process.env.GETSONGBPM_API_KEY, fetch);
    res.status(status).json(body);
  } catch (err) {
    console.error('songmeta error:', err);
    res.status(502).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Anthropic proxy listening on http://localhost:${PORT}/v1/messages -> ${TARGET}`);
});
