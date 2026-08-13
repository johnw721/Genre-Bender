/* ============================================================
   tabrender.js — turn a phrase timeline into ASCII guitar tab.

   Lays each bar out as columns in time order (chord first, then
   lead notes). Audio keeps true rhythm; the text view sequentializes
   simultaneous chord+lick as "strum then phrase", the way tab books
   usually print a chord followed by its lick. Strings render
   top->bottom as e B G D A E (high to low), standard tab order.
   ============================================================ */
import { leadToken } from './techniques.js';

const STRING_LABELS = ['e','B','G','D','A','E']; // top(high e) -> bottom(low E)
const BARS_PER_SYSTEM = 4;

/* One bar -> array of columns; each column maps low->high string idx to token.
   Chord stabs (including any inserted passing chord) and lead notes are laid
   out together in time order; a chord shares its time slot ahead of a note. */
function barColumns(bar){
  const evs = bar.events.filter(e =>
    (e.type === 'chord' && e.frets && e.frets.some(f => f !== null)) || e.type === 'note'
  );
  evs.sort((a, b) => (a.at || 0) - (b.at || 0) || (a.type === 'chord' ? -1 : 1));
  const cols = evs.map(ev => {
    if (ev.type === 'chord'){
      const col = {};
      ev.frets.forEach((f, s) => { if (f !== null) col[s] = String(f); });
      return col;
    }
    return { [ev.string]: leadToken(ev) };
  });
  if (!cols.length) cols.push({});
  return cols;
}

/* Render a system (up to BARS_PER_SYSTEM bars) into 6 text lines. */
function renderSystem(bars){
  // build column list with bar boundaries
  const lines = STRING_LABELS.map(l => l + '|');
  bars.forEach(bar => {
    const cols = barColumns(bar);
    cols.forEach(col => {
      const width = Math.max(2, ...Object.values(col).map(t => t.length), 1);
      for (let topRow = 0; topRow < 6; topRow++){
        const strIdx = 5 - topRow;            // top row = high e = idx5
        const tok = col[strIdx] || '';
        const pad = '-'.repeat(width - tok.length);
        lines[topRow] += '-' + tok + pad;
      }
    });
    for (let r = 0; r < 6; r++) lines[r] += '-|';
  });
  return lines.join('\n');
}

/* Full phrase -> string. */
export function renderTab(timeline){
  const systems = [];
  for (let i = 0; i < timeline.bars.length; i += BARS_PER_SYSTEM){
    systems.push(renderSystem(timeline.bars.slice(i, i + BARS_PER_SYSTEM)));
  }
  return systems.join('\n\n');
}
