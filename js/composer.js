/* ============================================================
   composer.js — UI controller for the Phrase Composer.

   Reads the form, builds a phrase with the deterministic generator
   (phrase.js), renders ASCII tab (tabrender.js), and plays it back
   on the shared audio clock. The AI toggle ONLY asks the model to
   choose a progression + feel; the notes are always generated
   locally from the chord/scale books, so output stays in-key and
   playable whether or not AI is on.
   ============================================================ */
import { buildPhrase } from './phrase.js';
import {
  phraseGridHTML, eventActive, cycleCell as cycleCellPure,
  setBarLayer, setAllLayers, LAYER_ORDER
} from './phraselayers.js';
import { TECH_LEGEND } from './techniques.js';
import { diatonicChords, keyInfo, PROGRESSIONS } from './scales.js';
import { getCtx, playStrumAtTime, playLeadEvent } from './audio.js';
import { getBPM } from './metronome.js';
import { callClaude } from './api.js';
import { extractJSON, escHtml } from './util.js';
import { exportPhraseMidi } from './midi.js';
import { blendDescriptor } from './library.js';
import { store } from './store.js';

const $ = (id) => document.getElementById(id);

function readForm(){
  return {
    key: $('composer-key')?.value || 'Am',
    bars: parseInt($('composer-bars')?.value) || 4,
    density: $('composer-density')?.value || 'light',
    position: $('composer-position')?.value || 'open',
    voicing: $('composer-voicing')?.value || 'auto',
    layer: $('composer-layer')?.value || 'both',
    passingChords: !!$('composer-passing')?.checked,
    useAI: !!$('composer-ai')?.checked
  };
}

const ZONE_LABELS = {
  zone1: 'Zone 1 · open colors',
  zone2: 'Zone 2 · funk',
  zone3: 'Zone 3 · jazz voicings'
};

/* Ask the model only for a progression (degrees 0-6) + a name.
   Always validated; returns null on any problem so we fall back. */
async function aiArrange(key){
  const { mode } = keyInfo(key);
  const diatonic = diatonicChords(key);
  const examples = PROGRESSIONS[mode].map(p => p.name).join(', ');
  const blend = store.selected.length >= 2 ? blendDescriptor() : 'a versatile modern feel';
  const prompt =
    `You are arranging a ${mode}-key chord progression in ${key}. ` +
    `The 7 diatonic chords by scale degree (0-6) are: ${diatonic.map((c,i)=>`${i}=${c}`).join(', ')}. ` +
    `Style/feel to evoke: ${blend}. ` +
    `Choose a musical progression of 4 to 8 chords that fits. ` +
    `Respond with ONLY JSON: {"name":"<short roman-numeral name>","degrees":[<ints 0-6>]}. ` +
    `Example shapes: ${examples}. No prose, no code fences.`;
  try {
    const raw = await callClaude([{ role: 'user', content: prompt }], { maxTokens: 200 });
    const obj = extractJSON(raw);
    if (!obj || !Array.isArray(obj.degrees)) return null;
    const degrees = obj.degrees.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
    if (degrees.length < 2) return null;
    return { progressionDeg: degrees, progressionName: String(obj.name || 'AI arrangement') };
  } catch { return null; }
}

let _playState = { playing: false, timers: [], loopTimer: null };

export async function generatePhrase(){
  const cfg = readForm();
  const out = $('composer-output');
  const btn = $('composer-gen-btn');
  phraseStop();
  if (out){ out.classList.remove('placeholder'); out.textContent = 'Composing phrase…'; }
  if (btn) btn.disabled = true;

  let aiBits = null;
  if (cfg.useAI){
    if (out) out.textContent = 'Asking AI to arrange a progression…';
    aiBits = await aiArrange(cfg.key);
  }

  const timeline = buildPhrase({
    key: cfg.key, bars: cfg.bars, density: cfg.density,
    progressionDeg: aiBits?.progressionDeg,
    progressionName: aiBits?.progressionName,
    position: cfg.position,
    voicingStyle: cfg.voicing,
    passingChords: cfg.passingChords,
    layer: cfg.layer
  });
  store.phraseData = timeline;
  renderPhrase(timeline, cfg.useAI && aiBits ? 'AI' : 'rules');
  if (btn) btn.disabled = false;
}

export function regeneratePhrase(){
  // Reroll: rebuild from the current form with a fresh seed/template.
  const cfg = readForm();
  const timeline = buildPhrase({
    key: cfg.key, bars: cfg.bars, density: cfg.density, position: cfg.position,
    voicingStyle: cfg.voicing, passingChords: cfg.passingChords, layer: cfg.layer
  });
  store.phraseData = timeline;
  renderPhrase(timeline, 'rules');
}

let _lastSource = 'rules';

function renderPhrase(timeline, source){
  if (source) _lastSource = source;
  const out = $('composer-output');
  if (!out) return;
  const posLabel = timeline.position === 'open' ? 'open position'
    : timeline.position === 'auto' ? 'auto position'
    : ZONE_LABELS[timeline.position] ? ZONE_LABELS[timeline.position]
    : `position ${escHtml(String(timeline.position))}`;
  const voiceLabel = timeline.voicingStyle === 'compact' ? ' · drop-2 voicings'
    : timeline.voicingStyle === 'barre' ? ' · barre voicings' : '';
  const head =
    `Key ${escHtml(timeline.key)}  ·  ${timeline.bars.length} bars  ·  ` +
    `${escHtml(timeline.progressionName)}  ·  ${posLabel}${voiceLabel}  ·  ${_lastSource === 'AI' ? 'AI-arranged' : 'rule-based'}`;
  out.innerHTML =
    `<div class="composer-meta">${head}</div>` +
    phraseGridHTML(timeline) +
    `<div class="composer-legend">Per-bar button cycles Bass+Lick / Bass / Lick. Greyed numbers are editable — click to swap for another in-key fret. ${escHtml(TECH_LEGEND)}</div>`;
  const tools = $('composer-tools');
  if (tools) tools.style.display = 'flex';
  updatePhraseBtn();
}

/* ---- layer controls (interactive tab) ----------------------------------- */
/* Global default selector: re-tag every bar, then re-render. */
export function setComposerLayer(){
  const tl = store.phraseData;
  if (!tl) return;
  const layer = $('composer-layer')?.value || 'both';
  setAllLayers(tl, layer);
  renderPhrase(tl);
}

/* Per-bar toggle button: cycle one bar Bass+Lick -> Bass -> Lick. */
export function cycleBarLayer(bi){
  const tl = store.phraseData;
  if (!tl) return;
  setBarLayer(tl, bi);
  renderPhrase(tl);
}

/* Click a greyed cell to substitute the next in-key / chord-tone fret. */
export function cycleCell(bi, ei, si){
  const tl = store.phraseData;
  if (!tl) return;
  if (cycleCellPure(tl, bi, ei, si)) renderPhrase(tl);
}

/* ---- playback ------------------------------------------------------------ */
export function phrasePlay(){
  const tl = store.phraseData;
  if (!tl || !tl.bars.length) return;
  if (_playState.playing){ phraseStop(); return; }
  const spb = 60 / getBPM();
  const barSec = 4 * spb;                 // 4/4
  const ctx = getCtx();
  const start = ctx.currentTime + 0.06;

  tl.bars.forEach((bar, bi) => {
    const barStart = start + bi * barSec;
    const layer = bar.layer || 'both';
    bar.events.forEach(ev => {
      if (!eventActive(ev, layer)) return;   // respect this bar's Bass/Lick/Both choice
      if (ev.type === 'chord' && ev.freqs && ev.freqs.length){
        playStrumAtTime(ev.freqs, barStart + (ev.at || 0) * spb, (ev.beats || 4) * spb, spb);
      } else if (ev.type === 'note'){
        playLeadEvent(ev, barStart + (ev.at || 0) * spb, spb);
      }
    });
    // highlight the active bar (visual position)
    const delay = Math.max(0, (barStart - ctx.currentTime) * 1000);
    _playState.timers.push(setTimeout(() => highlightBar(bi, tl.bars.length), delay));
  });

  _playState.playing = true;
  updatePhraseBtn();
  const total = tl.bars.length * barSec * 1000;
  _playState.loopTimer = setTimeout(() => {
    if ($('composer-loop')?.checked){ _playState.playing = false; phrasePlay(); }
    else phraseStop();
  }, total + 60);
}

export function phraseStop(){
  _playState.playing = false;
  _playState.timers.forEach(clearTimeout);
  _playState.timers = [];
  if (_playState.loopTimer){ clearTimeout(_playState.loopTimer); _playState.loopTimer = null; }
  highlightBar(-1, 0);
  updatePhraseBtn();
}

function highlightBar(idx){
  const meta = $('composer-output')?.querySelector('.composer-meta');
  if (meta) meta.dataset.bar = idx >= 0 ? String(idx + 1) : '';
}

function updatePhraseBtn(){
  const b = $('composer-play-btn');
  if (!b) return;
  b.textContent = _playState.playing ? '⏸ playing…' : '▶ play phrase';
  b.classList.toggle('active-playing', _playState.playing);
}

export function exportComposerMidi(){
  if (store.phraseData) exportPhraseMidi(store.phraseData);
}

/* Re-render a phrase restored from a persisted session (persist.js). */
export function restorePhraseView(){
  if (store.phraseData) renderPhrase(store.phraseData);
}
