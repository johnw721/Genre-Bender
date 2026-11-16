/* ============================================================
   blend.js — the mixer's "Generate blend" action.

   Sends the selected genre blend to the model and renders the
   returned creative direction, techniques, chord/rhythm guide,
   and reference tracks. All model text is escaped before display.
   ============================================================ */
import { callClaude } from './api.js';
import { escHtml, extractJSON } from './util.js';
import { store } from './store.js';
import { blendDescriptor } from './library.js';

/* ---- reference tracks → somewhere to hear them -----------------------
   The model gives artist + title (older replies: "Artist – Track" in one
   field). Links are search URLs built here, not model-written URLs, so they
   never point at a made-up video: YouTube, Spotify, Apple Music. */
export function splitRef(ref){
  let artist = String(ref?.artist || '').trim();
  let title = String(ref?.title || ref?.track || '').trim();
  if (!title){
    const m = artist.match(/^(.+?)\s+[–—-]\s+(.+)$/);
    if (m){ artist = m[1].trim(); title = m[2].trim(); }
  }
  title = title.replace(/^["“'‘]+|["”'’]+$/g, '');
  return { artist, title };
}
export function listenLinks(ref){
  const { artist, title } = splitRef(ref);
  const q = [artist, title].filter(Boolean).join(' ');
  if (!q) return [];
  const e = encodeURIComponent(q);
  return [
    { id: 'youtube', label: 'YouTube',     url: `https://www.youtube.com/results?search_query=${e}` },
    { id: 'spotify', label: 'Spotify',     url: `https://open.spotify.com/search/${e}` },
    { id: 'apple',   label: 'Apple Music', url: `https://music.apple.com/us/search?term=${e}` },
  ];
}
function refHTMLFor(ref){
  const { artist, title } = splitRef(ref);
  const name = [artist, title].filter(Boolean).join(' – ');
  const links = listenLinks(ref);
  return `<div class="ref-item"><div class="ref-icon">♪</div><div class="ref-body">
    <div class="ref-artist">${escHtml(name)}</div>
    ${ref?.note ? `<div class="ref-note">${escHtml(ref.note)}</div>` : ''}
    ${links.length ? `<div class="ref-links" aria-label="Listen to ${escHtml(name)}">${links.map(l =>
      `<a class="ref-link ref-${l.id}" href="${escHtml(l.url)}" target="_blank" rel="noopener noreferrer" title="Find it on ${l.label}">${l.label} ↗</a>`).join('')}</div>` : ''}
  </div></div>`;
}

export async function generateBlend(){
  if (store.selected.length < 2) return;
  const dot = document.getElementById('status-dot');
  const out = document.getElementById('output-body');
  const btn = document.getElementById('gen-btn');

  dot.className = 'status-dot live';
  out.className = 'output-body';
  out.innerHTML = '<span style="color:var(--muted)">Generating blend<span class="cursor"></span></span>';
  btn.disabled = true;

  const blendDesc = blendDescriptor();
  const prompt = `You are a music production AI assistant helping a bedroom producer blend genres. The user wants to blend: ${blendDesc}${referenceLine()}\nRespond ONLY with a JSON object (no markdown, no backticks, no preamble):\n{"direction":"2-3 sentence creative direction.","techniques":[{"name":"name","desc":"2-sentence DAW explanation."},{"name":"name","desc":"2-sentence."},{"name":"name","desc":"2-sentence."}],"chords":{"key":"key/mode","bpm":"BPM range","rhythm":"rhythmic feel","voicing":"chord voicing tip"},"references":[{"artist":"Artist","title":"Track title","note":"one sentence."},{"artist":"Artist","title":"Track title","note":"one sentence."},{"artist":"Artist","title":"Track title","note":"one sentence."}]}\nReferences must be real, released recordings that can be found on streaming services — give the exact artist name and track title, no URLs.`;

  try {
    const raw = await callClaude([{ role: "user", content: prompt }], { maxTokens: 1000 });
    const data = extractJSON(raw);
    store.blendData = data;               // kept for session persistence
    renderResult(data);
    dot.className = 'status-dot';
    dot.style.background = 'var(--green)';
    setTimeout(() => { dot.style.background = ''; dot.className = 'status-dot'; }, 2000);
  } catch (e) {
    out.innerHTML = '<span style="color:var(--coral)">Error generating blend. Check the AI endpoint configuration.<br><small style="opacity:.8">' + escHtml(e.message || String(e)) + '</small></span>';
    dot.className = 'status-dot';
    console.error(e);
  }
  btn.disabled = false;
}

/* One line describing the reference clip the mixer was seeded from, so the
   direction is grounded in something the producer actually heard. */
export function referenceLine(){
  const r = store.reference;
  if (!r) return '';
  const bits = [];
  if (r.key) bits.push(`key ${r.key}`);
  if (r.bpm) bits.push(`${r.bpm} BPM`);
  if (r.genres) bits.push(`sounds like: ${r.genres}`);
  if (r.notes) bits.push(`notes: "${String(r.notes).slice(0, 300)}"`);
  return `\nThey are blending TOWARD a reference clip ("${r.label}" on ${r.platform || 'the web'}${bits.length ? ' — ' + bits.join(', ') : ''}). Keep the creative direction, tempo and key anchored to that reference; say explicitly how the blend departs from it.`;
}

/* Exported so persist.js can re-render a restored session. */
export function renderResult(r){
  const out = document.getElementById('output-body');
  out.className = 'output-body has-content';

  const techHTML = (r.techniques || [])
    .map(t => `<div class="technique"><div class="technique-name">${escHtml(t.name)}</div><div class="technique-desc">${escHtml(t.desc)}</div></div>`)
    .join('');

  const c = r.chords || {};
  const chordHTML = Object.entries({ 'Key / mode': c.key, 'BPM range': c.bpm, 'Rhythmic feel': c.rhythm, 'Voicing tip': c.voicing })
    .filter(([, v]) => v)
    .map(([k, v]) => `<div class="chord-card"><div class="chord-card-label">${k}</div><div class="chord-card-value">${escHtml(v)}</div></div>`)
    .join('');

  const refHTML = (r.references || []).map(refHTMLFor).join('');

  out.innerHTML = `
    <div class="result-block"><div class="result-block-title">Creative direction</div><div class="direction-text">${escHtml(r.direction || '')}</div></div>
    <div class="result-block"><div class="result-block-title">Production techniques</div><div class="technique-list">${techHTML}</div></div>
    <div class="result-block"><div class="result-block-title">Chord &amp; rhythm guide</div><div class="chord-grid">${chordHTML}</div></div>
    <div class="result-block"><div class="result-block-title">Reference tracks</div><div class="ref-list">${refHTML}</div></div>`;
}
