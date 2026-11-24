/* ============================================================
   progtab.js — the active My chords track in the transport bar.

     [ ♪ Track ▾ ]  Em  C  [G]  D   ⟳  ◀ ▶

   Chords (click = jump + play, hover/tap = guitar diagram), a
   tempo-locked strum loop that starts from the highlighted chord,
   step through, and a small popover on the track name for the track
   switcher and beats per chord. Follows the active track live
   (trainer.onTracksChange) and the tempo keeper. (This used to also
   float as a "hover tab"; the strip replaced it.)
   ============================================================ */
import { registerActions } from './actions.js';
import { registerStore, loadJSON, saveJSON } from './storage.js';
import { escHtml } from './util.js';
import { trainerActiveTrack, onTracksChange, trainerTrackList, trainerSelectTrack } from './trainer.js';
import { getUnits } from './songimport.js';
import { toRomans, inferKey, sameKey, romanFor } from './chordsheet.js';
import { showChordPeek, hideChordPeek, peekAnchor, initChordPeek, shapeFor } from './chordpeek.js';
import { degreeOf } from './colormap.js';
import { getAppKey, onAppKeyChange } from './keysync.js';
import { getBPM } from './metronome.js';
import { getVoicing } from './chordbook.js';
import { STRING_OPEN_MIDI, midiToHz } from './theory.js';
import { makeLooper } from './loopscheduler.js';
import { playChordNow } from './audio.js';
import { onSyncChord, trackMatchesSync, seekToChord } from './videosync.js';

const $ = (id) => document.getElementById(id);
const PREF_KEY = registerStore('progTab', 'GenreBenderProgTab_v1');
const BEAT_OPTIONS = [1, 2, 4, 8];

const pref = Object.assign({ open: false, collapsed: false, x: null, y: null, beats: 4 },
  loadJSON(PREF_KEY, {}) || {});
function savePref(){ saveJSON(PREF_KEY, pref); }

let pos = 0;              // highlighted chord index
let looper = null;
let bpmShown = null;

/* ---- pure helpers (exported for tests) ----------------------------- */

/* Which key to read the track in, and why. */
export function trackKey(track, { units = [], appKey = null } = {}){
  const names = (track?.chords || []).map(c => c.name);
  if (!names.length) return null;
  const unit = units.find(u => track.id === `trk_${u.id}` && u.key?.value);
  if (unit) return { key: unit.key.value, from: 'song' };
  if (appKey && names.every(n => degreeOf(n, appKey) >= 0)) return { key: appKey, from: 'app' };
  const g = inferKey(names);
  return g ? { key: g.key, from: 'guess' } : (appKey ? { key: appKey, from: 'app' } : null);
}

/* Frequencies for a track entry: the pinned fingering if there is one,
   else the chord book's voicing. */
export function entryFreqs(entry){
  if (entry?.frets && entry.frets.some(f => f !== null && f !== undefined)){
    return entry.frets.map((f, s) => (f === null || f === undefined) ? null : midiToHz(STRING_OPEN_MIDI[s] + f)).filter(Boolean);
  }
  const v = getVoicing(entry?.name);
  return v?.midis?.length ? v.midis.map(midiToHz) : [];
}

/* ---- DOM ----------------------------------------------------------- */
/* Compact strip in the transport bar: same track, same looper. */
function renderMini(){
  const host = $('transport-prog');
  if (!host) return;
  const t = trainerActiveTrack();
  const chords = t?.chords || [];
  if (!chords.length){
    host.innerHTML = `<button type="button" class="tp-empty" data-action="progtab:openPlay"><span class="tp-empty-long">No chords yet — learn a song or add chords in Play →</span><span class="tp-empty-short">No chords yet →</span></button>`;
    return;
  }
  if (pos >= chords.length) pos = 0;
  const playing = !!looper?.playing;
  host.innerHTML = `
    <div class="tp-track">
      <button type="button" class="tp-prog-name" data-action="ui:pop" data-pop="tp-track-pop" aria-haspopup="dialog" aria-expanded="false" title="Track, beats per chord">${escHtml(t.name)} ▾</button>
      <div class="tp-pop" id="tp-track-pop" role="dialog" aria-label="Track settings" hidden>
        <div class="tp-pop-row"><span class="tp-pop-k">track</span>
          <select data-on-change="progtab:track" aria-label="Track">${trainerTrackList().map(o => `<option value="${escHtml(o.id)}"${o.id === t.id ? ' selected' : ''}>${escHtml(o.name)}</option>`).join('')}</select></div>
        <div class="tp-pop-row"><span class="tp-pop-k">beats</span>
          <select data-on-change="progtab:beats" aria-label="Beats per chord">${BEAT_OPTIONS.map(b => `<option value="${b}"${b === pref.beats ? ' selected' : ''}>${b} per chord</option>`).join('')}</select></div>
        <div class="tp-pop-row"><button type="button" class="btn btn-ghost" data-action="progtab:openPlay">Open in Play →</button></div>
      </div>
    </div>
    <div class="tp-chords" id="tp-chords">${chords.map((c, i) =>
      `<button type="button" class="tp-chord${i === pos ? ' current' : ''}" data-action="progtab:jump" data-idx="${i}" title="Play ${escHtml(c.name)}">${escHtml(c.name)}</button>`).join('')}</div>
    <button type="button" class="tp-mini${playing ? ' on' : ''}" data-action="progtab:play" data-role="loop" aria-label="${playing ? 'Stop loop' : 'Loop progression'}" title="Loop the progression at the tempo keeper's BPM">${playing ? '■' : '⟳'}</button>
    <button type="button" class="tp-mini tp-hide-sm" data-action="progtab:step" data-dir="-1" aria-label="Previous chord">◀</button>
    <button type="button" class="tp-mini tp-hide-sm" data-action="progtab:step" data-dir="1" aria-label="Next chord">▶</button>`;
}

function render(){ renderMini(); }

function safeUnits(){ try { return getUnits(); } catch { return []; } }

function highlight(i){
  pos = i;
  document.querySelectorAll('#prog-tab .prog-tab-cell').forEach((b, j) => b.classList.toggle('current', j === i));
  const strip = $('tp-chords');
  if (strip){
    [...strip.children].forEach((b, j) => b.classList.toggle('current', j === i));
    const cur = strip.children[i];
    if (cur && (cur.offsetLeft < strip.scrollLeft || cur.offsetLeft + cur.offsetWidth > strip.scrollLeft + strip.clientWidth)){
      strip.scrollLeft = Math.max(0, cur.offsetLeft - 24);
    }
  }
}
function paintPlaying(on){
  const b = document.querySelector('#prog-tab [data-action="progtab:play"]');
  if (b){ b.textContent = on ? '■ stop' : '▶ loop'; b.classList.toggle('btn-primary', on); b.classList.toggle('btn-ghost', !on); }
  const m = document.querySelector('#transport-prog [data-role="loop"]');
  if (m){ m.textContent = on ? '■' : '⟳'; m.classList.toggle('on', on); m.setAttribute('aria-label', on ? 'Stop loop' : 'Loop progression'); }
}

/* ---- playback ------------------------------------------------------ */
let stepOffset = 0, stepLen = 1;   // looper plays a rotated copy starting at `pos`
function getLooper(){
  if (looper) return looper;
  looper = makeLooper({
    swing: true,
    onStep: (i) => highlight((i + stepOffset) % stepLen),
    onStop: () => paintPlaying(false),
  });
  return looper;
}
function play(){
  const t = trainerActiveTrack();
  if (!t?.chords.length) return;
  if (looper?.playing){ stop(); return; }
  // start from the highlighted chord, so "step to it, then loop" works
  stepLen = t.chords.length;
  stepOffset = pos % stepLen;
  const order = t.chords.map((c, i) => t.chords[(i + stepOffset) % stepLen]);
  getLooper().start(order.map(c => ({ freqs: entryFreqs(c), beats: pref.beats })),
    { beatsPerChord: pref.beats, mode: 'strum', loop: true });
  paintPlaying(true);
}
function stop(){ if (looper) looper.stop(); }

/* keyboard: Space loops, ←/→ step (shortcuts.js) */
export function progPlay(){ const has = !!trainerActiveTrack()?.chords.length; if (has) play(); return has; }
export function progStep(dir){ const has = !!trainerActiveTrack()?.chords.length; if (has) step(dir); return has; }

function step(dir){
  const t = trainerActiveTrack();
  if (!t?.chords.length) return;
  stop();
  const n = t.chords.length;
  highlight(((pos + dir) % n + n) % n);
  const f = entryFreqs(t.chords[pos]);
  if (f.length) playChordNow(f);
}
function jump(el){
  const t = trainerActiveTrack();
  const i = +el.dataset.idx;
  if (!t?.chords[i]) return;
  const wasPlaying = !!looper?.playing;
  stop();
  highlight(i);
  // synced to the video: jump the video to that chord too
  if (!wasPlaying && trackMatchesSync()) seekToChord(i);
  if (wasPlaying) play();
  else { const f = entryFreqs(t.chords[i]); if (f.length) playChordNow(f); }
}

/* ---- chord peek: hover (or tap) a chord → its guitar diagram ---------- */

/* The fingering a track entry plays: its pinned frets, else the chord book's. */
export function entryFrets(entry){ return shapeFor(entry?.name, entry?.frets); }

export function showPeek(btn, autoHideMs = 0){
  const t = trainerActiveTrack();
  const entry = t?.chords?.[+btn?.dataset?.idx];
  if (!entry) return hideChordPeek();
  const k = trackKey(t, { units: safeUnits(), appKey: getAppKey() });
  showChordPeek(btn, { name: entry.name, frets: entry.frets, sub: k ? romanFor(entry.name, k.key) : '', autoHideMs });
}
export function hidePeek(){ hideChordPeek(); }
const CHIP = '.tp-chord, .prog-tab-cell';
let lastPointer = 'mouse';
function initPeek(){
  initChordPeek();
  document.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || 'mouse'; }, true);
  // mouse / pen: show while hovering
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const b = e.target.closest?.(CHIP);
    if (b && b !== peekAnchor()) showPeek(b);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'touch') return;
    const b = e.target.closest?.(CHIP);
    if (b && !b.contains(e.relatedTarget)) hidePeek();
  });
  // touch: a tap plays the chord (existing action) and shows the shape for a moment
  document.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch') return;
    const b = e.target.closest?.(CHIP);
    if (b) showPeek(b, 3500);
  });
  // keyboard
  document.addEventListener('focusin', (e) => {
    if (lastPointer === 'touch') return;          // a tap focuses too; the tap handler owns that peek
    const b = e.target.closest?.(CHIP); if (b) showPeek(b);
  });
  document.addEventListener('focusout', (e) => { if (lastPointer !== 'touch' && e.target.closest?.(CHIP)) hidePeek(); });
}

/* ---- public -------------------------------------------------------- */


export function initProgTab(){
  registerActions({
    'progtab:toggle':   () => { if (typeof window.trainerNav === 'function') window.trainerNav('chords'); },   // old entry → Play
    'progtab:play':     () => play(),
    'progtab:step':     (el) => step(+el.dataset.dir || 1),
    'progtab:jump':     (el) => jump(el),
    'progtab:beats':    (el) => {
      pref.beats = BEAT_OPTIONS.includes(+el.value) ? +el.value : 4; savePref();
      if (looper?.playing){ stop(); play(); }
    },
    'progtab:openPlay': () => { document.getElementById('tp-track-pop')?.setAttribute('hidden', ''); if (typeof window.trainerNav === 'function') window.trainerNav('chords'); },
    'progtab:track':    (el) => { stop(); pos = 0; trainerSelectTrack(el.value); },
  });
  initPeek();
  onTracksChange(() => { hidePeek(); const was = !!looper?.playing; stop(); render(); if (was) play(); });
  onAppKeyChange(() => render());
  // chords synced to the video: the strip follows the playhead (silently)
  onSyncChord((idx) => {
    const strip = $('tp-chords');
    strip?.classList.toggle('following', idx != null && trackMatchesSync());
    if (idx == null || looper?.playing || !trackMatchesSync()) return;
    highlight(idx);
  });
  render();
}
