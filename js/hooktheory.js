/* ============================================================
   hooktheory.js — optional Hooktheory Trends API layer.

   Adds a *realism check* on top of the existing Claude-generated
   progressions, and an opt-in *seeding* mode that hands the model a
   statistically common chord skeleton to reharmonize instead of
   generating from nothing. Never a hard dependency: every function
   here degrades to `null` on auth failure, network failure, or an
   unrecognized chord, so callers can treat "no Hooktheory data" as a
   normal, silent outcome — never block generation on it.

   Auth: api.hooktheory.com/v1/users/auth is called directly from the
   browser (confirmed CORS-clean, no proxy needed). The returned
   activkey lives only in a module-scoped variable — never written to
   localStorage/sessionStorage — so it disappears on reload, same as
   this app's "generated output is disposable" stance elsewhere.
   Treat it like a password: it is sent as a Bearer token and nothing
   else.

   ------------------------------------------------------------
   Degree mapping — read before touching this file.

   Hooktheory's Trends corpus keys every progression to scale degrees
   *relative to the major scale*, even for songs in a minor key (a
   song in A minor is stored the same way a song in C major would be,
   just anchored to A minor's relative major, C). `cp=4,1` (confirmed
   working) means "IV was followed by I" with no quality/extension
   suffix — degrees are bare numbers (`1`..`7`), with `b`/`#` prefixes
   for chromatic/borrowed roots (`b7`, `#4`, ...). Seventh chords,
   voicings, and extensions are ignored for the purposes of the
   degree path — the corpus reasons about root movement, not chord
   quality, which matches every `cp=` example seen in the docs.

   The relative-major-anchoring above is the one piece of this file
   that's built from recollection of Hooktheory's data model rather
   than a live response inspected in this session. It's isolated to
   `keyToMajorTonicPc()` below — if a live smoke test (see README note
   at the bottom of this file) shows minor keys are *not* normalized
   to their relative major, that's the only function that needs to
   change.
   ============================================================ */
import { nameToPc, pcToName } from './theory.js';

const AUTH_URL   = 'https://api.hooktheory.com/v1/users/auth';
const TRENDS_URL = 'https://api.hooktheory.com/v1/trends/nodes';

/* Session-only credential. Never persisted. */
let activkey = null;

/* cp path ("4,1") -> parsed nodes response (or null). Session-only,
   cleared on logout so a stale session's data can't leak into a new one. */
const trendCache = new Map();

export function isHooktheoryAuthed(){ return !!activkey; }

export function hooktheoryLogout(){
  activkey = null;
  trendCache.clear();
}

/* Prompts for Hooktheory credentials and authenticates. Returns true
   on success. Never throws — failures resolve false so a UI button
   handler can just check the return value. */
export async function hooktheoryAuth(username, password){
  if (!username || !password) return false;
  try {
    const res = await fetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data || !data.activkey) return false;
    activkey = data.activkey;
    trendCache.clear();
    return true;
  } catch {
    return false;
  }
}

/* Convenience wrapper for a UI button: prompts for credentials with
   window.prompt (per design — no modal needed for a rarely-used,
   opt-in connection), authenticates, and returns the new auth state. */
export async function connectHooktheory(){
  if (isHooktheoryAuthed()) {
    hooktheoryLogout();
    return false;
  }
  const username = window.prompt('Hooktheory username or email:');
  if (!username) return false;
  const password = window.prompt('Hooktheory password (not stored — used once to authenticate this session):');
  if (!password) return false;
  const ok = await hooktheoryAuth(username, password);
  if (!ok) window.alert('Hooktheory sign-in failed. Check your credentials and try again.');
  return ok;
}

/* cpTokens: array of bare degree tokens, e.g. ['4'] or ['4','1'].
   -> the parsed `nodes` array from the Trends API (candidate next
   chords + probabilities for that path), or null on any failure
   (not authed, network error, non-200, empty body). Cached per path
   for the life of the session. */
export async function fetchChordTrend(cpTokens){
  if (!isHooktheoryAuthed() || !Array.isArray(cpTokens) || !cpTokens.length) return null;
  const cp = cpTokens.join(',');
  if (trendCache.has(cp)) return trendCache.get(cp);
  let result = null;
  try {
    const res = await fetch(`${TRENDS_URL}?cp=${encodeURIComponent(cp)}`, {
      headers: { Authorization: `Bearer ${activkey}` }
    });
    if (res.ok) {
      const data = await res.json();
      result = Array.isArray(data) ? data : (Array.isArray(data?.nodes) ? data.nodes : null);
    }
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
   for the borrowed-major-chord shapes (bIII/bVI/bVII) that dominate
   pop's chromatic-mediant vocabulary. */
const DEGREE_QUALITY = { '1':'', '2':'m', '3':'m', '4':'', '5':'', '6':'m', '7':'dim' };

/* App key select values are like "C", "G", "Am", "Dm" (5 major +
   5 minor tonics). Returns the pitch class (0-11) of the key's
   *relative major* tonic — see the header comment on why minor keys
   fold onto their relative major here. */
function keyToMajorTonicPc(key){
  const m = String(key || '').match(/^([A-G]#?b?)(m?)$/);
  if (!m) return 0;
  const tonicPc = nameToPc(m[1]);
  const isMinor = m[2] === 'm';
  return isMinor ? (tonicPc + 3) % 12 : tonicPc;
}

/* "Am7" in key "C" -> "6" (vi). Returns null if Tonal isn't loaded or
   the chord name can't be parsed — callers treat that as "can't
   score/seed this chord", not an error. */
export function symbolToDegree(chordName, key){
  try {
    const T = window.Tonal;
    if (!T || !T.Chord) return null;
    const info = T.Chord.get(chordName);
    const tonic = info && info.tonic;
    if (!tonic) return null;
    const rootPc = nameToPc(tonic.replace(/\d/g, ''));
    const majorTonicPc = keyToMajorTonicPc(key);
    const offset = ((rootPc - majorTonicPc) % 12 + 12) % 12;
    return SEMITONE_TO_DEGREE[offset];
  } catch {
    return null;
  }
}

/* "6" in key "C" -> "Am". Used to turn a Hooktheory trend walk back
   into chord symbols the existing prompt/validation pipeline expects. */
export function degreeToSymbol(degreeToken, key){
  const semis = DEGREE_TO_SEMITONE[degreeToken];
  if (semis == null) return null;
  const majorTonicPc = keyToMajorTonicPc(key);
  const rootName = pcToName((majorTonicPc + semis) % 12);
  const quality = DEGREE_QUALITY[degreeToken] ?? '';
  return `${rootName}${quality}`;
}

/* ------------------------------------------------------------
   Integration point 1 — realism scoring.
   ------------------------------------------------------------ */

/* chordNames: the generated progression, in order (e.g.
   ["Am7","F","C","G"]). -> { score, samples } where score is the
   mean transition probability (0-1) Hooktheory's corpus assigns to
   the actual chord-to-chord moves in this progression, or null if
   scoring wasn't possible (not authed, <2 chords, or any chord
   didn't map to a degree). `samples` is how many transitions were
   actually scored, so callers can distinguish "confidently mediocre"
   from "barely any data." */
export async function scoreProgressionRealism(chordNames, key){
  if (!isHooktheoryAuthed() || !Array.isArray(chordNames) || chordNames.length < 2) return null;
  const degrees = chordNames.map(name => symbolToDegree(name, key));
  if (degrees.some(d => d == null)) return null;

  let total = 0, samples = 0;
  for (let i = 0; i < degrees.length - 1; i++){
    const path = degrees.slice(0, i + 1);
    const nodes = await fetchChordTrend(path);
    if (!nodes) continue;
    const next = degrees[i + 1];
    const match = nodes.find(n => (n.interval ?? n.degree ?? n.chord_ID ?? n.token) == next
      || String(n.interval ?? n.degree ?? n.chord_ID ?? n.token) === next);
    let p = match ? Number(match.probability ?? match.percent ?? 0) : 0;
    if (p > 1) p /= 100; // API reports 0-100; normalize to 0-1
    total += p;
    samples++;
  }
  if (samples === 0) return null;
  return { score: total / samples, samples };
}

/* ------------------------------------------------------------
   Integration point 2 — progression seeding.
   ------------------------------------------------------------ */

/* Greedily walks the Trends graph, always taking the highest-
   probability next chord, to build a `length`-chord skeleton that's
   genuinely common in Hooktheory's corpus. Returns an array of chord
   symbols (e.g. ["C","Am","F","G"]) in `key`, or null if not authed
   or the walk comes up empty on the first step (no data to seed
   from — callers fall back to generating from nothing, same as
   today). A walk that runs dry partway through just stops early and
   returns whatever it built (still useful as a partial hint). */
export async function buildTrendSkeleton(key, length){
  if (!isHooktheoryAuthed() || !length || length < 1) return null;
  const degrees = [];
  for (let i = 0; i < length; i++){
    const nodes = await fetchChordTrend(degrees.length ? degrees : ['']);
    // fetchChordTrend requires non-empty tokens; the first step asks
    // the root-nodes endpoint (cp omitted entirely).
    let candidates = nodes;
    if (!degrees.length) {
      candidates = await (async () => {
        if (!isHooktheoryAuthed()) return null;
        if (trendCache.has('')) return trendCache.get('');
        let result = null;
        try {
          const res = await fetch(TRENDS_URL, { headers: { Authorization: `Bearer ${activkey}` } });
          if (res.ok) {
            const data = await res.json();
            result = Array.isArray(data) ? data : (Array.isArray(data?.nodes) ? data.nodes : null);
          }
        } catch { result = null; }
        trendCache.set('', result);
        return result;
      })();
    }
    if (!candidates || !candidates.length) break;
    const top = candidates.reduce((best, n) => {
      const p = Number(n.probability ?? n.percent ?? 0);
      const bestP = Number(best?.probability ?? best?.percent ?? -1);
      return p > bestP ? n : best;
    }, null);
    const token = String(top?.interval ?? top?.degree ?? top?.chord_ID ?? top?.token ?? '');
    if (!token) break;
    degrees.push(token);
  }
  if (!degrees.length) return null;
  const symbols = degrees.map(d => degreeToSymbol(d, key)).filter(Boolean);
  return symbols.length ? symbols : null;
}

/* ------------------------------------------------------------
   Smoke test (manual, run once from the browser console after
   connecting): confirms the two assumptions flagged above —
   relative-major anchoring for minor keys, and the shape of a nodes
   response — against the live API rather than recollection.

     import('./js/hooktheory.js').then(async h => {
       await h.hooktheoryAuth('you', 'pw');
       console.log(await h.fetchChordTrend(['4']));      // what follows IV
       console.log(await h.buildTrendSkeleton('C', 4));   // a 4-chord skeleton
       console.log(await h.scoreProgressionRealism(['C','Am','F','G'], 'C'));
     });

   If `fetchChordTrend` logs a shape whose keys don't match
   `interval`/`degree`/`chord_ID`/`probability`/`percent`, update the
   field lookups in `scoreProgressionRealism` and `buildTrendSkeleton`
   above to match — that's the only place the exact field names
   matter.
   ============================================================ */
