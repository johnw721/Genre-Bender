/* ============================================================
   config.js — static configuration for the whole app.
   Edit this file to add genres or point the AI calls somewhere else.
   ============================================================ */

/* The genre catalog rendered in the mixer's library. */
export const GENRES = {
  "Hip-hop / R&B":         {color:"hip-hop",   genres:["Lo-fi hip-hop","Trap","Boom bap","Cloud rap","Drill","Neo-soul","G-funk","Jersey club","Phonk"]},
  "Electronic":            {color:"electronic",genres:["Synthwave","House","Techno","Drum & bass","Ambient","IDM","Trance","Jungle","UK garage","Footwork","Electro","Breakbeat"]},
  "Jazz / Soul":           {color:"jazz-soul", genres:["Jazz","Bossa nova","Soul","Funk","Gospel","Nu-jazz","Fusion","Swing","Bebop"]},
  "Global / World":        {color:"global",    genres:["Afrobeats","Cumbia","Reggaeton","Baile funk","Dembow","Dancehall","Highlife","Amapiano","Soca","Flamenco","Qawwali"]},
  "Rock / Alt":            {color:"rock-alt",  genres:["Indie rock","Shoegaze","Post-punk","Math rock","Grunge","Emo","Noise rock","Dream pop","Psychedelic"]},
  "Classical / Cinematic": {color:"classical", genres:["Orchestral","Minimalist","Neoclassical","Dark ambient","Chamber","Baroque","Film score"]}
};

/* How many genres can be blended at once. */
export const MAX_GENRES = 4;

/* ------------------------------------------------------------
   AI endpoint configuration.

   - endpoint:  where chat-completion requests are POSTed.
   - model:     model string forwarded to the endpoint.

   IMPORTANT: the default endpoint below (api.anthropic.com) only
   works without an API key when this app runs *inside the
   Claude.ai artifact sandbox*. When you self-host Genre Bender,
   browsers cannot call that endpoint directly (no key + CORS).
   Point `endpoint` at your own thin proxy that injects the key
   server-side. A ready-to-deploy AWS Lambda example lives in
   the README. The proxy should accept the same JSON body shape
   ({ model, max_tokens, messages }) and return the same response.
   ------------------------------------------------------------ */
export const API_CONFIG = {
  // Default points at the local dev proxy (server/proxy.js), which
  // injects your API key server-side. Run `npm start` in /server first.
  // If running inside the Claude.ai artifact sandbox instead, set this
  // to "https://api.anthropic.com/v1/messages" in the Settings modal.
  endpoint: "http://localhost:8787/v1/messages",
  model: "claude-sonnet-4-6"
};

/* Per-card looper rates and their UI labels (index 0 = off). */
export const LOOP_RATES  = [null, 0.5, 0.75, 1, 2];
export const LOOP_LABELS = ['',   '½×', '¾×', '1×', '2×'];
