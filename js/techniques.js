/* ============================================================
   techniques.js — guitar technique vocabulary shared by the
   generator, the tab renderer, and the audio engine.

   A lead note event carries one technique. slide/hammer/pull/bend
   also carry a `to` target; vibrato and none stand alone.
   ============================================================ */
export const TECHNIQUES = ['none','slide','hammer','pull','bend','vibrato'];

/* Render a single lead event to its ASCII-tab token.
   ev = { fret, technique, to:{fret} }

   `fmt` optionally re-labels the fret numbers — this is how the
   app-wide note-names toggle (labels.js) turns "5h7" into "AhB".
   The technique symbol and the slide direction are still decided
   from the real fret numbers, so the token reads correctly in
   either mode. Defaults to plain numbers.

   `bendMark` exists because the usual bend marker is "b", which
   collides with a flat once frets are labelled as notes ("AbB"
   would read as A-flat). Pass BEND_MARK_NOTES in note mode.
   h and p are safe either way — neither is a note letter. */
export const BEND_MARK_FRETS = 'b';
export const BEND_MARK_NOTES = '↑';

export function leadToken(ev, fmt, bendMark = BEND_MARK_FRETS){
  const label = typeof fmt === 'function' ? fmt : String;
  const f = label(ev.fret);
  const to = ev.to ? label(ev.to.fret) : '';
  switch (ev.technique){
    case 'slide':  return ev.to ? `${f}${ev.to.fret > ev.fret ? '/' : '\\'}${to}` : `${f}`;
    case 'hammer': return ev.to ? `${f}h${to}` : `${f}`;
    case 'pull':   return ev.to ? `${f}p${to}` : `${f}`;
    case 'bend':   return ev.to ? `${f}${bendMark}${to}` : `${f}${bendMark}`;
    case 'vibrato':return `${f}~`;
    default:       return `${f}`;
  }
}

/* Human-readable legend for the UI. Takes the bend marker actually in
   use so the legend matches what's on screen. */
export function techLegend(bendMark = BEND_MARK_FRETS){
  return `/ \\ slide   h hammer-on   p pull-off   ${bendMark} bend   ~ vibrato`;
}
export const TECH_LEGEND = techLegend();
