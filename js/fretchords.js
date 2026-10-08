/* ============================================================
   fretchords.js — "frets in, progressions out".

   Type six fret numbers (one per string, low E -> high e,
   'x' = muted, 0 = open) and this builds a chord out of the
   pitches, infers a likely key, and generates two-or-more
   chord progressions IN REAL TIME — pure music-theory math,
   no AI and no network. A small mode switch lets you pick the
   flavour: common diatonic patterns, patterns biased toward the
   genres selected in the mixer, or a contrasting mix of moods.

   Clicking any generated chord opens a fingering viewport: it
   resolves the chord to a real playable guitar voicing (via the
   chord book), draws a chord-box diagram, and plays that shape.

   Playback reuses the app's existing Web Audio chord voice.
   ============================================================ */
import { STRING_OPEN_MIDI, pcToName, midiToHz } from './theory.js';
import { playChordNow } from './audio.js';
import { store } from './store.js';
import { escHtml } from './util.js';
import { getVoicing, parseChordName, withQuality, QUALITY_LABELS } from './chordbook.js';
import { makeLooper } from './loopscheduler.js';
import { fretLabel, chordLabel, showingNotes, noteAt } from './labels.js';

/* ---- scales & constants ---------------------------------- */
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];          // natural minor (Aeolian)
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e']; // low -> high

/* Module state: the progressions currently on screen, the voicing
   shown in the fingering viewport (so its "play shape" button can
   replay), the index of the progression that's playing, and which
   progressions have their per-row loop toggle switched on. */
let currentProgs = [];
let currentKey = 'C';              // key the on-screen progressions are in
let lastVoiceFreqs = null;
let lastShownName = null;         // chord currently in the fingering viewport
let lastShownIdx = null;          // [progIdx, chordIdx] of the selected chip
let activeProgIdx = -1;
const progLoop = {};               // progression index -> loop on?
let lastDetect = null;             // last detectChordAndKey() result, for re-labelling

/* Paint the detected-chord line. Split out so the notation toggles can
   re-label it (the chord symbol follows the names/degrees switch). */
function updateDetectReadout(){
  const detect = document.getElementById('fret-detect');
  if (!detect) return;
  if (!lastDetect){ detect.innerHTML = ''; return; }
  const info = lastDetect;
  const keyName = pcToName(info.keyPc) + (info.isMinor ? ' minor' : ' major');
  detect.innerHTML =
    `<span class="fret-chip-name" title="${escHtml(info.symbol)}">${escHtml(chordLabel(info.symbol, currentKey))}</span>` +
    `<span class="fret-detect-key">key of ${escHtml(keyName)}</span>` +
    `<span class="fret-detect-notes">${info.noteNames.map(escHtml).join(' ')}</span>`;
}

/* ---- fret reading ---------------------------------------- */
/* Read the six inputs into { midis:[], tokens:[] }.
   tokens keep the raw 'x'/number for display; midis are the
   sounding pitches of the non-muted strings (low -> high). */
function readFrets(){
  const midis = [], tokens = [];
  for (let i = 0; i < 6; i++){
    const el = document.getElementById('fret-' + i);
    const raw = (el ? el.value : '').trim().toLowerCase();
    if (raw === '' || raw === 'x' || raw === '-'){
      tokens.push('x');
      continue;
    }
    const f = parseInt(raw, 10);
    if (Number.isNaN(f) || f < 0 || f > 24){
      tokens.push('?');
      continue;
    }
    tokens.push(String(f));
    midis.push(STRING_OPEN_MIDI[i] + f);
  }
  return { midis, tokens };
}

/* ---- chord + key detection ------------------------------- */
/* Turn the sounding MIDI notes into a chord symbol + an inferred
   key { rootPc, isMinor }. Uses Tonal when present, with a plain
   fallback so the feature still works if the CDN fails.
   Exported for reuse by the trainer's explore sandbox. */
export function detectChordAndKey(midis){
  if (!midis.length) return null;
  const sorted = [...midis].sort((a, b) => a - b);
  const noteNames = sorted.map(m => pcToName(((m % 12) + 12) % 12) + (Math.floor(m / 12) - 1));
  const bassPc = ((sorted[0] % 12) + 12) % 12;

  let symbol = '', keyPc = bassPc, isMinor = false, quality = '';
  const T = window.Tonal;
  try {
    if (T && T.Chord && typeof T.Chord.detect === 'function'){
      const hits = T.Chord.detect(noteNames) || [];
      if (hits.length){
        // Tonal labels a plain major triad "CM" / "C/E" — tidy to "C".
        symbol = hits[0].replace(/M(?![a-z0-9#b])/, '');
        const info = T.Chord.get(symbol);
        if (info && info.tonic){
          keyPc = nameToPcSafe(info.tonic, bassPc);
          quality = info.quality || '';
          isMinor = /Minor|Diminished/.test(quality);
        }
      }
    }
  } catch { /* fall through to heuristic */ }

  if (!symbol){
    // Heuristic: bass is the root; minor if a minor third is present.
    const pcs = new Set(sorted.map(m => ((m % 12) + 12) % 12));
    isMinor = pcs.has((bassPc + 3) % 12) && !pcs.has((bassPc + 4) % 12);
    symbol = pcToName(bassPc) + (isMinor ? 'm' : '');
    keyPc = bassPc;
  }

  return { symbol, keyPc, isMinor, quality, noteNames };
}

function nameToPcSafe(name, fallback){
  const map = { C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11 };
  const key = name.replace('♭', 'b').replace('♯', '#');
  return key in map ? map[key] : fallback;
}

/* ---- diatonic chord builder ------------------------------ */
/* Build the diatonic chord on `degree` (1..7) of the key.
   Quality (major/minor/dim/aug, plus optional 7th flavour) is
   derived from the actual scale intervals, so the same call works
   for major and minor keys. Returns name, romanLabel, and a set
   of playback frequencies (with an added octave-down bass note). */
function degSemi(scale, i){
  const idx = ((i % 7) + 7) % 7;
  return scale[idx] + 12 * Math.floor(i / 7);
}

function diatonicChord(keyPc, keyMinor, degree, seventh){
  const scale = keyMinor ? MINOR : MAJOR;
  const i0 = degree - 1;
  const rSemi = degSemi(scale, i0);
  const thirdIv = degSemi(scale, i0 + 2) - rSemi;
  const fifthIv = degSemi(scale, i0 + 4) - rSemi;
  const rootPc = (keyPc + rSemi) % 12;

  const intervals = [0, thirdIv, fifthIv];
  let suffix = '';
  if      (thirdIv === 4 && fifthIv === 7) suffix = '';
  else if (thirdIv === 3 && fifthIv === 7) suffix = 'm';
  else if (thirdIv === 3 && fifthIv === 6) suffix = 'dim';
  else if (thirdIv === 4 && fifthIv === 8) suffix = 'aug';

  if (seventh){
    const sevIv = degSemi(scale, i0 + 6) - rSemi;
    intervals.push(sevIv);
    if      (suffix === '')    suffix = sevIv === 11 ? 'maj7' : '7';
    else if (suffix === 'm')   suffix = sevIv === 10 ? 'm7' : 'mMaj7';
    else if (suffix === 'dim') suffix = sevIv === 10 ? 'm7b5' : 'dim7';
  }

  // Roman numeral reflecting quality.
  let roman = ROMAN[degree - 1];
  if (thirdIv === 3) roman = roman.toLowerCase();
  if (fifthIv === 6) roman += '°';
  if (seventh)       roman += '7';

  // Voice the root around C3..B3, stack chord tones, add low octave.
  const rootMidi = 48 + rootPc;
  const freqs = [midiToHz(rootMidi - 12), ...intervals.map(iv => midiToHz(rootMidi + iv))];

  return { name: pcToName(rootPc) + suffix, roman, freqs };
}

/* ---- progression templates ------------------------------- */
/* Each template is degrees in the key + whether to use 7ths. */
const DIATONIC_TEMPLATES = [
  { label: 'Pop axis',      degrees: [1, 5, 6, 4], seventh: false },
  { label: 'Doo-wop / 50s', degrees: [1, 6, 4, 5], seventh: false },
  { label: 'ii–V–I cadence', degrees: [2, 5, 1],   seventh: true  },
  { label: 'Three-chord',   degrees: [1, 4, 5],    seventh: false },
];
const MINOR_TEMPLATES = [
  { label: 'Epic minor',     degrees: [1, 6, 3, 7], seventh: false },
  { label: 'Minor cadence',  degrees: [1, 4, 5],    seventh: false },
  { label: 'ii–V–i (jazz)',  degrees: [2, 5, 1],    seventh: true  },
  { label: 'Andalusian-ish', degrees: [1, 7, 6, 7], seventh: false },
];

/* Genre -> characteristic templates. Degrees are interpreted in
   whatever key was detected, so quality stays diatonic. Covers the
   catalog in config.js; anything unmapped falls back to diatonic. */
const GENRE_TEMPLATES = {
  'Lo-fi hip-hop': { label: 'ii–V lo-fi',    degrees: [2, 5, 1, 6], seventh: true },
  'Neo-soul':      { label: 'neo-soul',      degrees: [1, 4, 2, 5], seventh: true },
  'Boom bap':      { label: 'boom-bap loop', degrees: [6, 2, 5, 1], seventh: true },
  'Jazz':          { label: 'jazz turnaround', degrees: [1, 6, 2, 5], seventh: true },
  'Bebop':         { label: 'bebop ii–V–I',  degrees: [2, 5, 1],    seventh: true },
  'Bossa nova':    { label: 'bossa',         degrees: [1, 2, 5, 1], seventh: true },
  'Soul':          { label: 'soul',          degrees: [1, 4, 5, 4], seventh: true },
  'Gospel':        { label: 'gospel walk',   degrees: [1, 4, 1, 5], seventh: true },
  'Funk':          { label: 'funk vamp',     degrees: [1, 4],       seventh: true },
  'Fusion':        { label: 'fusion',        degrees: [2, 5, 1, 4], seventh: true },
  'House':         { label: 'house vamp',    degrees: [6, 4, 1, 5], seventh: true },
  'Synthwave':     { label: 'synthwave',     degrees: [6, 4, 1, 5], seventh: false },
  'Ambient':       { label: 'ambient drift', degrees: [1, 3, 4, 6], seventh: true },
  'Trance':        { label: 'trance lift',   degrees: [6, 4, 1, 5], seventh: false },
  'Drum & bass':   { label: 'dnb',           degrees: [1, 6, 4, 5], seventh: true },
  'Indie rock':    { label: 'indie',         degrees: [1, 5, 6, 4], seventh: false },
  'Shoegaze':      { label: 'shoegaze',      degrees: [1, 4, 6, 5], seventh: false },
  'Post-punk':     { label: 'post-punk',     degrees: [1, 7, 6, 7], seventh: false },
  'Dream pop':     { label: 'dream pop',     degrees: [1, 3, 4, 4], seventh: true },
  'Grunge':        { label: 'grunge',        degrees: [1, 4, 5, 4], seventh: false },
  'Emo':           { label: 'emo',           degrees: [1, 5, 6, 4], seventh: false },
  'Psychedelic':   { label: 'psych',         degrees: [1, 7, 4, 1], seventh: false },
  'Afrobeats':     { label: 'afrobeats',     degrees: [1, 4, 5, 4], seventh: false },
  'Reggaeton':     { label: 'reggaeton',     degrees: [6, 4, 1, 5], seventh: false },
  'Amapiano':      { label: 'amapiano',      degrees: [1, 5, 6, 4], seventh: true },
  'Flamenco':      { label: 'flamenco',      degrees: [1, 7, 6, 7], seventh: false },
  'Orchestral':    { label: 'cinematic',     degrees: [1, 6, 4, 5], seventh: false },
  'Neoclassical':  { label: 'neoclassical',  degrees: [1, 5, 6, 3], seventh: false },
  'Film score':    { label: 'film',          degrees: [1, 6, 4, 5], seventh: false },
  'Baroque':       { label: 'baroque',       degrees: [1, 4, 5, 1], seventh: false },
};

/* ---- progression assembly -------------------------------- */
function buildProgression(tpl, keyPc, keyMinor, source){
  const chords = tpl.degrees.map(d => diatonicChord(keyPc, keyMinor, d, tpl.seventh));
  return {
    label: tpl.label,
    source,
    key: pcToName(keyPc) + (keyMinor ? 'm' : ''),   // for degree labelling
    romans: chords.map(c => c.roman).join('–'),
    chords,
  };
}

function diatonicSet(keyPc, keyMinor){
  const tpls = keyMinor ? MINOR_TEMPLATES : DIATONIC_TEMPLATES;
  return tpls.map(t => buildProgression(t, keyPc, keyMinor, 'diatonic'));
}

function genreSet(keyPc, keyMinor){
  const picks = [];
  for (const sel of store.selected){
    const tpl = GENRE_TEMPLATES[sel.name];
    if (tpl) picks.push(buildProgression(tpl, keyPc, keyMinor, sel.name));
  }
  if (picks.length < 2){
    // top up with diatonic staples so there are always >=2
    for (const p of diatonicSet(keyPc, keyMinor)){
      if (picks.length >= 3) break;
      picks.push(p);
    }
  }
  return picks;
}

function moodSet(keyPc, keyMinor){
  const relMajorPc = (keyPc + (keyMinor ? 3 : 0)) % 12;        // bright pivot
  const relMinorPc = (keyPc + (keyMinor ? 0 : 9)) % 12;        // dark pivot
  const bright = buildProgression(DIATONIC_TEMPLATES[0], relMajorPc, false, 'bright / uplifting');
  const dark   = buildProgression(MINOR_TEMPLATES[0],   relMinorPc, true,  'dark / moody');
  const jazzy  = buildProgression(
    keyMinor ? MINOR_TEMPLATES[2] : DIATONIC_TEMPLATES[2],
    keyPc, keyMinor, 'jazzy / sophisticated');
  return [bright, dark, jazzy];
}

/* ---- main entry: recompute + render ---------------------- */
export function updateFretChords(){
  const out = document.getElementById('fret-output');
  const detect = document.getElementById('fret-detect');
  if (!out) return;

  const { midis } = readFrets();
  if (!midis.length){
    currentProgs = [];
    lastDetect = null;
    if (detect) detect.innerHTML = '';
    out.className = 'tab-output placeholder';
    out.innerHTML = 'Enter fret numbers above (use <code>x</code> for muted strings). Progressions appear as you type.';
    clearDiagram();
    return;
  }

  const info = detectChordAndKey(midis);
  const mode = (document.getElementById('fret-mode') || {}).value || 'diatonic';

  let progs;
  if (mode === 'genre')      progs = genreSet(info.keyPc, info.isMinor);
  else if (mode === 'moods') progs = moodSet(info.keyPc, info.isMinor);
  else                       progs = diatonicSet(info.keyPc, info.isMinor);
  currentProgs = progs;
  fretStop();                                 // chords changed: stop any playback
  for (const k in progLoop) delete progLoop[k];  // reset loop toggles

  // Header readout: detected chord + inferred key + entered notes.
  lastDetect = info;
  currentKey = pcToName(info.keyPc) + (info.isMinor ? 'm' : '');
  updateDetectReadout();

  renderProgs();
  clearDiagram();
}

/* Paint currentProgs into #fret-output. Split out of updateFretChords so the
   notation toggles can re-label the chips without recomputing progressions
   (which would stop playback and reset the loop switches). */
function renderProgs(){
  const out = document.getElementById('fret-output');
  if (!out) return;
  out.className = currentProgs.length ? 'tab-output has-content' : 'tab-output placeholder';
  out.innerHTML = currentProgs.map((p, i) => `
    <div class="fret-prog">
      <div class="fret-prog-head">
        <button class="pb-btn fret-play" onclick="fretToggleProg(${i})" id="fret-play-${i}">▶ play</button>
        <button class="pb-btn fret-loop" onclick="fretToggleLoop(${i})" id="fret-loop-${i}" title="Loop this progression" aria-pressed="false">⟳ loop</button>
        <span class="fret-prog-label">${escHtml(p.label)}</span>
        <span class="fret-prog-roman">${escHtml(p.romans)}</span>
        <span class="fret-prog-src">${escHtml(p.source)}</span>
      </div>
      <div class="fret-prog-chords">
        ${p.chords.map((c, j) =>
          `<button class="fret-chord" onclick="fretShowChord(${i},${j})" title="${escHtml(c.name)}">` +
          `${escHtml(chordLabel(c.name, p.key || currentKey))}</button>`
        ).join('')}
      </div>
    </div>`).join('');
  restoreProgButtonState();
  markSelectedChip();
}

/* Re-apply loop / playing state to freshly-rendered buttons. */
function restoreProgButtonState(){
  currentProgs.forEach((_, i) => {
    const lb = document.getElementById('fret-loop-' + i);
    if (lb){ lb.classList.toggle('looping', !!progLoop[i]); lb.setAttribute('aria-pressed', String(!!progLoop[i])); }
  });
  if (activeProgIdx >= 0 && fretLooper && fretLooper.playing){
    const btn = document.getElementById('fret-play-' + activeProgIdx);
    if (btn){ btn.classList.add('playing'); btn.textContent = '■ stop'; }
  }
}

/* Re-label everything on screen after a notation toggle: the chord chips,
   the fingering diagram, and the detected-chord readout. Cheap and
   non-destructive — no regeneration, no playback interruption. */
export function refreshFretLabels(){
  if (currentProgs.length) renderProgs();
  if (lastShownName) renderDiagram(lastShownName);
  updateDetectReadout();
}

/* ---- chord-fingering viewport ---------------------------- */
/* Build an SVG chord-box diagram from a voicing's fret array
   (6 entries low->high: fret number, 0 = open, null = muted).
   Exported for reuse by the shape trainer. */
export function chordDiagramSVG(frets){
  const NUM = 5;                       // fret rows shown
  const x0 = 22, dx = 22;              // first string x + spacing (6 strings)
  const y0 = 40, dy = 26;              // first fret line y + spacing
  const right = x0 + 5 * dx;

  const f = (frets && frets.length === 6) ? frets : [null, null, null, null, null, null];
  const fretted = f.filter(v => v !== null && v > 0);
  let startFret = 1;
  if (fretted.length){
    const maxF = Math.max(...fretted), minF = Math.min(...fretted);
    startFret = maxF > NUM ? minF : 1;
  }
  const showNut = startFret === 1;

  let svg = `<svg class="chord-box" viewBox="0 0 ${right + 22} ${y0 + NUM * dy + 22}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`;

  for (let r = 0; r <= NUM; r++){
    const y = y0 + r * dy;
    const w = (r === 0 && showNut) ? 4 : 1;
    svg += `<line x1="${x0}" y1="${y}" x2="${right}" y2="${y}" class="cb-fret" stroke-width="${w}"/>`;
  }
  for (let s = 0; s < 6; s++){
    const x = x0 + s * dx;
    svg += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y0 + NUM * dy}" class="cb-string"/>`;
  }
  if (!showNut){
    svg += `<text x="${x0 - 10}" y="${y0 + 0.5 * dy + 4}" class="cb-pos" text-anchor="end">${startFret}fr</text>`;
  }
  for (let s = 0; s < 6; s++){
    const x = x0 + s * dx;
    const v = f[s];
    if (v === null){
      svg += `<text x="${x}" y="${y0 - 12}" class="cb-mute" text-anchor="middle">×</text>`;
    } else if (v === 0){
      svg += showingNotes()
        ? `<text x="${x}" y="${y0 - 11}" class="cb-open-label" text-anchor="middle">${noteAt(s, 0)}</text>`
        : `<circle cx="${x}" cy="${y0 - 16}" r="5" class="cb-open"/>`;
    } else {
      const pos = v - startFret + 1;
      if (pos >= 1 && pos <= NUM){
        const y = y0 + (pos - 0.5) * dy;
        const label = fretLabel(s, v);
        svg += `<circle cx="${x}" cy="${y}" r="${label.length > 1 ? 9.5 : 8}" class="cb-dot"/>`;
        svg += `<text x="${x}" y="${y + 4}" class="cb-dot-label" text-anchor="middle">${label}</text>`;
      }
    }
    svg += `<text x="${x}" y="${y0 + NUM * dy + 16}" class="cb-strname" text-anchor="middle">${STRING_LABELS[s]}</text>`;
  }
  svg += `</svg>`;
  return svg;
}

function clearDiagram(){
  const el = document.getElementById('fret-diagram');
  if (!el) return;
  lastVoiceFreqs = null;
  lastShownName = null;
  lastShownIdx = null;
  el.className = 'fret-diagram-wrap empty';
  el.innerHTML = '<span class="fret-diagram-hint">Click any chord above to see its fingering.</span>';
}

/* Render the fingering viewport for a chord name; returns the
   resolved voicing (or null). */
function renderDiagram(name){
  const el = document.getElementById('fret-diagram');
  if (!el) return null;
  const v = getVoicing(name);
  const frets = v ? v.frets : null;
  lastVoiceFreqs = (v && v.midis && v.midis.length) ? v.midis.map(midiToHz) : null;
  lastShownName = name;

  const p = parseChordName(name);
  const currentQuality = p ? p.quality : 'maj';
  const qualityOptions = Object.entries(QUALITY_LABELS)
    .map(([key, label]) => `<option value="${key}"${key === currentQuality ? ' selected' : ''}>${escHtml(label)}</option>`)
    .join('');

  el.className = 'fret-diagram-wrap';
  el.innerHTML =
    `<div class="fret-diagram-card">
       ${chordDiagramSVG(frets)}
       <div class="fret-diagram-meta">
         <div class="fret-diagram-name" title="${escHtml(name)}">${escHtml(chordLabel(name, currentKey))}</div>
         ${chordLabel(name, currentKey) === name ? '' : `<div class="fret-diagram-alt">${escHtml(name)}</div>`}
         <div class="fret-diagram-notes">${escHtml(v ? v.notes : '')}</div>
         <div class="fret-diagram-style">${escHtml(v ? (v.style + ' voicing') : 'no voicing found')}</div>
         <label class="fret-diagram-quality-label">chord type
           <select class="fret-diagram-quality" aria-label="Change chord type" onchange="fretChangeQuality(this.value)">${qualityOptions}</select>
         </label>
         <button class="pb-btn" type="button" onclick="fretReplayChord()">▶ play shape</button>
       </div>
     </div>`;
  return v;
}

/* Swap the quality of the chord currently in the viewport (e.g. C -> C7 ->
   Cmaj9 -> Csus4), redraw its fingering, and play the new shape. */
export function fretChangeQuality(qualityKey){
  if (!lastShownName) return;
  const newName = withQuality(lastShownName, qualityKey);
  if (!newName) return;
  renderDiagram(newName);
  if (lastVoiceFreqs && lastVoiceFreqs.length) playChordNow(lastVoiceFreqs);
}

/* Replay the chord currently shown in the viewport. */
export function fretReplayChord(){
  if (lastVoiceFreqs && lastVoiceFreqs.length) playChordNow(lastVoiceFreqs);
}

/* Click handler for a generated chord chip: show its fingering,
   play that exact voicing, and mark the chip as selected. */
export function fretShowChord(progIdx, chordIdx){
  const c = currentProgs[progIdx] && currentProgs[progIdx].chords[chordIdx];
  if (!c) return;
  const v = renderDiagram(c.name);
  lastShownIdx = [progIdx, chordIdx];
  playChordNow((v && lastVoiceFreqs) ? lastVoiceFreqs : c.freqs);
  markSelectedChip();
}

/* Re-apply the .selected highlight after the chips are re-rendered. */
function markSelectedChip(){
  document.querySelectorAll('.fret-chord.selected').forEach(e => e.classList.remove('selected'));
  if (!lastShownIdx) return;
  const row = document.querySelectorAll('.fret-prog')[lastShownIdx[0]];
  if (!row) return;
  const chip = row.querySelectorAll('.fret-chord')[lastShownIdx[1]];
  if (chip) chip.classList.add('selected');
}

/* ---- playback (shared loop engine) ----------------------- */
/* One looper for the tab — only one progression plays at a time.
   Built lazily so the engine's audio context isn't touched until
   the user actually plays something. */
let fretLooper = null;
function getFretLooper(){
  if (fretLooper) return fretLooper;
  fretLooper = makeLooper({
    swing: true,
    onStep(snap){
      const row = document.querySelectorAll('.fret-prog')[activeProgIdx];
      if (!row) return;
      row.querySelectorAll('.fret-chord').forEach(el => el.classList.remove('playing'));
      const chip = row.querySelectorAll('.fret-chord')[snap];
      if (chip) chip.classList.add('playing');
    },
    onStop(){
      document.querySelectorAll('.fret-chord.playing').forEach(c => c.classList.remove('playing'));
      const btn = document.getElementById('fret-play-' + activeProgIdx);
      if (btn){ btn.classList.remove('playing'); btn.textContent = '▶ play'; }
      activeProgIdx = -1;
    },
  });
  return fretLooper;
}

export function fretStop(){
  if (fretLooper) fretLooper.stop();
  // belt-and-braces UI reset even if the looper was never built
  document.querySelectorAll('.fret-chord.playing').forEach(c => c.classList.remove('playing'));
  document.querySelectorAll('.fret-play.playing').forEach(b => { b.classList.remove('playing'); b.textContent = '▶ play'; });
}

/* Play a single chord (used by the chip's audio + diagram). */
export function fretPlayChord(progIdx, chordIdx){
  const c = currentProgs[progIdx] && currentProgs[progIdx].chords[chordIdx];
  if (c) playChordNow(c.freqs);
}

/* Play one progression at 2 beats/chord. Loops if this row's loop
   toggle is on, otherwise plays a single pass then stops. */
export function fretPlayProg(idx){
  const prog = currentProgs[idx];
  if (!prog) return;
  fretStop();                                  // stop whatever's playing
  const chords = prog.chords.map(c => ({ freqs: c.freqs, beats: 2 }));
  getFretLooper().start(chords, { beatsPerChord: 2, mode: 'chord', loop: !!progLoop[idx] });
  activeProgIdx = idx;                          // set AFTER start() (its internal stop already ran)
  const btn = document.getElementById('fret-play-' + idx);
  if (btn){ btn.classList.add('playing'); btn.textContent = '■ stop'; }
}

/* Play button: start this row, or stop if it's already playing. */
export function fretToggleProg(idx){
  const btn = document.getElementById('fret-play-' + idx);
  if (btn && btn.classList.contains('playing')) fretStop();
  else fretPlayProg(idx);
}

/* Loop button: toggle this row's loop preference. If it's the row
   currently playing, restart it so the change takes effect now. */
export function fretToggleLoop(idx){
  progLoop[idx] = !progLoop[idx];
  const lb = document.getElementById('fret-loop-' + idx);
  if (lb){ lb.classList.toggle('looping', progLoop[idx]); lb.setAttribute('aria-pressed', String(!!progLoop[idx])); }
  if (activeProgIdx === idx && fretLooper && fretLooper.playing) fretPlayProg(idx);
}

/* ---- helpers exposed to the markup ----------------------- */
export function clearFrets(){
  for (let i = 0; i < 6; i++){
    const el = document.getElementById('fret-' + i);
    if (el) el.value = '';
  }
  fretStop();
  updateFretChords();
}

/* A couple of starter shapes so the panel is never empty on open. */
const PRESETS = [
  ['x', '3', '2', '0', '1', '0'], // C major
  ['x', '0', '2', '2', '1', '0'], // A minor
  ['3', '2', '0', '0', '0', '3'], // G major
  ['0', '2', '2', '1', '0', '0'], // E major
  ['x', 'x', '0', '2', '3', '2'], // D major
];
export function randomFrets(){
  const p = PRESETS[Math.floor(Math.random() * PRESETS.length)];
  for (let i = 0; i < 6; i++){
    const el = document.getElementById('fret-' + i);
    if (el) el.value = p[i] === 'x' ? '' : p[i];
  }
  updateFretChords();
}

/* ---- boot: wire live listeners --------------------------- */
export function initFretChords(){
  for (let i = 0; i < 6; i++){
    const el = document.getElementById('fret-' + i);
    if (el && !el.dataset.wired){
      el.addEventListener('input', updateFretChords);
      el.dataset.wired = '1';
    }
  }
  const mode = document.getElementById('fret-mode');
  if (mode && !mode.dataset.wired){
    mode.addEventListener('change', updateFretChords);
    mode.dataset.wired = '1';
  }
  // seed with a C-major shape so the feature demonstrates itself
  const first = document.getElementById('fret-0');
  const third = document.getElementById('fret-2');
  if (first && first.value === '' && third && third.value === ''){
    const c = ['', '3', '2', '0', '1', '0'];
    for (let i = 0; i < 6; i++){ const el = document.getElementById('fret-' + i); if (el) el.value = c[i]; }
  }
  updateFretChords();
}

export { STRING_LABELS };
