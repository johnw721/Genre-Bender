/* ============================================================
   midiin.js — Web MIDI input.

   Play chords on a MIDI keyboard (or any controller) and Genre
   Bender names them live: chord symbol (fretchords.detectChordAndKey,
   Tonal-backed), its degree in the app key, the held notes, and the
   device. The last chord you held stays "captured" after you let go,
   so "+ My chords" / "+ chord table" add what you just played.
   "auto-add" drops every captured chord onto the active My-chords
   track as you play — a quick way to transcribe a clip by ear.

   The sustain pedal (CC 64) keeps released keys in the chord until
   it lifts. "monitor" sounds the notes through the app's own synth
   (off by default — most keyboards make their own sound).

   Web MIDI is Chromium-only (Chrome / Edge / Opera, desktop and
   Android). Safari and every iOS browser don't implement it, so the
   card says so instead of failing silently.
   ============================================================ */
import { detectChordAndKey } from './fretchords.js';
import { chordLabel } from './labels.js';
import { getAppKey } from './keysync.js';
import { getCtx, playNote } from './audio.js';
import { midiToHz, pcToName } from './theory.js';
import { paletteAdd, redrawPalette } from './chordpalette.js';
import { trainerAddChordFromOutside } from './trainer.js';
import { registerActions } from './actions.js';
import { registerStore, loadJSON, saveJSON } from './storage.js';

const $ = (id) => document.getElementById(id);
const PREFS_KEY = registerStore('midiIn', 'GenreBenderMidiIn_v1');

let access = null;
let enabled = false;
const held = new Set();        // keys physically down
const sustained = new Set();   // released while the pedal was down
let pedal = false;
let captured = null;           // last detected chord { symbol, noteNames }
let lastAdded = null;          // symbol auto-added most recently (avoid duplicates per hold)
let detectTimer = null;
let prefs = { monitor: false, auto: false };

const noteName = (m) => pcToName(m % 12) + (Math.floor(m / 12) - 1);
const sounding = () => [...new Set([...held, ...sustained])].sort((a, b) => a - b);

export function midiSupported(){ return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function'; }

function setStatus(msg){ const el = $('midi-status'); if (el) el.textContent = msg; }

function paintDevices(){
  const el = $('midi-device');
  if (!el) return;
  const inputs = access ? [...access.inputs.values()] : [];
  el.textContent = inputs.length
    ? inputs.map(i => i.name || 'MIDI input').join(' · ')
    : 'no device — plug one in';
}

function paint(){
  const notes = sounding();
  const live = notes.length >= 3 ? detectChordAndKey(notes) : null;
  const show = live || captured;
  const sym = $('midi-chord'), deg = $('midi-degree'), notesEl = $('midi-notes');
  if (sym) sym.textContent = show ? show.symbol : '—';
  if (sym) sym.classList.toggle('live', !!live);
  const key = getAppKey() || 'C';
  if (deg){
    const d = show ? chordLabel(show.symbol, key, 'degree') : '';
    deg.textContent = show && d && d !== show.symbol ? `${d} in ${key}` : (show ? `outside ${key}` : '');
  }
  if (notesEl) notesEl.textContent = notes.length ? notes.map(noteName).join(' ') : (captured ? 'captured — add it below' : 'hold 3+ notes');
  for (const id of ['midi-add-track', 'midi-add-table']){ const b = $(id); if (b) b.disabled = !captured; }
}

/* Debounced: a chord's notes arrive a few ms apart; name it once they've settled. */
function scheduleDetect(){
  clearTimeout(detectTimer);
  detectTimer = setTimeout(() => {
    const notes = sounding();
    if (notes.length >= 3 && new Set(notes.map(m => m % 12)).size >= 3){
      const r = detectChordAndKey(notes);
      if (r){
        captured = r;
        if (prefs.auto && r.symbol !== lastAdded){
          const t = trainerAddChordFromOutside(r.symbol);
          if (t){ lastAdded = r.symbol; setStatus(`added ${r.symbol} to "${t}"`); }
        }
      }
    }
    if (!notes.length) lastAdded = null;   // a new hold may re-add the same chord
    paint();
  }, 90);
}

function onMessage(e){
  const [status, d1, d2] = e.data || [];
  const cmd = status & 0xf0;
  if (cmd === 0x90 && d2 > 0){
    held.add(d1); sustained.delete(d1);
    if (prefs.monitor){ try { playNote(midiToHz(d1), getCtx().currentTime, 0.8, 0.06 + (d2 / 127) * 0.12); } catch {} }
  } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)){
    held.delete(d1);
    if (pedal) sustained.add(d1);
  } else if (cmd === 0xb0 && d1 === 64){
    pedal = d2 >= 64;
    if (!pedal) sustained.clear();
  } else return;
  scheduleDetect();
}

function attachInputs(){
  if (!access) return;
  for (const input of access.inputs.values()) input.onmidimessage = enabled ? onMessage : null;
  paintDevices();
}

async function enable(){
  const card = $('rail-midi');
  if (card) card.style.display = '';
  if (!midiSupported()){
    setStatus('Web MIDI isn’t available in this browser — Safari and iOS don’t support it. Use Chrome or Edge on a computer.');
    const d = $('midi-device'); if (d) d.textContent = 'unsupported';
    enabled = true; paintButton();
    return;
  }
  try {
    access = access || await navigator.requestMIDIAccess({ sysex: false });
    access.onstatechange = attachInputs;
    enabled = true;
    attachInputs();
    setStatus('');
  } catch (e) {
    setStatus('MIDI access was blocked — allow it in the browser’s site settings and try again.');
    enabled = false;
  }
  paintButton();
  paint();
}

function disable(){
  enabled = false;
  attachInputs();
  held.clear(); sustained.clear(); pedal = false;
  const card = $('rail-midi');
  if (card) card.style.display = 'none';
  paintButton();
}

function paintButton(){
  const btn = $('midi-btn');
  if (!btn) return;
  btn.classList.toggle('on', enabled);
  btn.setAttribute('aria-pressed', String(enabled));
}

function savePrefs(){ saveJSON(PREFS_KEY, prefs); }

export function initMidiIn(){
  const p = loadJSON(PREFS_KEY, null);
  if (p) prefs = { ...prefs, ...p, monitor: !!p.monitor, auto: !!p.auto };
  const mon = $('midi-monitor'), auto = $('midi-auto');
  if (mon) mon.checked = prefs.monitor;
  if (auto) auto.checked = prefs.auto;
  registerActions({
    'midi:toggle': () => (enabled ? disable() : enable()),
    'midi:add-track': () => {
      if (!captured) return;
      const t = trainerAddChordFromOutside(captured.symbol);
      setStatus(t ? `added ${captured.symbol} to "${t}"` : 'no track to add to');
    },
    'midi:add-table': () => {
      if (!captured) return;
      const ok = paletteAdd(captured.symbol);
      try { redrawPalette(); } catch {}
      setStatus(ok ? `${captured.symbol} is on the chord table` : `${captured.symbol} is already on the table`);
    },
    'midi:clear': () => { captured = null; setStatus(''); paint(); },
    'midi:monitor': (el) => { prefs.monitor = !!el.checked; savePrefs(); },
    'midi:auto': (el) => { prefs.auto = !!el.checked; savePrefs(); },
  });
}

/* Test hook (build verifier): feed raw MIDI bytes as if a device sent them. */
export function _midiFeed(bytes){ onMessage({ data: bytes }); }
export function _midiFlush(){ clearTimeout(detectTimer); detectTimer = null; const n = sounding(); if (n.length >= 3){ captured = detectChordAndKey(n); } paint(); return captured; }
export function _midiCaptured(){ return captured ? { ...captured } : null; }
