/* ============================================================
   voicelead.js — deterministic progression tools (no AI, no DOM).

   - motion:     how far the voices move between chords (semitones)
   - smoothing:  pick the voicing per chord that minimizes movement
                 (guitar: from the chord book's playable shapes, via
                 Viterbi over string/fret cost; piano: close-position
                 right-hand inversions + a root/fifth left hand)
   - transpose:  chord names, note strings and ASCII tab
   - capo:       the capo position that turns a progression into the
                 most open-position shapes

   Pure functions over plain data so they're unit-testable in node.
   ============================================================ */
import { voicingCandidates, parseChordName, OPEN_VOICINGS } from './chordbook.js';
import { STRING_OPEN_MIDI, NOTE_NAMES, noteToMidi } from './theory.js';

const FLAT_NAMES = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
/* Keys whose spelling reads better with flats. */
const FLAT_KEYS = new Set(['F','Bb','Eb','Ab','Db','Gb','Dm','Gm','Cm','Fm','Bbm','Ebm']);

const mod12 = n => ((n % 12) + 12) % 12;
export const midiToName = (m, flats = false) =>
  (flats ? FLAT_NAMES : NOTE_NAMES)[mod12(m)] + (Math.floor(m / 12) - 1);

/* "A2 E3 A3" -> [45, 52, 57] (unparseable tokens dropped). */
export function notesToMidis(str){
  return String(str || '').trim().split(/\s+/).map(n => noteToMidi(n.replace('♭', 'b').replace('♯', '#')))
    .filter(m => m !== null);
}

/* ---- motion -------------------------------------------------------- */

/* Average distance (semitones) each note of b travels from the
   nearest note of a, symmetrised so adding/dropping voices counts. */
export function motionBetween(a, b){
  if (!a.length || !b.length) return 0;
  const near = (from, to) => from.reduce((s, x) => s + Math.min(...to.map(y => Math.abs(x - y))), 0) / from.length;
  return (near(b, a) + near(a, b)) / 2;
}

/* Mean motion across consecutive chords. midiLists: [[...], ...]. */
export function progressionMotion(midiLists){
  const lists = midiLists.filter(l => l && l.length);
  if (lists.length < 2) return 0;
  let s = 0;
  for (let i = 1; i < lists.length; i++) s += motionBetween(lists[i - 1], lists[i]);
  return s / (lists.length - 1);
}

/* ---- guitar smoothing ---------------------------------------------- */

function fretCost(a, b){
  let cost = 0;
  for (let s = 0; s < 6; s++){
    const x = a.frets[s], y = b.frets[s];
    if (x === null && y === null) continue;
    if (x === null || y === null){ cost += 1.5; continue; }
    // open strings cost the hand nothing to reach
    cost += (x === 0 || y === 0) ? 0.5 : Math.abs(x - y);
  }
  return cost + Math.abs((a.center || 0) - (b.center || 0)) * 0.6;
}
function shapeCost(v, name){
  const p = parseChordName(name);
  const rootBass = p && v.midis.length && mod12(Math.min(...v.midis)) === p.rootPc;
  const strings = v.frets.filter(f => f !== null).length;
  return (v.span || 0) * 0.3 + (rootBass ? 0 : 2.5) + Math.max(0, 5 - strings) * 0.6;
}
/* A voicing is only a candidate if it has the root and enough of the
   chord to read as that chord (all tones of a triad, 3+ otherwise). */
function fullEnough(v, name){
  const p = parseChordName(name);
  if (!p) return true;
  const want = [...new Set(p.intervals.map(i => mod12(p.rootPc + i)))];
  const have = new Set(v.midis.map(mod12));
  if (!have.has(p.rootPc)) return false;
  const covered = want.filter(pc => have.has(pc)).length;
  return want.length <= 3 ? covered === want.length : covered >= 3;
}

/* names: chord names. -> [{ frets, midis, notes, center }] — one
   playable voicing per chord minimizing hand movement (Viterbi).
   Chords the book can't voice come back as null. `start` biases the
   first chord toward a neck region (fret center), default open. */
export function smoothGuitarVoicings(names, { start = 0, maxCands = 12 } = {}){
  const cands = names.map(n => {
    const all = voicingCandidates(n) || [];
    const full = all.filter(v => fullEnough(v, n));
    return (full.length ? full : all).sort((a, b) => shapeCost(a, n) - shapeCost(b, n)).slice(0, maxCands);
  });
  const usable = cands.map(c => c.length > 0);
  const idx = names.map((_, i) => i).filter(i => usable[i]);
  if (!idx.length) return names.map(() => null);

  // Viterbi over the voiceable chords only.
  let prev = cands[idx[0]].map(v => ({ cost: shapeCost(v, names[idx[0]]) + Math.abs((v.center || 0) - start) * 0.3, back: -1 }));
  const backs = [prev];
  for (let k = 1; k < idx.length; k++){
    const here = cands[idx[k]], before = cands[idx[k - 1]];
    const row = here.map(v => {
      let best = Infinity, arg = 0;
      before.forEach((u, j) => {
        const c = prev[j].cost + fretCost(u, v);
        if (c < best){ best = c; arg = j; }
      });
      return { cost: best + shapeCost(v, names[idx[k]]), back: arg };
    });
    backs.push(row);
    prev = row;
  }
  let j = prev.reduce((bi, x, i, arr) => (x.cost < arr[bi].cost ? i : bi), 0);
  const chosen = new Array(idx.length);
  for (let k = idx.length - 1; k >= 0; k--){
    chosen[k] = cands[idx[k]][j];
    j = backs[k][j].back;
  }
  const out = names.map(() => null);
  idx.forEach((i, k) => { out[i] = chosen[k]; });
  return out;
}

/* Voicings -> a chord-per-column ASCII tab (high e on top), optionally
   written relative to a capo. */
export function voicingsToTab(voicings, names, { capo = 0 } = {}){
  const LABELS = ['E', 'A', 'D', 'G', 'B', 'e'];
  const cols = voicings.map((v, i) => {
    const frets = v ? v.frets : [null, null, null, null, null, null];
    const cells = frets.map(f => (f === null ? 'x' : String(f - capo)));
    const w = Math.max(2, ...cells.map(c => c.length), (names[i] || '').length);
    return { cells, w, name: names[i] || '' };
  });
  const header = '  ' + cols.map(c => (' ' + c.name).padEnd(c.w + 3)).join('');
  const rows = [5, 4, 3, 2, 1, 0].map(s =>
    LABELS[s] + '|' + cols.map(c => '-' + c.cells[s].padEnd(c.w, '-') + '-|').join(''));
  return (capo ? `Capo ${capo}\n` : '') + header.trimEnd() + '\n' + rows.join('\n');
}

/* ---- piano smoothing ----------------------------------------------- */

function chordPcList(name){
  const p = parseChordName(name);
  if (!p) return null;
  let ivs = [...new Set(p.intervals.map(mod12))];
  // keep RH at four voices: drop the fifth first, then the root (the LH has it)
  if (ivs.length > 4 && ivs.includes(7)) ivs = ivs.filter(i => i !== 7);
  if (ivs.length > 4) ivs = ivs.filter(i => i !== 0);
  return { rootPc: p.rootPc, pcs: ivs.map(i => mod12(p.rootPc + i)), hasFifth: p.intervals.some(i => mod12(i) === 7), quality: p.quality };
}

/* Close-position stacks of `pcs` starting on each chord tone, in a
   playable RH window (E3..A5). */
function rhCandidates(pcs){
  const out = [];
  for (let inv = 0; inv < pcs.length; inv++){
    const order = [...pcs.slice(inv), ...pcs.slice(0, inv)];
    for (let base = 52; base <= 64; base++){
      if (mod12(base) !== order[0]) continue;
      const stack = [base];
      for (let k = 1; k < order.length; k++){
        let m = stack[k - 1] + 1;
        while (mod12(m) !== order[k]) m++;
        stack.push(m);
      }
      if (stack[stack.length - 1] <= 81) out.push(stack);
    }
  }
  return out;
}

/* chords: [{ name }] -> [{ left, right }] note strings with a smooth
   right hand (minimal motion, kept near the middle of the keyboard)
   and a root(+fifth) left hand in octave 2. Null for unparseable names. */
export function smoothPianoVoicings(names, { flats = false } = {}){
  const infos = names.map(chordPcList);
  const cands = infos.map(inf => (inf ? rhCandidates(inf.pcs) : []));
  const center = 64;
  const idx = names.map((_, i) => i).filter(i => cands[i].length);
  const out = names.map(() => null);
  if (!idx.length) return out;
  const local = (s) => Math.abs(s.reduce((a, b) => a + b, 0) / s.length - center) * 0.15;

  let prev = cands[idx[0]].map(s => ({ cost: local(s), back: -1 }));
  const backs = [prev];
  for (let k = 1; k < idx.length; k++){
    const here = cands[idx[k]], before = cands[idx[k - 1]];
    const row = here.map(s => {
      let best = Infinity, arg = 0;
      before.forEach((u, j) => { const c = prev[j].cost + motionBetween(u, s); if (c < best){ best = c; arg = j; } });
      return { cost: best + local(s), back: arg };
    });
    backs.push(row); prev = row;
  }
  let j = prev.reduce((bi, x, i, arr) => (x.cost < arr[bi].cost ? i : bi), 0);
  for (let k = idx.length - 1; k >= 0; k--){
    const i = idx[k], inf = infos[i], rh = cands[i][j];
    let root = 36 + inf.rootPc; if (root < 40) root += 12;        // E2..D#3
    const lh = inf.hasFifth ? [root, root + 7] : [root];
    out[i] = { left: lh.map(m => midiToName(m, flats)).join(' '), right: rh.map(m => midiToName(m, flats)).join(' '), midis: [...lh, ...rh] };
    j = backs[k][j].back;
  }
  return out;
}

/* ---- transposition ------------------------------------------------- */

export function prefersFlats(key){ return FLAT_KEYS.has(String(key || '')); }

/* "C#m7/G#" +2 -> "D#m7/A#" (or Ebm7/Bb with flats). */
export function transposeChordName(name, n, flats = false){
  return String(name || '').split('/').map(part => {
    const m = part.match(/^([A-G])([#b♯♭]?)(.*)$/);
    if (!m) return part;
    const root = m[1] + (m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2]);
    const pc = NOTE_NAMES.indexOf(root) >= 0 ? NOTE_NAMES.indexOf(root) : FLAT_NAMES.indexOf(root);
    if (pc < 0) return part;
    return (flats ? FLAT_NAMES : NOTE_NAMES)[mod12(pc + n)] + m[3];
  }).join('/');
}

/* Key select value ("Am", "G") +n. */
export function transposeKey(key, n){
  const m = String(key || '').match(/^([A-G][#b]?)(m?)$/);
  if (!m) return key;
  const flats = prefersFlats(transposeChordName(m[1], n, true) + m[2]);
  return transposeChordName(m[1], n, flats) + m[2];
}

export function transposeNotes(str, n, flats = false){
  return String(str || '').trim().split(/\s+/).filter(Boolean).map(tok => {
    const m = noteToMidi(tok);
    return m === null ? tok : midiToName(m + n, flats);
  }).join(' ');
}

/* Shift every fret number on tab string lines by n. If that pushes a
   fret below 0 the whole tab moves up an octave (n + 12); above 22 it
   moves down. Non-tab lines are left alone. */
export function transposeTab(tab, n){
  const lines = String(tab || '').split('\n');
  const isTab = l => /^\s*[eBGDAEbgda]\s*[|:]/.test(l);
  const frets = [];
  lines.filter(isTab).forEach(l => (l.replace(/^\s*\S\s*[|:]/, '').match(/\d+/g) || []).forEach(x => frets.push(+x)));
  if (!frets.length) return tab;
  let shift = n;
  if (Math.min(...frets) + shift < 0) shift += 12;
  if (Math.max(...frets) + shift > 22) shift -= 12;
  if (Math.min(...frets) + shift < 0) return tab;          // can't fit — leave it
  return lines.map(l => {
    if (!isTab(l)) return l;
    const m = l.match(/^(\s*\S\s*[|:])(.*)$/);
    return m[1] + m[2].replace(/\d+/g, d => String(+d + shift));
  }).join('\n');
}

/* ---- capo ---------------------------------------------------------- */

/* For each capo 0..maxCapo, the shapes you'd finger (names shifted
   down) and how many are open-position shapes. -> best { capo,
   shapes, open, total } (ties go to the lower capo) plus all rows. */
export function suggestCapo(names, { maxCapo = 7 } = {}){
  const rows = [];
  for (let capo = 0; capo <= maxCapo; capo++){
    const shapes = names.map(n => transposeChordName(n, -capo, false));
    const open = shapes.filter(s => OPEN_VOICINGS[s]).length;
    rows.push({ capo, shapes, open, total: names.length });
  }
  const best = rows.reduce((b, r) => (r.open > b.open ? r : b), rows[0]);
  return { best, rows };
}

/* Capo voicings: the open shape fretted relative to the capo, i.e.
   actual frets = shape + capo. Null for shapes with no open voicing. */
export function capoVoicings(shapes, capo){
  return shapes.map(s => {
    const f = OPEN_VOICINGS[s];
    if (!f) return null;
    const frets = f.map(x => (x === null ? null : x + capo));
    const midis = [];
    frets.forEach((x, i) => { if (x !== null) midis.push(STRING_OPEN_MIDI[i] + x); });
    return { frets, midis, notes: midis.map(m => midiToName(m)).join(' ') };
  });
}
