/* ============================================================
   chordbook.js — the chord VOICING book (source of truth).

   Every chord the composer plays resolves to a real, playable
   voicing built here from the chord's actual tones — never from
   an AI guess. Voicings are arrays of 6 entries, low string ->
   high string: [E, A, D, G, B, e]; a fret number, 0 = open,
   null = muted.

   getVoicing(name, opts) resolves via several candidate generators
   and picks the best one. With opts.near it picks the voicing whose
   fret center is closest to a target neck position (this is what
   lets chords and lead lines share a region). With opts.style it
   prefers a family ('open' | 'barre' | 'compact').
   ============================================================ */
import { STRING_OPEN_MIDI, NOTE_NAMES } from './theory.js';

const PC = {C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};

/* ---- chord-tone intervals (semitones from root) -------------------------- */
/* Built in so the voicer needs no external library. */
export const QUALITY_INTERVALS = {
  maj:  [0,4,7],        min:  [0,3,7],        dim:  [0,3,6],     aug:  [0,4,8],
  sus2: [0,2,7],        sus4: [0,5,7],
  dom7: [0,4,7,10],     min7: [0,3,7,10],     maj7: [0,4,7,11],
  m7b5: [0,3,6,10],     dim7: [0,3,6,9],
  six:  [0,4,7,9],      min6: [0,3,7,9],      six9: [0,4,7,9,14],
  add9: [0,4,7,14],     madd9:[0,3,7,14],
  dom9: [0,4,7,10,14],  maj9: [0,4,7,11,14],  min9: [0,3,7,10,14],
  // 11ths / 13ths — voiced by omitting clashing/optional tones (5th, avoid-11)
  dom11:[0,7,10,14,17], min11:[0,3,7,10,17],  maj11:[0,4,7,11,17],
  dom13:[0,4,10,14,21], min13:[0,3,10,14,21], maj13:[0,4,11,14,21],
  // altered dominants (gospel / neo-soul tension)
  dom7s9:[0,4,10,15],   dom7b9:[0,4,10,13],
  dom7s5:[0,4,8,10],    dom7b5:[0,4,6,10]
};

/* ---- chord-type selector metadata ----------------------------------------- */
/* Human-readable labels + canonical name suffixes for every quality above,
   used by the "chord type" dropdowns (guitar chord cards + the frets->chords
   fingering viewport) so a chord — human-entered or AI-generated — can be
   swapped to its 7th/9th/11th/sus/etc. counterpart. Keys match QUALITY_INTERVALS
   and what parseChordName() below returns as `quality`. */
export const QUALITY_LABELS = {
  maj: 'Major',            min: 'Minor',            dim: 'Diminished',        aug: 'Augmented',
  sus2: 'Sus2',             sus4: 'Sus4',
  dom7: '7 (dominant)',     min7: 'Minor 7',          maj7: 'Major 7',
  m7b5: 'Half-dim (m7♭5)',  dim7: 'Diminished 7',
  six: '6',                 min6: 'Minor 6',          six9: '6/9',
  add9: 'Add9',              madd9: 'Minor add9',
  dom9: '9',                 maj9: 'Major 9',          min9: 'Minor 9',
  dom11: '11',                min11: 'Minor 11',         maj11: 'Major 11',
  dom13: '13',                min13: 'Minor 13',         maj13: 'Major 13',
  dom7s9: '7♯9',              dom7b9: '7♭9',              dom7s5: '7♯5',            dom7b5: '7♭5',
};
export const QUALITY_SUFFIX = {
  maj: '',      min: 'm',    dim: 'dim',   aug: 'aug',
  sus2: 'sus2', sus4: 'sus4',
  dom7: '7',    min7: 'm7',  maj7: 'maj7',
  m7b5: 'm7b5', dim7: 'dim7',
  six: '6',     min6: 'm6',  six9: '6/9',
  add9: 'add9', madd9: 'm(add9)',
  dom9: '9',    maj9: 'maj9', min9: 'm9',
  dom11: '11',  min11: 'm11', maj11: 'maj11',
  dom13: '13',  min13: 'm13', maj13: 'maj13',
  dom7s9: '7#9', dom7b9: '7b9', dom7s5: '7#5', dom7b5: '7b5',
};

/* Swap a chord's quality, keeping its root exactly as spelled (e.g. "Bb"
   stays "Bb", not "A#"). Returns the new name, or null if `name` doesn't
   parse or `qualityKey` isn't recognized. */
export function withQuality(name, qualityKey){
  const p = parseChordName(name);
  if (!p || !(qualityKey in QUALITY_SUFFIX)) return null;
  return p.rootName + QUALITY_SUFFIX[qualityKey];
}

/* ---- 1. Hand-seeded open voicings ---------------------------------------- */
export const OPEN_VOICINGS = {
  // majors
  'C':[null,3,2,0,1,0],'A':[null,0,2,2,2,0],'G':[3,2,0,0,0,3],'E':[0,2,2,1,0,0],
  'D':[null,null,0,2,3,2],'F':[1,3,3,2,1,1],
  // minors
  'Am':[null,0,2,2,1,0],'Em':[0,2,2,0,0,0],'Dm':[null,null,0,2,3,1],
  // dominant 7
  'A7':[null,0,2,0,2,0],'D7':[null,null,0,2,1,2],'E7':[0,2,0,1,0,0],
  'G7':[3,2,0,0,0,1],'C7':[null,3,2,3,1,0],'B7':[null,2,1,2,0,2],
  // minor 7
  'Am7':[null,0,2,0,1,0],'Em7':[0,2,0,0,0,0],'Dm7':[null,null,0,2,1,1],
  // major 7
  'Cmaj7':[null,3,2,0,0,0],'Amaj7':[null,0,2,1,2,0],'Gmaj7':[3,2,0,0,0,2],
  'Fmaj7':[null,null,3,2,1,0],'Dmaj7':[null,null,0,2,2,2],'Emaj7':[0,2,1,1,0,0],
  // sus
  'Dsus4':[null,null,0,2,3,3],'Dsus2':[null,null,0,2,3,0],'Asus2':[null,0,2,2,0,0],
  'Asus4':[null,0,2,2,3,0],'Esus4':[0,2,2,2,0,0],
  // add9 / colour
  'Cadd9':[null,3,2,0,3,0],'Gadd9':[3,2,0,2,0,3],'Dadd9':[null,null,0,2,3,0],
  // sixths
  'C6':[null,3,2,2,1,0],'G6':[3,2,0,0,0,0],'A6':[null,0,2,2,2,2],'Em6':[0,2,2,0,2,0],
  // ninths
  'A9':[null,0,2,4,2,3],'E9':[0,2,0,1,0,2],'D9':[null,5,4,5,5,5]
};

/* ---- 1b. Hand-seeded neo-soul / gospel voicings -------------------------- */
/* Idiomatic drop-2 / shell shapes transcribed from the source guides
   (low E -> high e; null = muted). These are the rootless-ish, low-string-
   muted colors that the generic voicer won't naturally produce. */
export const GOSPEL_VOICINGS = {
  // Advanced Gospel guide (key of Ab)
  'AbMaj9':[4,null,5,5,4,6], 'Bbm9':[6,null,6,6,6,6], 'Eb13':[null,6,7,6,8,6],
  'Ab13':[4,6,6,5,6,6],      'DbMaj9':[null,4,5,5,4,4],'Eb7#9':[null,6,7,6,7,6],
  'Adim7':[null,5,6,5,6,5],  'Fm9':[8,null,8,8,8,8],
  // Neo-soul chord-zones guide (key of C)
  'Cadd9':[null,3,2,0,3,3],   'C9':[null,3,2,3,3,3],
  'Cm9':[null,10,8,8,8,8],    'C13':[null,8,10,9,10,10]
};

/* ---- 2. Movable barre shapes (6-string) ---------------------------------- */
/* Exported so the trainer can drill "same shape, different fret". */
export const E_SHAPES = {
  maj:  n => [n, n+2, n+2, n+1, n,   n  ],
  min:  n => [n, n+2, n+2, n,   n,   n  ],
  dom7: n => [n, n+2, n,   n+1, n,   n  ],
  min7: n => [n, n+2, n,   n,   n,   n  ],
  maj7: n => [n, n+2, n+1, n+1, n,   n  ],
  sus4: n => [n, n+2, n+2, n+2, n,   n  ],
  sus2: n => [n, n+2, n+2, n,   null,n  ]
};
export const A_SHAPES = {
  maj:  n => [null, n, n+2, n+2, n+2, n  ],
  min:  n => [null, n, n+2, n+2, n+1, n  ],
  dom7: n => [null, n, n+2, n,   n+2, n  ],
  min7: n => [null, n, n+2, n,   n+1, n  ],
  maj7: n => [null, n, n+2, n+1, n+2, n  ],
  sus4: n => [null, n, n+2, n+2, n+3, n  ],
  sus2: n => [null, n, n+2, n+2, n,   n  ]
};
export const fretOnE = pc => ((pc - 4) % 12 + 12) % 12;   // E = pc 4 on low-E string
export const fretOnA = pc => ((pc - 9) % 12 + 12) % 12;   // A = pc 9 on A string

/* ---- name parsing -------------------------------------------------------- */
export function parseChordName(name){
  const m = String(name).match(/^([A-G][#b]?)(.*)$/);
  if (!m) return null;
  const rootName = m[1];
  // Normalize the spelled-out major word so "Maj"/"MAJ" behave like "maj".
  // The single-letter distinction M (major) vs m (minor) is preserved below.
  const s = m[2].trim().replace(/^maj/i, 'maj');
  let quality;
  // --- major family (word "maj", uppercase M + degree, or Δ) -------------
  if      (/^(maj13|M13|Δ13)/.test(s))   quality = 'maj13';
  else if (/^(maj11|M11|Δ11)/.test(s))   quality = 'maj11';
  else if (/^(maj9|M9|Δ9)/.test(s))      quality = 'maj9';
  else if (/^(maj7|M7|Δ)/.test(s))       quality = 'maj7';
  // --- half-diminished / diminished / augmented --------------------------
  else if (/^(m7b5|min7b5|ø)/.test(s))   quality = 'm7b5';
  else if (/^(dim7|°7|o7)/.test(s))      quality = 'dim7';
  else if (/^(dim|°|o(?!m))/.test(s))    quality = 'dim';
  else if (/^(aug|\+)/.test(s))          quality = 'aug';
  // --- minor family (lowercase m / "min") --------------------------------
  else if (/^(m13|min13)/.test(s))       quality = 'min13';
  else if (/^(m11|min11)/.test(s))       quality = 'min11';
  else if (/^(m9|min9)/.test(s))         quality = 'min9';
  else if (/^(m6|min6)/.test(s))         quality = 'min6';
  else if (/^(madd9|m\(add9\))/.test(s)) quality = 'madd9';
  else if (/^(m7|min7)/.test(s))         quality = 'min7';
  else if (/^(m|min)(?!aj)/.test(s))     quality = 'min';
  // --- altered dominants (must precede plain 7) --------------------------
  else if (/^7#9/.test(s))               quality = 'dom7s9';
  else if (/^7b9/.test(s))               quality = 'dom7b9';
  else if (/^(7#5|7\+5|aug7)/.test(s))   quality = 'dom7s5';
  else if (/^7b5/.test(s))               quality = 'dom7b5';
  // --- suspended / add ---------------------------------------------------
  else if (/^sus2/.test(s))              quality = 'sus2';
  else if (/^(sus4|sus)/.test(s))        quality = 'sus4';
  else if (/^add9/.test(s))              quality = 'add9';
  // --- numeric extensions (most specific first) --------------------------
  else if (/^(6\/9|69)/.test(s))         quality = 'six9';
  else if (/^13/.test(s))                quality = 'dom13';
  else if (/^11/.test(s))                quality = 'dom11';
  else if (/^9/.test(s))                 quality = 'dom9';
  else if (/^6/.test(s))                 quality = 'six';
  else if (/^7/.test(s))                 quality = 'dom7';
  else                                   quality = 'maj';
  return { rootName, rootPc: PC[rootName] ?? 0, quality, intervals: QUALITY_INTERVALS[quality] };
}

/* chord-tone pitch classes for a name. */
function chordPcs(name){
  const p = parseChordName(name);
  if (!p) return [];
  return p.intervals.map(iv => (p.rootPc + iv) % 12);
}

/* ---- 3. Generic 6-string voicer (from chord tones) ----------------------- */
/* lo/hi bound the fret search window per string; keep the window itself
   <=4 frets wide so no voicing this produces can span more than a human
   hand's reach (see fretSpan()/the filter in voicingCandidates below,
   which is the actual guarantee — this just keeps the common case tight). */
function genericVoicing(name, lo = 0, hi = 4){
  const pcs = chordPcs(name);
  if (!pcs.length) return null;
  const root = pcs[0], set = new Set(pcs);
  const frets = [null,null,null,null,null,null];
  let placedRoot = false;
  for (let s = 0; s < 6; s++){
    for (let f = lo; f <= hi; f++){
      const pc = (STRING_OPEN_MIDI[s] + f) % 12;
      if (!set.has(pc)) continue;
      if (!placedRoot && pc !== root) continue;
      frets[s] = f; if (pc === root) placedRoot = true; break;
    }
    if (!placedRoot && s >= 1){
      for (let f = lo; f <= hi; f++){
        const pc = (STRING_OPEN_MIDI[s] + f) % 12;
        if (set.has(pc)){ frets[s] = f; break; }
      }
    }
  }
  return frets.some(f => f !== null) ? frets : null;
}

/* ---- 4. Compact 4-string (drop-2 style) voicing near a center ------------ */
/* Realizes the chord on an adjacent 4-string set in a tight fret window,
   dropping the 5th first when a chord has more than 4 tones. */
function compactVoicing(name, center, stringSet = [2,3,4,5]){
  const p = parseChordName(name);
  if (!p) return null;
  let pcs = p.intervals.map(iv => (p.rootPc + iv) % 12);
  pcs = [...new Set(pcs)];
  if (pcs.length > 4){                      // drop the perfect 5th
    const fifth = (p.rootPc + 7) % 12;
    pcs = pcs.filter(pc => pc !== fifth);
  }
  if (pcs.length > 4) pcs = pcs.slice(0, 4);
  // Window kept to a 4-fret span (lo..hi) so every string lands in the
  // same hand position — no note gets placed outside a human reach.
  const lo = Math.max(0, center - 1), hi = lo + 4;
  const want = new Set(pcs), root = pcs[0];
  const frets = [null,null,null,null,null,null];
  const covered = new Set();
  stringSet.forEach((s, i) => {
    const tryPc = (predicate, hiMax = hi) => {
      for (let f = lo; f <= hiMax; f++){
        const pc = (STRING_OPEN_MIDI[s] + f) % 12;
        if (predicate(pc)){ frets[s] = f; covered.add(pc); return true; }
      }
      return false;
    };
    if (i === 0){
      // bass string carries the root; stay inside the window rather than
      // reaching outside it (that used to be able to blow the fret span).
      if (!tryPc(pc => pc === root)) tryPc(pc => want.has(pc));
    }
    else if (!tryPc(pc => want.has(pc) && !covered.has(pc))) tryPc(pc => want.has(pc));
  });
  const filled = frets.filter(f => f !== null).length;
  return filled >= 3 ? frets : null;
}

/* ---- helpers ------------------------------------------------------------- */
function voicingCenter(frets){
  const fretted = frets.filter(f => f !== null && f > 0);
  if (!fretted.length) return 0;
  return fretted.reduce((a, b) => a + b, 0) / fretted.length;
}
/* Fret span of a voicing, ignoring muted strings and open (fret-0) notes
   since an open string costs no hand stretch. This is the actual
   human-playability check — everything upstream just tries to keep it low. */
function fretSpan(frets){
  const fretted = frets.filter(f => f !== null && f > 0);
  if (fretted.length < 2) return 0;
  return Math.max(...fretted) - Math.min(...fretted);
}
function decorate(name, frets){
  if (!frets) return null;
  const midis = [];
  frets.forEach((f, s) => { if (f !== null) midis.push(STRING_OPEN_MIDI[s] + f); });
  const notes = midis.map(m => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1)).join(' ');
  return { name, frets, midis, notes, center: voicingCenter(frets), span: fretSpan(frets) };
}

/* Max fret span (see fretSpan()) considered "human playable" — a hand can
   comfortably cover about 4 frets in one position. */
export const MAX_PLAYABLE_SPAN = 4;

/* All candidate voicings for a chord (each tagged with style + center). */
export function voicingCandidates(name){
  const out = [];
  const push = (frets, style) => { const d = decorate(name, frets); if (d){ d.style = style; out.push(d); } };

  if (OPEN_VOICINGS[name]) push(OPEN_VOICINGS[name], 'open');
  if (GOSPEL_VOICINGS[name]) push(GOSPEL_VOICINGS[name], 'gospel');

  const p = parseChordName(name);
  if (p){
    const shp = p.quality;
    const eShape = E_SHAPES[shp], aShape = A_SHAPES[shp];
    const eFret = fretOnE(p.rootPc), aFret = fretOnA(p.rootPc);
    if (eShape){ push(eShape(eFret), 'barre'); if (eFret + 12 <= 15) push(eShape(eFret + 12), 'barre'); }
    if (aShape){ push(aShape(aFret), 'barre'); if (aFret + 12 <= 15) push(aShape(aFret + 12), 'barre'); }
    // compact voicings at a few neck centers
    [0, 5, 7, 12].forEach(c => push(compactVoicing(name, c), 'compact'));
  }
  push(genericVoicing(name, 0, 4), 'generic');

  const all = out.filter(Boolean);
  // Prefer human-playable voicings; only fall back to a wider stretch if
  // literally nothing playable was generated for this chord (rare, exotic
  // extensions). This is what makes the constraint apply retroactively —
  // every diagram is resolved live from the chord name, nothing is cached.
  const playable = all.filter(v => v.span <= MAX_PLAYABLE_SPAN);
  return playable.length ? playable : all;
}

/* Centers available for a chord — used by the auto position picker. */
export function chordAvailableCenters(name){
  return [...new Set(voicingCandidates(name).map(v => Math.round(v.center)))];
}

/* ---- public API ---------------------------------------------------------- */
/* opts: { near?|nearFret?: number (target fret center; null = no target),
           style?: 'open'|'barre'|'compact' }
   Selection prefers voicings that contain the root and cover the most
   distinct chord tones; center proximity (to the target) breaks ties. */
export function getVoicing(name, opts = {}){
  let cands = voicingCandidates(name);
  if (!cands.length) return null;
  if (opts.style){
    const filtered = cands.filter(c => c.style === opts.style);
    if (filtered.length) cands = filtered;
  }
  // accept either `near` or `nearFret`; a null/undefined target means "no region"
  const target = typeof opts.near === 'number' ? opts.near
               : typeof opts.nearFret === 'number' ? opts.nearFret : null;

  const p = parseChordName(name);
  const rootPc = p ? p.rootPc : null;
  const wantPcs = p ? [...new Set(p.intervals.map(iv => (rootPc + iv) % 12))] : [];

  const score = (c) => {
    const pcs = new Set(c.midis.map(m => m % 12));
    const hasRoot = rootPc === null || pcs.has(rootPc);
    const covered = wantPcs.filter(pc => pcs.has(pc)).length;
    const coverage = wantPcs.length ? covered / wantPcs.length : 1;
    const centerPenalty = target !== null
      ? Math.abs(c.center - target) : c.center * 0.15;
    const stylePref = (c.style === 'open' || c.style === 'gospel') && target === null ? -0.5 : 0;
    return (hasRoot ? 0 : 100) + (1 - coverage) * 12 + centerPenalty * 0.8 + stylePref;
  };

  return cands.reduce((best, c) => (score(c) < score(best) ? c : best));
}

