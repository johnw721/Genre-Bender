/* ============================================================
   progtab.js — floating "hover tab" for the active My chords track.

   A small draggable panel that stays on screen while you scroll the
   trainer (or switch tabs) so the progression is always in view while
   you play along:

     ┌ ♪ Track name ──── Em · 92 ─ ▾ ✕ ┐
     │  Em   C    G    D               │   chords (click = jump + play)
     │  i    VI   III  VII             │   Roman numerals in the track's key
     │  [▶ loop] [◀][▶]  beats: 4      │   tempo-locked loop / step through
     └─────────────────────────────────┘

   Follows the active track live (trainer.onTracksChange), the app key
   and the tempo keeper. Key: the saved song unit's key for imported
   tracks, else the app key when every chord fits it, else inferred
   from the chords. Position / open / collapsed / beats persist.
   ============================================================ */
import { registerActions } from './actions.js';
import { registerStore, loadJSON, saveJSON } from './storage.js';
import { escHtml } from './util.js';
import { trainerActiveTrack, onTracksChange, trainerTrackList, trainerSelectTrack } from './trainer.js';
import { getUnits } from './songimport.js';
import { toRomans, inferKey, sameKey, romanFor } from './chordsheet.js';
import { chordDiagramSVG } from './fretchords.js';
import { degreeOf } from './colormap.js';
import { getAppKey, onAppKeyChange } from './keysync.js';
import { getBPM } from './metronome.js';
import { getVoicing } from './chordbook.js';
import { STRING_OPEN_MIDI, midiToHz } from './theory.js';
import { makeLooper } from './loopscheduler.js';
import { playChordNow } from './audio.js';

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
function ensureEl(){
  let el = $('prog-tab');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'prog-tab';
  el.className = 'prog-tab';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Chord progression hover tab');
  document.body.appendChild(el);
  initDrag(el);
  return el;
}

function place(el){
  // Default: bottom-left of the main column; clamp a saved spot to the viewport.
  const W = window.innerWidth, H = window.innerHeight;
  const r = el.getBoundingClientRect();
  const w = r.width || 320, h = r.height || 140;
  let x = pref.x, y = pref.y;
  if (x == null || y == null){ x = 24; y = H - h - 24; }
  x = Math.max(8, Math.min(W - w - 8, x));
  y = Math.max(8, Math.min(H - Math.min(h, 60) - 8, y));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.bottom = 'auto';     // the CSS default anchors bottom; top + bottom would stretch it
}

/* Compact strip in the transport bar: same track, same looper. */
function renderMini(){
  const host = $('transport-prog');
  if (!host) return;
  const t = trainerActiveTrack();
  const chords = t?.chords || [];
  if (!chords.length){
    host.innerHTML = `<span class="tp-empty">No chords yet — learn a song or add chords in Play.</span>`;
    return;
  }
  if (pos >= chords.length) pos = 0;
  const playing = !!looper?.playing;
  host.innerHTML = `
    <button type="button" class="tp-prog-name" data-action="progtab:openPlay" title="Open this track in Play">${escHtml(t.name)}</button>
    <div class="tp-chords" id="tp-chords">${chords.map((c, i) =>
      `<button type="button" class="tp-chord${i === pos ? ' current' : ''}" data-action="progtab:jump" data-idx="${i}" title="Play ${escHtml(c.name)}">${escHtml(c.name)}</button>`).join('')}</div>
    <button type="button" class="tp-mini${playing ? ' on' : ''}" data-action="progtab:play" data-role="loop" aria-label="${playing ? 'Stop loop' : 'Loop progression'}" title="Loop the progression at the tempo keeper's BPM">${playing ? '■' : '⟳'}</button>
    <button type="button" class="tp-mini tp-hide-sm" data-action="progtab:step" data-dir="-1" aria-label="Previous chord">◀</button>
    <button type="button" class="tp-mini tp-hide-sm" data-action="progtab:step" data-dir="1" aria-label="Next chord">▶</button>`;
}

function render(){
  renderMini();
  const el = ensureEl();
  el.classList.toggle('open', !!pref.open);
  el.classList.toggle('collapsed', !!pref.collapsed);
  if (!pref.open) return;      // closing the pop-out keeps the transport loop running

  const t = trainerActiveTrack();
  const chords = t?.chords || [];
  if (pos >= chords.length) pos = 0;
  const k = trackKey(t, { units: safeUnits(), appKey: getAppKey() });
  const romans = k ? toRomans(chords.map(c => c.name), k.key) : [];
  bpmShown = getBPM();
  const playing = !!looper?.playing;
  const others = trainerTrackList();

  el.innerHTML = `
    <div class="prog-tab-head" id="prog-tab-drag" title="Drag to move">
      <span class="prog-tab-title">${escHtml(t?.name || 'My chords')}</span>
      <span class="prog-tab-meta">${k ? `<b title="${k.from === 'song' ? 'key from the saved song' : k.from === 'app' ? 'app key' : 'guessed from the chords'}">${escHtml(k.key)}</b>${k.from === 'guess' ? '?' : ''} · ` : ''}<span id="prog-tab-bpm">${bpmShown}</span></span>
      <button type="button" class="prog-tab-x" data-action="progtab:collapse" aria-label="${pref.collapsed ? 'Expand' : 'Collapse'}">${pref.collapsed ? '▴' : '▾'}</button>
      <button type="button" class="prog-tab-x" data-action="progtab:toggle" aria-label="Close">✕</button>
    </div>
    <div class="prog-tab-body">
      ${chords.length ? `<div class="prog-tab-grid" style="--n:${Math.min(chords.length, 8)}">
        ${chords.map((c, i) => `<button type="button" class="prog-tab-cell${i === pos ? ' current' : ''}" data-action="progtab:jump" data-idx="${i}" title="Play ${escHtml(c.name)}">
            <span class="prog-tab-chord">${escHtml(c.name)}</span><span class="prog-tab-roman">${escHtml(romans[i] || '')}</span></button>`).join('')}
      </div>` : '<div class="prog-tab-empty">This track has no chords yet — add some in My chords.</div>'}
      <div class="prog-tab-ctrl">
        <button type="button" class="btn ${playing ? 'btn-primary' : 'btn-ghost'} prog-tab-btn" data-action="progtab:play" ${chords.length ? '' : 'disabled'}>${playing ? '■ stop' : '▶ loop'}</button>
        <button type="button" class="btn btn-ghost prog-tab-btn" data-action="progtab:step" data-dir="-1" aria-label="Previous chord" ${chords.length ? '' : 'disabled'}>◀</button>
        <button type="button" class="btn btn-ghost prog-tab-btn" data-action="progtab:step" data-dir="1" aria-label="Next chord" ${chords.length ? '' : 'disabled'}>▶</button>
        <label class="prog-tab-beats">beats
          <select data-on-change="progtab:beats" aria-label="Beats per chord">${BEAT_OPTIONS.map(b => `<option value="${b}"${b === pref.beats ? ' selected' : ''}>${b}</option>`).join('')}</select>
        </label>
        ${others.length > 1 ? `<select class="prog-tab-track" data-on-change="progtab:track" aria-label="Track">${others.map(o => `<option value="${escHtml(o.id)}"${o.id === t?.id ? ' selected' : ''}>${escHtml(o.name)}</option>`).join('')}</select>` : ''}
      </div>
    </div>`;
  place(el);
}

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
  if (wasPlaying) play();
  else { const f = entryFreqs(t.chords[i]); if (f.length) playChordNow(f); }
}

/* ---- chord peek: hover (or tap) a chord → its guitar diagram ---------- */

/* The fingering a track entry plays: its pinned frets, else the chord book's. */
export function entryFrets(entry){
  if (entry?.frets && entry.frets.some(f => f !== null && f !== undefined)) return entry.frets;
  return getVoicing(entry?.name)?.frets || null;
}

let peekTimer = null, peekFor = null;
function peekEl(){
  let el = $('chord-peek');
  if (!el){
    el = document.createElement('div');
    el.id = 'chord-peek';
    el.className = 'chord-peek';
    el.setAttribute('role', 'tooltip');
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}
export function showPeek(btn){
  const t = trainerActiveTrack();
  const i = +btn?.dataset?.idx;
  const entry = t?.chords?.[i];
  if (!entry) return hidePeek();
  clearTimeout(peekTimer);
  const k = trackKey(t, { units: safeUnits(), appKey: getAppKey() });
  const frets = entryFrets(entry);
  const el = peekEl();
  el.innerHTML = `
    <div class="chord-peek-head"><b>${escHtml(entry.name)}</b>${k ? `<span>${escHtml(romanFor(entry.name, k.key))}</span>` : ''}</div>
    ${frets ? chordDiagramSVG(frets) : '<div class="chord-peek-none">no guitar shape for this one</div>'}
    ${frets ? `<div class="chord-peek-frets">${frets.map(f => f === null || f === undefined ? 'x' : f).join(' ')}</div>` : ''}`;
  el.hidden = false;
  peekFor = btn;
  btn.setAttribute('aria-describedby', 'chord-peek');
  // above the chip (the transport sits at the bottom), clamped to the viewport
  const r = btn.getBoundingClientRect(), pr = el.getBoundingClientRect();
  const w = pr.width || 150, h = pr.height || 190;
  let x = r.left + r.width / 2 - w / 2;
  x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
  let y = r.top - h - 10;
  if (y < 8) y = Math.min(window.innerHeight - h - 8, r.bottom + 10);
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
}
export function hidePeek(){
  clearTimeout(peekTimer);
  const el = $('chord-peek');
  if (el) el.hidden = true;
  peekFor?.removeAttribute('aria-describedby');
  peekFor = null;
}
const CHIP = '.tp-chord, .prog-tab-cell';
let lastPointer = 'mouse';
function initPeek(){
  document.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || 'mouse'; }, true);
  // mouse / pen: show while hovering
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const b = e.target.closest?.(CHIP);
    if (b && b !== peekFor) showPeek(b);
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
    if (!b){ if (!e.target.closest?.('#chord-peek')) hidePeek(); return; }
    showPeek(b);
    peekTimer = setTimeout(hidePeek, 3500);
  });
  // keyboard
  document.addEventListener('focusin', (e) => {
    if (lastPointer === 'touch') return;          // a tap focuses too; the tap handler owns that peek
    const b = e.target.closest?.(CHIP); if (b) showPeek(b);
  });
  document.addEventListener('focusout', (e) => { if (lastPointer !== 'touch' && e.target.closest?.(CHIP)) hidePeek(); });
  // sliding the strip or the page moves the chip: drop the peek
  document.addEventListener('scroll', () => { if (peekFor) hidePeek(); }, true);
}

/* ---- drag ---------------------------------------------------------- */
function initDrag(el){
  let sx, sy, ox, oy, dragging = false;
  el.addEventListener('pointerdown', (e) => {
    const head = e.target.closest('.prog-tab-head');
    if (!head || e.button !== 0 || e.target.closest('button')) return;
    dragging = true;
    const r = el.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    try { el.setPointerCapture(e.pointerId); } catch {}
    el.classList.add('dragging');
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    pref.x = ox + (e.clientX - sx);
    pref.y = oy + (e.clientY - sy);
    place(el);
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('dragging');
    try { el.releasePointerCapture(e.pointerId); } catch {}
    const r = el.getBoundingClientRect();
    pref.x = Math.round(r.left); pref.y = Math.round(r.top);
    savePref();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

/* ---- public -------------------------------------------------------- */
export function progTabToggle(force){
  pref.open = typeof force === 'boolean' ? force : !pref.open;
  if (pref.open) pref.collapsed = false;
  savePref();
  render();
}
export function progTabIsOpen(){ return !!pref.open; }

export function initProgTab(){
  registerActions({
    'progtab:toggle':   () => progTabToggle(),
    'progtab:collapse': () => { pref.collapsed = !pref.collapsed; savePref(); render(); },
    'progtab:play':     () => play(),
    'progtab:step':     (el) => step(+el.dataset.dir || 1),
    'progtab:jump':     (el) => jump(el),
    'progtab:beats':    (el) => {
      pref.beats = BEAT_OPTIONS.includes(+el.value) ? +el.value : 4; savePref();
      if (looper?.playing){ stop(); play(); }
    },
    'progtab:openPlay': () => { if (typeof window.trainerNav === 'function') window.trainerNav('chords'); },
    'progtab:track':    (el) => { stop(); pos = 0; trainerSelectTrack(el.value); },
  });
  initPeek();
  onTracksChange(() => { hidePeek(); const was = !!looper?.playing; stop(); render(); if (was) play(); });
  onAppKeyChange(() => render());
  window.addEventListener('resize', () => { const el = $('prog-tab'); if (el && pref.open) place(el); });
  // The tempo keeper has no change event of its own; keep the BPM label honest.
  setInterval(() => {
    if (!pref.open) return;
    const b = getBPM();
    if (b !== bpmShown){ bpmShown = b; const s = $('prog-tab-bpm'); if (s) s.textContent = b; }
  }, 500);
  render();
}
