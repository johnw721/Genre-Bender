/* ============================================================
   chordpalette.js — the customizable chord-diagram table that
   sits inside the Shape Trainer's "My chords" track view.

   A palette is a curated, ordered set of chord shapes,
     { id, name, frets }   frets: exact 6-string voicing (low→high),
                           0 = open, null = muted
   shared across every track and persisted in localStorage. Shapes
   get in by name (chord-book voicing), by frets (the exact
   fingering you typed), by quick-filling a key's diatonic triads
   or sevenths, or by dragging a chord OUT of a track onto the
   table. Every card is draggable: drop one onto the track to
   insert that exact voicing at that position (trainer.js owns the
   track side of the drop), or onto another card to reorder the
   table. Click a card to hear it.

   Drag payloads travel two ways: a MIME type on dataTransfer for
   real drops, and a module-level mirror (getDragPayload) because
   dragover can't read dataTransfer contents in most browsers.
   ============================================================ */
import { getVoicing, parseChordName, withQuality } from './chordbook.js';
import { diatonicChords } from './scales.js';
import { ALL_KEYS, keyLabel } from './theorydata.js';
import { layeredFretSVG, windowFor } from './fretdiagram.js';
import { STRING_OPEN_MIDI, midiToHz } from './theory.js';
import { playChordNow } from './audio.js';
import { escHtml } from './util.js';
import { registerStore, loadJSON, saveJSON } from './storage.js';

const PALETTE_KEY = registerStore('chordPalette', 'GenreBenderChordPalette_v1');
export const DRAG_MIME = 'application/x-genre-bender-chord';

const $ = (id) => document.getElementById(id);

/* First-run seed: the open-chord "campfire" set. Delete freely. */
const SEED = ['C', 'G', 'D', 'A', 'E', 'Am', 'Em', 'Dm', 'F', 'G7', 'Am7', 'Cmaj7'];

let palette = [];
let dragPayload = null;   // { source: 'palette'|'track', id?, idx?, name, frets }

function makeId(){ return 'pal_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function resolvedFrets(name, frets){
  if (Array.isArray(frets) && frets.length === 6) return frets;
  const v = getVoicing(name);
  return v ? v.frets : null;
}

/* ---- persistence ---------------------------------------------------------- */
export function initPalette(){
  const s = loadJSON(PALETTE_KEY);
  if (s && Array.isArray(s.shapes)){
    palette = s.shapes.filter(e => e && typeof e.name === 'string').map(e => ({
      id: e.id || makeId(), name: e.name,
      frets: (Array.isArray(e.frets) && e.frets.length === 6) ? e.frets : null,
    }));
    return;
  }
  palette = SEED.map(name => ({ id: makeId(), name, frets: null }));
  save();
}
function save(){ saveJSON(PALETTE_KEY, { shapes: palette }); }

export function getPaletteEntry(id){ return palette.find(e => e.id === id) || null; }
export function paletteSize(){ return palette.length; }

/* ---- mutations ------------------------------------------------------------ */
/* Add a shape. `frets` pins an exact voicing; null lets the chord book
   pick. Duplicates (same name AND same voicing) are skipped — a table
   with two identical cards is never what you meant. */
export function paletteAdd(name, frets = null, { at = null } = {}){
  const clean = String(name || '').trim();
  if (!clean || !parseChordName(clean)) return false;
  const pinned = (Array.isArray(frets) && frets.length === 6) ? [...frets] : null;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (palette.some(e => e.name === clean && same(resolvedFrets(e.name, e.frets), resolvedFrets(clean, pinned)))) return false;
  const entry = { id: makeId(), name: clean, frets: pinned };
  if (at === null || at < 0 || at >= palette.length) palette.push(entry);
  else palette.splice(at, 0, entry);
  save();
  return true;
}
export function paletteRemove(id){
  const i = palette.findIndex(e => e.id === id);
  if (i < 0) return;
  palette.splice(i, 1);
  save();
  redrawPalette();
}
export function paletteClear(){
  if (!palette.length) return;
  if (!confirm('Clear every shape from the chord table?')) return;
  palette = [];
  save();
  redrawPalette();
}
export function paletteMove(fromId, toId, before = true){
  const from = palette.findIndex(e => e.id === fromId);
  let to = palette.findIndex(e => e.id === toId);
  if (from < 0 || to < 0 || from === to) return;
  const [moved] = palette.splice(from, 1);
  to = palette.findIndex(e => e.id === toId);
  palette.splice(before ? to : to + 1, 0, moved);
  save();
  redrawPalette();
}
/* Swap one card's quality in place (C -> C7 -> Cmaj9...), un-pinning the
   voicing so the chord book re-resolves a real shape for the new name. */
export function paletteChangeQuality(id, qualityKey){
  const e = getPaletteEntry(id);
  if (!e) return;
  const n = withQuality(e.name, qualityKey);
  if (!n) return;
  e.name = n; e.frets = null;
  save();
  redrawPalette();
}

/* Quick-fill: every diatonic chord of a key, as triads or sevenths.
   Skips shapes already on the table. */
export function paletteFillKey(key, flavour = 'triads'){
  const names = diatonicChords(key).map(n => {
    if (flavour !== 'sevenths') return n;
    const p = parseChordName(n);
    if (!p) return n;
    const q = p.quality === 'maj' ? 'maj7' : p.quality === 'min' ? 'min7' : 'm7b5';
    // the V of a key wants a dominant 7, not a major 7
    const isFive = fifthRootOf(key) === p.rootName;
    return withQuality(n, isFive && p.quality === 'maj' ? 'dom7' : q) || n;
  });
  let added = 0;
  names.forEach(n => { if (paletteAdd(n)) added++; });
  redrawPalette();
  return added;
}
function fifthRootOf(key){
  const d = diatonicChords(key);
  const p = parseChordName(d[4]);
  return p ? p.rootName : '';
}

/* Read the palette's own controls and act. */
export function paletteAddByName(){
  const el = $('palette-name');
  if (!el) return;
  let raw = el.value.trim();
  raw = raw ? raw[0].toUpperCase() + raw.slice(1) : '';
  const err = $('palette-err');
  if (!raw) return;
  if (!parseChordName(raw)){
    if (err) err.textContent = `Can't read "${raw}" — start with a note letter A–G.`;
    return;
  }
  if (err) err.textContent = '';
  if (!paletteAdd(raw) && err) err.textContent = `"${raw}" is already on the table.`;
  el.value = '';
  redrawPalette();
  el.focus();
}
export function paletteFillFromControls(flavour){
  const key = $('palette-key')?.value || 'C';
  const added = paletteFillKey(key, flavour);
  const err = $('palette-err');
  if (err) err.textContent = added ? '' : `Every ${flavour === 'sevenths' ? 'seventh' : 'triad'} in ${keyLabel(key)} is already on the table.`;
}

/* ---- audition ------------------------------------------------------------- */
export function palettePlay(id){
  const e = getPaletteEntry(id);
  const frets = e && resolvedFrets(e.name, e.frets);
  if (!frets) return;
  const freqs = [];
  frets.forEach((f, s) => { if (f !== null && f !== undefined) freqs.push(midiToHz(STRING_OPEN_MIDI[s] + f)); });
  if (freqs.length) playChordNow(freqs);
}

/* ---- drag payload mirror -------------------------------------------------- */
export function setDragPayload(p){ dragPayload = p; }
export function getDragPayload(){ return dragPayload; }
export function clearDragPayload(){ dragPayload = null; }

/* Wire the table's own drag behaviour. Delegated on the container so a
   redraw never loses listeners. The track-side drop logic lives in
   trainer.js; this only handles starting a drag from a card, reordering
   cards, and accepting a chord dragged off a track. */
export function initPaletteDrag(root){
  if (!root || root.__paletteDragWired) return;
  root.__paletteDragWired = true;

  root.addEventListener('dragstart', e => {
    const card = e.target.closest && e.target.closest('.palette-card');
    if (!card) return;
    const entry = getPaletteEntry(card.dataset.paletteId);
    if (!entry) return;
    // `frets` is what the card shows (for the table's own reorder + the
    // track's insert); `pinned` says whether that shape was hand-entered.
    // An unpinned card resolves to the same chord-book voicing the track
    // would pick itself, so the track keeps it un-pinned ("auto" stays
    // meaningful) and only a pinned fingering travels as an exact shape.
    const payload = { source: 'palette', id: entry.id, name: entry.name,
      frets: resolvedFrets(entry.name, entry.frets), pinned: !!entry.frets };
    setDragPayload(payload);
    try {
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
      e.dataTransfer.setData('text/plain', entry.name);
      e.dataTransfer.effectAllowed = 'copyMove';
    } catch { /* jsdom / odd browsers */ }
    card.classList.add('dragging');
  });
  root.addEventListener('dragend', e => {
    const card = e.target.closest && e.target.closest('.palette-card');
    if (card) card.classList.remove('dragging');
    clearPaletteHover(root);
    clearDragPayload();
  });
  root.addEventListener('dragover', e => {
    const grid = e.target.closest && e.target.closest('#palette-grid');
    if (!grid || !getDragPayload()) return;
    e.preventDefault();
    const p = getDragPayload();
    e.dataTransfer.dropEffect = p.source === 'palette' ? 'move' : 'copy';
    clearPaletteHover(root);
    const card = e.target.closest('.palette-card');
    if (card && p.source === 'palette'){
      const r = card.getBoundingClientRect();
      card.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after');
    } else if (p.source === 'track' || p.source === 'colormap'){
      grid.classList.add('drop-target');
    }
  });
  root.addEventListener('dragleave', e => {
    const grid = e.target.closest && e.target.closest('#palette-grid');
    if (grid && !grid.contains(e.relatedTarget)) clearPaletteHover(root);
  });
  root.addEventListener('drop', e => {
    const grid = e.target.closest && e.target.closest('#palette-grid');
    if (!grid) return;
    const p = getDragPayload();
    if (!p) return;
    e.preventDefault();
    clearPaletteHover(root);
    if (p.source === 'palette'){
      const card = e.target.closest('.palette-card');
      if (card && card.dataset.paletteId !== p.id){
        const r = card.getBoundingClientRect();
        paletteMove(p.id, card.dataset.paletteId, e.clientX < r.left + r.width / 2);
      }
    } else if (p.source === 'track' || p.source === 'colormap'){
      const err = $('palette-err');
      const frets = p.source === 'colormap' ? (p.pinned ? p.frets : null) : p.frets;
      if (paletteAdd(p.name, frets)){ if (err) err.textContent = ''; redrawPalette(); }
      else if (err) err.textContent = `"${p.name}" (that voicing) is already on the table.`;
    }
    clearDragPayload();
  });
}
function clearPaletteHover(root){
  root.querySelectorAll('.palette-card.drop-before, .palette-card.drop-after').forEach(c => c.classList.remove('drop-before', 'drop-after'));
  root.querySelectorAll('#palette-grid.drop-target').forEach(g => g.classList.remove('drop-target'));
}

/* ---- rendering ------------------------------------------------------------ */
function cardHTML(e){
  const frets = resolvedFrets(e.name, e.frets);
  const svg = frets
    ? layeredFretSVG({ chordFrets: frets, window: windowFor(frets, null), showChord: true, showScale: false })
    : `<div class="palette-noshape">no shape</div>`;
  const pinned = e.frets ? `<span class="palette-pin" title="Exact fingering you entered">pinned</span>` : '';
  return `<div class="palette-card" draggable="true" data-palette-id="${e.id}" role="listitem"
      title="Drag onto the track to insert · click to hear"
      onclick="palettePlay('${e.id}')">
    <span class="palette-grip" aria-hidden="true">⠿</span>
    <button type="button" class="palette-x" aria-label="Remove ${escHtml(e.name)} from the table"
      onclick="event.stopPropagation();paletteRemove('${e.id}')">×</button>
    ${svg}
    <div class="palette-card-label">${escHtml(e.name)}${pinned}</div>
  </div>`;
}
function gridInnerHTML(){
  if (!palette.length){
    return `<div class="palette-empty">The table is empty — add a chord by name, fill a key, or drag a chord down from the track.</div>`;
  }
  return palette.map(cardHTML).join('');
}
export function redrawPalette(){
  const g = $('palette-grid');
  if (g) g.innerHTML = gridInnerHTML();
}

/* Whole section. Called from the track view's render. `railKey` seeds
   the fill selector with the session key so "fill key" is one click. */
export function paletteHTML(railKey){
  const keyOpts = ALL_KEYS.map(k => `<option value="${k}"${k === railKey ? ' selected' : ''}>${escHtml(keyLabel(k))}</option>`).join('');
  return `
  <div class="palette" id="chord-palette" aria-label="Chord table">
    <div class="palette-head">
      <span class="section-label">Chord table</span>
      <span class="trainer-hint palette-hint">Drag a shape onto the track above to drop it in place · drag a track chord down here to keep its shape · click to hear</span>
    </div>
    <div class="palette-tools" role="group" aria-label="Customize the chord table">
      <input id="palette-name" class="trainer-custom-name" type="text" placeholder="e.g. F#m7" autocomplete="off" maxlength="12"
        aria-label="Chord to add to the table"
        onkeydown="if(event.key==='Enter'){event.preventDefault();paletteAddByName();}">
      <button class="pb-btn" type="button" onclick="paletteAddByName()">+ add</button>
      <span class="palette-sep" aria-hidden="true"></span>
      <label class="palette-key-label">key
        <select id="palette-key" data-keypick class="tab-style-select palette-key" aria-label="Key — changes the app key; fill buttons use it"
          onchange="syncKey(this.value,'palette-key')">${keyOpts}</select>
      </label>
      <button class="pb-btn" type="button" onclick="paletteFillFromControls('triads')" title="Add the key's seven diatonic triads">fill key</button>
      <button class="pb-btn" type="button" onclick="paletteFillFromControls('sevenths')" title="Add the key's seven diatonic seventh chords">fill 7ths</button>
      <span class="palette-sep" aria-hidden="true"></span>
      <button class="pb-btn" type="button" onclick="paletteClear()">clear table</button>
    </div>
    <div class="trainer-custom-err" id="palette-err"></div>
    <div class="palette-grid" id="palette-grid" role="list">${gridInnerHTML()}</div>
  </div>`;
}
