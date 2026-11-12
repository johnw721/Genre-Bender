/* ============================================================
   chordpeek.js — the small floating guitar-diagram card.

   One shared popover used by the transport strip, the hover tab,
   the color map (click a chord), clip chord chips and the chord
   finder. It never takes focus and ignores pointer events, so it
   can't get in the way of whatever opened it.

     showChordPeek(anchorEl, { name, frets, sub, autoHideMs })
     hideChordPeek()
   ============================================================ */
import { escHtml } from './util.js';
import { chordDiagramSVG } from './fretchords.js';
import { getVoicing } from './chordbook.js';

const $ = (id) => document.getElementById(id);
let timer = null;
let anchor = null;

function el(){
  let e = $('chord-peek');
  if (!e){
    e = document.createElement('div');
    e.id = 'chord-peek';
    e.className = 'chord-peek';
    e.setAttribute('role', 'tooltip');
    e.hidden = true;
    document.body.appendChild(e);
  }
  return e;
}

/* The shape to draw: the given frets if any are set, else the chord book's. */
export function shapeFor(name, frets){
  if (frets && frets.some(f => f !== null && f !== undefined)) return frets;
  return getVoicing(name)?.frets || null;
}

export function peekAnchor(){ return anchor; }

export function showChordPeek(target, { name, frets = null, sub = '', autoHideMs = 0 } = {}){
  if (!target || !name) return hideChordPeek();
  clearTimeout(timer);
  const f = shapeFor(name, frets);
  const e = el();
  e.innerHTML = `
    <div class="chord-peek-head"><b>${escHtml(name)}</b>${sub ? `<span>${escHtml(sub)}</span>` : ''}</div>
    ${f ? chordDiagramSVG(f) : '<div class="chord-peek-none">no guitar shape for this one</div>'}
    ${f ? `<div class="chord-peek-frets">${f.map(v => v === null || v === undefined ? 'x' : v).join(' ')}</div>` : ''}`;
  e.hidden = false;
  if (anchor && anchor !== target) anchor.removeAttribute('aria-describedby');
  anchor = target;
  target.setAttribute('aria-describedby', 'chord-peek');
  // Prefer above the target; flip below when there's no room; clamp to the viewport.
  const r = target.getBoundingClientRect(), pr = e.getBoundingClientRect();
  const w = pr.width || 150, h = pr.height || 190;
  const x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  let y = r.top - h - 10;
  if (y < 8) y = Math.min(window.innerHeight - h - 8, r.bottom + 10);
  e.style.left = `${Math.round(x)}px`;
  e.style.top = `${Math.round(y)}px`;
  if (autoHideMs) timer = setTimeout(hideChordPeek, autoHideMs);
}

export function hideChordPeek(){
  clearTimeout(timer);
  const e = $('chord-peek');
  if (e) e.hidden = true;
  anchor?.removeAttribute('aria-describedby');
  anchor = null;
}

let wired = false;
/* Scrolling moves whatever the card points at, so drop it. A click
   anywhere else dismisses a click-opened (auto-hiding) card. */
export function initChordPeek(){
  if (wired) return;
  wired = true;
  document.addEventListener('scroll', () => { if (anchor) hideChordPeek(); }, true);
  document.addEventListener('pointerdown', (e) => {
    if (anchor && !anchor.contains(e.target)) hideChordPeek();
  }, true);
  window.addEventListener('resize', hideChordPeek);
}
