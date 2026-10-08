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
  const prompt = `You are a music production AI assistant helping a bedroom producer blend genres. The user wants to blend: ${blendDesc}${referenceLine()}\nRespond ONLY with a JSON object (no markdown, no backticks, no preamble):\n{"direction":"2-3 sentence creative direction.","techniques":[{"name":"name","desc":"2-sentence DAW explanation."},{"name":"name","desc":"2-sentence."},{"name":"name","desc":"2-sentence."}],"chords":{"key":"key/mode","bpm":"BPM range","rhythm":"rhythmic feel","voicing":"chord voicing tip"},"references":[{"artist":"Artist – Track","note":"one sentence."},{"artist":"Artist – Track","note":"one sentence."},{"artist":"Artist – Track","note":"one sentence."}]}`;

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

  const refHTML = (r.references || [])
    .map(ref => `<div class="ref-item"><div class="ref-icon">♪</div><div><div class="ref-artist">${escHtml(ref.artist)}</div><div class="ref-note">${escHtml(ref.note)}</div></div></div>`)
    .join('');

  out.innerHTML = `
    <div class="result-block"><div class="result-block-title">Creative direction</div><div class="direction-text">${escHtml(r.direction || '')}</div></div>
    <div class="result-block"><div class="result-block-title">Production techniques</div><div class="technique-list">${techHTML}</div></div>
    <div class="result-block"><div class="result-block-title">Chord &amp; rhythm guide</div><div class="chord-grid">${chordHTML}</div></div>
    <div class="result-block"><div class="result-block-title">Reference tracks</div><div class="ref-list">${refHTML}</div></div>`;
}
