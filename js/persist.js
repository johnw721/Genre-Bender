/* ============================================================
   persist.js — session persistence.

   Before this module, a refresh wiped everything: selected
   genres, the blend, generated tab/chart/phrase, tempo, swing.
   Now a snapshot of that state is saved to localStorage (debounced
   by change detection, every 2s + on page unload) and restored at
   boot, re-rendering each panel through the same render functions
   the generators use.

   What's persisted: store.selected / blendData / guitarTabData /
   pianoChordData / phraseData, BPM, swing, and the generator form
   controls (keys, styles, counts). Trainer progress persists
   separately (trainersrs.js); AI credentials live in api.js.
   ============================================================ */
import { store } from './store.js';
import { syncUI } from './library.js';
import { setBPM, getBPM } from './metronome.js';
import { setSwing, getSwing } from './swing.js';
import { renderResult } from './blend.js';
import { renderGuitarTab } from './guitar.js';
import { renderPianoChart } from './piano.js';
import { restorePhraseView } from './composer.js';
import { updateComposeBanner } from './sequencer.js';

const SESSION_KEY = 'GenreBenderSession_v1';

/* Form controls worth remembering across sessions. */
const FORM_IDS = [
  'guitar-key', 'guitar-style', 'guitar-chord-count',
  'piano-key', 'piano-style', 'piano-chord-count',
  'composer-key', 'composer-density', 'composer-position',
  'composer-voicing', 'composer-bars',
];

const $ = (id) => document.getElementById(id);

function snapshot(){
  const forms = {};
  FORM_IDS.forEach(id => { const el = $(id); if (el) forms[id] = el.value; });
  return JSON.stringify({
    v: 1,
    selected: store.selected,
    blendData: store.blendData,
    guitarTabData: store.guitarTabData,
    pianoChordData: store.pianoChordData,
    phraseData: store.phraseData,
    bpm: getBPM(),
    swing: getSwing(),
    forms,
  });
}

let lastSaved = '';
export function saveSession(){
  try {
    const s = snapshot();
    if (s === lastSaved) return;
    localStorage.setItem(SESSION_KEY, s);
    lastSaved = s;
  } catch { /* quota / private mode — persistence is best-effort */ }
}

export function restoreSession(){
  let s;
  try { s = JSON.parse(localStorage.getItem(SESSION_KEY)); }
  catch { return; }
  if (!s || s.v !== 1) return;

  /* form controls first — panel renders read them */
  Object.entries(s.forms || {}).forEach(([id, v]) => {
    const el = $(id);
    if (el && v != null){
      el.value = v;
      if (el.dispatchEvent && typeof Event !== 'undefined') el.dispatchEvent(new Event('input'));
    }
  });

  if (Array.isArray(s.selected) && s.selected.length){
    store.selected.length = 0;
    s.selected.forEach(x => {
      if (x && x.name) store.selected.push({ name: String(x.name), ratio: +x.ratio || 50 });
    });
    store.selected.forEach((sel, i) => {           // relight the chips
      try {
        const chip = document.querySelector(`.chip[data-genre="${CSS.escape(sel.name)}"]`);
        if (chip){ chip.classList.add('selected'); chip.setAttribute('aria-pressed', 'true'); chip.dataset.idx = i + 1; }
      } catch { /* chips not built / headless */ }
    });
    syncUI();
  }

  if (Number.isFinite(+s.bpm)){
    const sl = $('bpm-slider');
    if (sl) sl.value = s.bpm;
    setBPM(s.bpm);
  }
  if (Number.isFinite(+s.swing)){
    const sw = $('swing-slider');
    if (sw) sw.value = s.swing;
    setSwing(s.swing);
  }

  /* re-render generated content through the real render paths;
     each guarded so one bad blob can't take down boot */
  if (s.blendData){
    store.blendData = s.blendData;
    try { renderResult(s.blendData); } catch (e) { console.error('restore blend:', e); }
  }
  if (s.guitarTabData){
    store.guitarTabData = s.guitarTabData;
    try { renderGuitarTab(s.guitarTabData, ($('guitar-style') || {}).value || 'chord_progression'); }
    catch (e) { console.error('restore guitar:', e); }
  }
  if (s.pianoChordData){
    store.pianoChordData = s.pianoChordData;
    try { renderPianoChart(s.pianoChordData, ($('piano-style') || {}).value || 'chord_voicings'); }
    catch (e) { console.error('restore piano:', e); }
  }
  if (s.phraseData){
    store.phraseData = s.phraseData;
    try { restorePhraseView(); } catch (e) { console.error('restore phrase:', e); }
  }
  try { updateComposeBanner(); } catch { /* no data yet */ }
  lastSaved = snapshot();
}

export function clearSession(){
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  lastSaved = '';
}

export function initPersistence(){
  restoreSession();
  setInterval(saveSession, 2000);
  if (typeof window !== 'undefined' && window.addEventListener){
    window.addEventListener('beforeunload', saveSession);
  }
}
