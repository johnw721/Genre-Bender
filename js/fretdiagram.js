/* ============================================================
   fretdiagram.js — layered fretboard diagram renderer.

   Draws a chord-box-style vertical fretboard (6 string columns,
   fret rows) with two independent, individually toggleable layers:

     • scale layer  — hollow dots for every in-scale note in the
       window, with scale roots drawn solid,
     • chord layer  — either a concrete voicing (fret array, drawn
       as labeled dots + open/mute markers like the classic chord
       box) or a pitch-class highlight (chord tones inside the
       scale box drawn as filled "chord-tone" dots).

   This is how the trainer intertwines scale shapes and chord
   shapes on one neck: the chord literally sits inside the box.
   Pure string-in → SVG-out; no DOM, no state.
   ============================================================ */
import { STRING_OPEN_MIDI } from './theory.js';

const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e'];

/*
  layeredFretSVG({
    window:     { lo, hi }        fret window to display (lo may be 0)
    chordFrets: [6]|null          voicing, low→high; 0=open, null=muted
    chordPcs:   Set|Array|null    chord-tone pitch classes to highlight
                                  on top of the scale layer (used when
                                  there's no concrete voicing)
    scaleNotes: [{string,fret,root}]|null   in-scale notes in the window
    showChord:  bool              chord layer visible
    showScale:  bool              scale layer visible
  })
*/
export function layeredFretSVG(opts = {}){
  const {
    chordFrets = null, chordPcs = null, scaleNotes = null,
    showChord = true, showScale = true,
  } = opts;
  const win = opts.window || windowFor(chordFrets, scaleNotes);

  const startFret = win.lo <= 1 ? 1 : win.lo;
  const rows = Math.max(4, win.hi - startFret + 1);
  const showNut = startFret === 1;

  const x0 = 22, dx = 22;
  const y0 = 40, dy = 26;
  const right = x0 + 5 * dx;
  const yFor = (fret) => y0 + (fret - startFret + 0.5) * dy;

  const pcSet = chordPcs ? new Set(chordPcs) : null;

  let svg = `<svg class="chord-box" viewBox="0 0 ${right + 22} ${y0 + rows * dy + 22}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`;

  /* grid */
  for (let r = 0; r <= rows; r++){
    const y = y0 + r * dy;
    const w = (r === 0 && showNut) ? 4 : 1;
    svg += `<line x1="${x0}" y1="${y}" x2="${right}" y2="${y}" class="cb-fret" stroke-width="${w}"/>`;
  }
  for (let s = 0; s < 6; s++){
    const x = x0 + s * dx;
    svg += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y0 + rows * dy}" class="cb-string"/>`;
  }
  /* fret number beside every row, always visible */
  for (let r = 0; r < rows; r++){
    svg += `<text x="${x0 - 10}" y="${y0 + (r + 0.5) * dy + 3}" class="cb-fretnum" text-anchor="end">${startFret + r}</text>`;
  }

  /* scale layer (drawn under the chord layer) */
  if (showScale && scaleNotes){
    for (const n of scaleNotes){
      const x = x0 + n.string * dx;
      const isTone = pcSet && showChord &&
        pcSet.has(((STRING_OPEN_MIDI[n.string] + n.fret) % 12 + 12) % 12);
      if (n.fret === 0){
        if (showNut){
          svg += `<circle cx="${x}" cy="${y0 - 16}" r="4.5" class="${n.root ? 'cb-scaleroot' : isTone ? 'cb-chordtone' : 'cb-scale'}"/>`;
        }
        continue;
      }
      if (n.fret < startFret || n.fret > startFret + rows - 1) continue;
      const y = yFor(n.fret);
      const cls = n.root ? 'cb-scaleroot' : isTone ? 'cb-chordtone' : 'cb-scale';
      svg += `<circle cx="${x}" cy="${y}" r="${n.root || isTone ? 6.5 : 5}" class="${cls}"/>`;
    }
  }

  /* chord layer: concrete voicing dots + open/mute markers */
  if (showChord && chordFrets){
    for (let s = 0; s < 6; s++){
      const x = x0 + s * dx;
      const v = chordFrets[s];
      if (v === null || v === undefined){
        svg += `<text x="${x}" y="${y0 - 12}" class="cb-mute" text-anchor="middle">×</text>`;
      } else if (v === 0){
        svg += `<circle cx="${x}" cy="${y0 - 16}" r="5" class="cb-open"/>`;
      } else if (v >= startFret && v <= startFret + rows - 1){
        const y = yFor(v);
        svg += `<circle cx="${x}" cy="${y}" r="8" class="cb-dot"/>`;
        svg += `<text x="${x}" y="${y + 4}" class="cb-dot-label" text-anchor="middle">${v}</text>`;
      }
    }
  }

  /* string names */
  for (let s = 0; s < 6; s++){
    const x = x0 + s * dx;
    svg += `<text x="${x}" y="${y0 + rows * dy + 16}" class="cb-strname" text-anchor="middle">${STRING_LABELS[s]}</text>`;
  }

  svg += `</svg>`;
  return svg;
}

/* Fret window that fits a voicing and/or a set of scale notes. */
export function windowFor(chordFrets, scaleNotes){
  const vals = [];
  if (chordFrets) chordFrets.forEach(f => { if (f !== null && f !== undefined && f > 0) vals.push(f); });
  if (scaleNotes) scaleNotes.forEach(n => { if (n.fret > 0) vals.push(n.fret); });
  if (!vals.length) return { lo: 0, hi: 4 };
  const mn = Math.min(...vals), mx = Math.max(...vals);
  if (mx <= 5) return { lo: 0, hi: Math.max(4, mx) };
  const lo = Math.max(1, mn - 1);
  return { lo, hi: Math.max(lo + 4, mx) };
}
