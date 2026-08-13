/* ============================================================
   trainerexplore.js — free-exploration sandbox views for the
   Shape Trainer. Every drill mode can flip from quiz to explore:
   no right/wrong, no SRS — just the fret-entry element (from
   Number→Shape) front and center, live-identifying whatever you
   punch in: chord name, Roman numeral in the chosen key, and
   in/out-of-scale, drawn on the layered fretboard.

   Each mode adds its own controls that auto-fill the frets so
   you can browse instead of type:

     s2n   degree chips — click I..vii° to load its book voicing
     n2s   pure freeform — key + frets, live readout
     mv    movable barre — family/quality selects + a fret slider
     prog  progression stepper — template select + chord chips
     sc    scale-box picker — pent/full + neck position

   Shared vocabulary comes from theorydata.js (no import cycle
   with trainer.js).
   ============================================================ */
import { diatonicChords, keyInfo, scalePcs, pentPcs } from './scales.js';
import { getVoicing, parseChordName, E_SHAPES, A_SHAPES } from './chordbook.js';
import { layeredFretSVG, windowFor } from './fretdiagram.js';
import { detectChordAndKey } from './fretchords.js';
import { STRING_OPEN_MIDI, midiToHz, pcToName } from './theory.js';
import { playChordNow, playNote, getCtx } from './audio.js';
import { makeLooper } from './loopscheduler.js';
import { escHtml } from './util.js';
import {
  KEYS, romansFor, keyLabel, MV_QUALS, MV_SUFFIX, MV_QUAL_LABEL,
  SC_CENTERS, PROG_TEMPLATES, scaleNotesWindow
} from './theorydata.js';
import { syncKey } from './keysync.js';

const $ = (id) => document.getElementById(id);

/* ---- sandbox state ---------------------------------------- */
let exMode = 'n2s';
let exKey = 'C';
let mv = { fam: 'E', qual: 'maj', fret: 3 };
let progIdx = 0;
let sc = { type: 'pent', center: 2 };
let layersFn = () => ({ chord: true, scale: true });
let looper = null;

/* trainer.js hands us its layer-toggle state getter at boot. */
export function configureExplore(getLayers){ layersFn = getLayers; }

/* ---- fret input handling ----------------------------------- */
function readFrets(){
  const frets = [], midis = [];
  for (let i = 0; i < 6; i++){
    const el = $('explore-fret-' + i);
    const raw = (el ? el.value : '').trim().toLowerCase();
    if (raw === '' || raw === 'x' || raw === '-'){ frets.push(null); continue; }
    const f = parseInt(raw, 10);
    if (Number.isNaN(f) || f < 0 || f > 24){ frets.push(null); continue; }
    frets.push(f);
    midis.push(STRING_OPEN_MIDI[i] + f);
  }
  return { frets, midis };
}
function setFrets(frets){
  for (let i = 0; i < 6; i++){
    const el = $('explore-fret-' + i);
    if (!el) continue;
    const v = frets ? frets[i] : null;
    el.value = (v === null || v === undefined) ? 'x' : String(v);
  }
}

/* ---- analysis ----------------------------------------------- */
/* Which diatonic degree (if any) do these pitches spell in exKey? */
function degreeOf(key, midis){
  if (!midis.length) return null;
  const pcs = new Set(midis.map(m => ((m % 12) + 12) % 12));
  const names = diatonicChords(key);
  const romans = romansFor(key);
  for (let d = 0; d < 7; d++){
    const p = parseChordName(names[d]);
    if (!p) continue;
    const tri = new Set([p.rootPc % 12, (p.rootPc + p.intervals[1]) % 12, (p.rootPc + p.intervals[2]) % 12]);
    const allIn = [...pcs].every(pc => tri.has(pc));
    if (allIn && pcs.has(p.rootPc % 12) && pcs.has((p.rootPc + p.intervals[1]) % 12)){
      return { deg: d, name: names[d], roman: romans[d] };
    }
  }
  return null;
}

function readoutHTML(){
  const { midis } = readFrets();
  if (!midis.length){
    return 'Type frets (x or blank = muted) — or use the controls above to load a shape.';
  }
  const parts = [];
  const det = detectChordAndKey(midis);
  parts.push(`chord: <strong>${escHtml(det ? det.symbol : '?')}</strong>`);
  const d = degreeOf(exKey, midis);
  parts.push(d
    ? `degree: <strong>${escHtml(d.roman)}</strong> of ${escHtml(keyLabel(exKey))}`
    : `not a diatonic triad in ${escHtml(keyLabel(exKey))}`);
  const type = exMode === 'sc' ? sc.type : 'full';
  const set = new Set(type === 'pent' ? pentPcs(exKey) : scalePcs(exKey));
  const outside = midis.filter(m => !set.has(((m % 12) + 12) % 12)).length;
  parts.push(outside === 0
    ? `all notes in ${type === 'pent' ? 'the pentatonic' : 'the scale'}`
    : `<strong>${outside}</strong> note${outside > 1 ? 's' : ''} outside ${type === 'pent' ? 'the pentatonic' : 'the scale'}`);
  if (det && det.noteNames) parts.push(escHtml(det.noteNames.join(' ')));
  return parts.join(' &nbsp;·&nbsp; ');
}

/* ---- diagram + readout redraw ------------------------------- */
export function redrawExploreDiagrams(){
  const c = $('trainer-diagrams');
  if (!c) return;
  const layers = layersFn();
  const { frets } = readFrets();
  const hasFrets = frets.some(f => f !== null);
  let win;
  if (exMode === 'sc'){
    win = { lo: Math.max(0, sc.center - 1), hi: sc.center + 4 };
    if (hasFrets){
      const w2 = windowFor(frets, null);
      win = { lo: Math.min(win.lo, w2.lo), hi: Math.max(win.hi, w2.hi) };
    }
  } else {
    win = windowFor(hasFrets ? frets : null, null);
  }
  const type = exMode === 'sc' ? sc.type : 'full';
  const scaleNotes = layers.scale ? scaleNotesWindow(exKey, type, win.lo, win.hi) : null;
  c.innerHTML = `<div class="trainer-diagram">
      ${layeredFretSVG({
        chordFrets: hasFrets ? frets : null,
        scaleNotes,
        window: win,
        showChord: layers.chord && hasFrets,
        showScale: !!scaleNotes,
      })}
      <div class="trainer-diagram-label">${hasFrets ? 'your shape' : ''}</div>
    </div>`;
  const r = $('trainer-explore-readout');
  if (r) r.innerHTML = readoutHTML();
}

/* ---- controls markup ----------------------------------------- */
function keySelectHTML(){
  return `<label class="trainer-ex-ctl">key
      <select class="tab-style-select" onchange="exploreSetKey(this.value)">
        ${KEYS.map(k => `<option value="${k}"${k === exKey ? ' selected' : ''}>${escHtml(keyLabel(k))}</option>`).join('')}
      </select></label>`;
}
function progChords(){
  const tpls = PROG_TEMPLATES[keyInfo(exKey).mode];
  const t = tpls[Math.min(progIdx, tpls.length - 1)];
  return { tpl: t, chords: t.deg.map(d => diatonicChords(exKey)[d]) };
}
function extraControlsHTML(){
  if (exMode === 's2n'){
    return romansFor(exKey).map((r, i) =>
      `<button class="fret-chord trainer-ex-chip" onclick="exploreLoadDegree(${i})">${escHtml(r)}</button>`).join('');
  }
  if (exMode === 'mv'){
    return `
      <label class="trainer-ex-ctl">shape
        <select class="tab-style-select" onchange="exploreMv('fam', this.value)">
          <option value="E"${mv.fam === 'E' ? ' selected' : ''}>E-shape</option>
          <option value="A"${mv.fam === 'A' ? ' selected' : ''}>A-shape</option>
        </select></label>
      <label class="trainer-ex-ctl">quality
        <select class="tab-style-select" onchange="exploreMv('qual', this.value)">
          ${MV_QUALS.map(q => `<option value="${q}"${q === mv.qual ? ' selected' : ''}>${MV_QUAL_LABEL[q]}</option>`).join('')}
        </select></label>
      <label class="trainer-ex-ctl">fret
        <input type="range" min="1" max="11" step="1" value="${mv.fret}" oninput="exploreMv('fret', this.value)">
        <span id="trainer-ex-mv-name" class="trainer-ex-name"></span></label>`;
  }
  if (exMode === 'prog'){
    const tpls = PROG_TEMPLATES[keyInfo(exKey).mode];
    const { chords } = progChords();
    return `
      <label class="trainer-ex-ctl">progression
        <select class="tab-style-select" onchange="exploreSetProg(this.value)">
          ${tpls.map((t, i) => `<option value="${i}"${i === progIdx ? ' selected' : ''}>${escHtml(t.name)}</option>`).join('')}
        </select></label>
      ${chords.map((n, j) =>
        `<button class="fret-chord trainer-ex-chip" onclick="exploreLoadProgChord(${j})">${escHtml(n)}</button>`).join('')}`;
  }
  if (exMode === 'sc'){
    return `
      <label class="trainer-ex-ctl">scale
        <select class="tab-style-select" onchange="exploreSetScale('type', this.value)">
          <option value="pent"${sc.type === 'pent' ? ' selected' : ''}>pentatonic</option>
          <option value="full"${sc.type === 'full' ? ' selected' : ''}>full scale</option>
        </select></label>
      <label class="trainer-ex-ctl">position
        <select class="tab-style-select" onchange="exploreSetScale('center', this.value)">
          ${SC_CENTERS.map(c => `<option value="${c}"${c === sc.center ? ' selected' : ''}>around fret ${c}</option>`).join('')}
        </select></label>`;
  }
  return '';   // n2s: pure freeform
}

const EX_TITLE = {
  s2n:  'Browse the degrees',
  n2s:  'Freeform shapes',
  mv:   'Move a barre shape',
  prog: 'Walk a progression',
  sc:   'Explore scale boxes',
};
const EX_HINT = {
  s2n:  'Click a numeral to load its book voicing into the frets — then bend it and watch the readout.',
  n2s:  'Type any shape; the readout names the chord, its degree in the key, and flags out-of-scale notes.',
  mv:   'Slide the fret and swap quality — same shape, new chord. The frets update live.',
  prog: 'Step through the chords of a progression, or play the whole thing. Edit any shape you land on.',
  sc:   'Pick a box, hear it, and type shapes inside it — the readout tells you what stays in the scale.',
};

/* ---- main render --------------------------------------------- */
export function renderExplore(mode){
  exMode = mode === 'mixed' ? 'n2s' : mode;
  const q = $('trainer-question'), a = $('trainer-answers'), f = $('trainer-feedback');
  if (!q) return;
  exploreStopProg();
  const cells = ['E','A','D','G','B','e'].map((s, i) =>
    `<label class="fret-cell"><span>${s}</span><input id="explore-fret-${i}" type="text" inputmode="numeric" maxlength="2" placeholder="x" aria-label="${s} string fret" oninput="exploreFretInput()"></label>`).join('');
  q.innerHTML = `
    <div class="trainer-prompt">${escHtml(EX_TITLE[exMode])}
      <span class="trainer-hint">${escHtml(EX_HINT[exMode])}</span></div>
    <div class="trainer-ex-controls">${keySelectHTML()}${extraControlsHTML()}</div>
    <div class="trainer-diagrams" id="trainer-diagrams"></div>
    <div class="trainer-readout" id="trainer-explore-readout" aria-live="polite"></div>`;
  a.innerHTML = `
    <div class="fret-inputs" role="group" aria-label="Explore frets, low E to high e">${cells}</div>
    <button class="pb-btn" type="button" onclick="explorePlayShape()">▶ hear shape</button>
    ${exMode === 'sc' ? `<button class="pb-btn" type="button" onclick="explorePlayBox()">▶ hear the box</button>` : ''}
    ${exMode === 'prog' ? `<button class="pb-btn" type="button" onclick="explorePlayProg()">▶ play progression</button>
      <button class="pb-btn stop-btn" type="button" onclick="exploreStopProg()">■</button>` : ''}
    <button class="pb-btn" type="button" onclick="exploreClearFrets()">clear</button>`;
  if (f){ f.className = 'trainer-feedback'; f.innerHTML = ''; }

  /* seed each sandbox with something to look at */
  if (exMode === 'mv') loadMvShape(false);
  else if (exMode === 's2n') exploreLoadDegree(0, false);
  else if (exMode === 'prog') exploreLoadProgChord(0, false);
  else setFrets(null);
  redrawExploreDiagrams();
}

/* ---- handlers (window-bridged) -------------------------------- */
export function exploreFretInput(){ redrawExploreDiagrams(); }

export function exploreSetKey(v){
  setExploreKey(v);
  syncKey(exKey, 'trainer-explore');     // keep the app's other key selects in step
}

/* Key change without echoing back to keysync (used BY keysync). */
export function setExploreKey(v){
  if (!KEYS.includes(v) || v === exKey) return;
  exKey = v;
  /* degree chips and progression templates depend on the key's mode */
  if ($('trainer-explore-readout')){
    if (exMode === 's2n' || exMode === 'prog'){ progIdx = 0; renderExplore(exMode); return; }
    redrawExploreDiagrams();
  }
}

export function exploreLoadDegree(d, play = true){
  const name = diatonicChords(exKey)[d];
  if (!name) return;
  const v = getVoicing(name);
  if (v) setFrets(v.frets);
  document.querySelectorAll('.trainer-ex-chip').forEach((el, k) => el.classList.toggle('selected', k === d));
  redrawExploreDiagrams();
  if (play && v) playChordNow(v.midis.map(midiToHz));
}

function mvChordName(){ return pcToName(((mv.fam === 'E' ? 4 : 9) + mv.fret) % 12) + MV_SUFFIX[mv.qual]; }
function loadMvShape(play){
  const shape = (mv.fam === 'E' ? E_SHAPES : A_SHAPES)[mv.qual];
  const frets = shape(mv.fret);
  setFrets(frets);
  redrawExploreDiagrams();
  const lbl = $('trainer-ex-mv-name');
  if (lbl) lbl.textContent = `= ${mvChordName()}`;
  if (play){
    const midis = [];
    frets.forEach((f, s) => { if (f !== null) midis.push(STRING_OPEN_MIDI[s] + f); });
    playChordNow(midis.map(midiToHz));
  }
}
export function exploreMv(part, val){
  if (part === 'fret') mv.fret = Math.max(1, Math.min(11, parseInt(val, 10) || 1));
  else if (part === 'fam') mv.fam = val === 'A' ? 'A' : 'E';
  else if (part === 'qual') mv.qual = MV_QUALS.includes(val) ? val : 'maj';
  loadMvShape(true);
}

export function exploreSetProg(i){
  progIdx = Math.max(0, parseInt(i, 10) || 0);
  renderExplore('prog');
}
export function exploreLoadProgChord(j, play = true){
  const { chords } = progChords();
  const name = chords[j];
  if (!name) return;
  const v = getVoicing(name);
  if (v) setFrets(v.frets);
  document.querySelectorAll('.trainer-ex-chip').forEach((el, k) => el.classList.toggle('selected', k === j));
  redrawExploreDiagrams();
  if (play && v) playChordNow(v.midis.map(midiToHz));
}
function getLooper(){
  if (looper) return looper;
  looper = makeLooper({
    swing: false,
    onStep(i){
      document.querySelectorAll('.trainer-ex-chip').forEach((el, k) => el.classList.toggle('selected', k === i));
    },
    onStop(){},
  });
  return looper;
}
export function explorePlayProg(){
  const { chords } = progChords();
  const freqs = chords.map(n => { const v = getVoicing(n); return v ? v.midis.map(midiToHz) : []; });
  getLooper().start(freqs.map(f => ({ freqs: f, beats: 2 })), { beatsPerChord: 2, mode: 'chord', loop: false });
}
export function exploreStopProg(){ if (looper) looper.stop(); }

export function exploreSetScale(part, val){
  if (part === 'type') sc.type = val === 'full' ? 'full' : 'pent';
  else sc.center = parseInt(val, 10) || 2;
  redrawExploreDiagrams();
}
export function explorePlayBox(){
  const notes = scaleNotesWindow(exKey, sc.type, Math.max(0, sc.center - 1), sc.center + 4);
  if (!notes.length) return;
  const ctx = getCtx();
  const t0 = ctx.currentTime + 0.05;
  [...notes].sort((a, b) => a.midi - b.midi)
    .forEach((n, i) => playNote(midiToHz(n.midi), t0 + i * 0.13, 0.3, 0.14));
}

export function explorePlayShape(){
  const { midis } = readFrets();
  if (midis.length) playChordNow(midis.map(midiToHz));
}
export function exploreClearFrets(){
  for (let i = 0; i < 6; i++){
    const el = $('explore-fret-' + i);
    if (el) el.value = '';
  }
  redrawExploreDiagrams();
}
