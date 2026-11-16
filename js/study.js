/* ============================================================
   study.js — one resizable workspace around a pasted link.

     ┌ Study · <clip> ─────────── layout ◧ ⬒ · Video Map Chords · ✕ ┐
     │ ┌ Video ───────────┐┃┌ Color map ────────────────────────────┐ │
     │ │ inline player,    │┃│ key · views · melody lens · the map   │ │
     │ │ A–B loop, speed,  │┃└───────────────────────────────────────┘ │
     │ │ caption chords    │┃━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
     │ │                   │┃┌ My chords · chord library ───────────┐ │
     │ └───────────────────┘┃│ track + chord table (follows the key) │ │
     │                      ┃└───────────────────────────────────────┘ │
     └────────────────────────────────────────────────────────────────┘
       (transport bar stays visible underneath)

   Nothing is rebuilt: the real color-map clip player (#cm-clip), the
   color map (#colormap-host) and the My chords card (#trainer-card)
   are moved into the panes while the view is open and put back when
   it closes, so every feature, id, handler and saved state is the
   same one you use on the Play page.

   Open it by pasting a link anywhere (when no other view claims the
   paste), from the clips player, the ⋯ menu, or a song card.
   ============================================================ */
import { registerActions } from './actions.js';
import { registerStore, loadJSON, saveJSON } from './storage.js';
import { escHtml } from './util.js';
import { setClipPasteFallback, setClipOpenRoute, getClip, parseClipUrl } from './clips.js';
import { colorMapAddClip, colorMapPickClip, colorMapClipId } from './colormap.js';
import { trainerSetMode, trainerState } from './trainer.js';
import { splitLinkText } from './chordsheet.js';
import { hideChordPeek } from './chordpeek.js';

const $ = (id) => document.getElementById(id);
const STUDY_KEY = registerStore('study', 'GenreBenderStudy_v1');
const PANES = ['video', 'map', 'chords'];
const LABEL = { video: 'Video', map: 'Color map', chords: 'My chords · chord library' };

const st = Object.assign({ layout: 'side', a: 36, b: 52, hidden: {}, max: null, phoneTab: 'map', videoEmpty: false }, loadJSON(STUDY_KEY, {}) || {});
const save = () => saveJSON(STUDY_KEY, { layout: st.layout, a: st.a, b: st.b, hidden: st.hidden, max: st.max, phoneTab: st.phoneTab, videoEmpty: st.videoEmpty });

/* The video pane only takes space when there's something to play (or you
   asked for it, to paste a link into). */
const hasClip = () => !!getClip(colorMapClipId());
const videoWanted = () => !st.hidden.video && (hasClip() || st.videoEmpty);
const paneShown = (p) => p === 'video' ? videoWanted() : !st.hidden[p];

let home = null;          // where each moved node came from
let prevMode = null;

export const studyIsOpen = () => document.body.classList.contains('study-open');

/* ---- DOM ------------------------------------------------------------- */
function ensure(){
  let el = $('study');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'study';
  el.className = 'study';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Study view');
  el.innerHTML = `
    <header class="study-head">
      <div class="study-title"><span id="study-clip-name"></span></div>
      <div class="study-tools">
        <div class="study-seg" role="group" aria-label="Layout">
          <button type="button" data-action="study:layout" data-layout="side" title="Video beside the map and chords">◧</button>
          <button type="button" data-action="study:layout" data-layout="top" title="Video above the map and chords">⬒</button>
        </div>
        <div class="study-seg study-panes" role="group" aria-label="Show panes">
          ${PANES.map(p => `<button type="button" data-action="study:toggle" data-pane="${p}" aria-pressed="true">${p === 'chords' ? 'Chords' : LABEL[p]}</button>`).join('')}
        </div>
        <button type="button" class="study-reset" data-action="study:reset" title="Reset pane sizes">reset</button>
      </div>
    </header>
    <div class="study-body" id="study-body">
      <section class="study-pane" data-pane="video" aria-label="Video">
        <div class="study-pane-head"><span>Video</span><button type="button" data-action="study:max" data-pane="video" title="Maximize / restore">⤢</button></div>
        <div class="study-pane-body" id="study-slot-video"></div>
      </section>
      <div class="study-split" data-split="a" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize video pane"></div>
      <div class="study-col" id="study-col">
        <section class="study-pane" data-pane="map" aria-label="Color map">
          <div class="study-pane-head"><span>Color map</span><button type="button" data-action="study:max" data-pane="map" title="Maximize / restore">⤢</button></div>
          <div class="study-pane-body" id="study-slot-map"></div>
        </section>
        <div class="study-split" data-split="b" role="separator" tabindex="0" aria-label="Resize color map / chords"></div>
        <section class="study-pane" data-pane="chords" aria-label="My chords and chord library">
          <div class="study-pane-head"><span>My chords · chord library</span><button type="button" data-action="study:max" data-pane="chords" title="Maximize / restore">⤢</button></div>
          <div class="study-pane-body" id="study-slot-chords"></div>
        </section>
      </div>
    </div>
    <div class="study-phone-tabs" role="tablist" aria-label="Pane">
      <button type="button" data-action="study:phoneTab" data-pane="map">Color map</button>
      <button type="button" data-action="study:phoneTab" data-pane="chords">Chords</button>
    </div>`;
  document.body.appendChild(el);
  initSplitters(el);
  return el;
}

function apply(){
  const el = $('study');
  if (!el) return;
  const visible = PANES.filter(paneShown);
  const max = st.max && visible.includes(st.max) ? st.max : null;
  el.dataset.layout = st.layout;
  el.dataset.max = max || '';
  el.dataset.phoneTab = st.phoneTab;
  el.style.setProperty('--study-a', `${st.a}%`);
  el.style.setProperty('--study-b', `${st.b}%`);
  PANES.forEach(p => {
    const shown = max ? p === max : paneShown(p);
    el.querySelector(`.study-pane[data-pane="${p}"]`).classList.toggle('off', !shown);
    el.querySelector(`[data-action="study:toggle"][data-pane="${p}"]`)?.setAttribute('aria-pressed', String(paneShown(p)));
  });
  const vidOn = max ? max === 'video' : paneShown('video');
  const colOn = max ? max !== 'video' : (paneShown('map') || paneShown('chords'));
  el.querySelector('.study-split[data-split="a"]').classList.toggle('off', !(vidOn && colOn));
  el.querySelector('.study-split[data-split="b"]').classList.toggle('off', !!(max || !paneShown('map') || !paneShown('chords')));
  el.querySelector('#study-col').classList.toggle('off', !colOn);
  el.classList.toggle('no-video', !vidOn);
  el.querySelectorAll('[data-action="study:layout"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.layout === st.layout)));
  el.querySelectorAll('[data-action="study:phoneTab"]').forEach(b => b.classList.toggle('active', b.dataset.pane === st.phoneTab));
  const c = getClip(colorMapClipId());
  const n = $('study-clip-name');
  if (n) n.innerHTML = c
    ? `<b>${escHtml(c.label)}</b>`
    : `<span class="study-novideo">No video — paste a link anywhere, or <button type="button" class="study-link" data-action="study:toggle" data-pane="video">open the video pane</button></span>`;
}

/* Make sure a pane is on screen (from the finder, shortcuts, links). */
export function studyShowPane(p){
  if (!PANES.includes(p)) return;
  if (p === 'video'){ st.hidden.video = false; if (!hasClip()) st.videoEmpty = true; }
  else st.hidden = { ...st.hidden, [p]: false };
  if (st.max && st.max !== p) st.max = null;
  if (p !== 'video') st.phoneTab = p;
  save(); apply();
}

/* Drag a splitter: % of the body (a) or of the right/bottom column (b). */
function initSplitters(root){
  root.addEventListener('pointerdown', (e) => {
    const sp = e.target.closest?.('.study-split');
    if (!sp || e.button !== 0) return;
    e.preventDefault();
    const which = sp.dataset.split;
    const box = (which === 'a' ? $('study-body') : $('study-col')).getBoundingClientRect();
    // side layout: a splits columns, b splits rows; top layout: the reverse
    const phone = window.matchMedia?.('(max-width: 720px)').matches;
    const horiz = phone ? false : (st.layout === 'side') === (which === 'a');
    root.classList.add('resizing');
    try { sp.setPointerCapture(e.pointerId); } catch {}
    const move = (ev) => {
      const pct = horiz ? (ev.clientX - box.left) / box.width * 100 : (ev.clientY - box.top) / box.height * 100;
      st[which] = Math.round(Math.max(15, Math.min(85, pct)) * 10) / 10;
      apply();
    };
    const up = () => {
      root.classList.remove('resizing');
      sp.removeEventListener('pointermove', move);
      sp.removeEventListener('pointerup', up);
      sp.removeEventListener('pointercancel', up);
      save();
    };
    sp.addEventListener('pointermove', move);
    sp.addEventListener('pointerup', up);
    sp.addEventListener('pointercancel', up);
  });
  // keyboard: arrows nudge the focused splitter by 2%
  root.addEventListener('keydown', (e) => {
    const sp = e.target.closest?.('.study-split');
    if (!sp) return;
    const d = { ArrowLeft: -2, ArrowUp: -2, ArrowRight: 2, ArrowDown: 2 }[e.key];
    if (!d) return;
    e.preventDefault();
    const k = sp.dataset.split;
    st[k] = Math.max(15, Math.min(85, st[k] + d));
    apply(); save();
  });
  // double-click a pane head to maximize / restore it
  root.addEventListener('dblclick', (e) => {
    const head = e.target.closest?.('.study-pane-head');
    if (head) toggleMax(head.parentElement.dataset.pane);
  });
}

/* ---- move the real views in / out -------------------------------------- */
function moveIn(){
  const nodes = { video: $('cm-clip'), map: $('colormap-host'), chords: $('trainer-card') };
  home = {};
  for (const [pane, node] of Object.entries(nodes)){
    if (!node) continue;
    home[pane] = { node, parent: node.parentNode, next: node.nextSibling };
    $(`study-slot-${pane}`).appendChild(node);
  }
}
function moveOut(){
  if (!home) return;
  // put back in reverse so sibling anchors still exist
  for (const pane of ['chords', 'map', 'video']){
    const h = home[pane];
    if (!h) continue;
    if (h.next && h.next.parentNode === h.parent) h.parent.insertBefore(h.node, h.next);
    else h.parent.appendChild(h.node);
  }
  home = null;
}

/* ---- open / close -------------------------------------------------------- */
export function openStudy({ text = null, clipId = null } = {}){
  ensure();
  if (!studyIsOpen()){
    prevMode = trainerState().mode;
    if (prevMode !== 'custom') trainerSetMode('custom');   // the My chords card renders the track + table
    moveIn();
    $('study').hidden = false;
    document.body.classList.add('study-open');
  }
  if (text) colorMapAddClip(text);
  else if (clipId) colorMapPickClip(clipId);
  if (text || clipId) st.hidden.video = false;
  apply();
  document.dispatchEvent(new CustomEvent('gb:nav', { detail: { tab: 'play' } }));
}
export function closeStudy(){
  if (!studyIsOpen()) return;
  hideChordPeek();
  moveOut();
  $('study').hidden = true;
  document.body.classList.remove('study-open');
  if (prevMode && prevMode !== 'custom' && $('inner-trainer')?.dataset.sub === 'drills') trainerSetMode(prevMode);
  prevMode = null;
}

/* Open Play through the normal route (trainer tab + custom mode), then run fn. */
function goPlay(fn){
  if (!studyIsOpen() && typeof window.trainerNav === 'function') window.trainerNav('chords');
  fn();
}

function toggleMax(p){ st.max = st.max === p ? null : p; save(); apply(); }

export function initStudy(){
  registerActions({
    'study:open':     (el) => goPlay(() => openStudy({ clipId: el?.dataset?.clip || null })),
    'study:layout':   (el) => { st.layout = el.dataset.layout === 'top' ? 'top' : 'side'; save(); apply(); },
    'study:toggle':   (el) => {
      const p = el.dataset.pane;
      const shown = paneShown(p);
      if (shown && PANES.filter(paneShown).length <= 1) return;               // keep at least one
      if (p === 'video'){
        if (shown){ st.hidden.video = true; st.videoEmpty = false; }
        else { st.hidden.video = false; if (!hasClip()) st.videoEmpty = true; }
      } else st.hidden = { ...st.hidden, [p]: shown };
      if (st.max === p) st.max = null;
      save(); apply();
    },
    'study:max':      (el) => toggleMax(el.dataset.pane),
    'study:reset':    () => { Object.assign(st, { a: 36, b: 52, hidden: {}, max: null, videoEmpty: false }); save(); apply(); },
    'study:phoneTab': (el) => { st.phoneTab = el.dataset.pane === 'chords' ? 'chords' : 'map'; save(); apply(); },
  });
  // A link pasted anywhere that no view claims opens here; every "open
  // clip" (clips list, song cards) plays in the one video pane.
  setClipPasteFallback((text) => {
    const { url } = splitLinkText(text);
    const meta = parseClipUrl(text) || parseClipUrl(url);
    if (!meta || meta.platform === 'other') return false;
    goPlay(() => openStudy({ text }));
    return true;
  });
  setClipOpenRoute((id) => { goPlay(() => openStudy({ clipId: id })); return true; });
  document.addEventListener('gb:refclip', () => { if (studyIsOpen()) apply(); });
  // Leaving Play (any other page) puts the views back.
  document.addEventListener('gb:nav', (e) => {
    const tab = e.detail?.tab;
    if (studyIsOpen() && tab && tab !== 'play' && tab !== 'trainer') closeStudy();
  });
  Object.assign(window, { openStudy, closeStudy, studyShowPane, studyIsOpen });
}
