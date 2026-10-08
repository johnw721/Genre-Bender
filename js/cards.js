/* ============================================================
   cards.js — chord card rendering + interaction.

   Builds the draggable chord cards shared by guitar and piano,
   handles click-to-audition, drag-to-reorder (which rewrites the
   underlying chord array and restarts a running sequence), inline
   edit/delete of individual chords, and maps chord data into the
   { freqs, name, beats } shape the sequencer consumes.
   ============================================================ */
import { parseNoteString } from './theory.js';
import { escHtml } from './util.js';
import { playChordNow } from './audio.js';
import { cycleCardLoop, stopAllCardLoopers } from './loopers.js';
import { guitarSeq, pianoSeq, updateSeqBtn } from './sequencer.js';
import { store } from './store.js';
import { QUALITY_LABELS, withQuality, getVoicing, parseChordName } from './chordbook.js';
import { chordLabel } from './labels.js';
import { validateChordList } from './theory.js';

/* Which card (if any) is mid-edit, per instrument — drives buildChordCardHTML
   into rendering an inline edit form instead of the normal display. Cleared
   whenever cards are rebuilt from a fresh generation or on save/cancel. */
const editingCard = { guitar: null, piano: null };
/* Inline error shown in the open edit form (e.g. an unresolvable chord name). */
let editError = null;

/* The key the given panel is generating in — the reference for scale-degree
   labels when the app-wide chord toggle is set to degrees. */
function panelKey(instrument){
  return document.getElementById(`${instrument}-key`)?.value || 'C';
}

/* Build one chord card. instrument: 'guitar' | 'piano'. */
export function buildChordCardHTML(c, i, instrument, total = Infinity){
  const freqs = instrument === 'piano'
    ? [...parseNoteString(c.left), ...parseNoteString(c.right)]
    : parseNoteString(c.notes);
  const freqsJSON = JSON.stringify(freqs);
  const uid = `${instrument}-${i}`;

  if (editingCard[instrument] === i){
    return buildEditFormHTML(c, i, instrument, uid);
  }

  let badge = '';
  if (c._valid === true)       badge = `<div class="card-valid-badge ok">✓ verified</div>`;
  else if (c._valid === false) badge = `<div class="card-valid-badge warn">⚠ ${escHtml(c._correction || 'check notes')}</div>`;
  const invalidClass = c._valid === false ? ' invalid' : '';

  let body;
  if (instrument === 'piano'){
    body = `<div class="card-sub">LH: <span style="color:var(--accent)">${escHtml(c.left || '')}</span></div>
            <div class="card-sub">RH: <span style="color:var(--green)">${escHtml(c.right || '')}</span></div>`;
  } else {
    body = `<div class="card-notes">${escHtml(c.notes || '')}</div>`;
  }

  // Guitar cards get a chord-type selector, front and center right under the
  // name, so a chord — however it got here (typed by hand upstream in the
  // frets tool, or produced by the AI tab generator) — can be swapped for
  // its 7th/9th/11th/sus/etc. counterpart in one click. The new voicing
  // always comes from the chord book, so it stays a real, playable shape.
  // When the panel is showing degrees, keep the letter name visible underneath
  // — a numeral alone is hard to play from.
  const shown = chordLabel(c.name || '', panelKey(instrument));
  const nameSub = (shown === (c.name || '')) ? ''
    : `<div class="card-name-alt">${escHtml(c.name || '')}</div>`;

  let qualityPicker = '';
  if (instrument === 'guitar'){
    const p = parseChordName(c.name || '');
    const current = p ? p.quality : 'maj';
    const options = Object.entries(QUALITY_LABELS)
      .map(([key, label]) => `<option value="${key}"${key === current ? ' selected' : ''}>${escHtml(label)}</option>`)
      .join('');
    qualityPicker = `<select class="card-quality-select" aria-label="Chord type" title="Change chord type"
        onclick="event.stopPropagation()" onchange="event.stopPropagation();changeCardQuality(${i},this.value)">${options}</select>`;
  }

  return `<div class="chord-card-item${invalidClass}" draggable="true"
      data-seq="${instrument}" data-chord-idx="${i}" data-uid="${uid}"
      onclick="handleCardClick(event,'${uid}',${freqsJSON})">
    <span class="drag-handle">⠿</span>
    <span class="card-play-hint">▶ tap</span>
    <div class="card-name" title="${escHtml(c.name || '')}">${escHtml(chordLabel(c.name || '', panelKey(instrument)))}</div>
    ${nameSub}
    ${qualityPicker}
    ${body}
    ${badge}
    <div class="card-actions">
      <button class="card-loop-btn" id="loop-btn-${uid}"
        onclick="event.stopPropagation();cycleCardLoop('${uid}',${freqsJSON})">⟳ loop</button>
      <span class="card-loop-rate" id="loop-rate-${uid}"></span>
      <button class="card-action-btn" title="Edit chord" aria-label="Edit chord"
        onclick="event.stopPropagation();startEditCard('${instrument}',${i})">✎</button>
      <button class="card-action-btn danger" aria-label="Delete chord"${total <= 1
          ? ' disabled title="Keep at least one chord"'
          : ' title="Delete chord"'}
        onclick="event.stopPropagation();deleteCard('${instrument}',${i})">🗑</button>
    </div>
  </div>`;
}

/* Inline edit form for one card. Guitar edits just the name — typing a new
   name (root and/or quality) re-resolves a real voicing from the chord
   book. Piano has no auto-voicer, so its left/right note fields are
   editable directly, same shape as what the AI generator produces. */
function buildEditFormHTML(c, i, instrument, uid){
  const errorHTML = editError ? `<div class="card-edit-error">${escHtml(editError)}</div>` : '';
  const subFields = instrument === 'piano'
    ? `<input type="text" class="card-edit-sub" id="edit-left-${uid}" value="${escHtml(c.left || '')}" placeholder="LH notes, e.g. A2 E3">
       <input type="text" class="card-edit-sub" id="edit-right-${uid}" value="${escHtml(c.right || '')}" placeholder="RH notes, e.g. E3 G3 C4 E4">`
    : '';
  return `<div class="chord-card-item editing" data-seq="${instrument}" data-chord-idx="${i}" data-uid="${uid}">
    <div class="card-edit-label">Chord name</div>
    <input type="text" class="card-edit-name" id="edit-name-${uid}" value="${escHtml(c.name || '')}"
      placeholder="e.g. F#m7" onkeydown="if(event.key==='Enter'){event.preventDefault();saveEditCard('${instrument}',${i});} if(event.key==='Escape'){cancelEditCard('${instrument}');}">
    ${subFields}
    ${errorHTML}
    <div class="card-edit-actions">
      <button class="pb-btn" onclick="saveEditCard('${instrument}',${i})">✓ save</button>
      <button class="pb-btn" onclick="cancelEditCard('${instrument}')">✕ cancel</button>
    </div>
  </div>`;
}

/* Restart the given instrument's sequence in place (used after any edit
   that changes the underlying chord list while it's playing). */
function restartIfPlaying(instrument, chords){
  const seq = instrument === 'guitar' ? guitarSeq : pianoSeq;
  if (!seq.playing) return;
  const mode = document.getElementById(`${instrument}-pb-mode`)?.value || 'chord';
  const seqChords = getSeqChords(instrument, chords);
  if (!seqChords.length){ seq.stop(); updateSeqBtn(instrument); return; }
  seq.start(seqChords, seqChords[0]?.beats || 4, mode);
  updateSeqBtn(instrument);
}

/* Change a guitar chord card's quality (e.g. C -> C7 -> Cmaj9 -> Csus4).
   Re-resolves the new chord's notes from the chord book (a real,
   human-playable voicing — never guessed), updates the underlying data,
   and rebuilds the card UI. Restarts playback in place if it's running. */
export function changeCardQuality(idx, qualityKey){
  const data = store.guitarTabData;
  const c = data && data.chords && data.chords[idx];
  if (!c) return;
  const newName = withQuality(c.name, qualityKey);
  if (!newName) return;
  const v = getVoicing(newName);
  if (!v) return;
  c.name = newName;
  c.notes = v.notes;
  c._valid = true;
  c._correction = '';
  rebuildCardsUI('guitar', data.chords);
  restartIfPlaying('guitar', data.chords);
}

/* ---- inline edit ----------------------------------------------------------- */
export function startEditCard(instrument, idx){
  editingCard[instrument] = idx;
  editError = null;
  const data = instrument === 'piano' ? store.pianoChordData : store.guitarTabData;
  if (data && data.chords) rebuildCardsUI(instrument, data.chords);
}

export function cancelEditCard(instrument){
  editingCard[instrument] = null;
  editError = null;
  const data = instrument === 'piano' ? store.pianoChordData : store.guitarTabData;
  if (data && data.chords) rebuildCardsUI(instrument, data.chords);
}

export function saveEditCard(instrument, idx){
  const data = instrument === 'piano' ? store.pianoChordData : store.guitarTabData;
  const c = data && data.chords && data.chords[idx];
  if (!c) return;
  const uid = `${instrument}-${idx}`;
  const nameEl = document.getElementById(`edit-name-${uid}`);
  const newName = (nameEl ? nameEl.value : c.name || '').trim();
  if (!newName){
    editError = 'Enter a chord name.';
    rebuildCardsUI(instrument, data.chords);
    return;
  }

  if (instrument === 'guitar'){
    const v = getVoicing(newName);
    if (!v){
      editError = `Can't resolve "${newName}" to a chord — try e.g. "F#m7" or "Bbmaj9".`;
      rebuildCardsUI(instrument, data.chords);
      return;
    }
    c.name = newName;
    c.notes = v.notes;
  } else {
    const leftEl = document.getElementById(`edit-left-${uid}`);
    const rightEl = document.getElementById(`edit-right-${uid}`);
    c.name = newName;
    c.left = leftEl ? leftEl.value.trim() : c.left;
    c.right = rightEl ? rightEl.value.trim() : c.right;
  }

  const { annotated } = validateChordList([c], instrument === 'piano' ? 'leftright' : 'notes');
  Object.assign(c, annotated[0]);

  editingCard[instrument] = null;
  editError = null;
  rebuildCardsUI(instrument, data.chords);
  restartIfPlaying(instrument, data.chords);
}

/* ---- delete ----------------------------------------------------------------- */
export function deleteCard(instrument, idx){
  const data = instrument === 'piano' ? store.pianoChordData : store.guitarTabData;
  if (!data || !data.chords || !data.chords[idx]) return;
  // The delete button is disabled once only one chord remains, but guard
  // here too in case this is ever called directly.
  if (data.chords.length <= 1) return;
  stopAllCardLoopers();          // loop state is uid (index) keyed; clear before indices shift
  if (editingCard[instrument] === idx) editingCard[instrument] = null;
  data.chords.splice(idx, 1);
  rebuildCardsUI(instrument, data.chords);
  restartIfPlaying(instrument, data.chords);
}

/* ---- click-to-play ------------------------------------------------------- */
export function handleCardClick(e, uid, freqs){
  const instrument = uid.split('-')[0];
  if (dragState[instrument] !== null) return; // ignore the click that ends a drag
  playChordNow(freqs);
}

/* ---- drag + drop reordering ---------------------------------------------- */
const dragState = { guitar: null, piano: null };

export function initDragDrop(instrument){
  const container = document.getElementById(`${instrument}-cards-container`);
  if (!container) return;
  container.addEventListener('dragstart', e => {
    const card = e.target.closest('.chord-card-item'); if (!card) return;
    dragState[instrument] = parseInt(card.dataset.chordIdx);
    card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move';
  });
  container.addEventListener('dragend', () => {
    document.querySelectorAll('.chord-card-item').forEach(c => c.classList.remove('dragging','drag-over'));
    dragState[instrument] = null;
  });
  container.addEventListener('dragover', e => {
    e.preventDefault();
    const card = e.target.closest('.chord-card-item');
    document.querySelectorAll(`[data-seq="${instrument}"]`).forEach(c => c.classList.remove('drag-over'));
    if (card && parseInt(card.dataset.chordIdx) !== dragState[instrument]) card.classList.add('drag-over');
  });
  container.addEventListener('dragleave', e => {
    const c = e.target.closest('.chord-card-item'); if (c) c.classList.remove('drag-over');
  });
  container.addEventListener('drop', e => {
    e.preventDefault();
    const card = e.target.closest('.chord-card-item'); if (!card) return;
    const dest = parseInt(card.dataset.chordIdx);
    if (dragState[instrument] === null || dragState[instrument] === dest) return;
    reorderCards(instrument, dragState[instrument], dest);
  });
}

function reorderCards(instrument, from, to){
  const data = instrument === 'guitar' ? store.guitarTabData : store.pianoChordData;
  if (!data || !data.chords) return;
  stopAllCardLoopers();
  const moved = data.chords.splice(from, 1)[0];
  data.chords.splice(to, 0, moved);
  rebuildCardsUI(instrument, data.chords);
  restartIfPlaying(instrument, data.chords);
}

export function rebuildCardsUI(instrument, chords){
  const container = document.getElementById(`${instrument}-cards-container`);
  if (container) container.innerHTML = chords.map((c, i) => buildChordCardHTML(c, i, instrument, chords.length)).join('');
  const dotsWrap = document.querySelector(`#${instrument}-output .seq-pos-dots`);
  if (dotsWrap) dotsWrap.innerHTML = chords.map((_, i) => `<div class="seq-dot" id="seq-dot-${instrument}-${i}"></div>`).join('');
  initDragDrop(instrument);
}

/* ---- data mapping for the sequencer -------------------------------------- */
export function getSeqChords(instrument, chords){
  if (instrument === 'piano'){
    return chords
      .map(c => ({ freqs: [...parseNoteString(c.left), ...parseNoteString(c.right)], name: c.name, beats: c.duration_beats || 4 }))
      .filter(c => c.freqs.length > 0);
  }
  return chords
    .map(c => ({ freqs: parseNoteString(c.notes), name: c.name, beats: c.duration_beats || 4 }))
    .filter(c => c.freqs.length > 0);
}
