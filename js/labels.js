/* ============================================================
   labels.js — how notation is LABELLED, app-wide.

   Two independent display modes, owned here so every renderer
   (chord boxes, ASCII tab, the interactive phrase grid, chord
   cards, the frets→chords panel, the trainer's fretboards) reads
   the same switch instead of each growing its own:

     • fret mode   'number' | 'note'
         a fret number becomes the note it actually sounds on that
         string ("3" on the low E → "G").
     • chord mode  'name' | 'degree'
         a chord name becomes its scale degree relative to the
         current key ("Am" in C → "vi", "Bb" in C → "♭VII").

   Both persist to localStorage and broadcast a change so open
   panels repaint. NOTHING here changes what is played or exported
   — this module only decides what the text says.

   Import direction: labels.js → scales/chordbook/theory. Nothing
   in those three imports labels.js, so there's no cycle.
   ============================================================ */
import { STRING_OPEN_MIDI, pcToName } from './theory.js';
import { parseChordName } from './chordbook.js';
import { keyInfo, SCALE_STEPS } from './scales.js';

import { registerStore, loadJSON, saveJSON } from './storage.js';
const STORE_KEY = registerStore('labels', 'GenreBenderLabels_v1');

export const FRET_MODES  = ['number', 'note'];
export const CHORD_MODES = ['name', 'degree'];

const state = { fret: 'number', chord: 'name' };

/* ---- persistence --------------------------------------------------------- */
(function load(){
  const raw = loadJSON(STORE_KEY);
  if (raw && FRET_MODES.includes(raw.fret))   state.fret  = raw.fret;
  if (raw && CHORD_MODES.includes(raw.chord)) state.chord = raw.chord;
})();

function save(){
  saveJSON(STORE_KEY, state);
}

/* ---- subscribers --------------------------------------------------------- */
const listeners = new Set();

/* Register a repaint callback. Returns an unsubscribe function. */
export function onLabelsChange(fn){
  if (typeof fn === 'function') listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(){
  listeners.forEach(fn => {
    // one broken panel must not stop the others repainting
    try { fn(state.fret, state.chord); } catch (e) { console.error('labels listener:', e); }
  });
}

/* ---- mode accessors ------------------------------------------------------ */
export function getFretMode(){ return state.fret; }
export function getChordMode(){ return state.chord; }
export function showingNotes(){ return state.fret === 'note'; }
export function showingDegrees(){ return state.chord === 'degree'; }

export function setFretMode(m){
  if (!FRET_MODES.includes(m) || m === state.fret) return;
  state.fret = m; save(); syncLabelToggleUI(); emit();
}
export function setChordMode(m){
  if (!CHORD_MODES.includes(m) || m === state.chord) return;
  state.chord = m; save(); syncLabelToggleUI(); emit();
}
export function toggleFretLabels(){ setFretMode(state.fret === 'note' ? 'number' : 'note'); }
export function toggleChordLabels(){ setChordMode(state.chord === 'degree' ? 'name' : 'degree'); }

/* ---- fret ⇄ note --------------------------------------------------------- */
/* The pitch class sounding at (string, fret) in standard tuning. */
export function noteAt(stringIdx, fret){
  const open = STRING_OPEN_MIDI[stringIdx];
  if (open == null || fret == null || !Number.isFinite(+fret)) return null;
  return pcToName(open + (+fret));
}

/* Label for a single fret on a string, honouring the current mode.
   Falls back to the number if the string index is unknown. */
export function fretLabel(stringIdx, fret, mode = state.fret){
  if (fret == null) return '';
  if (mode !== 'note') return String(fret);
  return noteAt(stringIdx, fret) || String(fret);
}

/* The bend marker that suits the current fret mode — "b" reads as a flat
   once frets are shown as note names, so note mode uses an arrow. */
export function bendMark(mode = state.fret){
  return mode === 'note' ? '↑' : 'b';
}

/* A formatter bound to one string — handy for renderers that walk a
   row of a tab and just need fret → text. */
export function fretFormatter(stringIdx, mode = state.fret){
  return (fret) => fretLabel(stringIdx, fret, mode);
}

/* ---- chord name ⇄ scale degree ------------------------------------------- */
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/* Per chord quality: does the numeral go lowercase, what symbol trails
   the numeral, and what extension text follows. Keys match
   chordbook.parseChordName()'s `quality`. */
const DEGREE_QUALITY = {
  maj:    { lower: false, mark: '',  ext: ''      },
  min:    { lower: true,  mark: '',  ext: ''      },
  dim:    { lower: true,  mark: '°', ext: ''      },
  aug:    { lower: false, mark: '+', ext: ''      },
  sus2:   { lower: false, mark: '',  ext: 'sus2'  },
  sus4:   { lower: false, mark: '',  ext: 'sus4'  },
  dom7:   { lower: false, mark: '',  ext: '7'     },
  min7:   { lower: true,  mark: '',  ext: '7'     },
  maj7:   { lower: false, mark: '',  ext: 'maj7'  },
  m7b5:   { lower: true,  mark: 'ø', ext: '7'     },
  dim7:   { lower: true,  mark: '°', ext: '7'     },
  six:    { lower: false, mark: '',  ext: '6'     },
  min6:   { lower: true,  mark: '',  ext: '6'     },
  six9:   { lower: false, mark: '',  ext: '6/9'   },
  add9:   { lower: false, mark: '',  ext: 'add9'  },
  madd9:  { lower: true,  mark: '',  ext: 'add9'  },
  dom9:   { lower: false, mark: '',  ext: '9'     },
  maj9:   { lower: false, mark: '',  ext: 'maj9'  },
  min9:   { lower: true,  mark: '',  ext: '9'     },
  dom11:  { lower: false, mark: '',  ext: '11'    },
  min11:  { lower: true,  mark: '',  ext: '11'    },
  maj11:  { lower: false, mark: '',  ext: 'maj11' },
  dom13:  { lower: false, mark: '',  ext: '13'    },
  min13:  { lower: true,  mark: '',  ext: '13'    },
  maj13:  { lower: false, mark: '',  ext: 'maj13' },
  dom7s9: { lower: false, mark: '',  ext: '7♯9'   },
  dom7b9: { lower: false, mark: '',  ext: '7♭9'   },
  dom7s5: { lower: false, mark: '+', ext: '7'     },
  dom7b5: { lower: false, mark: '',  ext: '7♭5'   },
  minS5:  { lower: true,  mark: '',  ext: '♯5'    },
  dimb9:  { lower: true,  mark: '°', ext: '♭9'    },
};

/* Roman-numeral degree of `name` within `key` (e.g. ("Am","C") -> "vi",
   ("Bb","C") -> "♭VII", ("G7","C") -> "V7"). Returns the chord name
   unchanged if either side can't be parsed or the root can't be placed
   on the scale — better a correct letter name than a wrong numeral. */
export function degreeLabel(name, key){
  const p = parseChordName(name);
  if (!p) return String(name ?? '');
  const ki = keyInfo(key || 'C');
  const steps = SCALE_STEPS[ki.mode] || SCALE_STEPS.major;
  const offset = ((p.rootPc - ki.rootPc) % 12 + 12) % 12;

  let idx = steps.indexOf(offset), accidental = '';
  if (idx < 0){                                  // chromatic root: spell it ♭/♯
    idx = steps.indexOf((offset + 1) % 12);
    if (idx >= 0) accidental = '♭';
    else {
      idx = steps.indexOf(((offset - 1) % 12 + 12) % 12);
      if (idx >= 0) accidental = '♯';
    }
  }
  if (idx < 0) return String(name);

  const q = DEGREE_QUALITY[p.quality] || DEGREE_QUALITY.maj;
  const numeral = q.lower ? ROMAN[idx].toLowerCase() : ROMAN[idx];
  return accidental + numeral + q.mark + q.ext;
}

/* Chord label honouring the current mode. `key` is whatever key the
   caller's panel is working in ("Am", "C", …). */
export function chordLabel(name, key, mode = state.chord){
  if (mode !== 'degree') return String(name ?? '');
  return degreeLabel(name, key);
}

/* ---- toggle-button UI ---------------------------------------------------- */
/* Keeps the two header buttons in sync with the state (also called at
   boot, so a restored preference lights the right button). */
export function syncLabelToggleUI(){
  if (typeof document === 'undefined') return;
  const f = document.getElementById('label-fret-toggle');
  if (f){
    const on = state.fret === 'note';
    f.classList.toggle('on', on);
    f.setAttribute('aria-pressed', String(on));
    f.textContent = on ? '♪ note names' : '# fret numbers';
  }
  const c = document.getElementById('label-chord-toggle');
  if (c){
    const on = state.chord === 'degree';
    c.classList.toggle('on', on);
    c.setAttribute('aria-pressed', String(on));
    c.textContent = on ? 'Ⅴ degrees' : 'A chord names';
  }
}

/* ---- ASCII-tab conversion ------------------------------------------------ */
/* Rewrite a block of six-line ASCII tab (the shape the AI tab generator
   returns) so every fret number reads as its sounding note, keeping the
   columns aligned. Lines are matched in groups of six labelled rows and
   assumed top→bottom = high e → low E, the standard printing order.

   Anything it can't confidently parse is returned untouched — a tab that
   still shows numbers beats a tab that's been mangled. */
const TAB_LINE_RE = /^(\s*)([eEbBgGdDaA])(\s*\|)(.*)$/;
const ROW_TO_STRING = [5, 4, 3, 2, 1, 0];   // printed top row = high e = index 5

export function tabToNoteNames(tabText){
  const text = String(tabText ?? '');
  if (!text) return text;
  try {
    const lines = text.split('\n');
    const out = lines.slice();
    let i = 0;
    while (i < lines.length){
      if (!TAB_LINE_RE.test(lines[i])){ i++; continue; }
      // collect the contiguous run of tab-looking lines
      let j = i;
      while (j < lines.length && TAB_LINE_RE.test(lines[j])) j++;
      const block = lines.slice(i, j);
      if (block.length === 6){
        const converted = convertBlock(block);
        if (converted) for (let k = 0; k < 6; k++) out[i + k] = converted[k];
      }
      i = j;
    }
    return out.join('\n');
  } catch (e) {
    console.error('tabToNoteNames:', e);
    return text;
  }
}

/* Convert one 6-line block. Walks the shared column axis so that a run of
   digits in any row widens that column for every row — which is what keeps
   the six lines lined up after "10" becomes "D" and "3" becomes "G". */
function convertBlock(block){
  const heads = [], bodies = [];
  for (const line of block){
    const m = TAB_LINE_RE.exec(line);
    if (!m) return null;
    heads.push(m[1] + m[2] + m[3]);
    bodies.push(m[4]);
  }
  // pad the head column so the six prefixes are equal width
  const headW = Math.max(...heads.map(h => h.length));
  const maxLen = Math.max(...bodies.map(b => b.length));
  const outBodies = ['', '', '', '', '', ''];

  let c = 0;
  while (c < maxLen){
    // longest digit-run starting at this column, across all six rows
    const runs = bodies.map(b => (/^\d+/.exec(b.slice(c)) || [null])[0]);
    const runLen = Math.max(1, ...runs.map(r => (r ? r.length : 0)));
    const pieces = bodies.map((b, row) => {
      const run = runs[row];
      if (run) return noteAt(ROW_TO_STRING[row], parseInt(run, 10)) || run;
      return b.slice(c, c + runLen);            // '-', '|', 'h', ' ' …
    });
    const w = Math.max(...pieces.map(p => p.length));
    pieces.forEach((p, row) => {
      // pad with the row's own filler so bar lines don't get dashes glued on
      const fill = /^\|+$/.test(p) ? '|' : '-';
      outBodies[row] += p.length >= w ? p : p + fill.repeat(w - p.length);
    });
    c += runLen;
  }
  return outBodies.map((b, row) => heads[row].padEnd(headW, ' ') + b);
}
