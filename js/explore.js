/* ============================================================
   explore.js — Explore mode: one global toggle that rolls dice.

   Toggling it ON immediately shuffles the whole bench:
     • random 2–4 genre blend with random ratios,
     • random tempo + swing feel,
     • random key/style/settings on every generator panel,
     • a random fret shape in Frets→chords,
     • a random trainer drill mode,
   and jumps you to a random inner tab. While it stays ON, every
   inner tab you wander into re-rolls its settings — the app keeps
   nudging you somewhere you wouldn't have gone on purpose.

   Nothing here calls the AI — it only rolls local settings, so
   exploring is free; hit a Generate button when a roll intrigues
   you. Toggling OFF simply stops the rolling (settings stay).
   ============================================================ */
import { GENRES, MAX_GENRES } from './config.js';
import { store, clearSelected } from './store.js';
import { syncUI } from './library.js';
import { setBPM } from './metronome.js';
import { setSwing } from './swing.js';
import { randomFrets } from './fretchords.js';
import { trainerSetMode } from './trainer.js';
import { switchInnerTab } from './ui.js';

const $ = (id) => document.getElementById(id);
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

let on = false;

export function isExploreOn(){ return on; }

export function toggleExplore(){
  on = !on;
  const b = $('explore-btn');
  if (b){
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? '✦ exploring' : '✦ explore';
  }
  if (on) exploreShuffle();
}

/* ---- rolling helpers -------------------------------------- */
function fire(el, type){
  if (el && el.dispatchEvent && typeof Event !== 'undefined') el.dispatchEvent(new Event(type));
}
function rollSelect(id){
  const el = $(id);
  if (!el || !el.options || !el.options.length) return;
  el.selectedIndex = Math.floor(Math.random() * el.options.length);
  fire(el, 'change');
}
function rollRange(id, lo, hi){
  const el = $(id);
  if (!el) return;
  el.value = randInt(lo, hi);
  fire(el, 'input');
}

function rollGenres(){
  clearSelected();
  document.querySelectorAll('.chip.selected').forEach(c => {
    c.classList.remove('selected'); c.setAttribute('aria-pressed', 'false'); delete c.dataset.idx;
  });
  const all = Object.values(GENRES).flatMap(cat => cat.genres);
  const n = randInt(2, MAX_GENRES);
  const picks = [];
  while (picks.length < n){
    const g = rand(all);
    if (!picks.includes(g)) picks.push(g);
  }
  picks.forEach(name => {
    store.selected.push({ name, ratio: randInt(20, 80) });
    try {
      const chip = document.querySelector(`.chip[data-genre="${CSS.escape(name)}"]`);
      if (chip){ chip.classList.add('selected'); chip.setAttribute('aria-pressed', 'true'); chip.dataset.idx = store.selected.length; }
    } catch { /* headless / chips not built yet */ }
  });
  syncUI();
}

function rollTempo(){
  const bpm = randInt(70, 170);
  const slider = $('bpm-slider');
  if (slider) slider.value = bpm;
  setBPM(bpm);
  const sw = rand([0, 0, 33, 55, 75]);      // biased toward straight
  const ss = $('swing-slider');
  if (ss) ss.value = sw;
  setSwing(sw);
}

/* Re-roll one inner panel's controls. */
export function exploreRollPanel(id){
  if (id === 'guitar'){
    rollSelect('guitar-key'); rollSelect('guitar-style'); rollRange('guitar-chord-count', 2, 8);
  } else if (id === 'piano'){
    rollSelect('piano-key'); rollSelect('piano-style'); rollRange('piano-chord-count', 2, 8);
  } else if (id === 'composer'){
    rollSelect('composer-key'); rollSelect('composer-density'); rollSelect('composer-position');
    rollSelect('composer-voicing'); rollRange('composer-bars', 2, 8);
    const p = $('composer-passing');
    if (p) p.checked = Math.random() < 0.3;
  } else if (id === 'frets'){
    randomFrets();
  } else if (id === 'trainer'){
    trainerSetMode(rand(['mixed', 'sc', 's2n', 'n2s', 'mv', 'prog']));
  }
}

/* Bridged into the switchInnerTab handler: wandering re-rolls. */
export function exploreOnInnerTab(id){
  if (on) exploreRollPanel(id);
}

const INNER_TABS = ['guitar', 'piano', 'composer', 'frets', 'trainer'];

/* The big roll: everything at once, then jump somewhere random. */
export function exploreShuffle(){
  rollGenres();
  rollTempo();
  INNER_TABS.forEach(exploreRollPanel);
  const dest = rand(INNER_TABS);
  const btns = document.querySelectorAll('.tab-inner-tab');
  switchInnerTab(dest, btns[INNER_TABS.indexOf(dest)] || null);
}
