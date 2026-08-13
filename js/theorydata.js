/* ============================================================
   theorydata.js — shared constants + helpers for the trainer
   family (trainer.js quiz + trainerexplore.js sandbox).

   These used to live duplicated in both modules; this is the
   single source of truth so a change (new key, new progression
   template, roman-numeral spelling) can't drift between copies.
   Pure data + pure functions — no DOM, no audio.
   ============================================================ */
import { keyInfo, scalePcs, pentPcs } from './scales.js';
import { STRING_OPEN_MIDI } from './theory.js';

export const KEYS = ['C', 'G', 'D', 'A', 'E', 'Am', 'Em', 'Dm', 'Gm', 'Cm'];

export const ROMAN_MAJ = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
export const ROMAN_MIN = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
export function romansFor(key){ return keyInfo(key).mode === 'minor' ? ROMAN_MIN : ROMAN_MAJ; }
export function keyLabel(key){ const k = keyInfo(key); return `${k.rootName} ${k.mode}`; }

/* Movable barre-shape drill vocabulary. */
export const MV_QUALS  = ['maj', 'min', 'dom7', 'min7'];
export const MV_SUFFIX = { maj: '', min: 'm', dom7: '7', min7: 'm7' };
export const MV_QUAL_LABEL = { maj: 'major', min: 'minor', dom7: 'dominant 7', min7: 'minor 7' };

/* Scale-box positions offered by the trainer + explore views. */
export const SC_CENTERS = [2, 4, 7, 9];

/* Degree-sequence templates per mode (0-based into diatonicChords). */
export const PROG_TEMPLATES = {
  major: [
    { name: 'I–V–vi–IV',    deg: [0, 4, 5, 3] },
    { name: 'I–IV–V',       deg: [0, 3, 4]    },
    { name: 'ii–V–I',       deg: [1, 4, 0]    },
    { name: 'I–vi–IV–V',    deg: [0, 5, 3, 4] },
  ],
  minor: [
    { name: 'i–VI–III–VII', deg: [0, 5, 2, 6] },
    { name: 'i–iv–v',       deg: [0, 3, 4]    },
    { name: 'i–VII–VI–VII', deg: [0, 6, 5, 6] },
    { name: 'i–iv–VII–III', deg: [0, 3, 6, 2] },
  ],
};

/* All in-scale (string,fret) notes for a key inside a fret window.
   type: 'pent' | 'full'. Each note: { string, fret, root, midi }. */
export function scaleNotesWindow(key, type, lo, hi){
  const pcs = type === 'pent' ? pentPcs(key) : scalePcs(key);
  const set = new Set(pcs);
  const root = keyInfo(key).rootPc;
  const out = [];
  for (let s = 0; s < 6; s++){
    for (let f = Math.max(0, lo); f <= hi; f++){
      const midi = STRING_OPEN_MIDI[s] + f;
      const pc = midi % 12;
      if (set.has(pc)) out.push({ string: s, fret: f, root: pc === root, midi });
    }
  }
  return out;
}
