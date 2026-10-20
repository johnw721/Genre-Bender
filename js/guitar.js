/* ============================================================
   guitar.js — guitar tab generator.

   Asks the model for a tab in the chosen key/style, validates the
   returned chords against their names (Tonal.js), and does a single
   targeted repair pass for any that don't match before rendering
   the cards, tab block, and playback transport.

   Optional Hooktheory layer (see hooktheory.js): when connected,
   a generated progression is scored for how statistically common
   its chord-to-chord movement is; if the score is low we spend the
   one retry we'd otherwise skip on asking for something more
   conventional. Separately, an opt-in "skeleton" toggle seeds the
   very first prompt with a real, commonly-occurring chord skeleton
   pulled from Hooktheory's Trends corpus for the model to
   reharmonize. Both are additive — with Hooktheory disconnected,
   generation behaves exactly as before.
   ============================================================ */
import { callClaude } from './api.js';
import { escHtml, extractJSON } from './util.js';
import { validateChordList } from './theory.js';
import { buildChordCardHTML, initDragDrop } from './cards.js';
import { guitarSeq, updateComposeBanner } from './sequencer.js';
import { store } from './store.js';
import { blendDescriptor } from './library.js';
import { isHooktheoryAuthed, buildTrendSkeleton, realismPass } from './hooktheory.js';
import { renderProgTools, recordSnapshot, registerProgRenderer } from './progtools.js';
import { tabToNoteNames, showingNotes } from './labels.js';

const STYLE_MAP = {
  chord_progression: 'a chord progression in standard guitar tab notation',
  riff:              'a melodic riff in standard guitar tab notation',
  fingerpicking:     'a fingerpicking pattern in standard guitar tab notation',
  arpeggio:          'an arpeggio pattern in standard guitar tab notation'
};


export async function generateGuitar(){
  if (store.selected.length < 2){
    document.getElementById('guitar-output').textContent = 'Select at least 2 genres in the mixer first.';
    return;
  }
  const key = document.getElementById('guitar-key').value;
  const style = document.getElementById('guitar-style').value;
  const chordCount = parseInt(document.getElementById('guitar-chord-count').value) || 4;
  const useSkeleton = document.getElementById('guitar-hooktheory')?.checked && isHooktheoryAuthed();
  const blendDesc = blendDescriptor();
  const out = document.getElementById('guitar-output');
  const btn = document.getElementById('guitar-gen-btn');

  out.className = 'tab-output';
  out.innerHTML = '<span style="color:var(--muted)">Generating guitar tab<span class="cursor"></span></span>';
  btn.disabled = true; guitarSeq.stop();

  const buildPrompt = ({ retryHints, realismHint, skeleton } = {}) => {
    const rb = retryHints ? `\nFIX REQUIRED: Correct these chords:\n${retryHints}\n` : '';
    const realb = realismHint ? `\n${realismHint}\n` : '';
    const skelb = (skeleton && skeleton.length)
      ? `\nUse this well-established chord skeleton as your starting point (a real, commonly-occurring progression): ${skeleton.join(' - ')}. Reharmonize/voice it to fit the blend, but keep the underlying functional movement close to it.\n`
      : '';
    return `You are a guitar tablature and music theory expert. A bedroom producer wants to blend: ${blendDesc}.\nGenerate ${STYLE_MAP[style]} in the key of ${key} with EXACTLY ${chordCount} chords.${rb}${realb}${skelb}\n\nRespond ONLY with a JSON object (no markdown, no backticks):\n{\n  "title":"Short title",\n  "description":"1-2 sentences.",\n  "tab":"6-line guitar tab with string names. e|---| B|---| G|---| D|---| A|---| E|---| Use | for bars.",\n  "chords":[\n    {"name":"Am7","notes":"A2 E3 A3 C4 E4","duration_beats":4}\n  ],\n  "notes":"1-2 production tips."\n}\nIMPORTANT: chords array must have EXACTLY ${chordCount} entries. notes field must be real note names with octave numbers.`;
  };
  const callAPI = async (p) => extractJSON(await callClaude([{ role: "user", content: p }], { maxTokens: 900 }));

  try {
    let skeleton = null;
    if (useSkeleton) {
      out.innerHTML = '<span style="color:var(--muted)">Pulling a Hooktheory chord skeleton<span class="cursor"></span></span>';
      skeleton = await buildTrendSkeleton(key, chordCount); // null if unavailable — silently ignored
    }

    out.innerHTML = '<span style="color:var(--muted)">Generating chords<span class="cursor"></span></span>';
    let result = await callAPI(buildPrompt({ skeleton }));
    out.innerHTML = '<span style="color:var(--muted)">Validating<span class="cursor"></span></span>';
    const { bad, annotated } = validateChordList(result.chords || [], 'notes');
    let retried = false;
    if (bad.length > 0){
      out.innerHTML = `<span style="color:var(--muted)">Fixing ${bad.length} chord${bad.length > 1 ? 's' : ''}…<span class="cursor"></span></span>`;
      const hints = bad.map(b => `"${b.name}": was [${b.allNotes.join(' ')}], should be [${b.expected.join(' ')}]`).join('\n');
      const retryResult = await callAPI(buildPrompt({ retryHints: hints, skeleton }));
      const { annotated: ra } = validateChordList(retryResult.chords || [], 'notes');
      result.chords = annotated.map(orig => orig._valid !== false ? orig : (ra.find(r => r.name === orig.name) || orig));
      const { annotated: final } = validateChordList(result.chords, 'notes');
      result.chords = final;
      retried = true;
    } else {
      result.chords = annotated;
    }

    // Realism pass (hooktheory.js): scores the movement against Hooktheory's
    // corpus and — depending on the realism mode — may spend one retry
    // nudging it toward (or away from) common movement. Skipped when the
    // note-validation retry was already spent, and a no-op when disconnected.
    if (!retried && isHooktheoryAuthed()){
      const pass = await realismPass({
        chords: result.chords,
        key,
        onStatus: (msg) => { out.innerHTML = `<span style="color:var(--muted)">${msg}<span class="cursor"></span></span>`; },
        retry: async (hint) => {
          const retryResult = await callAPI(buildPrompt({ realismHint: hint, skeleton }));
          const { bad: bad2, annotated: annotated2 } = validateChordList(retryResult.chords || [], 'notes');
          return bad2.length === 0 ? annotated2 : null;
        },
      });
      result.chords = pass.chords;
      result._realism = pass.realism;
    }

    result._key = key;
    store.guitarTabData = result;
    recordSnapshot('guitar', result, skeleton ? 'skeleton' : 'generated');
    renderGuitarTab(result, style);
    updateComposeBanner();
  } catch (e) {
    out.innerHTML = '<span style="color:var(--coral)">Error generating tab. Try again.<br><small style="opacity:.8"></small></span>';
    out.querySelector('small').textContent = e.message || String(e);
    console.error(e);
  }
  btn.disabled = false;
}

/* Exported so persist.js can re-render a restored session. */
export function renderGuitarTab(r, style){
  const out = document.getElementById('guitar-output');
  out.className = 'tab-output has-content';
  const isArp = style === 'arpeggio' || style === 'fingerpicking';
  const modeOpts = ['chord','arpeggio','strum']
    .map(m => `<option value="${m}"${m === (isArp ? 'arpeggio' : 'chord') ? ' selected' : ''}>${m}</option>`).join('');
  const dotsHTML = (r.chords || []).map((_, i) => `<div class="seq-dot" id="seq-dot-guitar-${i}"></div>`).join('');
  const cardsHTML = (r.chords || []).map((c, i, arr) => buildChordCardHTML(c, i, 'guitar', arr.length)).join('');

  out.innerHTML = `
    <div style="margin-bottom:12px">
      <div style="font-family:var(--display);font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px">${escHtml(r.title || '')}</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.6">${escHtml(r.description || '')}</div>
    </div>
    <div class="playback-toolbar">
      <span class="pb-label">Guitar</span>
      <button class="pb-btn" id="guitar-play-btn" onclick="toggleSeq('guitar')">▶ play in tempo</button>
      <button class="pb-btn stop-btn" onclick="guitarSeq.stop();updateSeqBtn('guitar')">■ stop</button>
      <select class="pb-mode-select" id="guitar-pb-mode" aria-label="Guitar playback mode" onchange="if(guitarSeq.playing){guitarSeq.stop();toggleSeq('guitar')}">${modeOpts}</select>
      <div class="seq-pos-dots">${dotsHTML}</div>
      <button class="pb-btn midi-btn" onclick="exportMidi('guitar')" title="Export as MIDI">↓ MIDI</button>
    </div>
    <div class="prog-tools" id="guitar-tools"></div>
    <div class="chord-cards-container" id="guitar-cards-container">${cardsHTML}</div>
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:14px 16px;margin-bottom:12px;overflow-x:auto">
      <pre style="font-family:var(--mono);font-size:12px;line-height:2;color:var(--text);white-space:pre;margin:0">${escHtml(showingNotes() ? tabToNoteNames(r.tab || '') : (r.tab || ''))}</pre>
    </div>
    <div style="font-size:11px;color:var(--muted);border-left:2px solid var(--accent2);padding-left:10px;line-height:1.7">${escHtml(r.notes || '')}</div>`;
  initDragDrop('guitar');
  renderProgTools('guitar');
}

registerProgRenderer('guitar', (r) => renderGuitarTab(r, document.getElementById('guitar-style')?.value || 'chord_progression'));
