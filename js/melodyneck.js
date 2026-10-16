/* ============================================================
   melodyneck.js — draw a melody on the fretboard.

   Frets typed in frets mode are drawn exactly where you played
   them. Notes typed by name get a suggested fingering: the window
   (5 frets) with the least hand movement is picked, then each note
   goes to the nearest position of the right pitch inside it — so the
   path you see is playable as a line, not just "where the notes are".

   The key's scale is drawn faintly underneath (roots ringed), melody
   notes solid and numbered in order, out-of-key notes in amber, and a
   thin line joins them in playing order. Pure: returns an SVG string.
   ============================================================ */
import { STRING_OPEN_MIDI } from './theory.js';
import { spellPc } from './scales.js';

const mod12 = (n) => ((n % 12) + 12) % 12;
const WIDTH = 5;                         // frets per window

function positionsInWindow(lo, hi){
  const out = [];
  for (let s = 0; s < 6; s++) for (let f = lo; f <= hi; f++) out.push({ string: s, fret: f, midi: STRING_OPEN_MIDI[s] + f });
  return out;
}

/* Greedy fingering for name-typed notes inside one window. */
function pathFor(notes, lo, hi){
  const pos = positionsInWindow(lo, hi);
  let prev = null, prevMidi = null, cost = 0;
  const out = notes.map(n => {
    let cands;
    if (n.midi != null){
      cands = pos.filter(p => p.midi === n.midi);
      if (!cands.length) cost += 4;                 // typed an octave this window can't reach
    }
    if (!cands || !cands.length){
      const same = pos.filter(p => mod12(p.midi) === n.pc);
      if (prevMidi != null && same.length){
        // keep the line's contour: nearest octave to the previous pitch
        const best = Math.min(...same.map(p => Math.abs(p.midi - prevMidi)));
        cands = same.filter(p => Math.abs(p.midi - prevMidi) === best);
      } else cands = same;
    }
    if (!cands.length){ cost += 20; return null; }
    const pick = cands.reduce((b, p) => {
      const d = prev ? Math.abs(p.fret - prev.fret) + 0.6 * Math.abs(p.string - prev.string) : (p.fret - lo) * 0.1 + (5 - p.string) * 0.05;
      return !b || d < b.d ? { p, d } : b;
    }, null);
    cost += pick.d;
    prev = pick.p; prevMidi = pick.p.midi;
    return pick.p;
  });
  return { out, cost };
}

/* -> { lo, hi, placed: [{ string, fret, midi } | null] } */
export function layoutMelody(notes, { shift = 0 } = {}){
  if (!notes.length) return { lo: 0, hi: WIDTH - 1, placed: [] };
  const exact = notes.every(n => n.string !== undefined && n.fret !== undefined);
  if (exact){
    const frets = notes.map(n => n.fret);
    let lo = Math.max(0, Math.min(...frets) - 1);
    let hi = Math.max(lo + WIDTH - 1, Math.max(...frets) + 1);
    lo = Math.max(0, lo + shift); hi = Math.max(lo + WIDTH - 1, hi + shift);
    return { lo, hi, placed: notes.map(n => ({ string: n.string, fret: n.fret, midi: STRING_OPEN_MIDI[n.string] + n.fret })), exact: true };
  }
  let best = null;
  for (let lo = 0; lo <= 12; lo++){
    const r = pathFor(notes, lo, lo + WIDTH - 1);
    const total = r.cost + lo * 0.3;                // prefer lower positions unless a higher one is clearly smoother
    if (!best || total < best.total) best = { lo, total, placed: r.out };
  }
  if (shift){
    const lo = Math.max(0, Math.min(15, best.lo + shift));
    best = { lo, placed: pathFor(notes, lo, lo + WIDTH - 1).out };
  }
  return { lo: best.lo, hi: best.lo + WIDTH - 1, placed: best.placed, exact: false };
}

const STR_LABEL = ['E', 'A', 'D', 'G', 'B', 'e'];
export function neckSVG(notes, key, scalePcs, rootPc, opts = {}){
  const { lo, hi, placed, exact } = layoutMelody(notes, opts);
  const cols = hi - lo + 1;
  const cw = 46, rh = 18, padL = 24, padT = 12, w = padL + cols * cw + 10, h = padT + 5 * rh + 30;
  const x = (f) => padL + (f - lo + 0.5) * cw;          // dot sits mid-fret
  const y = (s) => padT + (5 - s) * rh;                  // high e on top, like tab
  const inKey = new Set(scalePcs);
  const parts = [];
  // frets + strings
  for (let f = lo; f <= hi + 1; f++){
    const fx = padL + (f - lo) * cw;
    parts.push(`<line x1="${fx}" y1="${padT}" x2="${fx}" y2="${padT + 5 * rh}" class="mn-fret${f === 0 ? ' nut' : ''}"/>`);
  }
  for (let s = 0; s < 6; s++){
    parts.push(`<line x1="${padL}" y1="${y(s)}" x2="${padL + cols * cw}" y2="${y(s)}" class="mn-string"/>`);
    parts.push(`<text x="${padL - 8}" y="${y(s) + 3}" class="mn-slabel">${STR_LABEL[s]}</text>`);
  }
  for (let f = lo; f <= hi; f++) parts.push(`<text x="${x(f)}" y="${padT + 5 * rh + 16}" class="mn-fnum">${f}</text>`);
  [3, 5, 7, 9, 15, 17].forEach(f => { if (f >= lo && f <= hi) parts.push(`<circle cx="${x(f)}" cy="${padT + 5 * rh + 24}" r="2" class="mn-inlay"/>`); });
  if (12 >= lo && 12 <= hi) parts.push(`<circle cx="${x(12) - 4}" cy="${padT + 5 * rh + 24}" r="2" class="mn-inlay"/><circle cx="${x(12) + 4}" cy="${padT + 5 * rh + 24}" r="2" class="mn-inlay"/>`);
  // scale underlay
  const used = new Set(placed.filter(Boolean).map(p => `${p.string}:${p.fret}`));
  for (let s = 0; s < 6; s++) for (let f = lo; f <= hi; f++){
    const pc = mod12(STRING_OPEN_MIDI[s] + f);
    if (!inKey.has(pc) || used.has(`${s}:${f}`)) continue;
    parts.push(`<circle cx="${x(f)}" cy="${y(s)}" r="5" class="mn-scale${pc === rootPc ? ' root' : ''}"><title>${spellPc(pc, key)}</title></circle>`);
  }
  // path + melody dots
  const pts = placed.map(p => p && [x(p.fret), y(p.string)]).filter(Boolean);
  if (pts.length > 1) parts.push(`<polyline points="${pts.map(p => p.join(',')).join(' ')}" class="mn-path"/>`);
  // one marker per position; repeated spots list every turn ("1·6")
  const spots = new Map();
  placed.forEach((p, i) => {
    if (!p) return;
    const k = `${p.string}:${p.fret}`;
    if (!spots.has(k)) spots.set(k, { p, order: [] });
    spots.get(k).order.push(i + 1);
  });
  for (const { p, order } of spots.values()){
    const pc = mod12(p.midi);
    const name = spellPc(pc, key);
    const cls = `mn-note${inKey.has(pc) ? '' : ' out'}${pc === rootPc ? ' root' : ''}`;
    const label = order.length > 3 ? `${order.slice(0, 2).join('·')}…` : order.join('·');
    const pw = Math.max(16, 8 + label.length * 6);
    const cx = x(p.fret), cy = y(p.string);
    parts.push(`<g class="${cls}"><rect x="${cx - pw / 2}" y="${cy - 8}" width="${pw}" height="16" rx="8"/>`
      + `<text x="${cx}" y="${cy + 3}">${label}</text><title>${order.join(', ')}. ${name} — ${STR_LABEL[p.string]} string, fret ${p.fret}</title></g>`);
  }
  const missing = placed.filter(p => !p).length;
  return {
    svg: `<svg class="mn-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Melody on the fretboard, frets ${lo} to ${hi}">${parts.join('')}</svg>`,
    lo, hi, exact, missing,
  };
}
