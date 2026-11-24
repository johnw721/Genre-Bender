/* ============================================================
   videosync.js — chords that move with the video.

   Tap along once: play the clip, hit TAP (or Space) on every chord
   change. Each tap stores the playhead; tap i is chord i of the active
   track, looping (a 4-chord song tapped through 3 times = 12 taps).
   Saved on the clip as { chords, times } (clips.js cleanSync).

   While the video plays:
     • the player shows "now Am · next F"
     • the transport strip highlights the chord, if the active track is
       the one you synced (same chord names, same order)
     • tapping a strip chord seeks the video to that chord
     • ↻ loop this pass sets the A–B loop to one trip round the progression
   Past the last tap it keeps counting at your average chord length, so
   tapping one or two passes is enough for a song that repeats.

   YouTube only: Instagram / TikTok embeds don't report their time.
   ============================================================ */
import { registerActions } from './actions.js';
import { escHtml } from './util.js';
import { getClip, clipsUpdate } from './clips.js';
import { colorMapClipId, onClipTime, clipNow, clipIsPlaying, colorMapSeek, colorMapSetLoop, colorMapIsYouTube } from './colormap.js';
import { trainerActiveTrack, onTracksChange } from './trainer.js';
import { toast } from './toast.js';

const $ = (id) => document.getElementById(id);
let rec = null;               // { clipId, chords, times } while tapping
let lastIdx = null;
let tick = 0;
const listeners = new Set();

const clip = () => getClip(colorMapClipId());
export const syncOf = (c = clip()) => (c && c.sync && c.sync.chords?.length && c.sync.times?.length ? c.sync : null);
export const vsyncRecording = () => !!rec;
/* (idx) → called when the synced chord changes; idx is into sync.chords, or null. */
export function onSyncChord(fn){ listeners.add(fn); return () => listeners.delete(fn); }

/* Does the active track play the synced progression? */
export function trackMatchesSync(sync = syncOf(), t = trainerActiveTrack()){
  if (!sync || !t?.chords?.length || t.chords.length !== sync.chords.length) return false;
  return t.chords.every((c, i) => c.name === sync.chords[i]);
}

/* ---- the maths ------------------------------------------------------ */
/* Which tap is sounding at time t (an index into times, may run past the
   end by extrapolating at the average chord length); -1 before the first. */
export function tapIndexAt(sync, t){
  const T = sync?.times;
  if (!T?.length || !Number.isFinite(t)) return -1;
  if (t < T[0]) return -1;
  let lo = 0, hi = T.length - 1;
  while (lo < hi){ const mid = (lo + hi + 1) >> 1; if (T[mid] <= t) lo = mid; else hi = mid - 1; }
  if (lo < T.length - 1 || T.length < 2) return lo;
  const avg = (T[T.length - 1] - T[0]) / (T.length - 1);
  return avg > 0.2 ? lo + Math.floor((t - T[T.length - 1]) / avg) : lo;
}
export function chordIndexAt(sync, t){
  const i = tapIndexAt(sync, t);
  return i < 0 ? null : i % sync.chords.length;
}
/* Time of tap k (extrapolated past the end). */
function tapTime(sync, k){
  const T = sync.times;
  if (k < T.length) return T[k];
  const avg = T.length > 1 ? (T[T.length - 1] - T[0]) / (T.length - 1) : 2;
  return T[T.length - 1] + (k - (T.length - 1)) * avg;
}
/* Seek to chord idx: the nearest occurrence at/after the current pass. */
export function seekToChord(idx){
  const sync = syncOf();
  if (!sync || !colorMapIsYouTube()) return false;
  const n = sync.chords.length;
  const now = clipNow() ?? 0;
  const k = Math.max(0, tapIndexAt(sync, now));
  const passStart = k - (k % n);
  let target = passStart + (idx % n);
  colorMapSeek(tapTime(sync, target));
  emit(idx % n);
  return true;
}
function loopPass(){
  const sync = syncOf();
  if (!sync) return;
  const n = sync.chords.length;
  const k = Math.max(0, tapIndexAt(sync, clipNow() ?? sync.times[0]));
  const start = k - (k % n);
  const a = tapTime(sync, start), b = tapTime(sync, start + n);
  colorMapSetLoop({ a, b, on: true });
  colorMapSeek(a);
  toast(`↻ Looping one pass (${fmt(a)}–${fmt(b)})`);
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* ---- recording -------------------------------------------------------- */
function startRec(){
  const c = clip();
  if (!c || !colorMapIsYouTube()) return;
  const t = trainerActiveTrack();
  if (!t?.chords?.length){ toast('Add the song\'s chords to a track first — then tap along to them.'); return; }
  rec = { clipId: c.id, chords: t.chords.map(x => x.name), times: [] };
  render();
  if (!clipIsPlaying()) toast('Press play on the video, then tap on every chord change');
}
function tap(){
  if (!rec) return;
  const now = clipNow();
  if (now == null){ toast('Start the video first'); return; }
  rec.times.push(Math.round(now * 100) / 100);
  rec.times.sort((a, b) => a - b);
  const el = $('vsync-tap');
  if (el){ el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
  render();
}
function undoTap(){ if (rec?.times.length){ rec.times.pop(); render(); } }
function finishRec(){
  if (!rec) return;
  if (rec.times.length < 2){ toast('Tap at least two chord changes'); return; }
  clipsUpdate(rec.clipId, 'sync', { chords: rec.chords, times: rec.times });
  const n = rec.times.length;
  rec = null;
  lastIdx = null;
  render();
  toast(`✓ Synced ${n} chord changes to the video`);
}
function cancelRec(){ rec = null; render(); }
function clearSync(){
  const c = clip();
  if (!c?.sync) return;
  const before = c.sync;
  clipsUpdate(c.id, 'sync', null);
  lastIdx = null; emit(null);
  render();
  toast('Cleared the chord sync', { undo: () => { clipsUpdate(c.id, 'sync', before); render(); } });
}

/* ---- UI: one line under the player ------------------------------------ */
function render(){
  const host = $('cm-vsync');
  if (!host) return;
  const c = clip();
  if (!c){ host.innerHTML = ''; return; }
  if (!colorMapIsYouTube()){
    host.innerHTML = `<span class="trainer-hint cm-hint-inline tip">Chord sync works with YouTube clips (other embeds don't report their time).</span>`;
    return;
  }
  if (rec && rec.clipId === c.id){
    const next = rec.chords[rec.times.length % rec.chords.length];
    host.innerHTML = `<span class="cm-mel-label">sync</span>
      <button type="button" class="vsync-tap" id="vsync-tap" data-action="vsync:tap" title="Tap on each chord change (Space)">TAP <b>${escHtml(next)}</b></button>
      <span class="cm-mstat">${rec.times.length} tap${rec.times.length === 1 ? '' : 's'} · Space works too</span>
      <button type="button" class="cm-mini" data-action="vsync:undo"${rec.times.length ? '' : ' disabled'} title="Undo the last tap">↶</button>
      <button type="button" class="pb-btn" data-action="vsync:done"${rec.times.length >= 2 ? '' : ' disabled'}>✓ done</button>
      <button type="button" class="pb-btn" data-action="vsync:cancel">cancel</button>`;
    return;
  }
  const sync = syncOf(c);
  if (!sync){
    host.innerHTML = `<span class="cm-mel-label">sync</span>
      <button type="button" class="pb-btn" data-action="vsync:rec" title="Play the video and tap on every chord change — the strip then follows the video">⏺ tap along to sync chords</button>`;
    return;
  }
  const match = trackMatchesSync(sync);
  host.innerHTML = `<span class="cm-mel-label">sync</span>
    <span class="vsync-now" id="vsync-now">${nowHTML(lastIdx, sync)}</span>
    <button type="button" class="pb-btn" data-action="vsync:loop" title="A–B loop one trip round the progression">↻ loop this pass</button>
    <button type="button" class="cm-mini" data-action="vsync:rec" title="Tap it again">⏺</button>
    <button type="button" class="cm-mini" data-action="vsync:clear" title="Clear the sync">✕</button>
    ${match ? '' : `<span class="cm-mstat" title="The strip follows the video when the active track has these chords">strip follows when the track is ${escHtml(sync.chords.slice(0, 4).join(' '))}${sync.chords.length > 4 ? '…' : ''}</span>`}`;
}
function nowHTML(idx, sync){
  if (idx == null) return `<span class="cm-mstat">▶ play — chords show here</span>`;
  const n = sync.chords.length;
  return `now <b>${escHtml(sync.chords[idx])}</b> <span class="cm-mstat">next ${escHtml(sync.chords[(idx + 1) % n])}</span>`;
}

function emit(idx){
  lastIdx = idx;
  const sync = syncOf();
  const now = $('vsync-now');
  if (now && sync) now.innerHTML = nowHTML(idx, sync);
  listeners.forEach(fn => { try { fn(idx, sync); } catch (e) { console.error(e); } });
}
function onTime(){
  if (rec) return;
  const sync = syncOf();
  if (!sync) return;
  const idx = chordIndexAt(sync, clipNow());
  if (idx !== lastIdx) emit(idx);
}

export function initVideoSync(){
  registerActions({
    'vsync:rec':    () => startRec(),
    'vsync:tap':    () => tap(),
    'vsync:undo':   () => undoTap(),
    'vsync:done':   () => finishRec(),
    'vsync:cancel': () => cancelRec(),
    'vsync:clear':  () => clearSync(),
    'vsync:loop':   () => loopPass(),
  });
  onClipTime(onTime);
  // between the player's ~4 reports a second, keep the chord crisp
  const loop = () => { if (clipIsPlaying() && syncOf() && !rec) onTime(); tick = setTimeout(loop, 100); };
  loop();
  // Space taps while recording (before the global shortcuts see it)
  document.addEventListener('keydown', (e) => {
    if (!rec || e.key !== ' ' || e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    e.preventDefault(); e.stopPropagation(); tap();
  }, true);
  ['gb:refclip', 'gb:clipframe'].forEach(ev => document.addEventListener(ev, () => { if (rec && rec.clipId !== colorMapClipId()) rec = null; lastIdx = null; render(); }));
  onTracksChange(() => render());
  Object.assign(window, { vsyncRecording, seekToChord });
  render();
}
