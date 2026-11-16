/* ============================================================
   keysync.js — one "current key" across the whole bench.

   Guitar, piano, composer and the trainer's explore sandbox each
   have a key selector over the same 10 keys. Changing any of them
   updates all the others, so "work in G" is one click, not four.
   The trainer QUIZ is deliberately excluded — its questions roam
   keys on purpose.

   The circular import with trainerexplore.js is runtime-only
   (calls happen inside handlers, never at module evaluation).
   ============================================================ */
import { setExploreKey } from './trainerexplore.js';

// palette-key (chord table) and colormap-key (color map) live inside the
// trainer's My chords view, so they're mirrored only while it's on screen.
const KEY_SELECT_IDS = ['rail-key', 'guitar-key', 'piano-key', 'composer-key', 'palette-key', 'colormap-key'];

let currentKey = null;

export function getAppKey(){ return currentKey; }

/* Views that render from the app key without owning a mirrored <select>
   (e.g. the color map) subscribe here instead of being listed above. */
const listeners = [];
export function onAppKeyChange(fn){ if (typeof fn === 'function') listeners.push(fn); }

/* Called after persistence restores the generator selects: pick up the
   guitar key as the app key so every mirror (rail included) agrees. */
export function initKeySync(){
  const el = document.getElementById('guitar-key');
  if (el && el.value) syncKey(el.value, 'guitar-key');
}

/* Called from any key <select> (onchange) or the explore sandbox.
   sourceId identifies the caller so we don't write back into it. */
export function syncKey(key, sourceId){
  if (!key) return;
  currentKey = key;
  KEY_SELECT_IDS.forEach(id => {
    if (id === sourceId) return;
    const el = document.getElementById(id);
    if (!el || el.value === key) return;
    const options = el.options ? [...el.options] : [];
    if (!options.length || options.some(o => o.value === key)) el.value = key;
  });
  if (sourceId !== 'trainer-explore') setExploreKey(key);
  // Every listener hears every change (the color map's own included) with
  // its source, so a listener that caused the change can skip it.
  listeners.forEach(fn => { try { fn(key, sourceId); } catch (e) { console.error('keysync listener:', e); } });
}
