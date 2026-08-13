/* ============================================================
   api.js — thin client for the AI completion endpoint.

   Centralizes the fetch + response-flattening logic that the three
   generators (blend / guitar / piano) used to duplicate. Returns
   the concatenated text of all text blocks in the response.
   ============================================================ */
import { API_CONFIG } from './config.js';

const STORAGE_PREFIX = 'GenreBender';
const ENDPOINT_KEY = `${STORAGE_PREFIX}ApiEndpoint`;
const MODEL_KEY = `${STORAGE_PREFIX}ApiModel`;
const API_KEY_KEY = `${STORAGE_PREFIX}ApiKey`;

// Model strings that older builds saved to localStorage but that the
// Anthropic API rejects. Treat them as "unset" so the valid default wins.
const LEGACY_INVALID_MODELS = new Set(['sonnet-4.6', 'sonnet-4-6']);

function normalizeModel(model){
  if (typeof model !== 'string') return model;
  const cleaned = model.trim().replace(/\s+/g, '-');
  if (LEGACY_INVALID_MODELS.has(cleaned)) return '';
  return cleaned;
}

/* True when the endpoint is Anthropic's public API, which the browser can
   call directly if the user supplies their own key. */
export function isDirectAnthropic(endpoint){
  return typeof endpoint === 'string' && /(^|\/\/)([^/]*\.)?anthropic\.com\//.test(endpoint);
}

export function getSavedApiConfig(){
  const endpoint = localStorage.getItem(ENDPOINT_KEY);
  const model = normalizeModel(localStorage.getItem(MODEL_KEY));
  const apiKey = localStorage.getItem(API_KEY_KEY);
  return {
    endpoint: endpoint || API_CONFIG.endpoint,
    model: model || API_CONFIG.model,
    apiKey: apiKey || ''
  };
}

export function saveApiConfig({ endpoint, model, apiKey }){
  if (endpoint != null) localStorage.setItem(ENDPOINT_KEY, endpoint.trim());
  if (model != null) localStorage.setItem(MODEL_KEY, normalizeModel(model));
  if (apiKey != null) {
    if (apiKey === '') localStorage.removeItem(API_KEY_KEY);
    else localStorage.setItem(API_KEY_KEY, apiKey);
  }
}

/* messages: [{ role, content }]
   opts.maxTokens: token ceiling (default 1000)
   -> resolves to a single string of the response's text blocks. */
export async function callClaude(messages, { maxTokens = 1000 } = {}){
  const saved = getSavedApiConfig();
  if (isDirectAnthropic(saved.endpoint) && !saved.apiKey) {
    throw new Error(
      'No API key set. Open ⚙ AI and paste an Anthropic API key ' +
      '(console.anthropic.com) — it is stored only in this browser.'
    );
  }
  let res;
  try {
    const headers = {
      "Content-Type": "application/json",
      "Anthropic-Version": "2023-06-01"
    };
    if (saved.apiKey) headers["x-api-key"] = saved.apiKey;
    // Calling api.anthropic.com straight from a browser requires an explicit
    // opt-in header. Only sent for that host; proxies never see it.
    if (isDirectAnthropic(saved.endpoint)) {
      headers["anthropic-dangerous-direct-browser-access"] = "true";
    }
    res = await fetch(saved.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: saved.model,
        max_tokens: maxTokens,
        messages
      })
    });
  } catch (networkErr) {
    throw new Error(
      `Could not reach the AI endpoint (${saved.endpoint}). ` +
      `If you are self-hosting, set API_CONFIG.endpoint in config.js to your proxy. ` +
      `Original error: ${networkErr.message}`
    );
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI endpoint returned HTTP ${res.status}: ${errText}`);
  }

  // Read as text first so we can give a useful error if the body isn't JSON.
  const bodyText = await res.text();
  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    const looksLikeHtml = /^\s*<(?:!doctype|html)/i.test(bodyText);
    if (looksLikeHtml) {
      throw new Error(
        `Endpoint ${saved.endpoint} returned an HTML page, not JSON. ` +
        `Your proxy probably isn't answering this URL — most likely the proxy ` +
        `isn't running, or its port collides with the server hosting the app ` +
        `(run the proxy on a different port than the app). ` +
        `Open ${saved.endpoint} directly: if you see the app, it's a port collision.`
      );
    }
    throw new Error(`AI endpoint returned non-JSON response: ${bodyText.slice(0, 120)}`);
  }
  let text = '';
  if (Array.isArray(data.content)) {
    text = data.content.map(block => block.text || '').join('');
  } else if (typeof data.output_text === 'string') {
    text = data.output_text;
  } else if (typeof data.completion === 'string') {
    text = data.completion;
  } else if (data.response?.output?.text) {
    text = data.response.output.text;
  } else if (typeof data.response?.output_text === 'string') {
    text = data.response.output_text;
  }
  text = String(text).trim();

  if (!text) throw new Error('AI endpoint returned an empty response');
  return text;
}
