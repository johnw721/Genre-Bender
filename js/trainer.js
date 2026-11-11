/* ============================================================
   trainer.js — Shape Trainer: drills that connect
   scale shapes ⇄ chord shapes ⇄ chords ⇄ numbers.

   Five question kinds, all built from the app's own theory
   engines (chord book + scale book) — no AI, no network:

     s2n  Shape → Number   see a voicing in a key, name its degree
     n2s  Number → Shape   "play the IV in G" — enter frets, we verify
     mv   Moving shapes    "E-shape barre at fret 3 = ?" — name the chord
     prog Progression ID   hear/see a progression, name the degree sequence
     sc   Scale shapes     see a scale box (roots marked), name the scale

   Every fretboard is drawn with TWO independent layers — the scale
   box and the chord shape — toggleable separately, so you can see
   how chords live inside scale positions (or hide either one).
   Layer preferences persist locally.

   Question order is driven by a Leitner spaced-repetition queue
   (trainersrs.js): missed cards come back soon, mastered cards
   drift out to multi-day intervals. Progress lives in localStorage.
   ============================================================ */
import { diatonicChords, keyInfo, guessKey } from './scales.js';
import {
  KEYS, romansFor, keyLabel, MV_QUALS, MV_SUFFIX, MV_QUAL_LABEL,
  SC_CENTERS, PROG_TEMPLATES, scaleNotesWindow
} from './theorydata.js';
import {
  getVoicing, parseChordName, E_SHAPES, A_SHAPES, QUALITY_LABELS, QUALITY_SUFFIX, withQuality,
  voicingCandidates, MAX_PLAYABLE_SPAN
} from './chordbook.js';
import { layeredFretSVG, windowFor } from './fretdiagram.js';
import { STRING_OPEN_MIDI, midiToHz, pcToName } from './theory.js';
import { playChordNow, playNote, playLeadEvent, getCtx } from './audio.js';
import { makeLooper } from './loopscheduler.js';
import { escHtml } from './util.js';
import { srsPick, srsRecord, srsStats, srsResetAll, srsToday } from './trainersrs.js';
import { renderExplore, redrawExploreDiagrams, configureExplore } from './trainerexplore.js';
import { detectChordAndKey } from './fretchords.js';
import { buildLick } from './phrase.js';
import { renderTab } from './tabrender.js';
import { getBPM } from './metronome.js';
import { registerStore, loadJSON, saveJSON } from './storage.js';
import {
  initPalette, paletteHTML, redrawPalette, initPaletteDrag, paletteAdd,
  getDragPayload, setDragPayload, clearDragPayload, DRAG_MIME
} from './chordpalette.js';
import {
  configureColorMap, recolorName, nextColorName, mapColumns, colorVoicing, FN_LABEL,
  degreeOf, pinnedFretsFor, LEVEL_NAMES
} from './colormap.js';
import { getAppKey, syncKey } from './keysync.js';
import { mergeSeedPack } from './seeds.js';

const $ = (id) => document.getElementById(id);

/* ---- decks ------------------------------------------------
   Shared vocabulary (KEYS, romans, barre shapes, progression
   templates, scaleNotesWindow) lives in theorydata.js. */
const SC_TYPES = ['pent', 'full'];
function scaleLabel(key, type){ return keyLabel(key) + (type === 'pent' ? ' pentatonic' : ''); }

/* Production drill skips the diminished degree (awkward beginner shape). */
function n2sDegrees(key){
  return keyInfo(key).mode === 'minor' ? [0, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4, 5];
}

function mvRootPc(fam, fret){ return ((fam === 'E' ? 4 : 9) + fret) % 12; }
function mvName(fam, qual, fret){ return pcToName(mvRootPc(fam, fret)) + MV_SUFFIX[qual]; }

/* All card ids for a mode ('mixed' = every deck). */
function deckFor(mode){
  if (mode === 's2n') return KEYS.flatMap(k => [0,1,2,3,4,5,6].map(d => `s2n|${k}|${d}`));
  if (mode === 'n2s') return KEYS.flatMap(k => n2sDegrees(k).map(d => `n2s|${k}|${d}`));
  if (mode === 'mv'){
    const out = [];
    for (const fam of ['E', 'A'])
      for (const q of MV_QUALS)
        for (let f = 1; f <= 9; f++) out.push(`mv|${fam}|${q}|${f}`);
    return out;
  }
  if (mode === 'prog') return KEYS.flatMap(k => [0,1,2,3].map(t => `prog|${k}|${t}`));
  if (mode === 'sc'){
    return KEYS.flatMap(k => SC_TYPES.flatMap(ty => SC_CENTERS.map(c => `sc|${k}|${c}|${ty}`)));
  }
  if (mode === 'cm') return cmDeck();
  return ['s2n','n2s','mv','prog','sc','cm'].flatMap(deckFor);
}

/* ---- Color map drill ---------------------------------------------------
   Cards come from the color map itself (your edits included): in-scale
   columns (triad + the first two colours) and the out-of-scale roots
   (first two chords). Question: hear / see the chord in a key, name its
   degree and job — "Emaj7 in E → I · tonic", "C in E → ♭VI · outside". */
const CM_VIEWS = ['in', 'out'];
function cmCards(key, view){
  return mapColumns(key, view).flatMap(col => {
    const qs = col.items.filter(i => i.off === 0).slice(0, 2).map(i => i.q);
    return (view === 'in' ? ['tri', ...qs] : qs).map(q => `cm|${key}|${view}|${col.id}|${q}`);
  });
}
function cmDeck(){ return KEYS.flatMap(k => CM_VIEWS.flatMap(v => cmCards(k, v))); }
function cmLabel(col){ return `${col.roman} · ${FN_LABEL[col.fn]}${col.chromatic ? ' (outside)' : ''}`; }
function buildCM(id, key, view, colId, q){
  const cols = mapColumns(key, view);
  const col = cols.find(c => c.id === colId) || cols[0];
  if (!col) return null;
  const item = q === 'tri' ? null : col.items.find(i => i.off === 0 && i.q === q);
  const chord = item ? item.name : (col.anchor || (col.items[0] && col.items[0].name));
  if (!chord) return null;
  const v = colorVoicing(chord) || getVoicing(chord);
  const correct = cmLabel(col);
  const pool = [...new Set(CM_VIEWS.flatMap(vw => mapColumns(key, vw)).map(cmLabel))].filter(l => l !== correct);
  const options = shuffle([correct, ...shuffle(pool).slice(0, 3)]);
  const note = item && item.note ? ` <span class="trainer-hint">${escHtml(item.note)}</span>` : '';
  return {
    id, kind: 'cm', correctIdx: options.indexOf(correct),
    playFreqs: v ? v.midis.map(midiToHz) : null,
    diagrams: [{ chordFrets: v ? v.frets : null, scaleKey: key, scaleType: 'full', revealLabel: chord }],
    questionHTML: `
      <div class="trainer-prompt">Key of <strong>${escHtml(keyLabel(key))}</strong> — where does <strong>${escHtml(chord)}</strong> live, and what job does it do?
        <span class="trainer-hint">From your color map${view === 'out' ? ' · out-of-scale roots included' : ''}.</span>
      </div>
      ${DIAGRAMS_DIV}
      <button class="pb-btn" type="button" onclick="trainerPlay()">▶ hear it</button>`,
    answersHTML: options.map((n, i) =>
      `<button class="fret-chord trainer-opt" id="trainer-opt-${i}" onclick="trainerAnswer(${i})">${escHtml(n)}</button>`).join(''),
    revealHTML: `<strong>${escHtml(chord)}</strong> is <strong>${escHtml(correct)}</strong> in ${escHtml(keyLabel(key))}.${note}`,
  };
}

/* ---- module state ----------------------------------------- */
let mode = 'mixed';
let current = null;          // the active question object
let lastId = null;           // previous card id (avoid immediate repeats)
let answered = false;
let session = { asked: 0, right: 0, streak: 0 };
let advanceToken = 0;        // cancels a pending auto-advance
let progLooper = null;

/* Per-mode quiz ⇄ explore preference, persisted locally. */
const VIEW_KEY = registerStore('trainerView', 'GenreBenderTrainerView_v1');
let viewPref = {};
function loadViewPref(){
  viewPref = loadJSON(VIEW_KEY, {});
}
function saveViewPref(){
  saveJSON(VIEW_KEY, viewPref);
}
function exploring(){ return mode !== 'mixed' && mode !== 'custom' && mode !== 'cm' && viewPref[mode] === 'explore'; }
function updateViewToggle(){
  const b = $('trainer-view-toggle');
  if (!b) return;
  b.style.display = (mode === 'mixed' || mode === 'custom' || mode === 'cm') ? 'none' : '';
  b.classList.toggle('on', exploring());
  b.textContent = exploring() ? '🎓 back to quiz' : '🧭 explore this drill';
}
/* "My chords" is a reference/practice panel, not a quiz deck — it has
   no SRS stats and the scale layer / reset-progress controls don't
   apply to it, so hide them while it's active. */
function updateModeChrome(){
  const scaleWrap = $('trainer-layer-scale-wrap');
  if (scaleWrap) scaleWrap.style.display = mode === 'custom' ? 'none' : '';
  const resetBtn = $('trainer-reset-btn');
  if (resetBtn) resetBtn.style.display = mode === 'custom' ? 'none' : '';
}

/* Layer visibility — independent toggles, persisted locally. */
const LAYERS_KEY = registerStore('trainerLayers', 'GenreBenderTrainerLayers_v1');
let layers = { chord: true, scale: true };
function loadLayers(){
  const s = loadJSON(LAYERS_KEY);
  if (s) layers = { chord: !!s.chord, scale: !!s.scale };
}
function saveLayers(){
  saveJSON(LAYERS_KEY, layers);
}
function syncLayerCheckboxes(){
  const c = $('trainer-layer-chord'), s = $('trainer-layer-scale');
  if (c) c.checked = layers.chord;
  if (s) s.checked = layers.scale;
}

/* ---- "My chords" — saved tracks of chord diagrams ----------------
   A track is a named, ordered sequence of chords (like a chord tab):
   add a chord by typing its name, or by entering its actual frets
   (six squares, same reading logic as the frets->chords tab, chord
   name auto-detected from the notes) so the diagram shows YOUR
   fingering rather than the auto-picked voicing. Several tracks can
   be saved and switched between; once a track has 2+ chords, the
   last two are used to guess a likely key and suggest diatonic
   chords to add next. Every gap between adjacent chords also gets a
   suggested lick (phrase.buildLick) — a short pentatonic fill that
   resolves from the first chord's tones onto the second's, reusing
   the composer's lead-line engine. Reference/practice panel — never
   feeds SRS. */
const TRACKS_KEY = registerStore('trainerTracks', 'GenreBenderTrainerTracks_v1');
const LEGACY_CUSTOM_KEY = 'GenreBenderTrainerCustom_v1'; // pre-tracks flat chord list
let tracks = [];
let activeTrackId = null;
let editingCustomIdx = null;      // index of the chord mid-rename in "My chords", or null
let customEditError = null;       // inline error shown in that edit form
let customFitMessage = null;      // one-shot status line after "fit key", shown once then cleared

function makeTrackId(){ return 'trk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function makeTrack(name){ return { id: makeTrackId(), name, chords: [] }; }
function getActiveTrack(){ return tracks.find(t => t.id === activeTrackId) || tracks[0] || null; }

function loadTracks(){
  {
    const s = loadJSON(TRACKS_KEY);
    if (s && Array.isArray(s.tracks) && s.tracks.length){
      tracks = s.tracks;
      activeTrackId = tracks.some(t => t.id === s.activeId) ? s.activeId : tracks[0].id;
      return;
    }
  }
  // Migrate the earlier flat "My chords" list into a first track, if present.
  let migrated = [];
  const old = loadJSON(LEGACY_CUSTOM_KEY);
  if (Array.isArray(old)) migrated = old.filter(n => typeof n === 'string' && n).map(name => ({ name, frets: null }));
  const t = makeTrack('My chords');
  t.chords = migrated;
  tracks = [t];
  activeTrackId = t.id;
  saveTracks();
}
function saveTracks(){
  saveJSON(TRACKS_KEY, { tracks, activeId: activeTrackId });
}
function addChordToActiveTrack(entry){
  const t = getActiveTrack();
  if (!t) return;
  t.chords.push(entry);           // tracks are sequences — repeats are allowed on purpose
  saveTracks();
}

/* Capitalize just the first character so "am7" reads as "Am7" —
   parseChordName requires an uppercase A–G root letter. */
function normalizeChordInput(raw){
  const t = String(raw || '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

/* Read the six "add by frets" squares -> per-string fret array
   (null = muted) + the sounding MIDI notes, same convention as
   the trainer's n2s fret entry and the frets->chords tab. */
function readCustomFretSquares(){
  const frets = [], midis = [];
  for (let i = 0; i < 6; i++){
    const el = $('trainer-custom-fret-' + i);
    const raw = (el ? el.value : '').trim().toLowerCase();
    if (raw === '' || raw === 'x' || raw === '-'){ frets.push(null); continue; }
    const f = parseInt(raw, 10);
    if (Number.isNaN(f) || f < 0 || f > 24){ frets.push(null); continue; }
    frets.push(f);
    midis.push(STRING_OPEN_MIDI[i] + f);
  }
  return { frets, midis };
}
function clearCustomFretSquares(){
  for (let i = 0; i < 6; i++){ const el = $('trainer-custom-fret-' + i); if (el) el.value = ''; }
}

/* A track entry is { name, frets }: frets is the exact voicing when
   added via the fret squares, typed via the position control below, or
   null when added by name (in which case the diagram falls back to the
   chord book's best guess). */
function resolvedFretsFor(entry){
  return entry.frets || (getVoicing(entry.name) || {}).frets || null;
}
function customDiagSpec(entry, idx){
  return { chordFrets: resolvedFretsFor(entry), label: `${idx + 1}. ${entry.name}` };
}
/* Lowest fretted (non-open, non-muted) note of a voicing — the fret a
   guitarist would call its "position". 0 if the shape is all open/muted. */
function startFretOf(frets){
  if (!frets) return 0;
  const fretted = frets.filter(f => f !== null && f > 0);
  return fretted.length ? Math.min(...fretted) : 0;
}

/* ---- "fit key" — conform a chord's neighbors to its key --------------
   Groups a chord's original quality into a rough "extension family" (plain
   triad, seventh, ninth, sixth, sus, add9) so a fitted chord keeps roughly
   the same color instead of collapsing to a bare triad. */
const EXTENSION_FAMILY = {
  maj: 'triad', min: 'triad', dim: 'triad', aug: 'triad',
  dom7: 'seventh', min7: 'seventh', maj7: 'seventh', m7b5: 'seventh', dim7: 'seventh',
  dom7s9: 'seventh', dom7b9: 'seventh', dom7s5: 'seventh', dom7b5: 'seventh',
  minS5: 'triad', dimb9: 'seventh',
  dom9: 'ninth', maj9: 'ninth', min9: 'ninth',
  dom11: 'ninth', min11: 'ninth', maj11: 'ninth',
  dom13: 'ninth', min13: 'ninth', maj13: 'ninth',
  six: 'sixth', min6: 'sixth', six9: 'sixth',
  add9: 'ninthAdd', madd9: 'ninthAdd',
  sus2: 'sus2', sus4: 'sus4',
};
/* family + the target diatonic degree's basic mode ('maj'|'min'|'dim') ->
   the chord-book quality key to render the fitted chord as. */
const DEGREE_QUALITY = {
  triad:    { maj: 'maj',  min: 'min',  dim: 'dim'   },
  seventh:  { maj: 'maj7', min: 'min7', dim: 'm7b5'  },
  ninth:    { maj: 'maj9', min: 'min9', dim: 'min9'  },
  sixth:    { maj: 'six',  min: 'min6', dim: 'min6'  },
  ninthAdd: { maj: 'add9', min: 'madd9', dim: 'madd9' },
  sus2:     { maj: 'sus2', min: 'sus2', dim: 'sus2'  },
  sus4:     { maj: 'sus4', min: 'sus4', dim: 'sus4'  },
};
function qualityForDegree(origQualityKey, targetMode){
  const family = EXTENSION_FAMILY[origQualityKey] || 'triad';
  const table = DEGREE_QUALITY[family] || DEGREE_QUALITY.triad;
  return table[targetMode] || table.maj;
}

/* Minimally adjust one chord name to fit diatonically in `key`: keep its
   root if that root is already diatonic there (just correct the quality
   to match that degree), otherwise snap to the nearest diatonic root by
   semitone distance. Either way, the original chord's rough "color"
   (triad / seventh / ninth / sus / etc.) is preserved via qualityForDegree.
   Returns the original name unchanged if it can't be parsed. */
function fitChordToKey(originalName, key){
  const orig = parseChordName(originalName);
  if (!orig) return originalName;
  const diatonicParsed = diatonicChords(key)
    .map(n => ({ name: n, p: parseChordName(n) }))
    .filter(d => d.p);
  if (!diatonicParsed.length) return originalName;

  let target = diatonicParsed.find(d => d.p.rootPc === orig.rootPc);
  if (!target){
    const dist = (a, b) => { const d = Math.abs(a - b) % 12; return Math.min(d, 12 - d); };
    target = diatonicParsed.reduce((best, d) =>
      dist(d.p.rootPc, orig.rootPc) < dist(best.p.rootPc, orig.rootPc) ? d : best);
  }
  const newQualityKey = qualityForDegree(orig.quality, target.p.quality);
  return target.p.rootName + (QUALITY_SUFFIX[newQualityKey] ?? '');
}
function customChipsHTML(t){
  if (!t.chords.length){
    return `<span class="trainer-hint">No chords yet — type a name or enter frets below, then add.</span>`;
  }
  return t.chords.map((c, i) => `
    <span class="chip trainer-chip">${i + 1}. ${escHtml(c.name)}
      <button type="button" class="trainer-chip-x" aria-label="Remove ${escHtml(c.name)}" onclick="trainerRemoveCustomChord(${i})">×</button>
    </span>`).join('');
}
/* ---- lick suggestions between adjacent chords -------------------
   For the gap between chords[i] and chords[i+1]: guess a key from
   just that pair (guessKey), then build a short pentatonic fill
   (phrase.buildLick) that starts on a FROM-chord tone and resolves
   onto a TO-chord tone. Persisted per track (keyed by gap index) so
   it's stable across re-renders; a "different lick" button rerolls
   it with a fresh seed. Auto-heals if the adjacent chords change. */
function generateLickFor(fromName, toName, seed){
  const key = guessKey([fromName, toName]) || 'C';
  return buildLick({ key, fromChordName: fromName, toChordName: toName, seed });
}
function ensureLick(t, gapIdx){
  const from = t.chords[gapIdx], to = t.chords[gapIdx + 1];
  if (!from || !to) return null;
  if (!t.licks) t.licks = {};
  const existing = t.licks[gapIdx];
  if (existing && existing.fromChordName === from.name && existing.toChordName === to.name) return existing;
  const lick = generateLickFor(from.name, to.name);
  if (lick) t.licks[gapIdx] = lick; else delete t.licks[gapIdx];
  saveTracks();
  return lick;
}
function lickHTML(t, gapIdx){
  const lick = ensureLick(t, gapIdx);
  if (!lick) return '';
  const tab = renderTab({ bars: [{ chordName: null, events: lick.events }] });
  return `
    <div class="trainer-lick" id="trainer-lick-${gapIdx}">
      <div class="trainer-lick-label">fill · ${escHtml(keyLabel(lick.key))}</div>
      <pre class="trainer-lick-tab composer-tab">${escHtml(tab)}</pre>
      <div class="trainer-lick-tools">
        <button class="pb-btn" type="button" onclick="trainerPlayLick(${gapIdx})">▶ play</button>
        <button class="pb-btn" type="button" onclick="trainerRerollLick(${gapIdx})">🔀 different lick</button>
      </div>
    </div>`;
}

/* Controls under each "My chords" diagram: a chord-type selector (same
   QUALITY_LABELS list as the guitar tab's cards, one click to try the
   7th/9th/11th/sus/etc. of the same root) plus edit/delete. Only shown
   here, never in the quiz decks — diagHTML() itself stays untouched so
   quiz diagrams remain read-only. */
function customControlsHTML(entry, idx, t){
  if (editingCustomIdx === idx){
    const errorHTML = customEditError ? `<div class="card-edit-error">${escHtml(customEditError)}</div>` : '';
    return `<div class="trainer-custom-edit">
      <input type="text" class="card-edit-name" id="custom-edit-name-${idx}" value="${escHtml(entry.name)}" placeholder="e.g. F#m7"
        onkeydown="if(event.key==='Enter'){event.preventDefault();trainerSaveCustomChordEdit(${idx});} if(event.key==='Escape'){trainerCancelCustomChordEdit();}">
      ${errorHTML}
      <div class="card-edit-actions">
        <button class="pb-btn" type="button" onclick="trainerSaveCustomChordEdit(${idx})">✓ save</button>
        <button class="pb-btn" type="button" onclick="trainerCancelCustomChordEdit()">✕ cancel</button>
      </div>
    </div>`;
  }
  const p = parseChordName(entry.name);
  const currentQuality = p ? p.quality : 'maj';
  const qualityOptions = Object.entries(QUALITY_LABELS)
    .map(([key, label]) => `<option value="${key}"${key === currentQuality ? ' selected' : ''}>${escHtml(label)}</option>`)
    .join('');
  const atStart = idx === 0, atEnd = idx === t.chords.length - 1;
  const hasNeighbor = t.chords.length > 1;
  const startFret = startFretOf(resolvedFretsFor(entry));
  return `<div class="trainer-custom-controls">
    <select class="card-quality-select" aria-label="Chord type" title="Change chord type"
      onchange="trainerChangeCustomChordQuality(${idx},this.value)">${qualityOptions}</select>
    ${positionControlHTML(entry, idx, startFret)}
    <button class="card-action-btn fit-key-btn" type="button" aria-label="Fit neighboring chords to this chord's key"${hasNeighbor
        ? ' title="Nudge the chord before/after this one to fit its key"'
        : ' disabled title="No neighboring chords to fit"'}
      onclick="trainerFitChordToKey(${idx})">🔑 make in key</button>
    <button class="card-action-btn color-btn" type="button" title="Cycle this chord through its degree's colours (color map)" aria-label="Cycle chord colour"
      onclick="trainerColorChord(${idx})">🎨 color</button>
    <div class="card-actions">
      <button class="card-action-btn" type="button" aria-label="Move earlier"${atStart ? ' disabled title="Already first"' : ' title="Move earlier"'}
        onclick="trainerMoveCustomChord(${idx},-1)">◀</button>
      <button class="card-action-btn" type="button" aria-label="Move later"${atEnd ? ' disabled title="Already last"' : ' title="Move later"'}
        onclick="trainerMoveCustomChord(${idx},1)">▶</button>
      <button class="card-action-btn" type="button" title="Edit chord" aria-label="Edit chord"
        onclick="trainerStartCustomChordEdit(${idx})">✎ edit</button>
      <button class="card-action-btn danger" type="button" title="Delete chord" aria-label="Delete chord"
        onclick="trainerRemoveCustomChord(${idx})">🗑 delete</button>
    </div>
  </div>`;
}

function customDiagramsInnerHTML(t){
  if (!t.chords.length){
    return `<div class="trainer-track-empty">Drop a shape from the chord table here, or add one below.</div>`;
  }
  const parts = [];
  t.chords.forEach((c, i) => {
    // Wrap the diagram + its controls together so they stack as one flex
    // item (the diagrams row itself is a flex row of side-by-side chords).
    // The diagram itself is the drag handle (the controls under it hold
    // inputs, which must stay selectable), and the block carries its
    // index so drops can land before/after it.
    parts.push(`<div class="trainer-custom-chord-block" data-track-idx="${i}">
      <div class="trainer-track-handle" draggable="true" title="Drag to reorder, or drag down to the chord table to keep this shape">${diagHTML(customDiagSpec(c, i), i)}</div>
      ${customControlsHTML(c, i, t)}</div>`);
    if (i < t.chords.length - 1) parts.push(lickHTML(t, i));
  });
  return parts.join('');
}
function customDiagramsHTML(t){
  return `<div class="trainer-diagrams trainer-track-drop${t.chords.length ? '' : ' empty'}" id="trainer-custom-diagrams"
    aria-label="Track chords — drop zone">${customDiagramsInnerHTML(t)}</div>`;
}
function redrawCustomDiagrams(){
  const c = $('trainer-custom-diagrams'), t = getActiveTrack();
  if (c && t){
    c.innerHTML = customDiagramsInnerHTML(t);
    c.classList.toggle('empty', !t.chords.length);
  }
  redrawPalette();
}

/* ---- drag + drop on the track ------------------------------------------
   Two sources land here: a chord-table card (insert a copy of that exact
   voicing) or another track chord (reorder). Drop position is decided by
   the pointer's x against the hovered block's midpoint; a drop on the
   row's empty space appends. Delegated on #trainer-question once, so
   re-renders never lose it; the chord table wires its own side the same
   way (chordpalette.initPaletteDrag). */
let trackDropHint = null;           // { idx, before } while hovering
function clearTrackDropHint(){
  document.querySelectorAll('.trainer-custom-chord-block.drop-before, .trainer-custom-chord-block.drop-after, .trainer-lick.drop-target')
    .forEach(b => b.classList.remove('drop-before', 'drop-after', 'drop-target'));
  const c = $('trainer-custom-diagrams');
  if (c) c.classList.remove('drop-target');
  trackDropHint = null;
}
function trackDropIndexFrom(e, zone){
  const block = e.target.closest && e.target.closest('.trainer-custom-chord-block');
  if (!block){
    // Hovering the lick between chords N and N+1 means "between them".
    const lick = e.target.closest && e.target.closest('.trainer-lick');
    const gap = lick ? parseInt(String(lick.id).replace('trainer-lick-', ''), 10) : NaN;
    if (!Number.isNaN(gap)) return { idx: gap + 1, before: true, block: null, lick };
    return { idx: null, before: false, block: null };
  }
  const r = block.getBoundingClientRect();
  return { idx: parseInt(block.dataset.trackIdx, 10), before: e.clientX < r.left + r.width / 2, block };
}
function insertChordAt(entry, idx, before){
  const t = getActiveTrack();
  if (!t) return;
  let at = (idx === null || Number.isNaN(idx)) ? t.chords.length : (before ? idx : idx + 1);
  at = Math.max(0, Math.min(t.chords.length, at));
  t.chords.splice(at, 0, entry);
  if (editingCustomIdx !== null){ editingCustomIdx = null; customEditError = null; }
  saveTracks();
  renderCustomView();
}
function moveChordTo(from, idx, before){
  const t = getActiveTrack();
  if (!t || !t.chords[from]) return;
  let at = (idx === null || Number.isNaN(idx)) ? t.chords.length : (before ? idx : idx + 1);
  if (at === from || at === from + 1) return;          // dropped back where it was
  const [moved] = t.chords.splice(from, 1);
  if (at > from) at--;
  t.chords.splice(at, 0, moved);
  if (editingCustomIdx !== null){ editingCustomIdx = null; customEditError = null; }
  saveTracks();
  renderCustomView();
}
function initTrackDrag(root){
  if (!root || root.__trackDragWired) return;
  root.__trackDragWired = true;

  root.addEventListener('dragstart', e => {
    const handle = e.target.closest && e.target.closest('.trainer-track-handle');
    if (!handle) return;
    const block = handle.closest('.trainer-custom-chord-block');
    const t = getActiveTrack();
    const idx = block ? parseInt(block.dataset.trackIdx, 10) : NaN;
    const entry = t && t.chords[idx];
    if (!entry) return;
    const payload = { source: 'track', idx, name: entry.name, frets: resolvedFretsFor(entry) };
    setDragPayload(payload);
    try {
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
      e.dataTransfer.setData('text/plain', entry.name);
      e.dataTransfer.effectAllowed = 'copyMove';
    } catch { /* ignore */ }
    block.classList.add('dragging');
  });
  root.addEventListener('dragend', () => {
    document.querySelectorAll('.trainer-custom-chord-block.dragging').forEach(b => b.classList.remove('dragging'));
    clearTrackDropHint();
    clearDragPayload();
  });
  root.addEventListener('dragover', e => {
    const zone = e.target.closest && e.target.closest('#trainer-custom-diagrams');
    const p = getDragPayload();
    if (!zone || !p) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = p.source === 'track' ? 'move' : 'copy';
    clearTrackDropHint();
    const { idx, before, block, lick } = trackDropIndexFrom(e, zone);
    if (block && !(p.source === 'track' && idx === p.idx)){
      block.classList.add(before ? 'drop-before' : 'drop-after');
      trackDropHint = { idx, before };
    } else if (lick){
      lick.classList.add('drop-target');
      trackDropHint = { idx, before };
    } else if (!block){
      zone.classList.add('drop-target');
      trackDropHint = { idx: null, before: false };
    }
  });
  root.addEventListener('dragleave', e => {
    const zone = e.target.closest && e.target.closest('#trainer-custom-diagrams');
    if (zone && !zone.contains(e.relatedTarget)) clearTrackDropHint();
  });
  root.addEventListener('drop', e => {
    const zone = e.target.closest && e.target.closest('#trainer-custom-diagrams');
    const p = getDragPayload();
    if (!zone || !p) return;
    e.preventDefault();
    const hint = trackDropHint || trackDropIndexFrom(e, zone);
    clearTrackDropHint();
    if (p.source === 'palette' || p.source === 'colormap'){
      insertChordAt({ name: p.name, frets: (p.pinned && p.frets) ? [...p.frets] : null }, hint.idx, hint.before);
    } else if (p.source === 'track'){
      moveChordTo(p.idx, hint.idx, hint.before);
    }
    clearDragPayload();
  });
}

/* "+ add to table": the fret squares double as the chord table's own
   fret entry, so a fingering you typed can go straight to the table
   instead of the track. */
export function trainerAddPaletteFromFrets(){
  const { frets, midis } = readCustomFretSquares();
  const errEl = $('trainer-custom-err');
  if (!midis.length){
    if (errEl) errEl.textContent = 'Enter at least one fret (0 = open, x/blank = muted) to add a shape.';
    return;
  }
  const info = detectChordAndKey(midis);
  if (!info || !info.symbol){
    if (errEl) errEl.textContent = "Couldn't identify a chord from those frets.";
    return;
  }
  if (errEl) errEl.textContent = paletteAdd(info.symbol, frets) ? '' : `"${info.symbol}" with that fingering is already on the table.`;
  clearCustomFretSquares();
  redrawPalette();
}

export function trainerPlayLick(gapIdx){
  const t = getActiveTrack();
  const lick = t && t.licks && t.licks[gapIdx];
  if (!lick || !lick.events.length) return;
  const spb = 60 / getBPM();
  const ctx = getCtx();
  let time = ctx.currentTime + 0.05;
  lick.events.forEach(ev => {
    playLeadEvent(ev, time, spb);
    time += (ev.beats || 0.5) * spb;
  });
}

export function trainerRerollLick(gapIdx){
  const t = getActiveTrack();
  if (!t) return;
  const from = t.chords[gapIdx], to = t.chords[gapIdx + 1];
  if (!from || !to) return;
  const seed = ((Date.now() & 0xffffffff) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  const lick = generateLickFor(from.name, to.name, seed);
  if (!t.licks) t.licks = {};
  if (lick) t.licks[gapIdx] = lick;
  saveTracks();
  redrawCustomDiagrams();
}

/* Once a track has 2+ chords, guess a key from the last two and
   offer the guessed key's remaining diatonic chords as "add next"
   chips (labeled with roman numerals). */
function suggestionHTML(t){
  if (t.chords.length < 2) return '';
  const key = guessKey(t.chords.slice(-2).map(c => c.name));
  if (!key) return '';
  const romans = romansFor(key), names = diatonicChords(key);
  const used = new Set(t.chords.map(c => c.name.toLowerCase()));
  const opts = names.map((n, i) => ({ n, roman: romans[i] })).filter(o => !used.has(o.n.toLowerCase()));
  if (!opts.length) return '';
  return `
    <div class="trainer-suggest">
      <span class="trainer-hint">Guessed key (from the last two chords): <strong>${escHtml(keyLabel(key))}</strong> — try next:</span>
      <div class="trainer-suggest-chips">${opts.map(o =>
        `<button type="button" class="chip trainer-suggest-chip" onclick="trainerAddSuggested('${o.n}')">${escHtml(o.roman)} · ${escHtml(o.n)}</button>`
      ).join('')}</div>
    </div>`;
}

function trackTabsHTML(){
  return tracks.map(t => `
    <button type="button" class="fret-chord trainer-track-tab${t.id === activeTrackId ? ' selected' : ''}"
      onclick="trainerSwitchTrack('${t.id}')">${escHtml(t.name)}</button>`).join('') +
    `<button type="button" class="pb-btn trainer-track-add" onclick="trainerNewTrack()" title="Save a new track">+ track</button>`;
}
function customFretCellsHTML(){
  return ['E', 'A', 'D', 'G', 'B', 'e'].map((s, i) =>
    `<label class="fret-cell"><span>${s}</span><input id="trainer-custom-fret-${i}" type="text" inputmode="numeric" maxlength="2" placeholder="x" aria-label="${s} string fret"
      onkeydown="if(event.key==='Enter'){event.preventDefault();trainerAddCustomChordFromFrets();}"></label>`).join('');
}

/* Seeded tracks carry a meta card: link, key, BPM, color chart, and
   where the progression came from (chart / analysis / closest-fit). */
const CONF_LABEL = { high: 'high confidence', medium: 'ear-check', low: 'low confidence' };
const PROG_LABEL = { chart: 'from a published chart', analysis: 'from automated analysis', 'closest-fit': 'closest diatonic fit (not transcribed)' };
function trackMetaHTML(t){
  const m = t && t.meta;
  if (!m) return '';
  const title = [m.title, m.artist].filter(Boolean).join(' — ');
  const link = m.link ? `<a class="trainer-meta-link" href="${escHtml(m.link)}" target="_blank" rel="noopener noreferrer">▶ ${escHtml(title || 'listen')}</a>`
    : (title ? `<span>${escHtml(title)}</span>` : '');
  let keyBit = '';
  if (m.key){
    let kl = m.key; try { kl = keyLabel(m.key); } catch { /* unknown key label */ }
    keyBit = `<span>key <strong>${escHtml(kl)}</strong>${m.keyNote ? ` <em>(${escHtml(m.keyNote)})</em>` : ''}</span>
      <button class="pb-btn" type="button" onclick="trainerUseTrackKey()" title="Set the app key (color map, chord table) to this track's key">use key</button>`;
  }
  const bpm = m.bpm ? `<span><strong>${m.bpm}</strong> BPM${m.bpmNote ? ` <em>(${escHtml(m.bpmNote)})</em>` : ''}</span>` : '';
  const prog = m.progression ? `<span class="trainer-meta-prog conf-${escHtml(m.confidence || 'medium')}" title="${escHtml(m.progressionNote || '')}">prog: ${escHtml(PROG_LABEL[m.progression] || m.progression)}${m.confidence ? ` · ${escHtml(CONF_LABEL[m.confidence] || m.confidence)}` : ''}</span>` : '';
  const chart = Array.isArray(m.colorChart) && m.colorChart.length
    ? `<div class="trainer-meta-chart" aria-label="Color chart — one rung per scale degree; tap to add">${m.colorChart.map((n, i) =>
        `<button type="button" class="chip trainer-suggest-chip" onclick="trainerAddSuggested(${escHtml(JSON.stringify(n))})" title="Add ${escHtml(n)} to the track">${i + 1} · ${escHtml(n)}</button>`).join('')}</div>` : '';
  return `<div class="trainer-track-meta">
    <div class="trainer-meta-row">${[link, keyBit, bpm, prog].filter(Boolean).join('<span class="trainer-meta-sep">·</span>')}</div>
    ${m.progressionNote ? `<div class="trainer-hint">${escHtml(m.progressionNote)}</div>` : ''}
    ${chart}
  </div>`;
}

function renderCustomView(){
  stopProgAudio();
  advanceToken++;                 // cancel any pending quiz auto-advance
  const q = $('trainer-question'), a = $('trainer-answers'), f = $('trainer-feedback');
  const t = getActiveTrack();
  if (!q || !t) return;
  const fitMsg = customFitMessage;      // one-shot: read then clear so it only shows once
  customFitMessage = null;
  q.innerHTML = `
    <div class="trainer-prompt">Build a track — a saved, ordered sequence of chords.
      <span class="trainer-hint">Add a chord by typing its name, or by entering its frets (name is auto-detected). Once a track has two chords, we'll guess the key and suggest what fits next.</span>
    </div>
    <div class="trainer-track-tabs" role="tablist" aria-label="Saved tracks">${trackTabsHTML()}</div>
    <div class="trainer-track-tools">
      <span class="trainer-track-name">${escHtml(t.name)}</span>
      <button class="pb-btn" type="button" onclick="trainerRenameTrack()">rename</button>
      <button class="pb-btn" type="button" onclick="trainerDeleteTrack()">delete track</button>
      ${t.chords.length ? `<button class="pb-btn recolor-btn" type="button" onclick="trainerRecolorTrack()" title="Move every in-key chord up the color map: triads → sevenths → extended → spice → triads">🎨 recolor → ${LEVEL_NAMES[((t.colorLevel || 0) + 1) % LEVEL_NAMES.length]}</button>` : ''}
      ${t.chords.length ? `<button class="btn btn-ghost" type="button" onclick="trainerClearCustomChords()">clear chords</button>` : ''}
      <button class="pb-btn" type="button" onclick="seedImportFile()" title="Load a seed pack (.pack.json) — adds or refreshes pre-filled tracks; safe to re-run">⤓ seed pack</button>
    </div>
    ${trackMetaHTML(t)}
    ${fitMsg ? `<div class="trainer-custom-status">${escHtml(fitMsg)}</div>` : ''}
    <div class="trainer-custom-input" role="group" aria-label="Add a chord by name">
      <input id="trainer-custom-name" class="trainer-custom-name" type="text" placeholder="e.g. Am7" autocomplete="off" maxlength="12"
        onkeydown="if(event.key==='Enter'){event.preventDefault();trainerAddCustomChord();}">
      <button class="btn btn-primary" type="button" onclick="trainerAddCustomChord()">+ add by name</button>
    </div>
    <div class="fret-inputs trainer-custom-fret-inputs" role="group" aria-label="Or add a chord by frets, low E to high e">
      ${customFretCellsHTML()}
      <button class="btn btn-primary" type="button" onclick="trainerAddCustomChordFromFrets()">+ add from frets</button>
      <button class="btn btn-ghost" type="button" onclick="trainerAddPaletteFromFrets()" title="Keep this exact fingering on the chord table below">+ add to table</button>
    </div>
    <div class="trainer-custom-err" id="trainer-custom-err"></div>
    <div class="trainer-chips" id="trainer-chips">${customChipsHTML(t)}</div>
    ${customDiagramsHTML(t)}
    ${suggestionHTML(t)}
    ${paletteHTML(getAppKey() || $('rail-key')?.value || 'C')}`;
  initTrackDrag(q);
  initPaletteDrag(q);
  if (a) a.innerHTML = '';
  if (f){ f.className = 'trainer-feedback'; f.innerHTML = ''; }
  updateStats();
}

export function trainerAddCustomChord(){
  const el = $('trainer-custom-name');
  if (!el) return;
  const name = normalizeChordInput(el.value);
  const errEl = $('trainer-custom-err');
  if (!name) return;
  if (!parseChordName(name)){
    if (errEl) errEl.textContent = `Can't read "${name}" — start with a note letter A–G.`;
    return;
  }
  if (errEl) errEl.textContent = '';
  addChordToActiveTrack({ name, frets: null });
  renderCustomView();
  const again = $('trainer-custom-name');
  if (again) again.focus();
}

export function trainerAddCustomChordFromFrets(){
  const { frets, midis } = readCustomFretSquares();
  const errEl = $('trainer-custom-err');
  if (!midis.length){
    if (errEl) errEl.textContent = 'Enter at least one fret (0 = open, x/blank = muted) to add a chord.';
    return;
  }
  const info = detectChordAndKey(midis);
  if (!info || !info.symbol){
    if (errEl) errEl.textContent = "Couldn't identify a chord from those frets.";
    return;
  }
  if (errEl) errEl.textContent = '';
  addChordToActiveTrack({ name: info.symbol, frets });
  clearCustomFretSquares();
  renderCustomView();
}

/* ---- color map: recolor a whole track / cycle one chord -------------------
   Key: the app key when every chord's root is diatonic there (so what you
   see in the color map is what you get), else a key guessed from the track. */
function trackColorKey(t){
  const app = getAppKey() || $('rail-key')?.value || 'C';
  if (t.chords.every(c => degreeOf(c.name, app) >= 0)) return app;
  return guessKey(t.chords.map(c => c.name)) || app;
}
function setColored(entry, name){
  if (!name || name === entry.name) return false;
  entry.name = name;
  entry.frets = pinnedFretsFor(name);     // root-in-bass shape when the default isn't
  return true;
}
export function trainerRecolorTrack(){
  const t = getActiveTrack();
  if (!t || !t.chords.length) return;
  const key = trackColorKey(t);
  const level = ((t.colorLevel || 0) + 1) % LEVEL_NAMES.length;
  let changed = 0, skipped = 0;
  t.chords.forEach(c => {
    const n = recolorName(c.name, key, level);
    if (n === null){ skipped++; return; }
    if (setColored(c, n)) changed++;
  });
  t.colorLevel = level;
  if (editingCustomIdx !== null){ editingCustomIdx = null; customEditError = null; }
  customFitMessage = `Recolored to ${LEVEL_NAMES[level]} in ${keyLabel(key)}` +
    (changed ? ` — ${changed} chord${changed === 1 ? '' : 's'} changed` : ' — nothing to change') +
    (skipped ? `; ${skipped} outside the key left alone.` : '.');
  saveTracks();
  renderCustomView();
}
export function trainerColorChord(idx){
  const t = getActiveTrack();
  const entry = t && t.chords[idx];
  if (!entry) return;
  const key = trackColorKey(t);
  const n = nextColorName(entry.name, key);
  if (n === null){
    customFitMessage = `"${entry.name}" isn't on a degree of ${keyLabel(key)} — try 🔑 make in key first.`;
  } else {
    setColored(entry, n);
    customFitMessage = null;
  }
  if (editingCustomIdx !== null){ editingCustomIdx = null; customEditError = null; }
  saveTracks();
  renderCustomView();
}

export function trainerAddSuggested(name){
  addChordToActiveTrack({ name, frets: null });
  renderCustomView();
}

export function trainerRemoveCustomChord(i){
  const t = getActiveTrack();
  if (!t) return;
  t.chords.splice(i, 1);
  if (editingCustomIdx !== null){       // indices just shifted — bail out of any open edit
    editingCustomIdx = null;
    customEditError = null;
  }
  saveTracks();
  renderCustomView();
  const again = $('trainer-custom-name');
  if (again) again.focus();
}

/* Move a chord earlier (dir -1) or later (dir 1) in the track — a
   progression's chord order matters as much as which chords are in it. */
export function trainerMoveCustomChord(idx, dir){
  const t = getActiveTrack();
  if (!t) return;
  const dest = idx + dir;
  if (dest < 0 || dest >= t.chords.length) return;
  [t.chords[idx], t.chords[dest]] = [t.chords[dest], t.chords[idx]];
  if (editingCustomIdx !== null){       // positions just swapped — bail out of any open edit
    editingCustomIdx = null;
    customEditError = null;
  }
  saveTracks();
  renderCustomView();
}

/* "Make in key/scale": infer a key from this chord plus its immediate
   neighbors (the chord itself is weighted first, so it need not become
   the tonic — a strong fit from the neighbors on some other key can
   outweigh that), then minimally retune just the neighbor(s) to be
   diatonic in that key. The selected chord itself is never touched. */
export function trainerFitChordToKey(idx){
  const t = getActiveTrack();
  if (!t) return;
  const entry = t.chords[idx];
  if (!entry) return;
  const prev = t.chords[idx - 1] || null;
  const next = t.chords[idx + 1] || null;
  if (!prev && !next) return;              // nothing to fit around

  const ctxNames = [entry.name, prev && prev.name, next && next.name].filter(Boolean);
  const key = guessKey(ctxNames);
  if (!key){
    customFitMessage = `Couldn't infer a key around "${entry.name}".`;
    renderCustomView();
    return;
  }

  let changed = 0;
  [prev, next].forEach(n => {
    if (!n) return;
    const fitted = fitChordToKey(n.name, key);
    if (fitted && fitted !== n.name){
      n.name = fitted;
      n.frets = null;                      // re-resolve a fresh voicing for the new name
      changed++;
    }
  });

  if (editingCustomIdx !== null){ editingCustomIdx = null; customEditError = null; }
  customFitMessage = changed
    ? `Fit the chords around "${entry.name}" to the key of ${keyLabel(key)}.`
    : `The chords around "${entry.name}" already fit the key of ${keyLabel(key)}.`;
  saveTracks();
  renderCustomView();
}

/* Re-voice a chord at a different neck position — same name, same
   quality, just moved up or down the fretboard. Pins the resulting exact
   shape on the entry (same convention as the "add from frets" input). */
/* ---- dynamic fret position ------------------------------------------------
   Every distinct playable shape the chord book knows for a chord (open,
   E/A barres, compact 4-string sets, root-in-bass shapes), sorted up the
   neck. The control steps through them (◀ ▶), scrubs with a slider that
   previews live (diagram + readout, no re-render, so the drag isn't
   interrupted) and commits + plays on release. */
const POS_MAX = 15;
function positionOptions(name){
  const seen = new Set(), all = [];
  const push = v => {
    if (!v || !v.frets) return;
    const k = JSON.stringify(v.frets);
    if (seen.has(k)) return;
    seen.add(k); all.push(v);
  };
  voicingCandidates(name).forEach(push);
  [0, 2, 4, 5, 7, 9, 12].forEach(n => push(getVoicing(name, { near: n, rootBass: true })));
  const p = parseChordName(name);
  const ok = all.filter(v => v.span <= MAX_PLAYABLE_SPAN && (!p || v.midis.some(m => m % 12 === p.rootPc)));
  const list = ok.length ? ok : all;
  return list.sort((a, b) => startFretOf(a.frets) - startFretOf(b.frets) || a.center - b.center);
}
function sameFrets(a, b){ return !!a && !!b && JSON.stringify(a) === JSON.stringify(b); }
function positionIndex(opts, frets){ return opts.findIndex(o => sameFrets(o.frets, frets)); }
/* Option whose position (lowest fretted note) is closest to `fret`. */
function optionNearFret(opts, fret){
  return opts.reduce((best, o) => {
    const d = Math.abs(startFretOf(o.frets) - fret), bd = Math.abs(startFretOf(best.frets) - fret);
    return d < bd || (d === bd && o.span < best.span) ? o : best;
  }, opts[0]);
}
const STYLE_LABEL = { open: 'open', gospel: 'gospel', barre: 'barre', compact: '4-string', generic: 'full' };
function positionReadout(entry, frets){
  const opts = positionOptions(entry.name);
  const i = positionIndex(opts, frets);
  const f = startFretOf(frets);
  const where = f === 0 ? 'open' : `fret ${f}`;
  const which = i >= 0 ? `${i + 1}/${opts.length} ${STYLE_LABEL[opts[i].style] || 'full'}` : `your shape`;
  return `${where} · ${which}`;
}
function positionControlHTML(entry, idx, startFret){
  const frets = resolvedFretsFor(entry);
  return `<div class="trainer-pos${entry.frets ? '' : ' is-auto'}" role="group" aria-label="Fret position">
    <div class="trainer-pos-meta">
      <span class="trainer-pos-label">position</span>
      <button class="card-action-btn trainer-pos-auto" type="button" aria-pressed="${!entry.frets}"
        title="${entry.frets ? 'Go back to the chord book’s best-guess shape' : 'Using the chord book’s best-guess shape'}" aria-label="Auto position"
        onclick="trainerResetCustomChordPosition(${idx})"${entry.frets ? '' : ' disabled'}>auto</button>
    </div>
    <div class="trainer-pos-row">
      <button class="card-action-btn trainer-pos-step" type="button" aria-label="Previous shape (lower on the neck)" title="Previous shape, lower on the neck"
        onclick="trainerStepCustomChordPosition(${idx},-1)">‹</button>
      <input type="range" class="trainer-pos-slider" min="0" max="${POS_MAX}" step="1" value="${Math.min(POS_MAX, startFret)}"
        aria-label="Fret position" title="Slide to move this chord up or down the neck"
        oninput="trainerPreviewCustomChordPosition(${idx},this.value)"
        onchange="trainerSetCustomChordPosition(${idx},this.value)">
      <button class="card-action-btn trainer-pos-step" type="button" aria-label="Next shape (higher on the neck)" title="Next shape, higher on the neck"
        onclick="trainerStepCustomChordPosition(${idx},1)">›</button>
    </div>
    <div class="trainer-pos-readout" id="trainer-pos-readout-${idx}">${escHtml(positionReadout(entry, frets))}</div>
  </div>`;
}
function playFrets(frets){
  const f = frets ? fretsToFreqs(frets) : [];
  if (f.length) playChordNow(f);
}

/* Live preview while the slider moves: swap just this chord's diagram. */
export function trainerPreviewCustomChordPosition(idx, rawValue){
  const t = getActiveTrack();
  const entry = t && t.chords[idx];
  if (!entry) return;
  const opts = positionOptions(entry.name);
  if (!opts.length) return;
  const o = optionNearFret(opts, parseInt(rawValue, 10) || 0);
  const diag = $('trainer-diag-' + idx);
  if (diag) diag.outerHTML = diagHTML({ chordFrets: o.frets, label: `${idx + 1}. ${entry.name}` }, idx);
  const ro = $('trainer-pos-readout-' + idx);
  if (ro) ro.textContent = positionReadout({ ...entry, frets: o.frets }, o.frets);
}

export function trainerSetCustomChordPosition(idx, rawValue){
  const t = getActiveTrack();
  const entry = t && t.chords[idx];
  if (!entry) return;
  const opts = positionOptions(entry.name);
  if (!opts.length) return;
  const o = optionNearFret(opts, Math.max(0, Math.min(20, parseInt(rawValue, 10) || 0)));
  entry.frets = [...o.frets];
  saveTracks();
  renderCustomView();
  playFrets(entry.frets);
}

/* ◀ ▶: previous / next distinct shape up the neck (wraps around). */
export function trainerStepCustomChordPosition(idx, dir){
  const t = getActiveTrack();
  const entry = t && t.chords[idx];
  if (!entry) return;
  const opts = positionOptions(entry.name);
  if (!opts.length) return;
  const cur = resolvedFretsFor(entry);
  let i = positionIndex(opts, cur);
  if (i < 0){
    // not one of the book's shapes: step from the nearest one by position
    const f = startFretOf(cur);
    i = dir > 0 ? opts.findIndex(o => startFretOf(o.frets) > f) - 1 : opts.findIndex(o => startFretOf(o.frets) >= f);
    if (i < -1) i = dir > 0 ? opts.length - 1 : 0;
  }
  const next = opts[((i + dir) % opts.length + opts.length) % opts.length];
  entry.frets = [...next.frets];
  saveTracks();
  renderCustomView();
  playFrets(entry.frets);
}


/* Drop the pinned voicing and go back to the chord book's own best guess. */
export function trainerResetCustomChordPosition(idx){
  const t = getActiveTrack();
  const entry = t && t.chords[idx];
  if (!entry) return;
  entry.frets = null;
  saveTracks();
  renderCustomView();
}

/* ---- edit / retype an existing custom chord ------------------------------ */
export function trainerStartCustomChordEdit(idx){
  editingCustomIdx = idx;
  customEditError = null;
  renderCustomView();
  const el = $('custom-edit-name-' + idx);
  if (el){ el.focus(); el.select(); }
}

export function trainerCancelCustomChordEdit(){
  editingCustomIdx = null;
  customEditError = null;
  renderCustomView();
}

export function trainerSaveCustomChordEdit(idx){
  const t = getActiveTrack();
  const entry = t && t.chords[idx];
  if (!entry) return;
  const el = $('custom-edit-name-' + idx);
  const newName = normalizeChordInput(el ? el.value : entry.name);
  if (!newName || !parseChordName(newName)){
    customEditError = `Can't read "${newName || ''}" — start with a note letter A–G.`;
    renderCustomView();
    return;
  }
  entry.name = newName;
  entry.frets = null;              // re-resolve a fresh, real voicing for the new name
  saveTracks();
  editingCustomIdx = null;
  customEditError = null;
  renderCustomView();
}

/* Swap an existing custom chord's quality in place (e.g. Am7 -> Am9 ->
   Asus4), same one-click idea as the guitar tab's card selector. */
export function trainerChangeCustomChordQuality(idx, qualityKey){
  const t = getActiveTrack();
  const entry = t && t.chords[idx];
  if (!entry) return;
  const newName = withQuality(entry.name, qualityKey);
  if (!newName) return;
  entry.name = newName;
  entry.frets = null;
  saveTracks();
  renderCustomView();
}

export function trainerClearCustomChords(){
  const t = getActiveTrack();
  if (!t || !t.chords.length) return;
  if (!confirm(`Clear all chords from "${t.name}"?`)) return;
  t.chords = [];
  saveTracks();
  renderCustomView();
}

export function trainerUseTrackKey(){
  const t = getActiveTrack();
  if (t && t.meta && t.meta.key) syncKey(t.meta.key, null);
  renderCustomView();
}

/* Apply a seed pack (seeds.js) to the live track list. Idempotent —
   see mergeSeedPack. The first added/updated track becomes active. */
export function trainerApplySeedPack(pack, opts = {}){
  const r = mergeSeedPack(tracks, pack, opts);
  tracks = r.tracks;
  if (r.firstId) activeTrackId = r.firstId;
  saveTracks();
  if (mode === 'custom') renderCustomView(); else updateStats();
  return r;
}

export function trainerSwitchTrack(id){
  if (!tracks.some(x => x.id === id)) return;
  activeTrackId = id;
  saveTracks();
  renderCustomView();
}

export function trainerNewTrack(){
  const name = (prompt('Name this track:', `Track ${tracks.length + 1}`) || '').trim();
  if (!name) return;
  const t = makeTrack(name);
  tracks.push(t);
  activeTrackId = t.id;
  saveTracks();
  renderCustomView();
}

export function trainerRenameTrack(){
  const t = getActiveTrack();
  if (!t) return;
  const name = (prompt('Rename track:', t.name) || '').trim();
  if (!name) return;
  t.name = name;
  saveTracks();
  renderCustomView();
}

export function trainerDeleteTrack(){
  if (tracks.length <= 1){
    alert("This is your only track — clear its chords instead of deleting it.");
    return;
  }
  const t = getActiveTrack();
  if (!t || !confirm(`Delete track "${t.name}"? This can't be undone.`)) return;
  tracks = tracks.filter(x => x.id !== t.id);
  activeTrackId = tracks[0].id;
  saveTracks();
  renderCustomView();
}

/* ---- small helpers ---------------------------------------- */
function shuffle(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function fretsToFreqs(frets){
  const out = [];
  frets.forEach((f, s) => { if (f !== null && f !== undefined) out.push(midiToHz(STRING_OPEN_MIDI[s] + f)); });
  return out;
}
function voicingFreqs(name){
  const v = getVoicing(name);
  return (v && v.midis && v.midis.length) ? v.midis.map(midiToHz) : null;
}
function chordTonePcs(name){
  const p = parseChordName(name);
  return p ? [...new Set(p.intervals.map(iv => (p.rootPc + iv) % 12))] : [];
}

/* ---- layered diagram rendering ------------------------------
   Each question carries `diagrams`: an array of specs
     { chordFrets?, chordPcs?, scaleKey?, scaleType?, window?,
       label?, revealLabel?, chordHiddenUntilReveal? }
   redrawDiagrams() paints them into #trainer-diagrams honouring
   the two layer toggles, so toggling repaints live. */
function diagHTML(spec, idx){
  const chordVisible = layers.chord &&
    (spec.chordFrets || spec.chordPcs) &&
    (!spec.chordHiddenUntilReveal || answered);
  const win = spec.window || windowFor(spec.chordFrets, null);
  const scaleVisible = !!(layers.scale && spec.scaleKey);
  const scaleNotes = scaleVisible
    ? scaleNotesWindow(spec.scaleKey, spec.scaleType || 'full', win.lo, win.hi)
    : null;
  const label = (answered && spec.revealLabel) ? spec.revealLabel : (spec.label || '');
  const empty = !chordVisible && !scaleVisible;
  const emptyMsg = spec.scaleKey ? ' (both layers hidden)' : ' (chord layer hidden)';
  return `<div class="trainer-diagram${empty ? ' layers-off' : ''}" id="trainer-diag-${idx}">
      ${layeredFretSVG({
        chordFrets: spec.chordFrets || null,
        chordPcs: spec.chordPcs || null,
        scaleNotes,
        window: win,
        showChord: !!chordVisible,
        showScale: scaleVisible,
      })}
      <div class="trainer-diagram-label">${escHtml(label)}${empty ? emptyMsg : ''}</div>
    </div>`;
}
function redrawDiagrams(){
  const c = $('trainer-diagrams');
  if (!c || !current || !current.diagrams) return;
  c.innerHTML = current.diagrams.map(diagHTML).join('');
}

/* Repaint whichever fretboard view is on screen. Used by the app-wide
   notation toggles (labels.js) so the diagrams re-label without losing
   the current question, track or explore state. */
export function trainerRedraw(){
  if (mode === 'custom') redrawCustomDiagrams();
  else if (exploring()) redrawExploreDiagrams();
  else redrawDiagrams();
}

export function trainerToggleLayer(which, on){
  if (which !== 'chord' && which !== 'scale') return;
  layers[which] = !!on;
  saveLayers();
  syncLayerCheckboxes();
  if (mode === 'custom') redrawCustomDiagrams();
  else if (exploring()) redrawExploreDiagrams();
  else redrawDiagrams();
}

/* Flip the current mode between quiz and explore (per-mode, persisted). */
export function trainerToggleView(){
  if (mode === 'mixed') return;
  viewPref[mode] = exploring() ? 'quiz' : 'explore';
  saveViewPref();
  updateViewToggle();
  if (exploring()) renderExploreView();
  else trainerNext();
}

function renderExploreView(){
  stopProgAudio();
  answered = false;
  advanceToken++;               // cancel any pending quiz auto-advance
  renderExplore(mode);
  updateStats();
}

/* ---- question builders ------------------------------------ */
function buildFromId(id){
  const p = id.split('|');
  if (p[0] === 's2n')  return buildS2N(id, p[1], +p[2]);
  if (p[0] === 'n2s')  return buildN2S(id, p[1], +p[2]);
  if (p[0] === 'mv')   return buildMV(id, p[1], p[2], +p[3]);
  if (p[0] === 'prog') return buildProg(id, p[1], +p[2]);
  if (p[0] === 'sc')   return buildSC(id, p[1], +p[2], p[3]);
  if (p[0] === 'cm')   return buildCM(id, p[1], p[2], p[3], p[4]);
  return null;
}

const DIAGRAMS_DIV = `<div class="trainer-diagrams" id="trainer-diagrams"></div>`;

/* Shape → Number: show a voicing (inside its scale box), name the degree. */
function buildS2N(id, key, deg){
  const chord = diatonicChords(key)[deg];
  const v = getVoicing(chord);
  const romans = romansFor(key);
  return {
    id, kind: 's2n', correctIdx: deg,
    playFreqs: v ? v.midis.map(midiToHz) : null,
    diagrams: [{ chordFrets: v ? v.frets : null, scaleKey: key, scaleType: 'full', revealLabel: chord }],
    questionHTML: `
      <div class="trainer-prompt">Key of <strong>${escHtml(keyLabel(key))}</strong> — which degree is this chord shape?
        <span class="trainer-hint">Scale layer shows the key's notes around it.</span>
      </div>
      ${DIAGRAMS_DIV}
      <button class="pb-btn" type="button" onclick="trainerPlay()">▶ hear it</button>`,
    answersHTML: romans.map((r, i) =>
      `<button class="fret-chord trainer-opt" id="trainer-opt-${i}" onclick="trainerAnswer(${i})">${escHtml(r)}</button>`).join(''),
    revealHTML: `That's <strong>${escHtml(chord)}</strong> — the ${escHtml(romans[deg])} of ${escHtml(keyLabel(key))}.`,
  };
}

/* Number → Shape: prompt a degree, user enters frets, we verify pitches.
   The scale layer doubles as a hint (in-key notes); the chord layer
   holds the answer, so it stays hidden until the reveal. */
function buildN2S(id, key, deg){
  const chord = diatonicChords(key)[deg];
  const roman = romansFor(key)[deg];
  const v = getVoicing(chord);
  const cells = ['E','A','D','G','B','e'].map((s, i) =>
    `<label class="fret-cell"><span>${s}</span><input id="trainer-fret-${i}" type="text" inputmode="numeric" maxlength="2" placeholder="x" aria-label="${s} string fret" onkeydown="if(event.key==='Enter')trainerCheckShape()"></label>`).join('');
  return {
    id, kind: 'n2s', chord,
    diagrams: [{
      chordFrets: v ? v.frets : null, chordHiddenUntilReveal: true,
      scaleKey: key, scaleType: 'full', revealLabel: chord,
    }],
    questionHTML: `
      <div class="trainer-prompt">Play the <strong>${escHtml(roman)}</strong> in <strong>${escHtml(keyLabel(key))}</strong>.
        <span class="trainer-hint">Enter a fret per string (x or blank = muted). Any voicing counts — we check the pitches.
        The scale layer below is your hint; one correct shape appears in it after you answer.</span>
      </div>
      ${DIAGRAMS_DIV}`,
    answersHTML: `
      <div class="fret-inputs" role="group" aria-label="Your shape, low E to high e">${cells}</div>
      <button class="btn btn-primary trainer-check" type="button" onclick="trainerCheckShape()">Check ↗</button>
      <button class="pb-btn" type="button" onclick="trainerGiveUp()">show answer</button>`,
  };
}

/* Moving shapes: barre shape + fret number → chord name. Chromatic
   drill, so there's no key context and no scale layer here. */
function buildMV(id, fam, qual, fret){
  const shape = (fam === 'E' ? E_SHAPES : A_SHAPES)[qual];
  const frets = shape(fret);
  const correct = mvName(fam, qual, fret);
  const cands = [];
  for (const df of [-2, -1, 1, 2]){
    const f = fret + df;
    if (f >= 1 && f <= 11) cands.push(mvName(fam, qual, f));
  }
  for (const q of MV_QUALS) if (q !== qual) cands.push(mvName(fam, q, fret));
  const distractors = shuffle([...new Set(cands)].filter(n => n !== correct)).slice(0, 3);
  const options = shuffle([correct, ...distractors]);
  return {
    id, kind: 'mv', correctIdx: options.indexOf(correct),
    playFreqs: fretsToFreqs(frets),
    diagrams: [{ chordFrets: frets, revealLabel: correct }],
    questionHTML: `
      <div class="trainer-prompt"><strong>${fam}-shape</strong> ${escHtml(MV_QUAL_LABEL[qual])} barre at <strong>fret ${fret}</strong> — which chord?</div>
      ${DIAGRAMS_DIV}
      <button class="pb-btn" type="button" onclick="trainerPlay()">▶ hear it</button>`,
    answersHTML: options.map((n, i) =>
      `<button class="fret-chord trainer-opt" id="trainer-opt-${i}" onclick="trainerAnswer(${i})">${escHtml(n)}</button>`).join(''),
    revealHTML: `The ${fam}-shape root sits on the ${fam === 'E' ? 'low-E' : 'A'} string: fret ${fret} = ${escHtml(pcToName(mvRootPc(fam, fret)))}, so this is <strong>${escHtml(correct)}</strong>.`,
  };
}

/* Progression ID: hear/see chords (in the key's scale), name the sequence. */
function buildProg(id, key, ti){
  const modeKey = keyInfo(key).mode;
  const tpls = PROG_TEMPLATES[modeKey];
  const tpl = tpls[ti];
  const names = diatonicChords(key);
  const chords = tpl.deg.map(d => names[d]);
  const voicings = chords.map(n => getVoicing(n));
  const chordsFreqs = chords.map((n, i) =>
    (voicings[i] && voicings[i].midis.length) ? voicings[i].midis.map(midiToHz) : []);
  return {
    id, kind: 'prog', correctIdx: ti, chordsFreqs,
    diagrams: voicings.map((v, i) => ({
      chordFrets: v ? v.frets : null, scaleKey: key, scaleType: 'full',
      revealLabel: chords[i],
    })),
    questionHTML: `
      <div class="trainer-prompt">Key of <strong>${escHtml(keyLabel(key))}</strong> — listen (and watch the shapes): which progression is this?</div>
      ${DIAGRAMS_DIV}
      <button class="pb-btn" type="button" onclick="trainerPlay()">▶ play progression</button>`,
    answersHTML: tpls.map((t, i) =>
      `<button class="fret-chord trainer-opt" id="trainer-opt-${i}" onclick="trainerAnswer(${i})">${escHtml(t.name)}</button>`).join(''),
    revealHTML: `<strong>${escHtml(tpl.name)}</strong> — ${chords.map(escHtml).join(' · ')}.`,
  };
}

/* Scale shapes: show a scale box (roots marked), name the scale.
   The chord layer highlights the tonic chord tones INSIDE the box —
   the intertwine: toggle it to see the chord living in the shape. */
function buildSC(id, key, center, type){
  const win = { lo: Math.max(0, center - 1), hi: center + 4 };
  const modeKey = keyInfo(key).mode;
  const correct = scaleLabel(key, type);
  const tonic = diatonicChords(key)[0];
  const sameModeKeys = KEYS.filter(k => keyInfo(k).mode === modeKey && k !== key);
  const distractors = shuffle([...sameModeKeys]).slice(0, 3).map(k => scaleLabel(k, type));
  const options = shuffle([correct, ...distractors]);
  const runNotes = scaleNotesWindow(key, type, win.lo, win.hi);
  return {
    id, kind: 'sc', correctIdx: options.indexOf(correct),
    scaleRunNotes: runNotes,
    tonicFreqs: voicingFreqs(tonic),
    diagrams: [{
      scaleKey: key, scaleType: type, window: win,
      chordPcs: chordTonePcs(tonic),
      revealLabel: `${correct} · tonic ${tonic}`,
    }],
    questionHTML: `
      <div class="trainer-prompt">Which scale is this box? <span class="trainer-hint">Solid dots are the roots. With the chord layer on, the tonic chord's tones are highlighted inside the shape.</span></div>
      ${DIAGRAMS_DIV}
      <button class="pb-btn" type="button" onclick="trainerPlay()">▶ hear the box</button>`,
    answersHTML: options.map((n, i) =>
      `<button class="fret-chord trainer-opt" id="trainer-opt-${i}" onclick="trainerAnswer(${i})">${escHtml(n)}</button>`).join(''),
    revealHTML: `<strong>${escHtml(correct)}</strong> around fret ${center}. Its tonic chord is <strong>${escHtml(tonic)}</strong> — toggle the chord layer to see those tones sitting inside the box.`,
  };
}

/* ---- rendering -------------------------------------------- */
function renderQuestion(){
  stopProgAudio();
  answered = false;
  advanceToken++;
  const q = $('trainer-question'), a = $('trainer-answers'), f = $('trainer-feedback');
  if (!q || !current) return;
  q.innerHTML = current.questionHTML;
  a.innerHTML = current.answersHTML;
  f.className = 'trainer-feedback';
  f.innerHTML = '';
  redrawDiagrams();
  updateStats();
}

/* The sidebar trainer card (trainernav.js) listens here. */
const statListeners = [];
export function onTrainerStats(fn){ if (typeof fn === 'function') statListeners.push(fn); }
function notifyStats(){ statListeners.forEach(fn => { try { fn(); } catch (e) { console.error('trainer stats listener:', e); } }); }
/* Cards due across every drill deck + today's answered count. */
export function trainerDueSummary(){
  const s = srsStats(deckFor('mixed'));
  return { due: s.due, unseen: s.unseen, mastered: s.mastered, total: s.total, today: srsToday() };
}
function updateStats(){
  notifyStats();
  const el = $('trainer-stats');
  if (!el) return;
  if (mode === 'custom'){
    const t = getActiveTrack();
    const n = t ? t.chords.length : 0;
    el.textContent = t
      ? `"${t.name}" · ${n} chord${n === 1 ? '' : 's'} · ${tracks.length} track${tracks.length === 1 ? '' : 's'} saved`
      : 'no tracks saved yet';
    return;
  }
  const s = srsStats(deckFor(mode));
  const acc = s.accuracy === null ? '—' : Math.round(s.accuracy * 100) + '%';
  el.textContent =
    `session ${session.right}/${session.asked} · streak ${session.streak} · ` +
    `deck ${s.seen}/${s.total} seen · ${s.due} due · ${s.mastered} mastered · ${acc} all-time`;
}

function showFeedback(ok, extraHTML = ''){
  const f = $('trainer-feedback');
  if (!f) return;
  f.className = 'trainer-feedback ' + (ok ? 'ok' : 'bad');
  f.innerHTML =
    `<span class="trainer-verdict">${ok ? '✓ correct' : '✗ not quite'}</span> ` +
    (extraHTML || '') +
    ` <button class="pb-btn trainer-next" type="button" onclick="trainerNext()">next →</button>`;
}

function finish(ok){
  if (answered) return;
  answered = true;
  redrawDiagrams();                 // reveal labels / unhide answer layers
  session.asked++;
  if (ok){ session.right++; session.streak++; } else session.streak = 0;
  srsRecord(current.id, ok);
  updateStats();
  if (ok){
    const token = ++advanceToken;
    setTimeout(() => { if (token === advanceToken) trainerNext(); }, 1400);
  }
}

/* ---- answer handlers (window-bridged) ---------------------- */
export function trainerAnswer(i){
  if (answered || !current || current.correctIdx === undefined) return;
  const ok = i === current.correctIdx;
  const chosen = $('trainer-opt-' + i);
  const right = $('trainer-opt-' + current.correctIdx);
  if (chosen) chosen.classList.add(ok ? 'trainer-right' : 'trainer-wrong');
  if (right) right.classList.add('trainer-right');
  document.querySelectorAll('.trainer-opt').forEach(b => b.disabled = true);
  showFeedback(ok, current.revealHTML || '');
  if (current.kind === 'prog') playProgression();
  else if (current.kind === 'sc'){ if (current.tonicFreqs) playChordNow(current.tonicFreqs); }
  else if (current.playFreqs) playChordNow(current.playFreqs);
  finish(ok);
}

/* Read the trainer's six fret inputs → sounding MIDI notes. */
function readTrainerFrets(){
  const midis = [];
  for (let i = 0; i < 6; i++){
    const el = $('trainer-fret-' + i);
    const raw = (el ? el.value : '').trim().toLowerCase();
    if (raw === '' || raw === 'x' || raw === '-') continue;
    const f = parseInt(raw, 10);
    if (Number.isNaN(f) || f < 0 || f > 24) continue;
    midis.push(STRING_OPEN_MIDI[i] + f);
  }
  return midis;
}

/* Verify entered pitches spell the target chord (any voicing/octave). */
function checkShape(name, midis){
  const p = parseChordName(name);
  if (!p) return { ok: false, msg: 'internal error parsing the target chord' };
  const want = new Set(p.intervals.map(iv => (p.rootPc + iv) % 12));
  const root = p.rootPc;
  const third = (p.rootPc + p.intervals[1]) % 12;
  const pcs = new Set(midis.map(m => ((m % 12) + 12) % 12));
  if (midis.length < 3) return { ok: false, msg: 'Need at least 3 sounding strings.' };
  const outside = [...pcs].filter(pc => !want.has(pc));
  if (outside.length) return { ok: false, msg: `Out-of-chord note${outside.length > 1 ? 's' : ''}: ${outside.map(pcToName).join(' ')}.` };
  if (!pcs.has(root))  return { ok: false, msg: `Missing the root (${pcToName(root)}).` };
  if (!pcs.has(third)) return { ok: false, msg: `Missing the 3rd (${pcToName(third)}) — the shape doesn't define its quality yet.` };
  return { ok: true, msg: `That spells ${name}.` };
}

export function trainerCheckShape(){
  if (answered || !current || current.kind !== 'n2s') return;
  const midis = readTrainerFrets();
  const res = checkShape(current.chord, midis);
  if (res.ok && midis.length) playChordNow(midis.map(midiToHz));
  else { const f = voicingFreqs(current.chord); if (f) setTimeout(() => playChordNow(f), 250); }
  showFeedback(res.ok,
    `${escHtml(res.msg)} One correct shape for <strong>${escHtml(current.chord)}</strong> is now shown above, inside the key's scale.`);
  finish(res.ok);
}

export function trainerGiveUp(){
  if (answered || !current || current.kind !== 'n2s') return;
  showFeedback(false,
    `No worries — a shape for <strong>${escHtml(current.chord)}</strong> is now shown above, inside the key's scale.`);
  const f = voicingFreqs(current.chord);
  if (f) playChordNow(f);
  finish(false);
}

/* ---- audio -------------------------------------------------- */
function getProgLooper(){
  if (progLooper) return progLooper;
  progLooper = makeLooper({
    swing: false,
    onStep(i){
      document.querySelectorAll('.trainer-diagram').forEach((el, j) =>
        el.classList.toggle('playing', j === i));
    },
    onStop(){
      document.querySelectorAll('.trainer-diagram.playing').forEach(el =>
        el.classList.remove('playing'));
    },
  });
  return progLooper;
}
function playProgression(){
  if (!current || !current.chordsFreqs) return;
  getProgLooper().start(
    current.chordsFreqs.map(f => ({ freqs: f, beats: 2 })),
    { beatsPerChord: 2, mode: 'chord', loop: false });
}
function stopProgAudio(){ if (progLooper) progLooper.stop(); }

/* Ascending run through the scale box — the sound of the shape. */
function playScaleRun(notes){
  if (!notes || !notes.length) return;
  const ctx = getCtx();
  const t0 = ctx.currentTime + 0.05;
  const seq = [...notes].sort((a, b) => a.midi - b.midi);
  seq.forEach((n, i) => playNote(midiToHz(n.midi), t0 + i * 0.13, 0.3, 0.14));
}

export function trainerPlay(){
  if (!current) return;
  if (current.kind === 'prog') playProgression();
  else if (current.kind === 'sc') playScaleRun(current.scaleRunNotes);
  else if (current.playFreqs) playChordNow(current.playFreqs);
}

/* ---- mode switching / lifecycle ----------------------------- */
export function trainerSetMode(m){
  mode = m;
  document.querySelectorAll('.trainer-mode').forEach(b =>
    b.classList.toggle('selected', b.id === 'trainer-mode-' + m));
  updateViewToggle();
  updateModeChrome();
  if (mode === 'custom'){ renderCustomView(); return; }
  if (exploring()) renderExploreView();
  else trainerNext();
}

export function trainerNext(){
  if (exploring()){ renderExploreView(); return; }
  advanceToken++;
  const id = srsPick(deckFor(mode), { excludeId: lastId });
  if (!id) return;
  lastId = id;
  current = buildFromId(id);
  renderQuestion();
}

export function trainerResetStats(){
  if (!confirm('Reset all trainer progress (spaced-repetition history)?')) return;
  srsResetAll();
  session = { asked: 0, right: 0, streak: 0 };
  trainerNext();
}

/* Read-only snapshot for the practice stepper (practice.js). */
export function trainerState(){
  const t = getActiveTrack();
  return {
    mode,
    exploring: exploring(),
    session: { ...session },
    tracks: tracks.length,
    track: t ? { id: t.id, name: t.name, chords: t.chords.length } : null,
  };
}

export function initTrainer(){
  if (!$('trainer-question')) return;
  loadLayers();
  loadViewPref();
  loadTracks();
  initPalette();
  configureColorMap({
    add: (name, frets) => { addChordToActiveTrack({ name, frets: frets || null }); renderCustomView(); },
    // melody harmonizer → a fresh track (made active, so My chords opens on it)
    newTrack: (name, entries) => {
      const t = makeTrack(name);
      t.chords = entries.map(e => ({ name: e.name, frets: e.frets || null }));
      tracks.push(t);
      activeTrackId = t.id;
      saveTracks();
      if (mode === 'custom') renderCustomView(); else updateStats();
    },
  });
  configureExplore(() => layers);
  syncLayerCheckboxes();
  updateViewToggle();
  updateModeChrome();
  trainerNext();
}
