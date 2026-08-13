/* ============================================================
   techniques.js — guitar technique vocabulary shared by the
   generator, the tab renderer, and the audio engine.

   A lead note event carries one technique. slide/hammer/pull/bend
   also carry a `to` target; vibrato and none stand alone.
   ============================================================ */
export const TECHNIQUES = ['none','slide','hammer','pull','bend','vibrato'];

/* Render a single lead event to its ASCII-tab token.
   ev = { fret, technique, to:{fret} } */
export function leadToken(ev){
  const f = ev.fret;
  switch (ev.technique){
    case 'slide':  return ev.to ? `${f}${ev.to.fret > f ? '/' : '\\'}${ev.to.fret}` : `${f}`;
    case 'hammer': return ev.to ? `${f}h${ev.to.fret}` : `${f}`;
    case 'pull':   return ev.to ? `${f}p${ev.to.fret}` : `${f}`;
    case 'bend':   return ev.to ? `${f}b${ev.to.fret}` : `${f}b`;
    case 'vibrato':return `${f}~`;
    default:       return `${f}`;
  }
}

/* Human-readable legend for the UI. */
export const TECH_LEGEND = '/ \\ slide   h hammer-on   p pull-off   b bend   ~ vibrato';
