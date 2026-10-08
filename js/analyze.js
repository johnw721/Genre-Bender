/* ============================================================
   analyze.js — "03 — Analyze Track", v1.

   The tab was a placeholder for mp3 upload + genre fingerprinting.
   This is the honest first version: pick a saved reference clip,
   add what you hear (or paste the post's caption), and the AI
   reasons from that text to propose catalog genres with
   confidence, a BPM and key guess, and a feel. Results can be
   written back onto the clip's tags and used to seed the mixer.

   It does NOT hear the audio — embeds are cross-origin and expose
   no samples. The UI says so. When real analysis lands (upload or
   Web Audio on a local file) it slots in behind the same output.
   ============================================================ */
import { callClaude } from './api.js';
import { escHtml, extractJSON } from './util.js';
import { GENRES } from './config.js';
import { getClips, getClip, getActiveClip, onClipsChange, clipsUpdate, clipsSeedMixer, normalizeKey } from './clips.js';
import { registerActions } from './actions.js';

const $ = (id) => document.getElementById(id);
const ALL_GENRES = Object.values(GENRES).flatMap(c => c.genres);
const KEYS = ['Am','Em','Dm','Cm','Gm','A','C','D','E','G'];

let lastResult = null;   // { clipId, data }

function renderPicker(){
  const sel = $('analyze-clip');
  if (!sel) return;
  const clips = getClips();
  const current = sel.value || getActiveClip()?.id || '';
  sel.innerHTML = clips.length
    ? clips.map(c => `<option value="${c.id}">${escHtml(c.label)}</option>`).join('')
    : '<option value="">— save a clip in the dock first —</option>';
  if (clips.some(c => c.id === current)) sel.value = current;
  const btn = $('analyze-btn');
  if (btn) btn.disabled = !clips.length;
  fillNotesFromClip();
}

function fillNotesFromClip(){
  const sel = $('analyze-clip'), ta = $('analyze-notes');
  const clip = getClip(sel?.value);
  if (!ta || !clip) return;
  if (!ta.value.trim() || ta.dataset.from !== clip.id){
    ta.value = clip.notes || '';
    ta.dataset.from = clip.id;
  }
}

export async function analyzeClip(){
  const clip = getClip($('analyze-clip')?.value);
  const out = $('analyze-output');
  const btn = $('analyze-btn');
  if (!clip || !out) return;
  const notes = $('analyze-notes')?.value.trim() || '';

  btn.disabled = true;
  out.className = 'tab-output';
  out.innerHTML = '<span style="color:var(--muted)">Listening with my eyes<span class="cursor"></span></span>';

  const prompt = `You are a music production assistant. A producer saved a reference clip and wants to know what it is so they can blend toward it. You cannot hear it — reason from the text below and be candid about confidence.

Clip: "${clip.label}" (${clip.platform}, ${clip.url})
Producer's tags — key: ${clip.key || 'unknown'}, bpm: ${clip.bpm || 'unknown'}, genres: ${clip.genres || 'none yet'}
Caption / what they hear: ${notes ? `"${notes.slice(0, 1200)}"` : '(nothing provided)'}

Pick genres ONLY from this catalog (use the exact names): ${ALL_GENRES.join(', ')}.
Keys must be one of: ${KEYS.join(', ')} (or null).
Respond ONLY with a JSON object (no markdown, no backticks):
{"genres":[{"name":"catalog name","confidence":0.0,"why":"one short sentence"}],"bpm":120,"bpm_range":"110-130","key":"Am","feel":"one sentence on groove/rhythm","direction":"2 sentences: what defines this clip and how a producer would approach recreating it","caveat":"one sentence on what you could not tell from text alone"}
Give 2-4 genres, best first. If the notes are empty, infer what you can from the tags and the platform, with low confidence.`;

  try {
    const raw = await callClaude([{ role: 'user', content: prompt }], { maxTokens: 900 });
    const data = extractJSON(raw);
    data.genres = (data.genres || []).filter(g => ALL_GENRES.includes(g.name));
    data.key = KEYS.includes(data.key) ? data.key : (normalizeKey(data.key) || null);
    data.bpm = Number.isFinite(+data.bpm) && +data.bpm > 0 ? Math.round(+data.bpm) : null;
    lastResult = { clipId: clip.id, data };
    renderResult(clip, data);
  } catch (e) {
    out.innerHTML = `<span style="color:var(--coral)">Analysis failed. Check the AI endpoint (⚙ AI).<br><small style="opacity:.8">${escHtml(e.message || String(e))}</small></span>`;
    console.error(e);
  }
  btn.disabled = false;
}

function renderResult(clip, d){
  const out = $('analyze-output');
  out.className = 'tab-output has-content';
  const genres = (d.genres || []).map(g => {
    const pct = Math.round(Math.max(0, Math.min(1, +g.confidence || 0)) * 100);
    return `<div class="an-genre"><div class="an-genre-head"><span>${escHtml(g.name)}</span><em>${pct}%</em></div>
      <div class="an-bar"><i style="width:${pct}%"></i></div><div class="an-why">${escHtml(g.why || '')}</div></div>`;
  }).join('');
  const facts = [
    ['BPM', d.bpm ? `${d.bpm}${d.bpm_range ? ` <small>(${escHtml(d.bpm_range)})</small>` : ''}` : '—'],
    ['Key', d.key ? escHtml(d.key) : '—'],
    ['Feel', escHtml(d.feel || '—')],
  ].map(([k, v]) => `<div class="chord-card"><div class="chord-card-label">${k}</div><div class="chord-card-value">${v}</div></div>`).join('');
  out.innerHTML = `
    <div class="result-block"><div class="result-block-title">What it probably is</div><div class="an-genres">${genres || '<span class="rail-empty">no catalog match</span>'}</div></div>
    <div class="result-block"><div class="result-block-title">Tempo, key, feel</div><div class="chord-grid">${facts}</div></div>
    <div class="result-block"><div class="result-block-title">How to approach it</div><div class="direction-text">${escHtml(d.direction || '')}</div>
      ${d.caveat ? `<div class="an-caveat">⚠ ${escHtml(d.caveat)}</div>` : ''}</div>
    <div class="action-row">
      <button class="btn btn-primary" type="button" data-action="analyze:apply" title="Write these genres / key / BPM onto the clip's tags">Apply tags to clip</button>
      <button class="btn btn-ghost" type="button" data-action="analyze:seed" title="Apply tags, then select them in the mixer and blend toward this clip">Apply + seed mixer ⇢</button>
    </div>`;
}

function applyToClip(){
  if (!lastResult) return null;
  const { clipId, data } = lastResult;
  if (!getClip(clipId)) return null;
  const genres = (data.genres || []).map(g => g.name).slice(0, 4).join(', ');
  if (genres) clipsUpdate(clipId, 'genres', genres);
  if (data.key) clipsUpdate(clipId, 'key', data.key);
  if (data.bpm) clipsUpdate(clipId, 'bpm', String(data.bpm));
  const notes = $('analyze-notes')?.value.trim();
  if (notes) clipsUpdate(clipId, 'notes', notes);
  return clipId;
}

export function initAnalyze(){
  registerActions({
    'analyze:run':   () => analyzeClip(),
    'analyze:pick':  () => fillNotesFromClip(),
    'analyze:apply': () => { if (applyToClip()) flash('Tags written to clip'); },
    'analyze:seed':  () => { const id = applyToClip(); if (id) clipsSeedMixer(id); },
  });
  onClipsChange(renderPicker);
  renderPicker();
}

function flash(msg){
  const s = $('analyze-status');
  if (!s) return;
  s.textContent = msg;
  setTimeout(() => { s.textContent = ''; }, 2200);
}
