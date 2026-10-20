/* ============================================================
   hooktheory.js — optional Hooktheory Trends API layer.

   Adds a *realism check* on top of the existing Claude-generated
   progressions, and an opt-in *seeding* mode that hands the model a
   statistically common chord skeleton to reharmonize instead of
   generating from nothing. Never a hard dependency: every function
   here degrades to `null` on auth failure, network failure, or an
   unrecognized chord, so callers can treat "no Hooktheory data" as a
   normal, silent outcome — never block generation on it.

   No DOM in this file. The connect dialog, header button and mode
   selects live in hooktheoryui.js; this module only exposes state
   and an onHooktheoryChange() subscription.

   Auth: api.hooktheory.com/v1/users/auth is called directly from the
   browser (confirmed CORS-clean, no proxy needed). The returned
   activkey lives only in a module-scoped variable — never written to
   localStorage/sessionStorage — so it disappears on reload, same as
   this app's "generated output is disposable" stance elsewhere.
   A 401 from the trends endpoint (expired key) drops the session and
   notifies subscribers so the header button can't claim "connected"
   while every call silently fails.

   ------------------------------------------------------------
   Degree mapping — read before touching this file.

   Hooktheory's Trends corpus keys every progression to scale degrees
   *relative to the major scale*, even for songs in a minor key (a
   song in A minor is stored the same way a song in C major would be,
   just anchored to A minor's relative major, C). `cp=4,1` (confirmed
   working) means "IV was followed by I" with no quality/extension
   suffix — degrees are bare numbers (`1`..`7`), with `b`/`#` prefixes
   for chromatic/borrowed roots (`b7`, `#4`, ...).

   The relative-major anchoring is the one piece built from
   recollection rather than a live response. It's isolated to
   `keyToMajorTonicPc()`. `hooktheorySmokeTest()` at the bottom checks
   it (and the response field names, and how applied chords such as
   D7-in-C map) against the live API — run it from the connect dialog.
   ============================================================ */
import { nameToPc, pcToName } from './theory.js';
import { registerStore, loadJSON, saveJSON } from './storage.js';

const AUTH_URL   = 'https://api.hooktheory.com/v1/users/auth';
const TRENDS_URL = 'https://api.hooktheory.com/v1/trends/nodes';

/* Session-only credential + display name. Never persisted. */
let activkey = null;
let username = null;

/* cp path ("4,1", or "" for the root nodes) -> normalized nodes (or
   null). Session-only, cleared on logout so a stale session's data
   can't leak into a new one. */
const trendCache = new Map();

/* ---- auth state + subscribers ------------------------------------------ */
const listeners = [];
export function onHooktheoryChange(fn){ if (typeof fn === 'function') listeners.push(fn); }
function notify(reason){
  for (const fn of listeners){ try { fn({ connected: !!activkey, username, reason }); } catch (e) { console.error(e); } }
}

export function isHooktheoryAuthed(){ return !!activkey; }
export function hooktheoryUser(){ return username; }

export function hooktheoryLogout(reason = 'logout'){
  const was = !!activkey;
  activkey = null;
  username = null;
  trendCache.clear();
  if (was) notify(reason);
}

/* Authenticates. Resolves { ok, error } — never throws, so a UI
   handler can show the error line without try/catch. */
export async function hooktheoryAuth(user, password){
  if (!user || !password) return { ok: false, error: 'Enter a username and password.' };
  try {
    const res = await fetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password })
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'Hooktheory rejected those credentials.' };
    if (!res.ok) return { ok: false, error: `Hooktheory returned HTTP ${res.status}.` };
    const data = await res.json();
    if (!data || !data.activkey) return { ok: false, error: 'Unexpected response — no activkey.' };
    activkey = data.activkey;
    username = data.username || user;
    trendCache.clear();
    notify('login');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Network error reaching Hooktheory.' };
  }
}

/* ---- realism mode (a preference, not a credential — safe to persist) ---- */
const PREFS_KEY = registerStore('hooktheoryPrefs', 'GenreBenderHooktheoryPrefs_v1');

/* What the realism pass does with a score.
   - score:        badge only, never spends a retry
   - conventional: retry toward more common movement when below 10%
   - balanced:     retry only when genuinely unusual (below 3%)
   - adventurous:  retry toward *less* predictable movement when above 20%
   Genre bending often wants the unusual move, so "balanced" is the
   default rather than "conventional". */
export const REALISM_MODES = {
  score:        { label: 'Score only',   retryIf: () => false },
  conventional: { label: 'Conventional', retryIf: s => s < 0.10, want: 'up' },
  balanced:     { label: 'Balanced',     retryIf: s => s < 0.03, want: 'up' },
  adventurous:  { label: 'Adventurous',  retryIf: s => s > 0.20, want: 'down' },
};
const DEFAULT_MODE = 'balanced';

export function getRealismMode(){
  const p = loadJSON(PREFS_KEY, null);
  return (p && REALISM_MODES[p.mode]) ? p.mode : DEFAULT_MODE;
}
export function setRealismMode(mode){
  if (!REALISM_MODES[mode]) return;
  saveJSON(PREFS_KEY, { mode });
  notify('mode');
}

/* Plain-language bucket for a 0-1 score, used by the result badge. */
export function realismLabel(score){
  if (score == null) return null;
  if (score < 0.03) return 'unusual';
  if (score < 0.10) return 'uncommon';
  if (score < 0.20) return 'familiar';
  return 'very common';
}

/* ---- trends fetch ------------------------------------------------------ */

/* Field names: the docs show { chord_ID, chord_HTML, probability,
   child_path }. Older guesses are kept as fallbacks; the smoke test
   reports which keys a live response actually has. */
function nodeToken(n){
  return String(n?.chord_ID ?? n?.interval ?? n?.degree ?? n?.token ?? '');
}
function nodeProb(n){
  let p = Number(n?.probability ?? n?.percent ?? 0);
  if (!Number.isFinite(p) || p < 0) p = 0;
  if (p > 1) p /= 100;                 // some responses report 0-100
  return p;
}
function normalizeNodes(data){
  const arr = Array.isArray(data) ? data : (Array.isArray(data?.nodes) ? data.nodes : null);
  if (!arr) return null;
  return arr.map(n => ({ token: nodeToken(n), p: nodeProb(n), raw: n })).filter(n => n.token);
}

/* cpTokens: array of bare degree tokens, e.g. [] (root), ['4'] or
   ['4','1']. -> [{ token, p, raw }] candidate next chords with 0-1
   probabilities, or null on any failure. Cached per path. */
export async function fetchChordTrend(cpTokens = []){
  if (!isHooktheoryAuthed() || !Array.isArray(cpTokens)) return null;
  const cp = cpTokens.filter(Boolean).join(',');
  if (trendCache.has(cp)) return trendCache.get(cp);
  let result = null;
  try {
    const url = cp ? `${TRENDS_URL}?cp=${encodeURIComponent(cp)}` : TRENDS_URL;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${activkey}` } });
    if (res.status === 401){ hooktheoryLogout('expired'); return null; }
    if (res.ok) result = normalizeNodes(await res.json());
  } catch {
    result = null;
  }
  trendCache.set(cp, result);
  return result;
}

/* ------------------------------------------------------------
   Symbol <-> degree conversion (Tonal-backed, key-aware).
   ------------------------------------------------------------ */

const SEMITONE_TO_DEGREE = ['1','b2','2','b3','3','4','b5','5','b6','6','b7','7'];
const DEGREE_TO_SEMITONE = { '1':0,'b2':1,'2':2,'b3':3,'3':4,'4':5,'b5':6,'#4':6,'5':7,'b6':8,'6':9,'b7':10,'7':11 };

/* Diatonic/common-borrowed triad quality per bare degree, used only
   when synthesizing a chord symbol back out of a degree (seeding
   mode). Defaults to major for anything not listed — the safest guess
   for the borrowed-major shapes (bIII/bVI/bVII). */
const DEGREE_QUALITY = { '1':'', '2':'m', '3':'m', '4':'', '5':'', '6':'m', '7':'dim' };

/* App key select values are like "C", "G", "Am", "Dm". Returns the
   pitch class (0-11) of the key's *relative major* tonic. */
export function keyToMajorTonicPc(key){
  const m = String(key || '').match(/^([A-G]#?b?)(m?)$/);
  if (!m) return 0;
  const tonicPc = nameToPc(m[1]);
  return m[2] === 'm' ? (tonicPc + 3) % 12 : tonicPc;
}

/* "Am7" in key "C" -> "6" (vi). Null if Tonal isn't loaded or the
   name can't be parsed. Slash chords score by their root, not bass. */
export function symbolToDegree(chordName, key){
  try {
    const T = window.Tonal;
    if (!T || !T.Chord) return null;
    const head = String(chordName || '').split('/')[0];
    const info = T.Chord.get(head);
    const tonic = info && info.tonic;
    if (!tonic) return null;
    const rootPc = nameToPc(tonic.replace(/\d/g, ''));
    const offset = ((rootPc - keyToMajorTonicPc(key)) % 12 + 12) % 12;
    return SEMITONE_TO_DEGREE[offset];
  } catch {
    return null;
  }
}

/* "6" in key "C" -> "Am". Applied/compound tokens ("5/5") resolve by
   their first segment's quality only when it's a bare degree. */
export function degreeToSymbol(degreeToken, key){
  const semis = DEGREE_TO_SEMITONE[degreeToken];
  if (semis == null) return null;
  const rootName = pcToName((keyToMajorTonicPc(key) + semis) % 12);
  return `${rootName}${DEGREE_QUALITY[degreeToken] ?? ''}`;
}

/* ------------------------------------------------------------
   Integration point 1 — realism scoring.
   ------------------------------------------------------------ */

/* How many preceding chords form the lookup path. Hooktheory's data
   thins out fast as the path grows (a 6-chord exact prefix almost
   never exists), so a full-prefix lookup turns long progressions into
   "no data". A 2-chord window is an order-2 Markov estimate. */
const CONTEXT_DEPTH = 2;
/* A next chord that isn't among the returned candidates is *rare*,
   not impossible — score it at a small floor instead of 0 so one
   off-list move can't zero the mean on its own. */
const RARE_FLOOR = 0.005;

/* chordNames: the generated progression in order. -> {
     score:     mean transition probability (0-1) over scored moves,
     samples:   how many transitions were scored,
     total:     how many transitions the progression has,
     weakest:   { index, from, to, p } — the least likely move,
     transitions: [{ from, to, p|null }]  (null = not scored)
   } or null when nothing could be scored. Chords that don't map to a
   degree (unparseable names) only skip the moves that touch them. */
export async function scoreProgressionRealism(chordNames, key){
  if (!isHooktheoryAuthed() || !Array.isArray(chordNames) || chordNames.length < 2) return null;
  const degrees = chordNames.map(name => symbolToDegree(name, key));

  const transitions = [];
  let total = 0, samples = 0, weakest = null;
  for (let i = 0; i < degrees.length - 1; i++){
    const from = chordNames[i], to = chordNames[i + 1];
    const next = degrees[i + 1];
    const ctx = [];
    for (let j = i; j >= 0 && ctx.length < CONTEXT_DEPTH; j--){
      if (degrees[j] == null) break;      // context can't cross an unmapped chord
      ctx.unshift(degrees[j]);
    }
    if (next == null || !ctx.length){ transitions.push({ from, to, p: null }); continue; }
    const nodes = await fetchChordTrend(ctx);
    if (!nodes || !nodes.length){ transitions.push({ from, to, p: null }); continue; }   // no data ≠ unlikely
    const match = nodes.find(n => n.token === next);
    const p = match ? Math.max(match.p, RARE_FLOOR) : RARE_FLOOR;
    transitions.push({ from, to, p });
    total += p; samples++;
    if (!weakest || p < weakest.p) weakest = { index: i, from, to, p };
  }
  if (samples === 0) return null;
  return { score: total / samples, samples, total: degrees.length - 1, weakest, transitions };
}

/* The shared realism step guitar.js and piano.js run after validation.
   retry(hint) must regenerate, validate, and resolve the new chord
   list — or null if it failed validation (never trade a structurally
   valid result for one Tonal.js can't confirm).
   Resolves { chords, realism, retried }. */
export async function realismPass({ chords, key, retry, onStatus, mode = getRealismMode() }){
  if (!isHooktheoryAuthed()) return { chords, realism: null, retried: false };
  const policy = REALISM_MODES[mode] || REALISM_MODES[DEFAULT_MODE];
  const names = chords.map(c => c.name);
  const realism = await scoreProgressionRealism(names, key);
  if (!realism || !policy.retryIf(realism.score) || typeof retry !== 'function'){
    return { chords, realism, retried: false };
  }

  const pct = (realism.score * 100).toFixed(1);
  const weak = realism.weakest ? ` The least likely move is ${realism.weakest.from} → ${realism.weakest.to}.` : '';
  const hint = policy.want === 'down'
    ? `The progression ${names.join(' - ')} is very predictable (Hooktheory realism ${pct}%). Make the movement less expected — a borrowed chord, a chromatic mediant, a deceptive resolution or a secondary dominant — while keeping the blend's character.`
    : `The progression ${names.join(' - ')} is statistically unusual (Hooktheory realism ${pct}%).${weak} Prefer a more common chord movement while keeping the blend's character.`;

  onStatus?.(policy.want === 'down' ? 'Adding some surprise' : 'Improving progression realism');
  let next = null;
  try { next = await retry(hint); } catch { next = null; }
  if (!next || !next.length) return { chords, realism, retried: true };

  const after = await scoreProgressionRealism(next.map(c => c.name), key);
  // Keep the retry only if it actually moved toward the goal (or we
  // can't tell — a scored original vs an unscorable retry keeps the original).
  const better = after && (policy.want === 'down' ? after.score < realism.score : after.score > realism.score);
  return better
    ? { chords: next, realism: { ...after, before: realism.score }, retried: true }
    : { chords, realism, retried: true };
}

/* ------------------------------------------------------------
   Integration point 2 — progression seeding.
   ------------------------------------------------------------ */

/* Weighted pick from the top `topK` candidates. temperature < 1
   sharpens toward the favourite, > 1 flattens. `avoid` tokens are
   down-weighted (not banned) so the walk doesn't loop I–V–I–V. */
export function sampleNode(nodes, { topK = 5, temperature = 0.8, avoid = [], rng = Math.random } = {}){
  if (!nodes || !nodes.length) return null;
  const top = [...nodes].sort((a, b) => b.p - a.p).slice(0, topK);
  const weights = top.map(n => {
    let w = Math.pow(Math.max(n.p, 1e-6), 1 / Math.max(temperature, 0.05));
    if (avoid.includes(n.token)) w *= 0.25;
    return w;
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return top[0];
  let r = rng() * sum;
  for (let i = 0; i < top.length; i++){ r -= weights[i]; if (r <= 0) return top[i]; }
  return top[top.length - 1];
}

/* Walks the Trends graph with weighted sampling to build a
   `length`-chord skeleton that's common in Hooktheory's corpus but not
   the same four chords every time. Returns chord symbols in `key`, or
   null when there's no data. A walk that runs dry partway just stops
   early and returns what it built. */
export async function buildTrendSkeleton(key, length, opts = {}){
  if (!isHooktheoryAuthed() || !length || length < 1) return null;
  const degrees = [];
  for (let i = 0; i < length; i++){
    const ctx = degrees.slice(-CONTEXT_DEPTH);
    const nodes = await fetchChordTrend(ctx);
    // Only bare degrees can be turned back into symbols.
    const usable = (nodes || []).filter(n => DEGREE_TO_SEMITONE[n.token] != null);
    if (!usable.length) break;
    const last = degrees[degrees.length - 1];
    const pick = sampleNode(usable.filter(n => n.token !== last).length ? usable.filter(n => n.token !== last) : usable,
      { ...opts, avoid: degrees });
    if (!pick) break;
    degrees.push(pick.token);
  }
  if (!degrees.length) return null;
  const symbols = degrees.map(d => degreeToSymbol(d, key)).filter(Boolean);
  return symbols.length ? symbols : null;
}

/* ------------------------------------------------------------
   Smoke test — run from the connect dialog (or the console as
   GenreBender.hooktheorySmokeTest()). Checks the assumptions this
   file can't verify offline:
     1. response field names (which keys a node actually has)
     2. minor keys normalize to the relative major
     3. how applied / borrowed chords map (D7 in C, Bb in C)
     4. whether compound tokens like "5/5" are a valid cp segment
   Resolves a report { ok, lines[] } and logs the raw responses.
   ------------------------------------------------------------ */
export async function hooktheorySmokeTest(){
  const lines = [];
  const say = (ok, msg) => lines.push({ ok, msg });
  if (!isHooktheoryAuthed()) return { ok: false, lines: [{ ok: false, msg: 'Not connected.' }] };

  trendCache.clear();
  let raw = null;
  try {
    const res = await fetch(`${TRENDS_URL}?cp=4`, { headers: { Authorization: `Bearer ${activkey}` } });
    raw = res.ok ? await res.json() : null;
    say(res.ok, `cp=4 → HTTP ${res.status}`);
  } catch (e) { say(false, `cp=4 → network error (${e.message})`); }
  console.log('[hooktheory smoke] raw cp=4 response:', raw);
  const first = Array.isArray(raw) ? raw[0] : raw?.nodes?.[0];
  if (first){
    const keys = Object.keys(first);
    say(keys.includes('chord_ID') && keys.includes('probability'),
      `node fields: ${keys.join(', ')}`);
  } else say(false, 'no nodes in the cp=4 response');

  // 2. relative-major anchoring: Am's i–iv must hit the same path as C's vi–ii.
  const am = ['Am', 'Dm'].map(c => symbolToDegree(c, 'Am'));
  const c  = ['Am', 'Dm'].map(c2 => symbolToDegree(c2, 'C'));
  say(am.join(',') === c.join(','), `Am "i iv" → cp=${am.join(',')} · C "vi ii" → cp=${c.join(',')} (should match)`);
  const amNodes = await fetchChordTrend(am);
  say(!!(amNodes && amNodes.length), `cp=${am.join(',')} returns ${amNodes ? amNodes.length : 0} candidates`);

  // 3. applied / borrowed mapping as this file computes it.
  say(true, `D7 in C → "${symbolToDegree('D7', 'C')}" · Bb in C → "${symbolToDegree('Bb', 'C')}" · E7 in Am → "${symbolToDegree('E7', 'Am')}"`);

  // 4. are compound tokens (secondary dominants) addressable?
  const applied = await fetchChordTrend(['1', '5/5']);
  say(applied !== null, `cp=1,5/5 (V/V) → ${applied ? `${applied.length} candidates — compound tokens work` : 'no data — compound tokens not accepted'}`);
  const tokens = (await fetchChordTrend(['1']) || []).map(n => n.token);
  const compound = tokens.filter(t => !(t in DEGREE_TO_SEMITONE));
  say(true, `after "1", non-bare tokens returned: ${compound.length ? compound.slice(0, 8).join(' ') : 'none'}`);

  // 5. end-to-end
  const r = await scoreProgressionRealism(['C', 'Am', 'F', 'G'], 'C');
  say(!!r, r ? `C Am F G realism ${(r.score * 100).toFixed(1)}% over ${r.samples}/${r.total} moves` : 'scoring returned null');
  const sk = await buildTrendSkeleton('C', 4);
  say(!!sk, `sample skeleton in C: ${sk ? sk.join(' ') : 'none'}`);

  console.table(lines);
  return { ok: lines.every(l => l.ok), lines };
}
