/* ============================================================
   tips.js — fewer words on screen.

   • Instruction text is tagged .tip and hidden until "Show tips" is
     turned on in the ⋯ menu (body.show-tips).
   • A 3-step tour runs once on first visit (and from ⋯ → Quick tour):
     Songs → Play → the transport strip. Each step is a small bubble
     pointing at the real control; Next / Done / Esc.
   ============================================================ */
import { registerActions } from './actions.js';
import { registerStore, loadJSON, saveJSON } from './storage.js';
import { escHtml } from './util.js';

const KEY = registerStore('tips', 'GenreBenderTips_v1');
let st = { show: false, toured: false };

const STEPS = [
  { sel: '.dest[data-dest="songs"]', title: 'Start with a song',
    body: 'Paste chords, a link, or look up key & BPM. Saving makes a track you can play along with.' },
  { sel: '.dest[data-dest="play"]', title: 'Play',
    body: 'Video, color map and your chords in one resizable view. Paste a link anywhere and it opens here.' },
  { sel: '#transport-prog', title: 'Your progression',
    body: 'The active track lives down here. Space loops it, ← / → step through chords, tap a chord to see its shape.' },
];
let step = -1;

function save(){ saveJSON(KEY, st); }
function applyTips(){
  document.body.classList.toggle('show-tips', !!st.show);
  const b = document.getElementById('tips-btn');
  if (b){
    b.setAttribute('aria-pressed', st.show ? 'true' : 'false');
    b.lastChild.textContent = st.show ? 'Hide tips' : 'Show tips';
  }
}
export function setTips(on){ st.show = !!on; save(); applyTips(); }

function bubble(){
  let e = document.getElementById('gb-tour');
  if (!e){
    e = document.createElement('div');
    e.id = 'gb-tour';
    e.className = 'gb-tour';
    e.setAttribute('role', 'dialog');
    e.setAttribute('aria-live', 'polite');
    document.body.appendChild(e);
  }
  return e;
}
function showStep(){
  const s = STEPS[step];
  const target = s && document.querySelector(s.sel);
  if (!s){ endTour(); return; }
  document.querySelectorAll('.tour-target').forEach(n => n.classList.remove('tour-target'));
  target?.classList.add('tour-target');
  const e = bubble();
  const last = step === STEPS.length - 1;
  e.innerHTML = `<div class="gb-tour-count">${step + 1} / ${STEPS.length}</div>
    <div class="gb-tour-title">${escHtml(s.title)}</div>
    <p>${escHtml(s.body)}</p>
    <div class="gb-tour-btns"><button type="button" data-action="tour:end" class="gb-tour-skip">${last ? 'Close' : 'Skip'}</button>
    <button type="button" data-action="${last ? 'tour:end' : 'tour:next'}" class="gb-tour-next">${last ? 'Done' : 'Next →'}</button></div>`;
  e.hidden = false;
  // place next to the target (below it, or above when it sits at the bottom)
  const r = target ? target.getBoundingClientRect() : { left: innerWidth / 2, bottom: 80, top: 80, width: 0 };
  const w = Math.min(300, innerWidth - 24);
  e.style.width = w + 'px';
  e.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + 'px';
  const below = r.bottom + 10;
  e.style.top = (below + 170 < innerHeight ? below : Math.max(12, r.top - e.offsetHeight - 10)) + 'px';
  e.querySelector('.gb-tour-next')?.focus({ preventScroll: true });
}
export function startTour(){ step = 0; showStep(); }
export function endTour(){
  step = -1;
  document.querySelectorAll('.tour-target').forEach(n => n.classList.remove('tour-target'));
  const e = document.getElementById('gb-tour');
  if (e) e.hidden = true;
  if (!st.toured){ st.toured = true; save(); }
}
export function tourOpen(){ return step >= 0; }

export function initTips(){
  st = { ...st, ...(loadJSON(KEY, {}) || {}) };
  applyTips();
  registerActions({
    'tips:toggle': () => setTips(!st.show),
    'tour:start':  () => { document.getElementById('menu-pop')?.setAttribute('hidden', ''); startTour(); },
    'tour:next':   () => { step++; showStep(); },
    'tour:end':    () => endTour(),
  });
  document.addEventListener('keydown', (e) => { if (step >= 0 && e.key === 'Escape'){ e.stopPropagation(); endTour(); } }, true);
  addEventListener('resize', () => { if (step >= 0) showStep(); });
  // first visit only; tests / embeds can opt out with ?notour
  if (!st.toured && !/[?&]notour\b/.test(location.search) && !window.__gbNoTour) setTimeout(() => { if (!st.toured && step < 0) startTour(); }, 600);
}
