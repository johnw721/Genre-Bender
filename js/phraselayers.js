/* ============================================================
   phraselayers.js — per-bar bass / lick layering for the composer.

   Each generated bar holds two layers:
     - a "bass" part: the chord voicing reduced to its low strings
       (E/A/D), i.e. a root-focused low-register comp.
     - a "lick" part: the single-note lead line.

   A bar's `layer` is one of 'both' | 'bass' | 'lick'. When only one
   layer sounds, the other is shown greyed and its fret numbers can be
   cycled through IN-KEY / chord-tone alternatives (so substitutions
   never introduce wrong notes). All mutations here are pure functions
   over the timeline object, so playback, persistence and MIDI export
   stay in sync — they all read the same store.phraseData.
   ============================================================ */
import { STRING_OPEN_MIDI, midiToHz } from './theory.js';
import { scalePcs } from './scales.js';
import { parseChordName } from './chordbook.js';
import { leadToken } from './techniques.js';
import { escHtml } from './util.js';

export const LAYER_ORDER = ['both', 'bass', 'lick'];
export const LAYER_LABEL = { both: 'Bass+Lick', bass: 'Bass', lick: 'Lick' };

/* Reduce a full 6-string voicing to a low-register bass part: keep the
   fretted low strings (E, A, D = indices 0,1,2). If those are all muted
   (a high voicing), fall back to the two lowest fretted strings overall. */
export function bassFromVoicing(frets){
  const out = [null, null, null, null, null, null];
  for (let s = 0; s < 3; s++) if (frets[s] != null) out[s] = frets[s];
  if (out.every(f => f == null)){
    frets.map((f, i) => (f != null ? i : -1)).filter(i => i >= 0).slice(0, 2)
         .forEach(i => { out[i] = frets[i]; });
  }
  return out;
}

/* midis for a fret array (low->high), skipping muted strings. */
export function fretsToMidis(frets){
  const midis = [];
  frets.forEach((f, s) => { if (f != null) midis.push(STRING_OPEN_MIDI[s] + f); });
  return midis;
}

/* Is an event audible/visible under a layer selection? */
export function eventActive(ev, layer){
  if (layer === 'bass') return ev.type === 'chord';
  if (layer === 'lick') return ev.type === 'note';
  return true; // 'both' (or anything unexpected) -> everything sounds
}

/* Candidate frets on a string for the BASS layer = chord tones of the
   bar's chord (so substitutions stay inside the harmony). */
export function bassCandidates(chordName, stringIdx, lo = 0, hi = 15){
  const p = parseChordName(chordName);
  if (!p) return [];
  const pcs = new Set(p.intervals.map(iv => (p.rootPc + iv) % 12));
  const out = [];
  for (let f = lo; f <= hi; f++) if (pcs.has((STRING_OPEN_MIDI[stringIdx] + f) % 12)) out.push(f);
  return out;
}

/* Candidate frets on a string for the LICK layer = scale tones of the key. */
export function lickCandidates(key, stringIdx, lo = 0, hi = 15){
  const pcs = new Set(scalePcs(key));
  const out = [];
  for (let f = lo; f <= hi; f++) if (pcs.has((STRING_OPEN_MIDI[stringIdx] + f) % 12)) out.push(f);
  return out;
}

/* Next value after `current` in `candidates`, wrapping around. */
export function nextCandidate(current, candidates){
  if (!candidates.length) return current;
  const i = candidates.indexOf(current);
  return candidates[(i + 1) % candidates.length];
}

/* Recompute a chord event's midis/freqs from its frets (after an edit). */
export function recomputeChordEvent(ev){
  ev.midis = fretsToMidis(ev.frets);
  ev.freqs = ev.midis.map(midiToHz);
}

/* Cycle one greyed cell to the next in-key/chord-tone fret. Mutates the
   timeline in place; returns true if anything changed. (bi=bar index,
   ei=event index within the bar, si=string index 0..5.) */
export function cycleCell(timeline, bi, ei, si){
  const bar = timeline && timeline.bars && timeline.bars[bi];
  if (!bar) return false;
  const ev = bar.events[ei];
  if (!ev) return false;
  if (ev.type === 'chord'){
    const cands = bassCandidates(ev.name, si);
    if (!cands.length) return false;
    ev.frets[si] = nextCandidate(ev.frets[si], cands);
    recomputeChordEvent(ev);
    return true;
  }
  if (ev.type === 'note'){
    const cands = lickCandidates(timeline.key, ev.string);
    if (!cands.length) return false;
    ev.fret = nextCandidate(ev.fret, cands);
    ev.midi = STRING_OPEN_MIDI[ev.string] + ev.fret;
    ev.hz = midiToHz(ev.midi);
    ev.technique = 'none';          // a moved note's old slide/bend target is stale
    delete ev.to;
    return true;
  }
  return false;
}

/* Set (or cycle, when `layer` is omitted) a single bar's layer. */
export function setBarLayer(timeline, bi, layer){
  const bar = timeline && timeline.bars && timeline.bars[bi];
  if (!bar) return;
  if (layer && LAYER_ORDER.includes(layer)) bar.layer = layer;
  else { const i = LAYER_ORDER.indexOf(bar.layer || 'both'); bar.layer = LAYER_ORDER[(i + 1) % LAYER_ORDER.length]; }
}

/* Apply a layer to every bar (used by the global default control). */
export function setAllLayers(timeline, layer){
  if (!timeline || !timeline.bars) return;
  timeline.bars.forEach(b => { b.layer = LAYER_ORDER.includes(layer) ? layer : 'both'; });
}

/* ---- interactive tab rendering (pure: returns an HTML string) ----------- */
/* Columns for one bar, each carrying its source event + per-string cells. */
function barColumns(bar){
  const items = bar.events
    .map((ev, ei) => ({ ev, ei }))
    .filter(x => (x.ev.type === 'chord' && x.ev.frets && x.ev.frets.some(f => f != null)) || x.ev.type === 'note');
  items.sort((a, b) => (a.ev.at || 0) - (b.ev.at || 0) || (a.ev.type === 'chord' ? -1 : 1));
  return items.map(({ ev, ei }) => {
    if (ev.type === 'chord'){
      const cells = [];
      ev.frets.forEach((f, si) => { if (f != null) cells.push({ si, token: String(f), kind: 'bass', ei }); });
      return { ev, ei, cells };
    }
    return { ev, ei, cells: [{ si: ev.string, token: leadToken(ev), kind: 'lick', ei }] };
  });
}

const ROW_LABELS = ['e', 'B', 'G', 'D', 'A', 'E']; // top(high e)=idx5 .. bottom(low E)=idx0

/* Render the whole phrase as an interactive grid. Greyed cells carry an
   onclick that calls the global cycleCell() bridge. */
export function phraseGridHTML(timeline){
  if (!timeline || !timeline.bars || !timeline.bars.length) return '';
  let html = '<div class="ctab-bars">';
  timeline.bars.forEach((bar, bi) => {
    const layer = bar.layer || 'both';
    const cols = barColumns(bar);
    html += `<div class="ctab-bar layer-${layer}" data-bar="${bi}">`;
    html += `<button type="button" class="ctab-layer" onclick="cycleBarLayer(${bi})" ` +
            `title="Click to change this bar: Bass+Lick / Bass / Lick">${escHtml(LAYER_LABEL[layer])}</button>`;
    html += `<div class="ctab-chord">${escHtml(bar.chordName || '')}</div>`;
    html += '<table class="ctab"><tbody>';
    for (let topRow = 0; topRow < 6; topRow++){
      const si = 5 - topRow;
      html += `<tr><th class="ctab-str">${ROW_LABELS[topRow]}</th>`;
      cols.forEach(col => {
        const cell = col.cells.find(c => c.si === si);
        if (!cell){ html += '<td class="ctab-cell empty">-</td>'; return; }
        const editable = !eventActive(col.ev, layer);   // greyed (inactive) layer is editable
        const cls = `ctab-cell ${cell.kind} ${editable ? 'greyed' : 'on'}`;
        const click = editable ? ` onclick="cycleCell(${bi},${cell.ei},${si})"` : '';
        const title = editable ? ' title="Click to swap for another in-key fret"' : '';
        html += `<td class="${cls}"${click}${title}>${escHtml(cell.token)}</td>`;
      });
      html += '</tr>';
    }
    html += '</tbody></table></div>';
  });
  html += '</div>';
  return html;
}
