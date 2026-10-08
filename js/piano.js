/* ============================================================
   piano.js — piano / chord-chart generator.

   Same shape as the guitar generator but with left/right-hand
   voicings: prompt -> validate against chord names -> one repair
   pass -> render cards, rhythm pattern, and playback transport.

   Optional Hooktheory layer (see hooktheory.js) — same two
   integration points as guitar.js: a realism score on the generated
   progression (spends the "spare" retry when Tonal.js validation
   passed on the first try but the movement is statistically
   unusual), and an opt-in skeleton toggle that seeds the prompt with
   a real, commonly-occurring progression to reharmonize. Both are
   no-ops when Hooktheory isn't connected.
   ============================================================ */
import { callClaude } from './api.js';
import { escHtml, extractJSON } from './util.js';
import { validateChordList } from './theory.js';
import { buildChordCardHTML, initDragDrop } from './cards.js';
import { pianoSeq, updateComposeBanner } from './sequencer.js';
import { store } from './store.js';
import { blendDescriptor } from './library.js';
import { isHooktheoryAuthed, buildTrendSkeleton, scoreProgressionRealism } from './hooktheory.js';

const STYLE_MAP = {
  chord_voicings:    'chord voicings with left hand bass and right hand voicing',
  left_hand_pattern: 'a left hand bass/rhythm pattern',
  melody_line:       'a right hand melody line',
  full_comping:      'a full comping pattern with both hands'
};

// Below this mean transition probability (0-1), a progression is
// considered unusual enough to spend the realism retry on.
const REALISM_THRESHOLD = 0.05;

export async function generatePiano(){
  if (store.selected.length < 2){
    document.getElementById('piano-output').textContent = 'Select at least 2 genres in the mixer first.';
    return;
  }
  const key = document.getElementById('piano-key').value;
  const style = document.getElementById('piano-style').value;
  const chordCount = parseInt(document.getElementById('piano-chord-count').value) || 4;
  const useSkeleton = document.getElementById('piano-hooktheory')?.checked && isHooktheoryAuthed();
  const blendDesc = blendDescriptor();
  const out = document.getElementById('piano-output');
  const btn = document.getElementById('piano-gen-btn');

  out.className = 'tab-output';
  out.innerHTML = '<span style="color:var(--muted)">Generating piano chart<span class="cursor"></span></span>';
  btn.disabled = true; pianoSeq.stop();

  const buildPrompt = ({ retryHints, realismHint, skeleton } = {}) => {
    const rb = retryHints ? `\nFIX REQUIRED:\n${retryHints}\n` : '';
    const realb = realismHint ? `\n${realismHint}\n` : '';
    const skelb = (skeleton && skeleton.length)
      ? `\nUse this well-established chord skeleton as your starting point (a real, commonly-occurring progression): ${skeleton.join(' - ')}. Reharmonize/voice it to fit the blend, but keep the underlying functional movement close to it.\n`
      : '';
    return `You are a piano and music theory expert. A bedroom producer wants to blend: ${blendDesc}.\nGenerate ${STYLE_MAP[style]} in the key of ${key} with EXACTLY ${chordCount} chords.${rb}${realb}${skelb}\n\nRespond ONLY with a JSON object (no markdown, no backticks):\n{\n  "title":"Short title",\n  "description":"1-2 sentences.",\n  "chords":[\n    {"name":"Am7","left":"A2 E3","right":"E3 G3 C4 E4","beat":"1","duration_beats":4}\n  ],\n  "pattern":"Rhythmic pattern description.",\n  "notes":"1-2 DAW tips."\n}\nCRITICAL: chords array must have EXACTLY ${chordCount} entries. left and right must be real note names with octave numbers.`;
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
    const { bad, annotated } = validateChordList(result.chords || [], 'leftright');
    let retried = false;
    if (bad.length > 0){
      out.innerHTML = `<span style="color:var(--muted)">Fixing ${bad.length} chord${bad.length > 1 ? 's' : ''}…<span class="cursor"></span></span>`;
      const hints = bad.map(b => `"${b.name}": was [${b.allNotes.join(' ')}], should be [${b.expected.join(' ')}]`).join('\n');
      const retryResult = await callAPI(buildPrompt({ retryHints: hints, skeleton }));
      const { annotated: ra } = validateChordList(retryResult.chords || [], 'leftright');
      result.chords = annotated.map(orig => orig._valid !== false ? orig : (ra.find(r => r.name === orig.name) || orig));
      const { annotated: final } = validateChordList(result.chords, 'leftright');
      result.chords = final;
      retried = true;
    } else {
      result.chords = annotated;
    }

    // Realism check: only worth spending an extra call if we haven't
    // already used our one retry on note-validation, and only if
    // Hooktheory is connected.
    if (!retried && isHooktheoryAuthed()){
      const realism = await scoreProgressionRealism(result.chords.map(c => c.name), key);
      if (realism && realism.score < REALISM_THRESHOLD){
        out.innerHTML = '<span style="color:var(--muted)">Improving progression realism<span class="cursor"></span></span>';
        const hintMsg = `The progression ${result.chords.map(c => c.name).join(' - ')} is statistically unusual (Hooktheory realism score ${(realism.score * 100).toFixed(1)}%). Prefer a more common chord movement while keeping the blend's character.`;
        try {
          const retryResult = await callAPI(buildPrompt({ realismHint: hintMsg, skeleton }));
          const { bad: bad2, annotated: annotated2 } = validateChordList(retryResult.chords || [], 'leftright');
          // Only take the realism retry if it didn't itself fail structural validation.
          if (bad2.length === 0) result.chords = annotated2;
        } catch { /* keep the original, structurally-valid result */ }
      }
    }

    store.pianoChordData = result;
    renderPianoChart(result, style);
    updateComposeBanner();
  } catch (e) {
    out.innerHTML = '<span style="color:var(--coral)">Error generating chart. Try again.<br><small style="opacity:.8"></small></span>';
    out.querySelector('small').textContent = e.message || String(e);
    console.error(e);
  }
  btn.disabled = false;
}

/* Exported so persist.js can re-render a restored session. */
export function renderPianoChart(r, style){
  const out = document.getElementById('piano-output');
  out.className = 'tab-output has-content';
  const isArp = style === 'melody_line' || style === 'left_hand_pattern';
  const modeOpts = ['chord','arpeggio','strum']
    .map(m => `<option value="${m}"${m === (isArp ? 'arpeggio' : 'chord') ? ' selected' : ''}>${m}</option>`).join('');
  const dotsHTML = (r.chords || []).map((_, i) => `<div class="seq-dot" id="seq-dot-piano-${i}"></div>`).join('');
  const cardsHTML = (r.chords || []).map((c, i, arr) => buildChordCardHTML(c, i, 'piano', arr.length)).join('');

  out.innerHTML = `
    <div style="margin-bottom:14px">
      <div style="font-family:var(--display);font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px">${escHtml(r.title || '')}</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.6">${escHtml(r.description || '')}</div>
    </div>
    <div class="playback-toolbar">
      <span class="pb-label">Piano</span>
      <button class="pb-btn" id="piano-play-btn" onclick="toggleSeq('piano')">▶ play in tempo</button>
      <button class="pb-btn stop-btn" onclick="pianoSeq.stop();updateSeqBtn('piano')">■ stop</button>
      <select class="pb-mode-select" id="piano-pb-mode" aria-label="Piano playback mode" onchange="if(pianoSeq.playing){pianoSeq.stop();toggleSeq('piano')}">${modeOpts}</select>
      <div class="seq-pos-dots">${dotsHTML}</div>
      <button class="pb-btn midi-btn" onclick="exportMidi('piano')" title="Export as MIDI">↓ MIDI</button>
    </div>
    <div class="chord-cards-container" id="piano-cards-container">${cardsHTML}</div>
    ${r.pattern ? `<div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:12px 14px;margin-bottom:12px;font-size:12px;color:var(--text);line-height:1.7">${escHtml(r.pattern)}</div>` : ''}
    <div style="font-size:11px;color:var(--muted);border-left:2px solid var(--accent2);padding-left:10px;line-height:1.7">${escHtml(r.notes || '')}</div>`;
  initDragDrop('piano');
}
