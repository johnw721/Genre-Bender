/* ============================================================
   player.js — one video player that keeps playing everywhere.

   The clip player (#cm-clip: the video, A–B loop, speed, caption
   chords) is moved ONCE, at boot, into a fixed layer (#gb-player) and
   never moved again — moving an iframe reloads it. The layer then
   takes one of four looks:

     dock  — in Play, laid exactly over the video pane's slot
     pop   — floated over Play as a modal (⧉ pop out; auto on phones)
     mini  — a small corner player on every other page (and in Play
             when the video pane is hidden), so the song keeps going
     hidden — no clip, or you closed the mini player (✕ also stops it)

   study.js owns the panes and calls playerUpdate() when they change;
   while docked, a rAF loop keeps the layer glued to the slot (resizes,
   splitter drags, scrolling, phone tabs).
   ============================================================ */
import { registerActions } from './actions.js';
import { escHtml } from './util.js';
import { getClip } from './clips.js';
import { colorMapClipId, colorMapStopFrame, colorMapReloadFrame, colorMapFrameLoaded } from './colormap.js';

const $ = (id) => document.getElementById(id);
let el = null;
let mode = 'hidden';
let pop = false;
let clipEdit = false;
let dismissed = false;            // ✕ on the mini player (until another clip opens / you go to Play)
let lastClip = null;
let announced = undefined;        // last clip id seen on gb:refclip (for the phone auto-pop)
let raf = 0;
let lastRect = '';
let drag = null;                  // mini player offset from its corner (session only)
const listeners = new Set();

const clip = () => getClip(colorMapClipId());
const isPhone = () => { try { return !!window.matchMedia?.('(max-width: 720px)').matches; } catch { return false; } };
const studyOpen = () => document.body.classList.contains('study-open');
const slot = () => $('study-slot-video');
function videoPaneShown(){
  if (!studyOpen()) return false;
  const pane = document.querySelector('#study .study-pane[data-pane="video"]');
  return !!pane && !pane.classList.contains('off') && getComputedStyle(pane).display !== 'none';
}

export const playerMode = () => mode;
export const playerIsPopped = () => mode === 'pop';
export const playerClipEditing = () => clipEdit;
export function onPlayerChange(fn){ listeners.add(fn); return () => listeners.delete(fn); }

export function playerPop(on = !pop){
  pop = !!on && !!clip();
  if (pop) dismissed = false;
  playerUpdate();
  if (pop) el?.querySelector('.gbp-pop')?.focus({ preventScroll: true });
}
export function playerClipEdit(on = !clipEdit){
  clipEdit = !!on;
  playerUpdate();
  if (clipEdit) setTimeout(() => $('cm-clip-url')?.focus(), 0);
}
/* Bring a closed mini player back. */
export function playerShow(){ dismissed = false; playerUpdate(); }
/* ✕ on the mini player: stop the video and get out of the way. */
export function playerClose(){
  dismissed = true;
  pop = false;
  colorMapStopFrame();
  playerUpdate();
}

function computeMode(){
  const c = clip();
  if (!c){ pop = false; return 'hidden'; }
  if (pop) return 'pop';
  if (videoPaneShown()) return 'dock';
  return dismissed ? 'hidden' : 'mini';
}

export function playerUpdate(){
  if (!el) return;
  const c = clip();
  if ((c?.id || null) !== lastClip){ lastClip = c?.id || null; dismissed = false; }
  const prev = mode;
  mode = computeMode();
  if (mode === 'dock') dismissed = false;
  // a stopped (✕) player comes back to life when it's shown again
  if (mode !== 'hidden' && c && !colorMapFrameLoaded()) colorMapReloadFrame();
  el.dataset.mode = mode;
  el.hidden = mode === 'hidden';
  el.classList.toggle('clip-edit', clipEdit || !c);
  el.classList.toggle('phone', isPhone());
  const name = el.querySelector('.gbp-name');
  if (name) name.textContent = c ? c.label : '';
  const pb = el.querySelector('.gbp-pop');
  if (pb){ pb.textContent = mode === 'pop' ? '↙ back' : '⧉'; pb.title = mode === 'pop' ? 'Dock the video (Esc)' : 'Pop out over the page'; }
  if (mode !== 'dock'){
    stopGlue();
    el.style.left = el.style.top = el.style.width = el.style.height = '';
    const s = slot(); if (s) s.style.height = '';
    if (mode === 'mini' && drag) el.style.transform = `translate(${drag.x}px, ${drag.y}px)`;
    else el.style.transform = '';
  } else {
    el.style.transform = '';
    lastRect = '';
    glue();
    startGlue();
  }
  if (prev !== mode){
    listeners.forEach(fn => { try { fn(mode); } catch (e) { console.error(e); } });
    document.dispatchEvent(new CustomEvent('gb:player', { detail: { mode } }));
  }
}

/* ---- dock: sit exactly on the video pane's slot ----------------------- */
function glue(){
  const s = slot();
  if (!s || !el) return;
  const phone = isPhone();
  // on a phone the pane sizes to the player; elsewhere the player fills the pane
  if (phone){ s.style.height = `${Math.ceil(el.offsetHeight)}px`; }
  else s.style.height = '';
  const r = s.getBoundingClientRect();
  const key = `${r.left}|${r.top}|${r.width}|${r.height}|${phone}`;
  if (key === lastRect) return;
  lastRect = key;
  el.style.left = `${r.left}px`;
  el.style.top = `${r.top}px`;
  el.style.width = `${r.width}px`;
  el.style.height = phone ? '' : `${r.height}px`;
}
function startGlue(){
  if (raf) return;
  const tick = () => { raf = 0; if (mode !== 'dock') return; glue(); raf = requestAnimationFrame(tick); };
  raf = requestAnimationFrame(tick);
}
function stopGlue(){ if (raf) cancelAnimationFrame(raf); raf = 0; }

/* ---- mini: drag it out of the way ------------------------------------- */
function initDrag(){
  el.addEventListener('pointerdown', (e) => {
    if (mode !== 'mini' || !e.target.closest('.gbp-head') || e.target.closest('button')) return;
    const start = { x: e.clientX, y: e.clientY, ox: drag?.x || 0, oy: drag?.y || 0 };
    const move = (ev) => {
      drag = { x: start.ox + ev.clientX - start.x, y: start.oy + ev.clientY - start.y };
      el.style.transform = `translate(${drag.x}px, ${drag.y}px)`;
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });
}

export function initPlayer(){
  const clipEl = $('cm-clip');
  if (!clipEl || $('gb-player')) return;
  el = document.createElement('div');
  el.id = 'gb-player';
  el.className = 'gb-player';
  el.hidden = true;
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Video player');
  el.innerHTML = `
    <div class="gbp-scrim" data-action="player:pop" aria-hidden="true"></div>
    <div class="gbp-card">
      <div class="gbp-head">
        <span class="gbp-name"></span>
        <button type="button" class="gbp-btn gbp-open" data-action="player:openPlay" title="Open in Play">Play ↗</button>
        <button type="button" class="gbp-btn gbp-pop" data-action="player:pop" title="Pop out over the page">⧉</button>
        <button type="button" class="gbp-btn gbp-close" data-action="player:close" aria-label="Close the player" title="Close (stops the video)">✕</button>
      </div>
      <div class="gbp-body"></div>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('.gbp-body').appendChild(clipEl);      // the one and only move
  initDrag();
  registerActions({
    'player:pop':      () => playerPop(),
    'player:close':    () => playerClose(),
    'player:openPlay': () => {
      pop = false;
      window.trainerNav?.('chords');
      window.studyShowPane?.('video');
      playerUpdate();
    },
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mode === 'pop' && !$('chord-finder')?.offsetParent){ e.stopPropagation(); playerPop(false); }
  }, true);
  document.addEventListener('gb:nav', () => setTimeout(playerUpdate, 0));
  // a NEW clip on a phone opens popped out, whichever way it arrived
  document.addEventListener('gb:refclip', (e) => {
    const id = e.detail?.id || null;
    if (id && id !== announced && announced !== undefined && isPhone()){ pop = true; clipEdit = false; }
    announced = id;
    setTimeout(playerUpdate, 0);
  });
  addEventListener('resize', () => { lastRect = ''; playerUpdate(); });
  // the player's own height changes (aspect, loop line, clip ▾) matter on a phone
  try { new ResizeObserver(() => { if (mode === 'dock') { lastRect = ''; glue(); } }).observe(clipEl); } catch { /* old browsers */ }
  Object.assign(window, { playerPop, playerClose, playerUpdate, playerMode, playerShow });
  announced = colorMapClipId() || null;      // the clip restored at boot doesn't pop
  playerUpdate();
}
