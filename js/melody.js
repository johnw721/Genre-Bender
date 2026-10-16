/* ============================================================
   melody.js — read a melody typed as notes or frets, and score
   how well a chord fits it. Pure (no DOM, no audio).

   Notes mode   "E G# B C#5 d eb"   letter + optional ♯/♭ + octave
   Frets mode   "e7 e9 B8 G9"       string letter + fret
                "e: 7 9 10 B: 8"    a string label carries over to
                                    the bare fret numbers after it
                "1:7 2:8"           tab string numbers, 1 = high e
                (E = low E string, e = high e; A D G B as usual)

   Separators: spaces, commas, dashes, pipes, slashes.
   ============================================================ */
import { STRING_OPEN_MIDI, NOTE_NAMES } from './theory.js';
import { parseChordName } from './chordbook.js';

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const STRING_IDX = { E: 0, A: 1, D: 2, G: 3, B: 4, e: 5 };   // low → high
const mod12 = (n) => ((n % 12) + 12) % 12;

function accOffset(a){
  if (a === '#' || a === '♯') return 1;
  if (a === 'b' || a === '♭') return -1;
  return 0;
}

/* -> { notes: [{ pc, midi|null, token, bar, string?, fret? }], bad: [token], bars }
   A "|" starts a new bar (bars = number of bars, 1 if none marked). */
export function parseMelody(text, mode = 'notes'){
  const tokens = String(text || '')
    .replace(/(\d)-(?=[\dA-Ga-g])/g, '$1 ')        // "7-9-10" / "e7-B8" read as separate notes
    .replace(/\|/g, ' | ')
    .split(/[\s,/–—]+/).map(t => t.trim()).filter(Boolean);
  const notes = [], bad = [];
  let curString = null;
  let bar = 0, barHasNotes = false;
  for (const raw of tokens){
    if (raw === '-' || raw === '–') continue;
    if (raw === '|'){ if (barHasNotes){ bar++; barHasNotes = false; } continue; }
    if (mode === 'frets'){
      // "e:" / "B:" / "3:" alone just sets the string
      let m = raw.match(/^([EADGBe]|[1-6])[:=]$/);
      if (m){ curString = m[1]; continue; }
      m = raw.match(/^([EADGBe]|[1-6])[:=]?(\d{1,2})$/) || (curString !== null && raw.match(/^()(\d{1,2})$/));
      if (!m){ bad.push(raw); continue; }
      const sTok = m[1] || curString;
      if (m[1]) curString = m[1];
      const idx = /\d/.test(sTok) ? 6 - parseInt(sTok, 10) : STRING_IDX[sTok];
      const fret = parseInt(m[2], 10);
      if (idx === undefined || idx < 0 || idx > 5 || fret > 24){ bad.push(raw); continue; }
      const midi = STRING_OPEN_MIDI[idx] + fret;
      notes.push({ pc: mod12(midi), midi, token: raw, bar, string: idx, fret });
      barHasNotes = true;
    } else {
      const m = raw.match(/^([A-Ga-g])([#b♯♭]?)(\d)?$/);
      if (!m){ bad.push(raw); continue; }
      const pc = mod12(PC[m[1].toUpperCase()] + accOffset(m[2]));
      const midi = m[3] !== undefined ? 12 * (parseInt(m[3], 10) + 1) + pc : null;
      notes.push({ pc, midi, token: raw, bar });
      barHasNotes = true;
    }
  }
  return { notes, bad, bars: notes.length ? notes[notes.length - 1].bar + 1 : 0, marked: /\|/.test(String(text || '')) };
}

/* ---- harmonizing --------------------------------------------------------
   Split the melody into bars — by its "|" marks, or every `perBar` notes —
   and pick the chord that sits best under each bar from `candidates`
   ([{ name, tonic?, rank }], in preference order). Scoring is chordFit's;
   ties go to the simpler chord (fewer tones), then candidate order. A
   small nudge keeps a chord from repeating bar after bar, and the first /
   last bar lean toward the tonic family. Each bar keeps its top 3 for
   cycling. */
export function splitBars(parsed, perBar = 4){
  const notes = parsed.notes || [];
  if (!notes.length) return [];
  const groups = [];
  if (parsed.marked && parsed.bars > 0){
    for (let b = 0; b < parsed.bars; b++) groups.push(notes.filter(n => n.bar === b));
  } else {
    const n = Math.max(1, perBar | 0);
    for (let i = 0; i < notes.length; i += n) groups.push(notes.slice(i, i + n));
  }
  return groups.filter(g => g.length).map(g => ({ notes: g, summary: summarize({ notes: g, bad: [] }) }));
}
function toneCount(name){ const p = parseChordName(name); return p ? new Set(p.intervals.map(i => mod12(i))).size : 9; }
export function harmonize(bars, candidates, { fallback = [] } = {}){
  let prev = null;
  return bars.map((bar, i) => {
    const last = i === bars.length - 1;
    const score = (c) => {
      const f = chordFit(c.name, bar.summary);
      if (!f) return null;
      let s = f.score;
      if (prev && c.name === prev) s -= 0.06;
      if ((i === 0 || last) && c.tonic) s += 0.05;
      return { c, f, s };
    };
    let ranked = candidates.map(score).filter(Boolean);
    // reach for outside chords only when nothing in the key covers the bar
    const bestIn = ranked.reduce((m, r) => Math.max(m, r.f.score), -9);
    if (bestIn < 0.45 && fallback.length) ranked = ranked.concat(fallback.map(score).filter(Boolean));
    ranked.sort((a, b) => b.s - a.s || toneCount(a.c.name) - toneCount(b.c.name) || (a.c.rank ?? 0) - (b.c.rank ?? 0));
    const seen = new Set();
    const alts = ranked.filter(r => !seen.has(r.c.name) && seen.add(r.c.name)).slice(0, 3)
      .map(r => ({ name: r.c.name, fit: r.f, outside: !!r.c.outside }));
    prev = alts[0] ? alts[0].name : prev;
    return { notes: bar.notes, summary: bar.summary, alts };
  });
}

/* Summary used by the color map: distinct pcs (in first-seen order),
   per-pc counts, first / last pc. */
export function summarize(parsed){
  const counts = new Map();
  const order = [];
  parsed.notes.forEach(n => {
    if (!counts.has(n.pc)) order.push(n.pc);
    counts.set(n.pc, (counts.get(n.pc) || 0) + 1);
  });
  const total = parsed.notes.length;
  return {
    total, counts, pcs: order,
    first: total ? parsed.notes[0].pc : null,
    last: total ? parsed.notes[total - 1].pc : null,
    notes: parsed.notes, bad: parsed.bad,
  };
}

/* How well does a chord sit under the melody?
     tones   melody pcs that are chord tones
     colour  melody pcs that aren't chord tones but don't clash
     clash   melody pcs a half step ABOVE a chord tone (the ♭9 rub),
             unless they're chord tones themselves
   score: share of melody note occurrences that are chord tones,
   minus a penalty per distinct clash. level 0–3 for the UI. */
export function chordFit(chordName, mel){
  const p = parseChordName(chordName);
  if (!p || !mel || !mel.total) return null;
  const chord = new Set(p.intervals.map(iv => mod12(p.rootPc + iv)));
  const tones = [], colour = [], clash = [];
  let hit = 0;
  mel.pcs.forEach(pc => {
    const n = mel.counts.get(pc);
    if (chord.has(pc)){ tones.push(pc); hit += n; }
    else if (chord.has(mod12(pc - 1))) clash.push(pc);
    else colour.push(pc);
  });
  const score = hit / mel.total - 0.2 * clash.length;
  let level = score >= 0.75 ? 3 : score >= 0.45 ? 2 : score >= 0.2 ? 1 : 0;
  if (clash.length) level = Math.min(level, 1);
  return { tones, colour, clash, score, level, covered: tones.length, distinct: mel.pcs.length };
}

/* Keys whose scale holds every melody note. Each key is listed once,
   with its usual spelling. Ranked: current key first, then melody
   starts / ends on the tonic, then majors before minors. Falls back
   to the keys covering the most notes when none covers them all. */
const MAJOR = [0, 2, 4, 5, 7, 9, 11], MINOR = [0, 2, 3, 5, 7, 8, 10];
const MAJ_NAME = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MIN_NAME = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];
export function keysForMelody(mel, currentKey = null, limit = 6){
  if (!mel || !mel.total) return { keys: [], complete: false };
  const rows = [];
  for (let r = 0; r < 12; r++){
    for (const minor of [false, true]){
      const set = new Set((minor ? MINOR : MAJOR).map(s => mod12(r + s)));
      const covered = mel.pcs.filter(pc => set.has(pc)).length;
      const key = (minor ? MIN_NAME : MAJ_NAME)[r];
      let rank = covered * 10;
      if (mel.last === r) rank += 3;
      if (mel.first === r) rank += 2;
      if (!minor) rank += 0.5;
      if (currentKey && samePitchKey(key, currentKey)) rank += 4;
      rows.push({ key, covered, rank });
    }
  }
  const best = Math.max(...rows.map(r => r.covered));
  const complete = best === mel.pcs.length;
  const keys = rows.filter(r => r.covered === best).sort((a, b) => b.rank - a.rank).slice(0, limit).map(r => r.key);
  return { keys, complete, covered: best };
}
function keyPcMode(k){
  const m = String(k).match(/^([A-G])([#b]?)(m?)$/);
  if (!m) return null;
  return { pc: mod12(PC[m[1]] + accOffset(m[2])), minor: m[3] === 'm' };
}
export function samePitchKey(a, b){
  const x = keyPcMode(a), y = keyPcMode(b);
  return !!x && !!y && x.pc === y.pc && x.minor === y.minor;
}

export function midiName(midi){ return NOTE_NAMES[mod12(midi)] + (Math.floor(midi / 12) - 1); }
