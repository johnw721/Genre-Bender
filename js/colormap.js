/* ============================================================
   colormap.js — the diatonic "color map", inside the Shape
   Trainer's "My chords" view.

   Three views (persisted, GenreBenderColorMapView_v1):

     in        In scale — one column per scale degree: the triad,
               plus richer chords that do the same job (I → maj7 /
               6 / maj9, iii → m7 / m♯5 = I/3, V → 7 / 11 / 13,
               vii° → m7♭5 / dim♭9 …). Only the key's own notes.
     out       Out of scale — one column per note that falls BETWEEN
               the scale degrees (in E major: F, G, A♯, C, D =
               ♭II ♭III ♯IV ♭VI ♭VII) with the chords that live on
               that root: Neapolitan, borrowed ♭III/♭VI/♭VII,
               tritone subs, passing diminished chords.
     parallel  The parallel key (same tonic, other mode) degree by
               degree, measured against the home key, with a
               "modulate" button.

   Every column is EDITABLE (✎ edit): rename a chord in place,
   remove it, add one (full name "Fmaj7" or just a suffix "maj7"),
   drag to reorder, or drag a chord in from another column / the
   track / the chord table. Edits are stored RELATIVE to the
   column root ({off, q}), so they follow you into every key of
   the same mode (GenreBenderColorMapEdits_v1). "↺ reset view"
   drops them.

   The in-scale columns (edited or not) also drive the track's
   🎨 recolor levels and the per-chord 🎨 color cycle; out-of-
   scale columns drive the cycle for chords on chromatic roots.
   ============================================================ */
import { diatonicChords, keyInfo, scalePcs, spellPc } from './scales.js';
import { ALL_KEYS, isKey, romansFor, keyLabel } from './theorydata.js';
import { parseChordName, getVoicing, QUALITY_SUFFIX } from './chordbook.js';
import { pcToName, midiToHz, nameToPc } from './theory.js';
import { playChordNow, playNote, getCtx, playChordAtTime } from './audio.js';
import { escHtml } from './util.js';
import { setDragPayload, getDragPayload, clearDragPayload, DRAG_MIME } from './chordpalette.js';
import { registerActions } from './actions.js';
import { syncKey, getAppKey, onAppKeyChange } from './keysync.js';
import { registerStore, loadJSON, saveJSON } from './storage.js';
import { parseMelody, summarize, chordFit, keysForMelody, samePitchKey, splitBars, harmonize } from './melody.js';
import { neckSVG } from './melodyneck.js';
import { downloadJSON } from './storage.js';
import { showChordPeek, initChordPeek, isTouch } from './chordpeek.js';
import { chordsIn, splitLinkText } from './chordsheet.js';
import { getBPM } from './metronome.js';
import {
  getClips, getClip, clipsAdd, clipsUpdate, parseClipUrl, normalizeKey, PLATFORM_LABEL,
  onClipsChange, clipsDetachDock, onDockReattach, setClipPasteRoute, clipsSyncHTML
} from './clips.js';
const MELODY_KEY = registerStore('colorMapMelody', 'GenreBenderColorMapMelody_v1');

const VIEW_KEY = registerStore('colorMapView', 'GenreBenderColorMapView_v1');
const EDIT_KEY = registerStore('colorMapEdits', 'GenreBenderColorMapEdits_v1');

/* ---- default ladders (in scale) -------------------------------------------
   colors: ordered by recolor level (1, 2, 3); extras follow. */
const LADDER = {
  major: [
    { fn: 'T',  colors: ['maj7', 'six', 'maj9'],
      extras: [['dom7', 'I7 — the ♭7 is borrowed; it turns I into V7 of IV (bluesy push to IV)'],
               ['add9', 'I add9 — open, no 7th']] },
    { fn: 'PD', colors: ['min7', 'min9', 'min11'], extras: [] },
    { fn: 'T',  colors: ['min7', 'minS5'], extras: [] },
    { fn: 'PD', colors: ['maj7', 'six', 'maj9'], extras: [] },
    { fn: 'D',  colors: ['dom7', 'dom11', 'dom13'],
      extras: [['dom9', 'V9 — the classic dominant 9'],
               ['sus4', 'Vsus4 — delay the 3rd, resolve to V or straight home']] },
    { fn: 'T',  colors: ['min7', 'min9', 'min11'], extras: [] },
    { fn: 'D',  colors: ['m7b5', 'dimb9'], extras: [] },
  ],
  minor: [
    { fn: 'T',  colors: ['min7', 'min9', 'min11'],
      extras: [['min6', 'i6 — the raised 6th is the Dorian color']] },
    { fn: 'PD', colors: ['m7b5'], extras: [] },
    { fn: 'T',  colors: ['maj7', 'six', 'maj9'], extras: [] },
    { fn: 'PD', colors: ['min7', 'min9', 'min11'],
      extras: [['maj', 'IV major — borrowed from Dorian, a brighter lift']] },
    { fn: 'D',  colors: ['min7', 'min11'],
      extras: [['dom7', 'V7 — raised 7th from harmonic minor; the strongest pull to i'],
               ['dom7b9', 'V7♭9 — harmonic-minor dominant with the ♭9 on top']] },
    { fn: 'PD', colors: ['maj7', 'maj9', 'six'], extras: [] },
    { fn: 'D',  colors: ['dom7', 'dom9', 'sus4'], extras: [] },
  ],
};

/* ---- out of scale: the notes BETWEEN the degrees ---------------------------
   semi = semitones above the tonic. Each root gets the chords that are
   idiomatic on it; every one of them has at least its root outside the key. */
const CHROMATIC = {
  major: [
    { semi: 1,  roman: '♭II',    fn: 'PD', items: [
      ['maj',  '♭II — Neapolitan: a dark predominant that falls into V'],
      ['maj7', '♭IImaj7 — lush Neapolitan colour'],
      ['dom7', '♭II7 — tritone sub of V7, slides down a half step to I'],
      ['dim7', '♯i°7 — passing diminished, I → ii'] ] },
    { semi: 3,  roman: '♭III',   fn: 'T', items: [
      ['maj',  '♭III — borrowed from the parallel minor'],
      ['maj7', '♭IIImaj7 — soul / neo-soul borrowed colour'],
      ['dom7', '♭III7 — pushes to ♭VI'],
      ['dim7', '♯ii°7 — passing diminished, ii → iii'] ] },
    { semi: 6,  roman: '♯IV/♭V', fn: 'PD', items: [
      ['m7b5', '♯ivø7 — chromatic predominant rising to V (or I/5)'],
      ['dim7', '♯iv°7 — passing diminished, IV → V'],
      ['dom7', '♭V7 — tritone sub of V7/V'],
      ['maj',  '♭V — a tritone away: maximum outside'] ] },
    { semi: 8,  roman: '♭VI',    fn: 'PD', items: [
      ['maj',  '♭VI — borrowed from the parallel minor, the "epic" lift'],
      ['maj7', '♭VImaj7 — dreamy borrowed colour'],
      ['dom7', '♭VI7 — German-sixth sound, falls to V'],
      ['dim7', '♯v°7 — passing diminished, V → vi'] ] },
    { semi: 10, roman: '♭VII',   fn: 'D', items: [
      ['maj',  '♭VII — Mixolydian / rock borrowed chord'],
      ['dom7', '♭VII7 — backdoor dominant, resolves to I'],
      ['add9', '♭VIIadd9 — open, anthemic'],
      ['sus4', '♭VIIsus4 — floating, unresolved'] ] },
  ],
  minor: [
    { semi: 1,  roman: '♭II',    fn: 'PD', items: [
      ['maj',  '♭II — Neapolitan (Phrygian colour), falls into V'],
      ['maj7', '♭IImaj7 — Phrygian lushness'],
      ['dom7', '♭II7 — tritone sub of V7, slides into i'],
      ['dim7', '♯i°7 — passing diminished, i → ii°'] ] },
    { semi: 4,  roman: '♮III',   fn: 'T', items: [
      ['maj',  'III♮ — the major 3rd as a root: chromatic mediant'],
      ['min',  'iii♮ — chromatic mediant, minor'],
      ['dim7', '°7 on the major 3rd — passing, III → iv'] ] },
    { semi: 6,  roman: '♯IV/♭V', fn: 'PD', items: [
      ['m7b5', '♯ivø7 — Dorian passing chord up to V'],
      ['dim7', '♯iv°7 — passing diminished, iv → v'],
      ['dom7', '♭V7 — tritone sub of V7/V'],
      ['maj',  '♭V — a tritone away'] ] },
    { semi: 9,  roman: '♮VI',    fn: 'PD', items: [
      ['m7b5', '♮viø7 — Dorian / melodic-minor predominant'],
      ['min',  '♮vi — Dorian shade'],
      ['dom7', '♮VI7 = V7 of ii'],
      ['dim7', '♮vi°7 — passing diminished'] ] },
    { semi: 11, roman: '♮VII',   fn: 'D', items: [
      ['dim',  'vii° — the harmonic-minor leading-tone triad'],
      ['dim7', 'vii°7 — the strongest pull to i'],
      ['m7b5', 'viiø7 — softer leading-tone chord'],
      ['maj',  'VII♮ major — chromatic, very bright'] ] },
  ],
};

export const VIEWS = {
  in:       { label: 'In scale',     hint: "Each degree's triad with richer chords that do the same job. Only the key's own notes." },
  out:      { label: 'Out of scale', hint: 'The notes that fall between the scale degrees, with the chords built on them: Neapolitan, borrowed ♭III / ♭VI / ♭VII, tritone subs, passing diminished.' },
  parallel: { label: 'Parallel',     hint: 'The parallel key (same tonic, other mode) degree by degree. Borrow single chords, or modulate outright.' },
};
export const FN_LABEL = { T: 'tonic', PD: 'predominant', D: 'dominant' };
const FN_TEXT = {
  T:  'tonic family — home / rest; these can stand in for each other',
  PD: 'predominant family — moves away from home and sets up the dominant',
  D:  'dominant family — tension that wants to resolve home',
};
export const LEVEL_NAMES = ['triads', 'sevenths', 'extended', 'spice'];

/* ---- helpers ------------------------------------------------------------- */
function chordPcs(name){
  const p = parseChordName(name);
  return p ? [...new Set(p.intervals.map(iv => (p.rootPc + iv) % 12))] : [];
}
/* Notes of a chord that fall outside the key. Spelled to match the chord:
   Db7 shows Db Ab, F#7 shows F# A# C#. */
function outsideOf(name, inKey, key){
  const acc = String(name).match(/^[A-G]([#b])?/)?.[1];
  return chordPcs(name).filter(pc => !inKey.has(pc)).map(pc =>
    acc === 'b' ? FLAT_SP[mod12(pc)] : acc === '#' ? SHARP_SP[mod12(pc)] : key ? spellPc(pc, key) : pcToName(pc));
}
const mod12 = (n) => ((n % 12) + 12) % 12;

export function parallelKey(key){
  const { rootName, mode } = keyInfo(key);
  return mode === 'minor' ? rootName : rootName + 'm';
}
function relativeRoman(roman, parRootPc, homeRootPc){
  const d = mod12(parRootPc - homeRootPc);
  return (d === 11 ? '♭' : d === 1 ? '♯' : '') + roman;
}

function autoNote(q, triads, rootName, mode){
  if (q === 'minS5') return `same notes as ${triads[0]}/${rootName} — the tonic with its 3rd in the bass`;
  if (q === 'dimb9') return `the ♭9 is the tonic note itself — the leading tone rubs against home, max pull to ${triads[0]}`;
  if (q === 'dom11' && mode === 'major'){
    const iv = parseChordName(triads[3]);
    return `sus-dominant sound — works like ${iv ? iv.rootName : 'IV'} over a ${rootName} bass`;
  }
  return '';
}

/* ---- edits (relative to the column root) ---------------------------------- */
let edits = {};
function loadEdits(){ const s = loadJSON(EDIT_KEY, {}); edits = (s && typeof s === 'object') ? s : {}; }
function getEdit(mode, view, colId){ return edits?.[mode]?.[view]?.[colId] || null; }
function setEdit(mode, view, colId, list){
  edits[mode] = edits[mode] || {};
  edits[mode][view] = edits[mode][view] || {};
  if (list) edits[mode][view][colId] = list; else delete edits[mode][view][colId];
  saveJSON(EDIT_KEY, edits);
}
export function resetColorMapEdits(mode, view){
  if (edits[mode]) delete edits[mode][view];
  saveJSON(EDIT_KEY, edits);
}

/* ---- columns ---------------------------------------------------------------
   column: { id, rootPc, rootName, roman, fn, anchor (triad name | null),
             anchorOutside, between, spelling, items:[item], edited }
   item:   { name, q, off, outside, note } */
function spell(col, off){ return off === 0 ? col.rootName : spellPc(col.rootPc + off, col.key); }
function makeItem(col, off, q, note, inKey){
  if (!(q in QUALITY_SUFFIX)) return null;
  const name = spell(col, off) + QUALITY_SUFFIX[q];
  return { name, q, off, outside: outsideOf(name, inKey, col.key), note: note || '' };
}
/* Apply a stored edit list (or the defaults) to a column skeleton. */
function fillItems(col, defaults, mode, view, inKey){
  const notes = new Map(defaults.map(d => [`${d.off}|${d.q}`, d.note]));
  const edited = getEdit(mode, view, col.id);
  const rel = edited || defaults;
  col.items = rel.map(r => makeItem(col, r.off, r.q, notes.get(`${r.off}|${r.q}`), inKey)).filter(Boolean);
  col.edited = !!edited;
  return col;
}

/* Spell a chromatic column's root the way its numeral reads: ♭VII in C
   is Bb (not A#), ♭III in E is G, ♮III in Am is C#. ♯IV/♭V follows the key. */
const FLAT_SP = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP_SP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function chromaticRoot(pc, roman, key){
  if (/^♭/.test(roman)) return FLAT_SP[mod12(pc)];
  if (/^♮/.test(roman)) return SHARP_SP[mod12(pc)];
  return spellPc(pc, key);
}

/* The columns for one of the three views, edits applied. */
export function mapColumns(key, view = 'in'){
  const { mode, rootPc: tonicPc } = keyInfo(key);
  const homeTriads = diatonicChords(key);
  const inKey = new Set(scalePcs(key));

  if (view === 'out'){
    const romans = romansFor(key);
    const steps = scalePcs(key).map(pc => mod12(pc - tonicPc));
    return CHROMATIC[mode].map(def => {
      const below = steps.filter(s => s < def.semi).length - 1;
      const col = {
        id: 'c' + def.semi, key, rootPc: mod12(tonicPc + def.semi), rootName: chromaticRoot(tonicPc + def.semi, def.roman, key),
        roman: def.roman, fn: def.fn, anchor: null, anchorOutside: [],
        between: `${romans[below]} · ${romans[(below + 1) % 7]}`, chromatic: true, spelling: [],
      };
      const defaults = def.items.map(([q, note]) => ({ off: 0, q, note }));
      return fillItems(col, defaults, mode, view, inKey);
    });
  }

  const srcKey = view === 'parallel' ? parallelKey(key) : key;
  const src = keyInfo(srcKey);
  const triads = diatonicChords(srcKey);
  const romans = romansFor(srcKey);
  return LADDER[src.mode].map((rung, deg) => {
    const t = parseChordName(triads[deg]);
    const home = parseChordName(homeTriads[deg]);
    const col = {
      id: 'd' + deg, key, rootPc: t.rootPc, rootName: t.rootName,
      roman: view === 'parallel' ? relativeRoman(romans[deg], t.rootPc, home.rootPc) : romans[deg],
      fn: rung.fn, anchor: triads[deg], anchorOutside: outsideOf(triads[deg], inKey, key),
      spelling: chordPcs(triads[deg]).map(pc => spellPc(pc, srcKey)), parallel: view === 'parallel',
    };
    let defaults = [
      ...rung.colors.map(q => ({ off: 0, q, note: autoNote(q, triads, t.rootName, src.mode) })),
      ...rung.extras.map(([q, note]) => ({ off: 0, q, note })),
    ];
    if (view === 'in'){
      defaults = defaults.filter(d => !outsideOf(t.rootName + QUALITY_SUFFIX[d.q], inKey, key).length);
    }
    return fillItems(col, defaults, mode, view, inKey);
  });
}

/* Back-compat: the plain in-scale ladder (colors = items). */
export function colorLadder(key){
  return mapColumns(key, 'in').map((c, deg) => ({
    deg, roman: c.roman, fn: c.fn, triad: c.anchor, spelling: c.spelling, colors: c.items, extras: [],
  }));
}

/* ---- recolor / cycle (used by the track) ----------------------------------- */
export function degreeOf(name, key){
  const p = parseChordName(name);
  if (!p) return -1;
  return diatonicChords(key).findIndex(n => { const d = parseChordName(n); return d && d.rootPc === p.rootPc; });
}
function sameRootQuals(col){ return col.items.filter(i => i.off === 0).map(i => i.q); }

/* Level 0 = triad; level n = the n-th same-root chord in the (edited)
   in-scale column, clamped to its last rung. null = root not diatonic. */
export function recolorName(name, key, level){
  const deg = degreeOf(name, key);
  if (deg < 0) return null;
  const col = mapColumns(key, 'in')[deg];
  const p = parseChordName(name);
  const quals = sameRootQuals(col);
  const pick = level <= 0 || !quals.length
    ? parseChordName(col.anchor).quality
    : quals[Math.min(level, quals.length) - 1];
  return p.rootName + (QUALITY_SUFFIX[pick] ?? '');
}

/* Next option in the chord's column: in-scale columns for diatonic roots,
   out-of-scale columns for the roots between degrees. */
export function nextColorName(name, key){
  const p = parseChordName(name);
  if (!p) return null;
  let quals;
  const deg = degreeOf(name, key);
  if (deg >= 0){
    const col = mapColumns(key, 'in')[deg];
    quals = [parseChordName(col.anchor).quality, ...sameRootQuals(col)];
  } else {
    const col = mapColumns(key, 'out').find(c => c.rootPc === p.rootPc);
    if (!col) return null;
    quals = sameRootQuals(col);
  }
  quals = [...new Set(quals)];
  if (!quals.length) return null;
  const i = quals.indexOf(p.quality);
  return p.rootName + (QUALITY_SUFFIX[quals[(i + 1) % quals.length]] ?? '');
}

/* Root-in-bass voicing for colour chords (G#m#5 must sound as E/G#).
   Frets to PIN, or null when the default voicing is already that shape. */
export function colorVoicing(name){ return getVoicing(name, { rootBass: true }); }
export function pinnedFretsFor(name){
  const v = colorVoicing(name), d = getVoicing(name);
  if (!v) return null;
  return d && JSON.stringify(d.frets) === JSON.stringify(v.frets) ? null : [...v.frets];
}

/* ---- find a chord in the map -------------------------------------------- */
const sameChord = (a, b) => {
  const A = parseChordName(String(a).split('/')[0]), B = parseChordName(String(b).split('/')[0]);
  return !!(A && B && A.rootPc === B.rootPc && A.quality === B.quality);
};
/* Where a chord lives in `key`'s map: the first view (in → out → parallel)
   with a chip for it, else the column whose root it shares. Pure. */
export function locateChord(name, key){
  for (const v of ['in', 'out', 'parallel']){
    for (const col of mapColumns(key, v)){
      const item = col.items.find(it => sameChord(it.name, name));
      if (item) return { view: v, colId: col.id, roman: col.roman, fn: col.fn, name: item.name, exact: true };
    }
  }
  const p = parseChordName(String(name).split('/')[0]);
  if (!p) return null;
  for (const v of ['in', 'out']){
    const col = mapColumns(key, v).find(c => c.rootPc === p.rootPc);
    if (col) return { view: v, colId: col.id, roman: col.roman, fn: col.fn, name: null, exact: false };
  }
  return null;
}
/* Keys whose in-scale map holds this exact chord (to offer a key switch). */
export function keysWithChord(name, limit = 4){
  const out = [];
  for (const k of ALL_KEYS){
    if (out.length >= limit) break;
    if (out.some(o => samePitchKey(o, k))) continue;           // D# major == Eb major
    if (mapColumns(k, 'in').some(c => c.items.some(it => sameChord(it.name, name)))) out.push(k);
  }
  return out;
}

/* ---- UI state ------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);
let mapKey = null;
let view = 'in';
let editing = false;
let lastError = '';
let onAdd = null;          // injected by trainer.js: (name, frets|null) → append to the active track

/* ---- melody lens -------------------------------------------------------------
   Type the notes (or frets) a melody will use; every chord in the map is
   scored against them (chordFit) and lit by how well it sits under the
   tune: chord tones / colour tones / ♭9 clashes. The best few in the view
   get a ★, clashing ones fade, and the keys that hold every note are
   offered as one-click key changes. */
let melodyText = '';
let melodyMode = 'notes';     // 'notes' | 'frets'
let mel = null;               // summarize(parseMelody(...)) or null
let bestNames = new Set();
/* Melody context: with a reference clip picked, the melody box reads and
   writes THAT clip's melody (clip.melody, saved with the clip list);
   with none, it uses its own global slot. */
let sessionClipId = null;
let globalMel = { text: '', mode: 'notes' };
function sessionClip(){ return sessionClipId ? getClip(sessionClipId) : null; }
function loadMelody(){
  const s = loadJSON(MELODY_KEY);
  if (s && typeof s === 'object'){
    globalMel = { text: typeof s.text === 'string' ? s.text : '', mode: s.mode === 'frets' ? 'frets' : 'notes' };
    sessionClipId = typeof s.clipId === 'string' ? s.clipId : null;
    if (Number.isFinite(+s.perBar) && +s.perBar > 0) perBar = +s.perBar;
  }
  applyContextMelody();
}
function applyContextMelody(){
  const c = sessionClip();
  const m = c ? (c.melody || { text: '', mode: melodyMode }) : globalMel;
  melodyText = m.text || '';
  melodyMode = m.mode === 'frets' ? 'frets' : 'notes';
  reparseMelody();
  const input = $('cm-melody-input');
  if (input && input.value !== melodyText) input.value = melodyText;
}
let melParsed = null;
let perBar = 4;                // notes per bar when the melody has no "|" marks
let harmonyPicks = {};         // bar index → chosen alternative (0..2)
let neckShift = 0;             // ‹ › nudges of the fretboard window
let neckOpen = true;
let trackNote = '';            // one-shot status after "→ new track"
function reparseMelody(){
  melParsed = parseMelody(melodyText, melodyMode);
  const sm = summarize(melParsed);
  mel = sm.total || sm.bad.length ? sm : null;
  harmonyPicks = {};
  neckShift = 0;
}
function saveMelody(){
  const c = sessionClip();
  if (c) clipsUpdate(c.id, 'melody', { text: melodyText, mode: melodyMode });
  else globalMel = { text: melodyText, mode: melodyMode };
  saveJSON(MELODY_KEY, { text: globalMel.text, mode: globalMel.mode, clipId: sessionClipId, perBar });
}
function melodyActive(){ return !!(mel && mel.total); }
function fitOf(name){ return melodyActive() ? chordFit(name, mel) : null; }
export function setMelody(text, mode){
  if (typeof mode === 'string') melodyMode = mode === 'frets' ? 'frets' : 'notes';
  melodyText = String(text ?? '');
  reparseMelody();
  saveMelody();
  redrawColorMap();
  const input = $('cm-melody-input');
  if (input && input.value !== melodyText) input.value = melodyText;
}
export function getMelody(){ return { text: melodyText, mode: melodyMode, summary: mel }; }

let onNewTrack = null;     // injected by trainer.js: (name, entries) → new My chords track
export function configureColorMap({ add, newTrack } = {}){ if (add) onAdd = add; if (newTrack) onNewTrack = newTrack; }
function currentKey(){
  if (mapKey && isKey(mapKey)) return mapKey;
  const k = getAppKey() || $('rail-key')?.value;
  return isKey(k) ? k : 'C';
}
function currentMode(){ return keyInfo(currentKey()).mode; }
function findColumn(colId){ return mapColumns(currentKey(), view).find(c => c.id === colId) || null; }
export function isColorMapEditing(){ return editing; }

/* ---- edit operations ------------------------------------------------------ */
function relList(col){ return col.items.map(i => ({ off: i.off, q: i.q })); }
function commit(col, list){ setEdit(currentMode(), view, col.id, list); }

/* "maj7" (a suffix on the column root) or "Fmaj7" (a full chord name). */
function parseForColumn(raw, col){
  const s = String(raw || '').trim();
  if (!s) return null;
  let full;
  if (/^[A-G]/.test(s)) full = s;
  else {
    full = col.rootName + s;
    const p0 = parseChordName(full);
    if (p0 && p0.quality === 'maj' && !/^(maj|M|major)?$/.test(s)){
      return { error: `Can't read "${s}" — try a suffix like m7, maj9, 7b9, sus4, dim7, or a full name like ${col.rootName}m7.` };
    }
  }
  const p = parseChordName(full);
  if (!p) return { error: `Can't read "${s}" — start with a note letter A–G, or type just a suffix like m7.` };
  return { off: mod12(p.rootPc - col.rootPc), q: p.quality };
}

function addTo(colId, raw, at = null){
  const col = findColumn(colId);
  if (!col) return false;
  const r = parseForColumn(raw, col);
  if (!r) return false;
  if (r.error){ lastError = r.error; redrawColorMap(); return false; }
  const list = relList(col);
  if (list.some(x => x.off === r.off && x.q === r.q)){
    lastError = `${spell(col, r.off) + QUALITY_SUFFIX[r.q]} is already in this column.`;
    redrawColorMap();
    return false;
  }
  list.splice(at === null ? list.length : Math.max(0, Math.min(list.length, at)), 0, { off: r.off, q: r.q });
  lastError = '';
  commit(col, list);
  redrawColorMap();
  return true;
}
function removeFrom(colId, idx){
  const col = findColumn(colId);
  if (!col) return;
  const list = relList(col);
  list.splice(idx, 1);
  lastError = '';
  commit(col, list);
  redrawColorMap();
}
function renameIn(colId, idx, raw){
  const col = findColumn(colId);
  if (!col || !col.items[idx]) return;
  if (!String(raw || '').trim()){ removeFrom(colId, idx); return; }
  const r = parseForColumn(raw, col);
  if (!r || r.error){ lastError = r ? r.error : ''; redrawColorMap(); return; }
  const list = relList(col);
  list[idx] = { off: r.off, q: r.q };
  lastError = '';
  commit(col, list);
  redrawColorMap();
}
function moveWithin(colId, from, to){
  const col = findColumn(colId);
  if (!col) return;
  const list = relList(col);
  if (from < 0 || from >= list.length) return;
  const [m] = list.splice(from, 1);
  if (to > from) to--;
  list.splice(Math.max(0, Math.min(list.length, to)), 0, m);
  commit(col, list);
  redrawColorMap();
}

/* ---- rendering ------------------------------------------------------------ */
function fitParts(name){
  const f = fitOf(name);
  if (!f) return { cls: '', badge: '', line: '' };
  const key = currentKey();
  const sp = (pcs) => pcs.map(pc => spellPc(pc, key)).join(' ');
  const line = 'melody: ' + [
    f.tones.length ? `chord tones ${sp(f.tones)}` : 'no chord tones',
    f.colour.length ? `colour ${sp(f.colour)}` : '',
    f.clash.length ? `clashes ${sp(f.clash)} (½ step above a chord tone)` : '',
  ].filter(Boolean).join(' · ');
  const best = bestNames.has(name);
  const badge = `<span class="cm-fitb${f.clash.length ? ' clash' : ''}" aria-label="melody fit">${best ? '★ ' : ''}♪${f.covered}/${f.distinct}</span>`;
  return { cls: ` cm-fit cm-fit-${f.level}${best ? ' cm-best' : ''}${f.clash.length ? ' cm-clash' : ''}`, badge, line };
}
function chipHTML(c, kind, col, idx){
  const fit = fitParts(c.name);
  const title = [c.name, c.note, c.outside.length ? `outside the key: ${c.outside.join(' ')}` : '', fit.line,
    editing && kind !== 'triad' ? 'type to rename · drag ⠿ to reorder or move' : 'click to hear · drag onto the track or table']
    .filter(Boolean).join('\n');
  const out = (c.outside.length ? `<span class="cm-out" aria-label="outside notes">${c.outside.map(escHtml).join(' ')}</span>` : '') + fit.badge;
  const loc = col && idx !== undefined ? ` data-col="${col.id}" data-idx="${idx}"` : '';
  if (editing && kind !== 'triad'){
    return `<div class="cm-chip cm-${kind} cm-editing${c.outside.length ? ' cm-outside' : ''}${fit.cls}"${loc} data-name="${escHtml(c.name)}" title="${escHtml(title)}">
      <span class="cm-grip" draggable="true" aria-label="Drag to reorder">⠿</span>
      <input class="cm-name-input" type="text" value="${escHtml(c.name)}" maxlength="14" aria-label="Chord name"
        data-on-change="cm:rename"${loc}>
      ${out}
      <button type="button" class="cm-mini" data-action="cm:play" data-name="${escHtml(c.name)}" aria-label="Hear ${escHtml(c.name)}" title="Hear it">▶</button>
      <button type="button" class="cm-mini cm-del" data-action="cm:remove"${loc} aria-label="Remove ${escHtml(c.name)}" title="Remove">✕</button>
    </div>`;
  }
  return `<div class="cm-chip cm-${kind}${c.outside.length ? ' cm-outside' : ''}${fit.cls}" draggable="true" role="button" tabindex="0"
      data-action="cm:play" data-name="${escHtml(c.name)}"${loc} title="${escHtml(title)}">
    <span class="cm-chip-name">${escHtml(c.name)}</span>${out}
    <button type="button" class="cm-add" data-action="cm:add" data-name="${escHtml(c.name)}" aria-label="Add ${escHtml(c.name)} to the track" title="Add to the end of the track">+</button>
  </div>`;
}

function columnHTML(col){
  const anchor = col.anchor
    ? chipHTML({ name: col.anchor, outside: col.anchorOutside, note: FN_TEXT[col.fn] }, 'triad')
    : `<div class="cm-note-anchor${melodyActive() && mel.counts.has(col.rootPc) ? ' cm-hit' : ''}" title="The note between ${escHtml(col.between)}${melodyActive() && mel.counts.has(col.rootPc) ? ' — it\'s in your melody' : ''}">
         <span class="cm-note-name">${escHtml(col.rootName)}</span>
         <span class="cm-between">between ${escHtml(col.between)}</span>
       </div>`;
  const items = col.items.map((c, i) => ({ c, i })).reverse()
    .map(({ c, i }) => chipHTML(c, (i < 3 && !col.chromatic) ? 'color' : 'extra', col, i)).join('');
  const add = editing ? `<div class="cm-add-row">
      <input class="cm-add-input" type="text" maxlength="14" placeholder="+ m7, maj9, ${escHtml(col.rootName)}7…"
        aria-label="Add a chord to ${escHtml(col.roman)}" data-on-enter="cm:addItem" data-col="${col.id}">
    </div>` : '';
  const empty = !col.items.length ? `<div class="cm-col-empty">${editing ? 'empty — add a chord' : '—'}</div>` : '';
  return `<div class="cm-col cm-fn-${col.fn}${col.chromatic ? ' cm-chromatic' : ''}${col.edited ? ' cm-edited' : ''}" role="listitem" data-col="${col.id}">
    ${add}
    <div class="cm-colors">${empty}${items}</div>
    <div class="cm-rule" aria-hidden="true"></div>
    ${anchor}
    <div class="cm-roman">${escHtml(col.roman)}</div>
    <div class="cm-fn" title="${escHtml(FN_TEXT[col.fn])}">${FN_LABEL[col.fn]}${col.edited ? ' · edited' : ''}</div>
    ${col.spelling.length ? `<div class="cm-spell">${col.spelling.map(n => melodyActive() && mel.counts.has(nameToPc(n))
      ? `<b class="cm-mhit" title="in your melody">${escHtml(n)}</b>` : escHtml(n)).join(' ')}</div>` : ''}
  </div>`;
}

function bodyHTML(key){
  const par = view === 'parallel' ? parallelKey(key) : null;
  const banner = par ? `<div class="cm-parallel-bar">
      <span>Showing <strong>${escHtml(keyLabel(par))}</strong> against ${escHtml(keyLabel(key))} — flagged notes are the ones you'd borrow.</span>
      <button type="button" class="pb-btn" data-action="cm:modulate" data-key="${escHtml(par)}">⇄ modulate to ${escHtml(keyLabel(par))}</button>
    </div>` : '';
  const cols = mapColumns(key, view);
  bestNames = new Set();
  if (melodyActive()){
    const names = [...new Set(cols.flatMap(c => [c.anchor, ...c.items.map(i => i.name)]).filter(Boolean))];
    names.map(n => ({ n, f: chordFit(n, mel) })).filter(x => x.f && !x.f.clash.length && x.f.score >= 0.45)
      .sort((a, b) => b.f.score - a.f.score || b.f.covered - a.f.covered).slice(0, 3)
      .forEach(x => bestNames.add(x.n));
  }
  const editedHere = cols.some(c => c.edited);
  const editBar = editing ? `<div class="cm-edit-bar">
      <span>Editing <strong>${escHtml(VIEWS[view].label)}</strong> for every ${escHtml(keyInfo(key).mode)} key — rename in place, ✕ to remove, type in a column's box + Enter to add, drag ⠿ to reorder, or drop chords in from the track / table.</span>
      <span class="cm-edit-io">
        <button type="button" class="pb-btn" data-action="cm:exportEdits" title="Download every color-map edit (all views, major + minor) as a file">⬇ export edits</button>
        <label class="pb-btn cm-import" title="Load edits from an exported file (replaces the edits in it, keeps the rest)">⬆ import<input type="file" accept="application/json,.json" hidden data-on-change="cm:importEdits"></label>
        ${editedHere ? `<button type="button" class="pb-btn" data-action="cm:reset">↺ reset view</button>` : ''}
      </span>
    </div>` : '';
  const err = lastError ? `<div class="trainer-custom-err cm-err" role="alert">${escHtml(lastError)}</div>` : '';
  return `<p class="trainer-hint cm-view-hint tip">${escHtml(VIEWS[view].hint)}</p>${banner}${editBar}${err}
    <div class="cm-grid cm-view-${view}${editing ? ' cm-is-editing' : ''}" role="list" style="--cols:${cols.length}">${cols.map(columnHTML).join('')}</div>`;
}
function switchHTML(){
  return `<div class="cm-switch" role="radiogroup" aria-label="Color map view">${Object.entries(VIEWS).map(([id, v]) =>
    `<button type="button" role="radio" class="cm-switch-btn${id === view ? ' on' : ''}" aria-checked="${id === view}"
      data-action="cm:view" data-view="${id}">${escHtml(v.label)}</button>`).join('')}</div>`;
}
function toolsHTML(key){
  const opts = ALL_KEYS.map(k => `<option value="${k}"${k === key ? ' selected' : ''}>${escHtml(keyLabel(k))}</option>`).join('');
  return `${switchHTML()}
    <label class="cm-key-label">key
      <select id="colormap-key" data-keypick class="tab-style-select" data-on-change="cm:key" aria-label="Color map key">${opts}</select>
    </label>
    <button type="button" class="pb-btn cm-edit-toggle${editing ? ' on' : ''}" data-action="cm:edit" aria-pressed="${editing}">${editing ? '✓ done editing' : '✎ edit'}</button>
    <span class="cm-legend"><i class="cm-dot cm-fn-T"></i>tonic <i class="cm-dot cm-fn-PD"></i>predominant <i class="cm-dot cm-fn-D"></i>dominant <i class="cm-dot cm-dot-out"></i>outside note</span>`;
}

function melodyModeHTML(){
  return [['notes', 'notes'], ['frets', 'frets']].map(([id, label]) =>
    `<button type="button" role="radio" class="cm-switch-btn${melodyMode === id ? ' on' : ''}" aria-checked="${melodyMode === id}"
      data-action="cm:melMode" data-mode="${id}">${label}</button>`).join('');
}
function melodyPlaceholder(){
  return melodyMode === 'frets' ? 'e.g. e7 e9 B8 G9   or   e: 7 9 10 B: 8' : 'e.g. E G# B C# B';
}
function melodyReadoutHTML(){
  const key = currentKey();
  if (!mel){
    return `<span class="trainer-hint tip">Type the notes your melody will use — or switch to <b>frets</b> (string + fret: <code>e7 B8</code>, or <code>e: 7 9 10</code>; E = low E, e = high e). Every chord lights up by how well it sits under the tune.</span>`;
  }
  const inKey = new Set(scalePcs(key));
  const notes = mel.notes.map(n => {
    const name = spellPc(n.pc, key);
    return `<span class="cm-mnote${inKey.has(n.pc) ? '' : ' out'}" title="${escHtml(n.token)} → ${escHtml(name)}${inKey.has(n.pc) ? '' : ' (outside ' + keyLabel(key) + ')'}">${escHtml(name)}</span>`;
  }).join('');
  const bad = mel.bad.length ? `<span class="cm-mbad">couldn't read: ${mel.bad.map(escHtml).join(' ')}</span>` : '';
  if (!mel.total) return `<div class="cm-mline">${bad}</div>`;
  const outside = mel.pcs.filter(pc => !inKey.has(pc));
  const fitLine = outside.length
    ? `<span class="cm-mstat warn">${outside.length} note${outside.length === 1 ? '' : 's'} outside ${escHtml(keyLabel(key))}: ${outside.map(pc => escHtml(spellPc(pc, key))).join(' ')} — see <b>Out of scale</b> / <b>Parallel</b>, or change key</span>`
    : `<span class="cm-mstat ok">every note is in ${escHtml(keyLabel(key))}</span>`;
  const ks = keysForMelody(mel, key);
  const keyBtns = ks.keys.map(k => `<button type="button" class="kp-seg cm-mkey${samePitchKey(k, key) ? ' on' : ''}" data-action="cm:melKey" data-key="${k}">${escHtml(keyLabel(k))}</button>`).join('');
  const keysLine = ks.keys.length ? `<span class="cm-mkeys"><span class="cm-mk-label">${ks.complete ? 'keys that hold every note' : `closest keys (cover ${ks.covered}/${mel.pcs.length})`}:</span>${keyBtns}</span>` : '';
  const best = [...bestNames];
  const bestLine = best.length ? `<span class="cm-mstat">★ best here: ${best.map(escHtml).join(' · ')}</span>` : `<span class="cm-mstat">no clean fit in this view — try another view or key</span>`;
  return `<div class="cm-mline">${notes}${bad}</div><div class="cm-mline">${fitLine}${bestLine}</div><div class="cm-mline">${keysLine}</div>`
    + harmonyHTML() + neckHTML();
}

/* ---- harmony: a chord per bar ------------------------------------------- */
function harmonyCandidates(key){
  const ins = mapColumns(key, 'in');
  const cands = [];
  ins.forEach((c, ci) => {
    cands.push({ name: c.anchor, rank: ci, tonic: c.id === 'd0' });
    c.items.filter(i => i.off === 0 && !i.outside.length).forEach((i, k) => cands.push({ name: i.name, rank: 10 + ci * 5 + k }));
  });
  const fallback = [];
  mapColumns(key, 'out').forEach((c, ci) => c.items.forEach((i, k) => fallback.push({ name: i.name, rank: 100 + ci * 5 + k, outside: true })));
  mapColumns(key, 'parallel').forEach((c, ci) => fallback.push({ name: c.anchor, rank: 200 + ci, outside: true }));
  return { cands, fallback };
}
export function currentHarmony(){
  if (!melodyActive() || !melParsed) return [];
  const { cands, fallback } = harmonyCandidates(currentKey());
  return harmonize(splitBars(melParsed, perBar), cands, { fallback })
    .map((b, i) => ({ ...b, pick: b.alts[Math.min(harmonyPicks[i] || 0, Math.max(0, b.alts.length - 1))] }));
}
function harmonyHTML(){
  const bars = currentHarmony();
  if (!bars.length) return '';
  const key = currentKey();
  const marked = melParsed && melParsed.marked;
  const sizeCtl = marked
    ? `<span class="cm-mstat">bars from your <code>|</code> marks</span>`
    : `<label class="cm-barsize-label">bar =
        <select class="tab-style-select cm-barsize" data-on-change="cm:barSize" aria-label="Notes per bar">
          ${[2, 3, 4, 6, 8].map(n => `<option value="${n}"${n === perBar ? ' selected' : ''}>${n} notes</option>`).join('')}
        </select></label><span class="trainer-hint cm-hint-inline tip">or mark bars with <code>|</code></span>`;
  const chips = bars.map((b, i) => {
    const pick = b.pick;
    if (!pick) return `<div class="cm-hbar"><span class="cm-hnum">${i + 1}</span><span class="cm-mstat">—</span></div>`;
    const lvl = pick.fit ? pick.fit.level : 0;
    const notes = b.notes.map(n => spellPc(n.pc, key)).join(' ');
    return `<div class="cm-hbar">
      <span class="cm-hnum">${i + 1}</span>
      <button type="button" class="cm-hchord cm-fit-${lvl}${pick.outside ? ' outside' : ''}" data-action="cm:play" data-name="${escHtml(pick.name)}"
        title="${escHtml(`${pick.name} under ${notes}${pick.outside ? ' — borrowed / outside the key' : ''}`)}">${escHtml(pick.name)}</button>
      ${b.alts.length > 1 ? `<button type="button" class="cm-mini cm-hcycle" data-action="cm:hAlt" data-bar="${i}" title="Try the next option (${b.alts.map(a => a.name).join(' / ')})" aria-label="Next chord option for bar ${i + 1}">⟳</button>` : ''}
      <span class="cm-hnotes">${escHtml(notes)}</span>
    </div>`;
  }).join('');
  return `<div class="cm-harmony" id="cm-harmony">
    <div class="cm-mline"><span class="cm-mk-label">harmony</span>${sizeCtl}
      <button type="button" class="pb-btn" data-action="cm:hPlay" title="Play the melody over these chords at the current tempo">▶ play with chords</button>
      <button type="button" class="pb-btn" data-action="cm:hTrack" title="Save these chords as a new My chords track">→ new track</button>
    </div>
    <div class="cm-hbars">${chips}</div>
    ${trackNote ? `<div class="cm-mline"><span class="cm-mstat ok">${trackNote}</span> <button type="button" class="pb-btn" onclick="trainerNav('chords')">open My chords</button></div>` : ''}
  </div>`;
}
function melodyMidis(){
  let prev = 64;
  return (mel ? mel.notes : []).map(n => {
    let midi = n.midi;
    if (midi == null){
      const base = prev - ((prev - n.pc) % 12 + 12) % 12;
      midi = (prev - base) <= 6 ? base : base + 12;
    }
    prev = midi;
    return midi;
  });
}
export function playHarmony(){
  const bars = currentHarmony();
  if (!bars.length) return;
  const ctx = getCtx();
  const step = 30 / Math.max(40, getBPM() || 100);
  const midis = melodyMidis();
  let t = ctx.currentTime + 0.08, k = 0;
  bars.forEach(b => {
    const dur = b.notes.length * step;
    if (b.pick){
      const v = colorVoicing(b.pick.name);
      if (v && v.midis.length) playChordAtTime(v.midis.map(midiToHz), t, dur);
    }
    b.notes.forEach(() => { playNote(midiToHz(midis[k++] + 12), t, step * 1.5, 0.13); t += step; });
  });
}
function harmonyToTrack(){
  const bars = currentHarmony().filter(b => b.pick);
  if (!bars.length || !onNewTrack) return;
  const c = sessionClip();
  const name = c ? `${c.label} — harmony` : `Melody harmony (${keyLabel(currentKey())})`;
  onNewTrack(name, bars.map(b => ({ name: b.pick.name, frets: pinnedFretsFor(b.pick.name) })));
  trackNote = `Saved ${bars.length} chord${bars.length === 1 ? '' : 's'} as track "${escHtml(name)}".`;
  redrawMelodyReadout();
  trackNote = '';
}

/* ---- the melody on the neck --------------------------------------------- */
function neckHTML(){
  if (!melodyActive()) return '';
  const key = currentKey();
  const r = neckSVG(mel.notes, key, scalePcs(key), keyInfo(key).rootPc, { shift: neckShift });
  return `<details class="cm-neck" id="cm-neck"${neckOpen ? ' open' : ''}>
    <summary class="cm-mline"><span class="cm-mk-label">on the neck</span>
      <span class="cm-mstat">${r.exact ? 'as you typed it' : 'suggested fingering'} · frets ${r.lo}–${r.hi}${r.missing ? ` · ${r.missing} note${r.missing === 1 ? '' : 's'} off this window` : ''}</span>
    </summary>
    <div class="cm-mline cm-neck-tools">
      <button type="button" class="cm-mini" data-action="cm:neck" data-d="-1" aria-label="Move window down the neck" title="Lower on the neck">‹</button>
      <button type="button" class="cm-mini" data-action="cm:neck" data-d="1" aria-label="Move window up the neck" title="Higher on the neck">›</button>
      ${neckShift ? `<button type="button" class="pb-btn" data-action="cm:neck" data-d="0">fit</button>` : ''}
      <span class="trainer-hint cm-hint-inline">numbers = playing order · faint dots = the ${escHtml(keyLabel(key))} scale · amber = outside the key</span>
    </div>
    <div class="cm-neck-svg">${r.svg}</div>
  </details>`;
}
/* ---- reference clip, inline -----------------------------------------------
   The saved-clips list, played right here next to the melody box — no
   pop-out. Picking a clip loads its melody; the melody you type is saved
   back to it; its key / BPM tags can drive the map and tempo, and the
   melody's key can tag the clip. */
function clipOptionsHTML(){
  const list = getClips();
  return `<option value="">— no reference clip —</option>` + list.map(c => {
    const tags = [c.key, c.bpm ? c.bpm + ' bpm' : '', c.melody ? '♪' : ''].filter(Boolean).join(' · ');
    return `<option value="${c.id}"${c.id === sessionClipId ? ' selected' : ''}>${escHtml(c.label)}${tags ? ' — ' + escHtml(tags) : ''}</option>`;
  }).join('');
}
function clipFrameHTML(){
  const c = sessionClip();
  if (!c){
    return `<div class="cm-clip-empty">Pick a saved clip, or paste a link (X · Instagram · TikTok · YouTube) — it plays here while you work out the melody.</div>`;
  }
  const p = parseClipUrl(c.url) || { embedUrl: null, aspect: 'card', note: '' };
  if (!p.embedUrl){
    return `<div class="cm-clip-empty">${escHtml(p.note || "This link can't be embedded.")}
      <a class="pb-btn" href="${escHtml(c.url)}" target="_blank" rel="noopener noreferrer">open ↗</a></div>`;
  }
  return `<iframe src="${escHtml(embedFor(c, p))}" title="${escHtml(c.label)}"
    allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
    allowfullscreen referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe>`;
}
/* YouTube embeds get the JS API switched on (for the A–B loop + speed)
   and start at the loop's A point. */
function embedFor(c, p){
  if (p.platform !== 'youtube') return p.embedUrl;
  let u = p.embedUrl.replace(/&start=\d+/, '') + '&enablejsapi=1&playsinline=1';
  const L = c.loop;
  if (L && L.on && L.a) u += `&start=${Math.floor(L.a)}`;
  try { if (/^https?:/.test(location.origin)) u += `&origin=${encodeURIComponent(location.origin)}`; } catch { /* ignore */ }
  return u;
}
function renderClipFrame(){
  const f = $('cm-clip-frame');
  if (!f) return;
  frameStopped = false;
  f.innerHTML = clipFrameHTML();
  f.dataset.aspect = clipAspect();
  const ifr = f.querySelector('iframe');
  if (ifr) ifr.addEventListener('load', () => ytListen(ifr));
  ytTime = null; ytState = -1;
  const l = $('cm-clip-loop');
  if (l) l.innerHTML = clipLoopInnerHTML();
  document.dispatchEvent(new CustomEvent('gb:clipframe'));
}

/* ---- A–B loop + speed (YouTube IFrame API over postMessage) --------------
   No API script needed: we ask the player to report ("listening"), it
   streams infoDelivery messages with currentTime / playerState, and we
   send seekTo / setPlaybackRate commands back. */
let ytTime = null;
let ytTimeAt = 0;          // when ytTime arrived (ms), to interpolate between reports
let ytState = -1;          // YouTube playerState: 1 playing, 2 paused, 0 ended
let ytRate = 1;
let lastSeek = 0;
const timeListeners = new Set();
/* videosync.js: the playhead, reported ~4×/s while playing. */
export function onClipTime(fn){ timeListeners.add(fn); return () => timeListeners.delete(fn); }
/* Best guess of the playhead right now (interpolates while playing). */
export function clipNow(){
  if (ytTime == null) return null;
  return ytState === 1 ? ytTime + (Date.now() - ytTimeAt) / 1000 * ytRate : ytTime;
}
export function clipIsPlaying(){ return ytState === 1; }
export function colorMapSeek(t){ if (Number.isFinite(t)){ ytCommand('seekTo', [Math.max(0, t), true]); ytTime = Math.max(0, t); ytTimeAt = Date.now(); } }
export function colorMapSetLoop(patch){ setLoop(patch); }
export function colorMapIsYouTube(){ const c = sessionClip(); return !!c && (parseClipUrl(c.url) || {}).platform === 'youtube'; }
function ytFrame(){ return $('cm-clip-frame')?.querySelector('iframe') || null; }
function ytPost(msg){
  const f = ytFrame();
  try { f?.contentWindow?.postMessage(JSON.stringify({ id: 'gb-cm', channel: 'widget', ...msg }), '*'); } catch { /* ignore */ }
}
function ytCommand(func, args = []){ ytPost({ event: 'command', func, args }); }
function ytListen(){
  ytPost({ event: 'listening' });
  const c = sessionClip();
  if (c && c.loop && c.loop.rate && c.loop.rate !== 1) ytCommand('setPlaybackRate', [c.loop.rate]);
}
function loopCheck(ended){
  const c = sessionClip();
  const L = c && c.loop;
  if (!L || !L.on || !(L.b > (L.a || 0))) return;
  const a = L.a || 0;
  const now = Date.now();
  if (now - lastSeek < 500) return;
  if (ended || (ytTime != null && (ytTime >= L.b || ytTime < a - 0.75))){
    lastSeek = now;
    ytCommand('seekTo', [a, true]);
    if (ended) ytCommand('playVideo');
  }
}
function onYtMessage(e){
  let host = '';
  try { host = new URL(e.origin).hostname; } catch { return; }
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return;
  const f = ytFrame();
  if (!f || e.source !== f.contentWindow) return;
  let d;
  try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
  if (!d) return;
  if (d.event === 'onReady' || d.event === 'initialDelivery'){
    const c = sessionClip();
    if (c && c.loop && c.loop.rate && c.loop.rate !== 1) ytCommand('setPlaybackRate', [c.loop.rate]);
  }
  if (d.event === 'infoDelivery' && d.info){
    if (typeof d.info.playerState === 'number') ytState = d.info.playerState;
    if (typeof d.info.playbackRate === 'number') ytRate = d.info.playbackRate;
    if (typeof d.info.currentTime === 'number'){
      ytTime = d.info.currentTime; ytTimeAt = Date.now();
      const r = $('cm-loop-now'); if (r) r.textContent = fmtTime(ytTime);
      loopCheck(false);
      timeListeners.forEach(fn => { try { fn(ytTime); } catch (err) { console.error(err); } });
    }
    if (d.info.playerState === 0) loopCheck(true);
  }
}
function fmtTime(sec){
  if (sec == null || !Number.isFinite(sec)) return '';
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${(Math.round(s * 10) / 10).toFixed(s % 1 ? 1 : 0)}`;
}
function parseTime(str){
  const t = String(str || '').trim();
  if (!t) return null;
  const m = t.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return NaN;
  return (m[1] ? parseInt(m[1], 10) * 60 : 0) + parseFloat(m[2]);
}
function setLoop(patch){
  const c = sessionClip();
  if (!c) return;
  const L = { a: null, b: null, on: false, rate: 1, ...(c.loop || {}), ...patch };
  clipsUpdate(c.id, 'loop', L);
  const l = $('cm-clip-loop');
  if (l) l.innerHTML = clipLoopInnerHTML();
}
function clipLoopInnerHTML(){
  const c = sessionClip();
  if (!c) return '';
  const p = parseClipUrl(c.url) || {};
  if (p.platform !== 'youtube' || !p.embedUrl){
    return `<span class="trainer-hint cm-hint-inline tip">A–B loop &amp; speed work on YouTube clips (Instagram / TikTok embeds don't allow control).</span>`;
  }
  const L = c.loop || {};
  const rate = L.rate || 1;
  const ready = L.b > (L.a || 0);
  return `<span class="cm-mel-label">loop</span>
    <label class="cm-time-l">A <input class="cm-time" value="${escHtml(fmtTime(L.a))}" placeholder="0:00" inputmode="decimal" aria-label="Loop start"
      data-on-change="cm:loopSet" data-k="a"></label>
    <button type="button" class="cm-mini" data-action="cm:loopMark" data-k="a" title="Set A to where the video is now" aria-label="Set A to current time">⤓</button>
    <label class="cm-time-l">B <input class="cm-time" value="${escHtml(fmtTime(L.b))}" placeholder="0:08" inputmode="decimal" aria-label="Loop end"
      data-on-change="cm:loopSet" data-k="b"></label>
    <button type="button" class="cm-mini" data-action="cm:loopMark" data-k="b" title="Set B to where the video is now" aria-label="Set B to current time">⤓</button>
    <button type="button" class="pb-btn cm-loop-toggle${L.on ? ' on' : ''}" data-action="cm:loopToggle" aria-pressed="${!!L.on}"${ready ? '' : ' disabled title="Set A and B first"'}>${L.on ? '↻ looping' : '↻ loop'}</button>
    <label class="cm-time-l">speed <select class="tab-style-select cm-rate" data-on-change="cm:rate" aria-label="Playback speed">
      ${[0.5, 0.75, 0.9, 1].map(r => `<option value="${r}"${r === rate ? ' selected' : ''}>${r === 1 ? '1×' : r + '×'}</option>`).join('')}
    </select></label>
    <span class="cm-mstat" id="cm-loop-now" title="current playhead"></span>`;
}
function clipAspect(){
  const c = sessionClip();
  return c ? ((parseClipUrl(c.url) || {}).aspect || 'card') : 'none';
}
function clipTagsHTML(){
  const c = sessionClip();
  if (!c) return '';
  const key = currentKey();
  const clipKey = normalizeKey(c.key);
  const bits = [];
  bits.push(`<span class="cm-clip-plat">${escHtml(PLATFORM_LABEL[c.platform] || 'Link')}</span>`);
  if (clipKey){
    bits.push(samePitchKey(clipKey, key)
      ? `<span class="cm-mstat ok">key ${escHtml(keyLabel(clipKey))} ✓</span>`
      : `<button type="button" class="pb-btn" data-action="cm:clipKey" data-key="${clipKey}" title="Set the app key to the clip's key">use clip key: ${escHtml(keyLabel(clipKey))}</button>`);
  } else if (c.key){
    bits.push(`<span class="cm-mstat">key tag "${escHtml(c.key)}"</span>`);
  }
  if (c.bpm) bits.push(`<button type="button" class="pb-btn" data-action="clips:usebpm" data-id="${c.id}" title="Push the clip's BPM to the tempo keeper">↑ ${c.bpm} bpm</button>`);
  bits.push(`<button type="button" class="pb-btn" data-action="clips:capturebpm" data-id="${c.id}" title="Tap tempo along with the clip, then save the metronome's BPM on it">↓ save tempo</button>`);
  // melody → clip key tag
  if (melodyActive()){
    const ks = keysForMelody(mel, key);
    const best = ks.complete && ks.keys.length ? (ks.keys.find(k => samePitchKey(k, key)) || ks.keys[0]) : null;
    if (best && !(clipKey && samePitchKey(clipKey, best))){
      bits.push(`<button type="button" class="pb-btn" data-action="cm:clipTagKey" data-key="${best}" title="Save this key on the clip (from the melody)">🏷 tag clip ${escHtml(keyLabel(best))}</button>`);
    }
  }
  const found = chordsIn(`${c.label || ''} ${c.notes || ''}`);
  if (found.length){
    bits.push(`<span class="cm-clip-chords" aria-label="Chords mentioned in this clip">${found.slice(0, 12).map(n => {
      const loc = locateChord(n, key);
      return `<button type="button" class="cm-cchip${loc && loc.exact && loc.view === 'in' ? '' : ' out'}" data-action="cm:peek" data-name="${escHtml(n)}" title="${escHtml(n)}${loc ? ' — ' + loc.roman : ''}">${escHtml(n)}</button>`;
    }).join('')}<button type="button" class="pb-btn" data-action="finder:openText" data-text="${escHtml(found.join(' '))}" title="Open these chords in the chord finder (diagrams, key, make a track)">🔎</button></span>`);
  }
  bits.push(`<span class="cm-mstat">${melodyActive() ? '♪ melody saved with this clip' : 'type the melody → it saves with this clip'}</span>`);
  bits.push(`<a class="pb-btn" href="${escHtml(c.url)}" target="_blank" rel="noopener noreferrer" title="Open on the platform">↗</a>`);
  return bits.join('');
}
function clipPanelHTML(){
  return `<div class="cm-clip" id="cm-clip" role="group" aria-label="Reference clip">
    <div class="cm-mrow">
      <span class="cm-mel-label">reference</span>
      <select id="cm-clip-select" class="tab-style-select cm-clip-select" data-on-change="cm:clipPick" aria-label="Reference clip">${clipOptionsHTML()}</select>
    </div>
    <div class="cm-mrow">
      <input id="cm-clip-url" class="cm-mel-input cm-clip-url" type="url" autocomplete="off" spellcheck="false"
        placeholder="paste a link to add + play it here" aria-label="Add a clip by link" data-on-enter="cm:clipAdd">
      <button type="button" class="pb-btn" data-action="cm:clipAdd">add</button>
    </div>
    <div class="cm-clip-frame" id="cm-clip-frame" data-aspect="${clipAspect()}">${clipFrameHTML()}</div>
    <div class="cm-clip-loop cm-mline" id="cm-clip-loop">${clipLoopInnerHTML()}</div>
    <div class="cm-vsync cm-mline" id="cm-vsync"></div>
    <div class="cm-clip-tags" id="cm-clip-tags">${clipTagsHTML()}</div>
    <details class="cm-sync"><summary>⇄ sync clips with another device</summary>${clipsSyncHTML()}</details>
    <div class="cm-clip-err" id="cm-clip-err" aria-live="polite"></div>
  </div>`;
}
/* Pick (or clear) the reference clip: swap the inline player, take over
   from the dock, and load that clip's melody. */
function pickClip(id){
  const prev = sessionClipId;
  sessionClipId = id && getClip(id) ? id : null;
  if (prev === sessionClipId) return;
  saveJSON(MELODY_KEY, { text: globalMel.text, mode: globalMel.mode, clipId: sessionClipId });
  if (sessionClipId) clipsDetachDock();
  document.dispatchEvent(new CustomEvent('gb:refclip', { detail: { id: sessionClipId } }));
  applyContextMelody();
  const f = $('cm-clip-frame');
  if (f) renderClipFrame();
  const sel = $('cm-clip-select');
  if (sel) sel.innerHTML = clipOptionsHTML();
  redrawForMelody();
}
function addClipFromInput(raw){
  const err = $('cm-clip-err');
  const meta = parseClipUrl(raw) || parseClipUrl(splitLinkText(raw).url);
  if (!meta){ if (err) err.textContent = "That doesn't look like a link."; return false; }
  const clip = clipsAdd(raw, { open: false });
  if (!clip) return false;
  if (err) err.textContent = meta.note || '';
  const input = $('cm-clip-url');
  if (input) input.value = '';
  pickClip(clip.id);
  return true;
}
function refreshClipChrome(){
  const sel = $('cm-clip-select');
  if (sel) sel.innerHTML = clipOptionsHTML();
  const t = $('cm-clip-tags');
  if (t) t.innerHTML = clipTagsHTML();
}
/* Is the map on screen? (Shape Trainer tab open on My chords / Color map.) */
function mapVisible(){
  if (document.body.classList.contains('study-open')) return !!$('cm-clip');
  const sub = $('inner-trainer')?.dataset.sub;
  return !!($('cm-clip') && $('panel-trainer')?.classList.contains('active') && (sub === 'chords' || sub === 'colormap'));
}
/* For the study view: put a link (or a saved clip) in the inline player. */
export function colorMapAddClip(text){ return addClipFromInput(text); }
export function colorMapPickClip(id){ pickClip(id); }
export function colorMapClipId(){ return sessionClipId; }
/* player.js: ✕ stops the video (drops the iframe); showing it again reloads. */
let frameStopped = false;
export function colorMapStopFrame(){ const f = $('cm-clip-frame'); if (f) f.innerHTML = ''; frameStopped = true; ytTime = null; }
export function colorMapReloadFrame(){ frameStopped = false; renderClipFrame(); }
export function colorMapFrameLoaded(){ return !frameStopped; }

function melodyPanelHTML(){
  return `<div class="cm-melody" id="colormap-melody" role="group" aria-label="Melody lens">
    <div class="cm-mrow">
      <span class="cm-mel-label" id="cm-mel-label">melody</span>
      <div class="cm-switch cm-mel-mode" id="cm-melody-mode" role="radiogroup" aria-label="Type notes or frets">${melodyModeHTML()}</div>
      <input id="cm-melody-input" class="cm-mel-input" type="text" autocomplete="off" spellcheck="false"
        value="${escHtml(melodyText)}" placeholder="${escHtml(melodyPlaceholder())}" aria-label="Melody notes or frets"
        data-on-input="cm:melody">
      <button type="button" class="pb-btn" data-action="cm:melPlay" title="Play the melody at the current tempo">▶ play</button>
      <button type="button" class="pb-btn" data-action="cm:melClear">clear</button>
    </div>
    <div class="cm-mel-readout" id="cm-melody-readout" aria-live="polite">${melodyReadoutHTML()}</div>
  </div>`;
}
function redrawMelodyReadout(){
  const r = $('cm-melody-readout');
  if (r) r.innerHTML = melodyReadoutHTML();
  const t = $('cm-clip-tags');
  if (t) t.innerHTML = clipTagsHTML();
  const m = $('cm-melody-mode');
  if (m) m.innerHTML = melodyModeHTML();
  const input = $('cm-melody-input');
  if (input) input.placeholder = melodyPlaceholder();
}

/* Play the typed melody: notes without an octave are placed nearest the
   previous one (starting around E4), eighth notes at the current tempo. */
function playMelody(){
  if (!melodyActive()) return;
  const ctx = getCtx();
  const step = 30 / Math.max(40, getBPM() || 100);
  let t = ctx.currentTime + 0.05, prev = 64;
  mel.notes.forEach(n => {
    let midi = n.midi;
    if (midi == null){
      const base = prev - ((prev - n.pc) % 12 + 12) % 12;      // same pc at or below prev
      midi = (prev - base) <= 6 ? base : base + 12;
    }
    playNote(midiToHz(midi), t, step * 1.6);
    prev = midi;
    t += step;
  });
}

/* Render the whole map into a host element (the Shape Trainer tab's
   #colormap-host) and wire its drag-and-drop there. */
export function mountColorMap(host){
  if (!host) return;
  host.innerHTML = colorMapHTML();
  initColorMapDrag(host);
}

export function colorMapHTML(){
  const key = currentKey();
  const body = bodyHTML(key);          // first, so the melody readout sees this view's ★ picks
  return `
  <details class="colormap" id="colormap" open>
    <summary><span class="section-label">Color map</span>
      <span class="trainer-hint cm-hint tip">Click to hear · drag onto the track or table · + to append · ✎ edit to make it yours.</span>
    </summary>
    <div class="cm-tools" id="colormap-tools">${toolsHTML(key)}</div>
    <div class="cm-session">
      ${$('cm-clip') ? '' : clipPanelHTML()}
      ${melodyPanelHTML()}
    </div>
    <div id="colormap-body">${body}</div>
  </details>`;
}

export function redrawColorMap(){
  const body = $('colormap-body');
  if (!body) return;
  const key = currentKey();
  body.innerHTML = bodyHTML(key);
  const tools = $('colormap-tools');
  if (tools) tools.innerHTML = toolsHTML(key);
  redrawMelodyReadout();
}
/* Typing in the melody box: repaint the map + readout, never the input. */
function redrawForMelody(){
  const body = $('colormap-body');
  if (body) body.innerHTML = bodyHTML(currentKey());
  redrawMelodyReadout();
}

export function setColorMapView(v){
  if (!VIEWS[v]) return;
  view = v;
  lastError = '';
  saveJSON(VIEW_KEY, view);
  redrawColorMap();
}
export function getColorMapView(){ return view; }

/* Switch the map to wherever `name` lives, scroll to it, flash it and
   show its shape. Call after the map is on screen. Returns the location. */
export function revealInColorMap(name){
  const loc = locateChord(name, currentKey());
  if (!loc) return null;
  if (loc.view !== view) setColorMapView(loc.view);
  const col = document.querySelector(`.cm-col[data-col="${loc.colId}"]`);
  const chip = loc.exact ? [...(col?.querySelectorAll('.cm-chip') || [])].find(c => sameChord(c.dataset.name, name)) : null;
  const target = chip || col;
  if (!target) return loc;
  target.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  target.classList.remove('cm-flash'); void target.offsetWidth; target.classList.add('cm-flash');
  if (chip) setTimeout(() => showChordPeek(chip, { name: chip.dataset.name, frets: colorVoicing(chip.dataset.name)?.frets, sub: `${loc.roman} · ${FN_LABEL[loc.fn] || ''}`, autoHideMs: 4000 }), 350);
  return loc;
}

function importEditsFile(input){
  const file = input && input.files && input.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const doc = JSON.parse(r.result);
      const inc = doc && (doc.edits || doc);
      if (!inc || typeof inc !== 'object') throw new Error('no edits in that file');
      for (const mode of ['major', 'minor']){
        if (!inc[mode]) continue;
        edits[mode] = edits[mode] || {};
        for (const v of Object.keys(inc[mode])) if (VIEWS[v]) edits[mode][v] = inc[mode][v];
      }
      saveJSON(EDIT_KEY, edits);
      lastError = '';
    } catch (e){ lastError = `Couldn't import edits: ${e.message || e}`; }
    input.value = '';
    redrawColorMap();
  };
  r.readAsText(file);
}
/* Shortcut hooks: play the triad (or first colour) on a degree of the app key. */
export function playDegree(deg, colour = false){
  const col = mapColumns(currentKey(), 'in')[deg];
  if (!col) return;
  const name = colour && col.items[0] ? col.items[0].name : col.anchor;
  playName(name);
  return name;
}
export function playMelodyNow(){ playMelody(); }
export function hasMelody(){ return melodyActive(); }
function playName(name){
  const v = colorVoicing(name);
  if (v && v.midis && v.midis.length) playChordNow(v.midis.map(midiToHz));
}

/* ---- drag & drop ------------------------------------------------------------
   Out of the map: chips → 'colormap' payload (track + chord table accept it).
   Into the map (edit mode): a chip from another column (copy) or the same
   column (reorder), a track chord, or a table card → inserted where dropped.
   Items render top-down from the LAST index, so "above a chip" = after it. */
function dropIndex(e, colEl){
  const chips = [...colEl.querySelectorAll('.cm-colors .cm-chip[data-idx]')];
  for (const ch of chips){
    const r = ch.getBoundingClientRect();
    if (e.clientY >= r.top && e.clientY <= r.bottom){
      const idx = parseInt(ch.dataset.idx, 10);
      return e.clientY < r.top + r.height / 2 ? idx + 1 : idx;
    }
  }
  return null;
}
export function initColorMapDrag(root){
  if (!root || root.__colormapDragWired) return;
  root.__colormapDragWired = true;
  root.addEventListener('dragstart', e => {
    const chip = e.target.closest && e.target.closest('.cm-chip');
    if (!chip) return;
    const name = chip.dataset.name;
    const pinned = pinnedFretsFor(name);
    const v = colorVoicing(name);
    const payload = { source: 'colormap', name, frets: pinned || (v ? v.frets : null), pinned: !!pinned,
      col: chip.dataset.col || null, idx: chip.dataset.idx !== undefined ? parseInt(chip.dataset.idx, 10) : null };
    setDragPayload(payload);
    try {
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
      e.dataTransfer.setData('text/plain', name);
      e.dataTransfer.effectAllowed = 'copyMove';
    } catch { /* ignore */ }
    chip.classList.add('dragging');
  });
  root.addEventListener('dragend', () => {
    root.querySelectorAll('.cm-chip.dragging').forEach(c => c.classList.remove('dragging'));
    root.querySelectorAll('.cm-col.drop-target').forEach(c => c.classList.remove('drop-target'));
    clearDragPayload();
  });
  root.addEventListener('dragover', e => {
    if (!editing) return;
    const colEl = e.target.closest && e.target.closest('.cm-col');
    const p = getDragPayload();
    if (!colEl || !p) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = (p.source === 'colormap' && p.col === colEl.dataset.col) ? 'move' : 'copy';
    root.querySelectorAll('.cm-col.drop-target').forEach(c => { if (c !== colEl) c.classList.remove('drop-target'); });
    colEl.classList.add('drop-target');
  });
  root.addEventListener('dragleave', e => {
    const colEl = e.target.closest && e.target.closest('.cm-col');
    if (colEl && !colEl.contains(e.relatedTarget)) colEl.classList.remove('drop-target');
  });
  root.addEventListener('drop', e => {
    if (!editing) return;
    const colEl = e.target.closest && e.target.closest('.cm-col');
    const p = getDragPayload();
    if (!colEl || !p) return;
    e.preventDefault();
    colEl.classList.remove('drop-target');
    const colId = colEl.dataset.col;
    const at = dropIndex(e, colEl);
    if (p.source === 'colormap' && p.col === colId && p.idx !== null){
      moveWithin(colId, p.idx, at === null ? Infinity : at);
    } else {
      addTo(colId, p.name, at);
    }
    clearDragPayload();
  });
  root.addEventListener('keydown', e => {
    const chip = e.target.closest && e.target.closest('.cm-chip');
    if (chip && e.target === chip && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); playName(chip.dataset.name); }
  });
}

/* Test / devtools hooks for the edit operations. */
export const colorMapEditOps = { addTo, removeFrom, renameIn, moveWithin, setEditing: (on) => { editing = !!on; redrawColorMap(); } };

export function initColorMap(){
  const saved = loadJSON(VIEW_KEY);
  if (VIEWS[saved]) view = saved;
  loadEdits();
  loadMelody();
  registerActions({
    'cm:melody': (el) => { melodyText = el.value; reparseMelody(); saveMelody(); redrawForMelody(); },
    'cm:melMode': (el) => { melodyMode = el.dataset.mode === 'frets' ? 'frets' : 'notes'; reparseMelody(); saveMelody(); redrawForMelody(); },
    'cm:melPlay': () => playMelody(),
    'cm:melClear': () => { setMelody(''); const i = $('cm-melody-input'); if (i) i.focus(); },
    'cm:clipPick': (el) => pickClip(el.value),
    'cm:clipAdd': (el, e) => { if (e) e.preventDefault(); const i = $('cm-clip-url'); addClipFromInput(i ? i.value : ''); },
    'cm:clipKey': (el) => { const k = el.dataset.key; if (!isKey(k)) return; mapKey = k; syncKey(k, 'colormap-key'); redrawColorMap(); },
    'cm:clipTagKey': (el) => { const c = sessionClip(); if (!c || !isKey(el.dataset.key)) return; clipsUpdate(c.id, 'key', el.dataset.key); refreshClipChrome(); },
    'cm:melKey': (el) => { const k = el.dataset.key; if (!isKey(k)) return; mapKey = k; syncKey(k, 'colormap-key'); redrawColorMap(); },
    'cm:view': (el) => setColorMapView(el.dataset.view),
    'cm:play': (el) => {
      playName(el.dataset.name);
      // a chip (not the ▶ button in edit mode) also shows its fingering for a moment
      const chip = el.closest('.cm-chip') || el;
      const col = chip.closest('.cm-col');
      const c = col ? findColumn(col.dataset.col) : null;
      const touch = isTouch();
      showChordPeek(chip, { name: el.dataset.name, frets: colorVoicing(el.dataset.name)?.frets,
        sub: c ? `${c.roman} · ${FN_LABEL[c.fn] || ''}` : '', autoHideMs: touch ? 6000 : 3500,
        // touch: drag-and-drop doesn't work, so the card carries the add buttons
        actions: touch ? [{ label: '+ track', action: 'peek:track', frets: pinnedFretsFor(el.dataset.name) }, { label: '+ keep', action: 'peek:keep' }] : null });
    },
    'cm:peek': (el) => {
      playName(el.dataset.name);
      const touch = isTouch();
      showChordPeek(el, { name: el.dataset.name, frets: colorVoicing(el.dataset.name)?.frets, autoHideMs: touch ? 6000 : 3500,
        actions: touch ? [{ label: '+ track', action: 'peek:track' }, { label: '+ keep', action: 'peek:keep' }] : null });
    },
    'cm:add': (el, e) => { e.stopPropagation(); if (onAdd) onAdd(el.dataset.name, pinnedFretsFor(el.dataset.name)); },
    'cm:key': (el) => { mapKey = el.value; syncKey(el.value, 'colormap-key'); redrawColorMap(); },
    'cm:modulate': (el) => { const k = el.dataset.key; if (!isKey(k)) return; mapKey = k; syncKey(k, 'colormap-key'); setColorMapView('in'); },
    'cm:edit': () => { editing = !editing; lastError = ''; redrawColorMap(); },
    'cm:reset': () => { resetColorMapEdits(currentMode(), view); lastError = ''; redrawColorMap(); },
    'cm:exportEdits': () => downloadJSON({ format: 'genre-bender-colormap-edits', v: 1, exportedAt: new Date().toISOString(), edits },
      `genre-bender-colormap-edits-${new Date().toISOString().slice(0, 10)}.json`),
    'cm:importEdits': (el) => importEditsFile(el),
    'cm:barSize': (el) => { perBar = Math.max(1, parseInt(el.value, 10) || 4); harmonyPicks = {}; saveMelody(); redrawMelodyReadout(); },
    'cm:hAlt': (el) => { const i = +el.dataset.bar; harmonyPicks[i] = ((harmonyPicks[i] || 0) + 1) % 3; redrawMelodyReadout(); const b = currentHarmony()[i]; if (b && b.pick) playName(b.pick.name); },
    'cm:hPlay': () => playHarmony(),
    'cm:hTrack': () => harmonyToTrack(),
    'cm:neck': (el) => { const d = +el.dataset.d; neckShift = d === 0 ? 0 : neckShift + d; redrawMelodyReadout(); },
    'cm:loopSet': (el) => { const v = parseTime(el.value); if (Number.isNaN(v)){ el.classList.add('bad'); return; } setLoop({ [el.dataset.k]: v }); },
    'cm:loopMark': (el) => { if (ytTime == null){ const n = $('cm-loop-now'); if (n) n.textContent = 'press play first'; return; } setLoop({ [el.dataset.k]: Math.round(ytTime * 10) / 10 }); },
    'cm:loopToggle': () => { const c = sessionClip(); if (!c) return; const on = !(c.loop && c.loop.on); setLoop({ on }); if (on) ytCommand('seekTo', [(c.loop && c.loop.a) || 0, true]); },
    'cm:rate': (el) => { const r = +el.value; setLoop({ rate: r }); ytCommand('setPlaybackRate', [r]); },
    'cm:remove': (el) => removeFrom(el.dataset.col, parseInt(el.dataset.idx, 10)),
    'cm:rename': (el) => renameIn(el.dataset.col, parseInt(el.dataset.idx, 10), el.value),
    'cm:addItem': (el, e) => {
      e.preventDefault();
      const colId = el.dataset.col;
      if (addTo(colId, el.value)){
        const again = document.querySelector(`.cm-add-input[data-col="${colId}"]`);
        if (again) again.focus();
      }
    },
  });
  onAppKeyChange((k, src) => { if (src === 'colormap-key') return; mapKey = k; redrawColorMap(); });
  initChordPeek();
  window.addEventListener('message', onYtMessage);
  document.addEventListener('toggle', e => { if (e.target && e.target.id === 'cm-neck') neckOpen = e.target.open; }, true);
  // clip list edits anywhere (dock tags, analyze, our own melody saves)
  onClipsChange(() => {
    if (sessionClipId && !getClip(sessionClipId)){ pickClip(null); return; }
    refreshClipChrome();
  });
  // the dock took the clip back ("play here instead") → stop the inline player
  onDockReattach(() => { if (sessionClipId) pickClip(null); });
  // links pasted while the map is on screen land here, not in the pop-out
  setClipPasteRoute(text => mapVisible() ? addClipFromInput(text) : false);
  // clips load after this module boots: re-apply the remembered clip once they're in
  setTimeout(() => {
    if (sessionClipId && !getClip(sessionClipId)){ sessionClipId = null; }
    applyContextMelody();
    const f = $('cm-clip-frame');
    if (f) renderClipFrame();
    refreshClipChrome();
    redrawForMelody();
  }, 0);
}
