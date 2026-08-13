/* ============================================================
   scales.js — the SCALE book (the second source of truth).

   Gives the composer two things the chord book can't:
     - diatonic chord names for a key (so progressions stay in key)
     - a fretboard "position box": the set of (string, fret) notes
       that are in the scale within a playable window, so solo /
       lead lines stay diatonic AND physically playable.
   ============================================================ */
import { STRING_OPEN_MIDI, NOTE_NAMES, nameToPc, pcToName } from './theory.js';
import { parseChordName } from './chordbook.js';

export const SCALE_STEPS = {
  major:      [0,2,4,5,7,9,11],
  minor:      [0,2,3,5,7,8,10],   // natural minor
  majorPent:  [0,2,4,7,9],
  minorPent:  [0,3,5,7,10]
};

/* Triad qualities on each scale degree. */
const DIATONIC_QUALITY = {
  major: ['',  'm', 'm', '',  '',  'm', 'dim'],
  minor: ['m', 'dim','',  'm', 'm', '',  '']
};

/* Parse "Am", "C", "F#m", "Bb" -> { rootPc, mode, rootName }. */
export function keyInfo(key){
  const m = String(key).match(/^([A-G][#b]?)(m?)$/);
  if (!m) return { rootPc: 9, mode: 'minor', rootName: 'A' };
  return { rootPc: nameToPc(m[1]), mode: m[2] === 'm' ? 'minor' : 'major', rootName: m[1] };
}

/* The 7 diatonic triad names for a key, e.g. Am -> [Am,Bdim,C,Dm,Em,F,G]. */
export function diatonicChords(key){
  const { rootPc, mode } = keyInfo(key);
  const steps = SCALE_STEPS[mode];
  const quals = DIATONIC_QUALITY[mode];
  return steps.map((st, i) => pcToName(rootPc + st) + quals[i]);
}

/* Guess the most likely key (e.g. "G" or "Em") for a short list of
   chord names — scores every one of the 24 major/minor keys by how
   well its 7 diatonic triads match the given chords (root match,
   plus a bonus if the chord's major/minor-third quality also lines
   up with that scale degree's expected quality), with a small bias
   toward the first chord being the tonic. Pure heuristic, no AI/
   network — used by the trainer's "My chords" track builder to
   suggest a plausible next chord. Returns null if nothing scores. */
const KEY_ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function guessKey(chordNames){
  const chords = (chordNames || []).map(parseChordName).filter(Boolean);
  if (!chords.length) return null;
  let best = null, bestScore = 0;
  for (const root of KEY_ROOTS){
    for (const mode of ['', 'm']){
      const key = root + mode;
      const diatonic = diatonicChords(key).map(parseChordName).filter(Boolean);
      let score = 0;
      for (const c of chords){
        const hit = diatonic.find(d => d.rootPc === c.rootPc);
        if (!hit) continue;
        score += 1;
        if ((hit.intervals[1] === 3) === (c.intervals[1] === 3)) score += 1;
      }
      if (chords[0].rootPc === keyInfo(key).rootPc) score += 0.5;
      if (score > bestScore){ bestScore = score; best = key; }
    }
  }
  return best;
}

/* Scale pitch classes for a key (default natural minor / major). */
export function scalePcs(key){
  const { rootPc, mode } = keyInfo(key);
  return SCALE_STEPS[mode].map(st => (rootPc + st) % 12);
}

/* Pentatonic pitch classes for lead lines (safer, more idiomatic). */
export function pentPcs(key){
  const { rootPc, mode } = keyInfo(key);
  const steps = mode === 'minor' ? SCALE_STEPS.minorPent : SCALE_STEPS.majorPent;
  return steps.map(st => (rootPc + st) % 12);
}

/* A good starting fret for the key's "home box" on the low strings.
   Root of a minor key sits well as a low-E-string position. */
export function homeFret(key){
  const { rootPc } = keyInfo(key);
  let f = ((rootPc - 4) % 12 + 12) % 12;   // root on low-E string
  if (f < 3) f += 12;                       // push very low roots up an octave
  return f;
}

/* Resolve a neck-position choice to a box-center fret.
   'open' -> low first-position zone; 'auto' -> the key root on the low-E
   string (so a barre chord and the lead box share the region); a numeric
   string -> that fret. Returns { center, nearFret } where nearFret is null
   for 'open' (so chords use idiomatic open voicings). */
export function positionCenter(key, position){
  const { rootPc } = keyInfo(key);
  if (position === 'open' || position == null) return { center: 2, nearFret: null };
  if (position === 'auto'){
    // Prefer the lowest playable first-position region. This favors open/5th
    // positions when the key allows them, instead of forcing the root onto
    // the low-E string.
    return { center: 2, nearFret: 2 };
  }
  // Neo-soul "chord zones" (from the source guide): each zone pins the lead
  // box and the chord voicings to a fret region with a characteristic color.
  if (position === 'zone1') return { center: 2, nearFret: 2 };  // 0–3: open + add9 colors
  if (position === 'zone2') return { center: 5, nearFret: 5 };  // 3–7: funk + dominant extensions
  if (position === 'zone3') return { center: 9, nearFret: 9 };  // 7–12: neo-soul jazz voicings
  const n = parseInt(position, 10);
  if (Number.isFinite(n)) return { center: n, nearFret: n };
  return { center: 2, nearFret: null };
}

/* Build the playable note box for lead lines:
   every (string, fret) within [center-1, center+4] whose pitch class
   is in `pcs`. Returned sorted by MIDI ascending. */
export function buildBox(pcs, center){
  const set = new Set(pcs);
  const lo = Math.max(0, center - 1), hi = center + 4;
  const box = [];
  for (let s = 0; s < 6; s++){
    for (let f = lo; f <= hi; f++){
      const midi = STRING_OPEN_MIDI[s] + f;
      if (set.has(midi % 12)) box.push({ string: s, fret: f, midi });
    }
  }
  box.sort((a, b) => a.midi - b.midi);
  return box;
}

/* Progression templates as 0-based indices into diatonicChords().
   Sized later to the requested bar count. */
export const PROGRESSIONS = {
  minor: [
    { name: 'i–VI–III–VII', deg: [0,5,2,6] },
    { name: 'i–iv–v–i',     deg: [0,3,4,0] },
    { name: 'i–VII–VI–VII', deg: [0,6,5,6] },
    { name: 'i–iv–VII–III', deg: [0,3,6,2] }
  ],
  major: [
    { name: 'I–V–vi–IV', deg: [0,4,5,3] },
    { name: 'I–IV–V',    deg: [0,3,4]   },
    { name: 'vi–IV–I–V', deg: [5,3,0,4] },
    { name: 'I–vi–IV–V', deg: [0,5,3,4] },
    // Gospel / neo-soul: the `quals` array overrides the diatonic triad
    // quality per bar (root is kept), so these render with real extensions.
    { name: 'Gospel ii–V–I (9/13)', deg: [1,4,0],   quals: ['m9','13','maj9'] },
    { name: 'Neo-soul I–vi–ii–V',   deg: [0,5,1,4], quals: ['maj9','m9','m9','7#9'] },
    { name: 'Neo-soul IV–iii–ii–I',  deg: [3,2,1,0], quals: ['maj9','m9','m9','6/9'] }
  ]
};

/* Tile/trim a degree pattern to exactly `bars` entries. */
export function fitProgression(deg, bars){
  const out = [];
  for (let i = 0; i < bars; i++) out.push(deg[i % deg.length]);
  return out;
}
