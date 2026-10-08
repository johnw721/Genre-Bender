/* ============================================================
   colormap.js — the diatonic "color ladder".

   For the current key, each of the seven scale degrees gets:
     - its roman numeral + harmonic function (tonic / predominant /
       dominant)
     - the plain triad and its spelling
     - a short ladder of richer chords that keep the same job
       (I → maj7 / 6 / maj9, iii → m7 / m♯5 = I over its 3rd,
       V → 7 / 11 / 13, vii° → m7♭5 / dim♭9 …)
     - "extras": idiomatic colors that borrow a tone from outside
       the key (I7 = V7 of IV, minor-key V7 from harmonic minor …),
       with the outside note called out.

   The same table drives "recolor": every chord in a track whose
   root sits on a scale degree can be moved up its ladder
   (level 0 = triads, 1 = sevenths, 2 = extended, 3 = spice), or a
   single chord can be cycled through its whole column.

   UI: the grid lives in the trainer's "My chords" view, above the
   chord table. Click a chip to hear it, drag it onto the track or
   the table (payload source 'colormap'), or press + to append it.
   Pure ladder functions have no DOM / audio dependencies.
   ============================================================ */
import { diatonicChords, keyInfo, scalePcs } from './scales.js';
import { KEYS, romansFor, keyLabel } from './theorydata.js';
import { parseChordName, withQuality, getVoicing } from './chordbook.js';
import { pcToName, midiToHz } from './theory.js';
import { playChordNow } from './audio.js';
import { escHtml } from './util.js';
import { setDragPayload, clearDragPayload, DRAG_MIME } from './chordpalette.js';
import { registerActions } from './actions.js';
import { syncKey, getAppKey, onAppKeyChange } from './keysync.js';
import { registerStore, loadJSON, saveJSON } from './storage.js';

const VIEW_KEY = registerStore('colorMapView', 'GenreBenderColorMapView_v1');

/* ---- the ladders ----------------------------------------------------------
   colors: in-key, ordered by recolor level (1, 2, 3). A shorter list just
   stays on its last rung at higher levels.
   extras: [qualityKey, note] — other idiomatic options for that degree. */
const LADDER = {
  major: [
    { fn: 'T',  colors: ['maj7', 'six', 'maj9'],
      extras: [['dom7', 'I7 — the ♭7 is borrowed; it turns I into V7 of IV (bluesy push to IV)'],
               ['add9', 'I add9 — open, no 7th']] },
    { fn: 'PD', colors: ['min7', 'min9', 'min11'], extras: [] },
    { fn: 'T',  colors: ['min7', 'minS5'], extras: [] },
    { fn: 'PD', colors: ['maj7', 'six', 'maj9'], extras: [] },
    { fn: 'D',  colors: ['dom7', 'dom11', 'dom13'],
      extras: [['dom9', 'V9 — the classic dominant 9'],
               ['sus4', 'Vsus4 — delay the 3rd, resolve to V or straight home']] },
    { fn: 'T',  colors: ['min7', 'min9', 'min11'], extras: [] },
    { fn: 'D',  colors: ['m7b5', 'dimb9'], extras: [] },
  ],
  minor: [
    { fn: 'T',  colors: ['min7', 'min9', 'min11'],
      extras: [['min6', 'i6 — the raised 6th is the Dorian color']] },
    { fn: 'PD', colors: ['m7b5'], extras: [] },
    { fn: 'T',  colors: ['maj7', 'six', 'maj9'], extras: [] },
    { fn: 'PD', colors: ['min7', 'min9', 'min11'],
      extras: [['maj', 'IV major — borrowed from Dorian, a brighter lift']] },
    { fn: 'D',  colors: ['min7', 'min11'],
      extras: [['dom7', 'V7 — raised 7th from harmonic minor; the strongest pull to i'],
               ['dom7b9', 'V7♭9 — harmonic-minor dominant with the ♭9 on top']] },
    { fn: 'PD', colors: ['maj7', 'maj9', 'six'], extras: [] },
    { fn: 'D',  colors: ['dom7', 'dom9', 'sus4'], extras: [] },
  ],
};

/* Out-of-scale options per degree, on the SAME root (so drag / recolor
   semantics don't change): secondary dominants, altered dominants, and
   chords borrowed from outside the key. Only entries that really carry an
   outside note are shown. */
const OUTSIDE = {
  major: [
    [['dom7', 'I7 = V7/IV — the ♭7 pushes to IV (blues tonic)'], ['dom7s9', 'I7♯9 — funk / blues tonic']],
    [['dom7', 'II7 = V7/V — secondary dominant, pulls to V'], ['maj', 'II major — Lydian lift']],
    [['dom7', 'III7 = V7/vi — pulls to vi'], ['maj', 'III major — chromatic mediant']],
    [['min', 'iv — borrowed minor iv, the bittersweet plagal'], ['min6', 'iv6 — borrowed, cinematic'], ['dom7', 'IV7 — blues subdominant']],
    [['dom7b9', 'V7♭9 — borrowed ♭9 tension'], ['dom7s9', 'V7♯9 — the "Hendrix" chord'], ['dom7s5', 'V7♯5 — augmented pull home']],
    [['dom7', 'VI7 = V7/ii — pulls to ii'], ['maj', 'VI major — chromatic lift']],
    [['dom7', 'VII7 = V7/iii — pulls to iii'], ['dim7', 'vii°7 — fully diminished, from harmonic minor']],
  ],
  minor: [
    [['maj', 'I major — Picardy third'], ['dom7', 'I7 = V7/iv — pulls to iv']],
    [['dom7', 'II7 = V7/V — pulls to V'], ['min7', 'ii m7 — Dorian / melodic-minor shade']],
    [['dom7', 'III7 = V7/VI — pulls to VI'], ['aug', 'III+ — harmonic-minor mediant']],
    [['maj', 'IV major — Dorian lift'], ['dom7', 'IV7 — Dorian / blues']],
    [['maj', 'V major — harmonic minor'], ['dom7', 'V7 — strongest pull to i'], ['dom7b9', 'V7♭9 — dark dominant']],
    [['dom7', 'VI7 — German-sixth sound, pulls to V'], ['min', 'vi minor — Dorian shade']],
    [['dom7b9', 'VII7♭9 — tension toward III'], ['min', 'vii minor — modal darkening']],
  ],
};

export const VIEWS = {
  in:       { label: 'In scale',     hint: "Every chord here uses only the key's own notes." },
  out:      { label: 'Out of scale', hint: 'Same roots, borrowed or altered tones: secondary dominants, altered V, borrowed iv. Outside notes are flagged.' },
  parallel: { label: 'Parallel',     hint: 'The parallel key (same tonic, other mode) degree by degree. Borrow single chords, or modulate outright.' },
};

export const FN_LABEL = { T: 'tonic', PD: 'predominant', D: 'dominant' };
const FN_TEXT = {
  T:  'tonic family — home / rest; these can stand in for each other',
  PD: 'predominant family — moves away from home and sets up the dominant',
  D:  'dominant family — tension that wants to resolve home',
};
export const LEVEL_NAMES = ['triads', 'sevenths', 'extended', 'spice'];

/* Chord-tone pitch classes for a name. */
function chordPcs(name){
  const p = parseChordName(name);
  return p ? [...new Set(p.intervals.map(iv => (p.rootPc + iv) % 12))] : [];
}

/* Default teaching note for a color, when the ladder doesn't give one. */
function autoNote(q, deg, triads, mode){
  if (q === 'minS5'){
    const tonic = triads[0], third = parseChordName(triads[deg]);
    return `same notes as ${tonic}/${third ? third.rootName : '?'} — the tonic with its 3rd in the bass`;
  }
  if (q === 'dimb9'){
    return `the ♭9 is the tonic note itself — the leading tone rubs against home, max pull to ${triads[0]}`;
  }
  if (q === 'dom11' && mode === 'major'){
    const iv = parseChordName(triads[3]), v = parseChordName(triads[4]);
    return `sus-dominant sound — works like ${iv ? iv.rootName : 'IV'} over a ${v ? v.rootName : 'V'} bass`;
  }
  return '';
}

function outsideOf(name, inKey){ return chordPcs(name).filter(pc => !inKey.has(pc)).map(pcToName); }

/* The full ladder for a key. `refKey` (default: the key itself) is the key
   outside notes are measured against — the parallel view measures the
   parallel key's chords against the key you're actually in. */
export function colorLadder(key, refKey = key){
  const { mode } = keyInfo(key);
  const triads = diatonicChords(key);
  const romans = romansFor(key);
  const inKey = new Set(scalePcs(refKey));
  const mk = (deg, q, note) => {
    const name = withQuality(triads[deg], q);
    if (!name) return null;
    return { name, q, outside: outsideOf(name, inKey), note: note || autoNote(q, deg, triads, mode) };
  };
  return LADDER[mode].map((rung, deg) => {
    const triad = triads[deg];
    return {
      deg,
      roman: romans[deg],
      fn: rung.fn,
      triad,
      triadOutside: outsideOf(triad, inKey),
      spelling: chordPcs(triad).map(pcToName),
      colors: rung.colors.map(q => mk(deg, q)).filter(Boolean),
      extras: rung.extras.map(([q, note]) => mk(deg, q, note)).filter(Boolean),
    };
  });
}

/* Same tonic, other mode: E <-> Em. Every app key's parallel is also an
   app key (C/Cm, G/Gm, D/Dm, A/Am, E/Em). */
export function parallelKey(key){
  const { rootName, mode } = keyInfo(key);
  return mode === 'minor' ? rootName : rootName + 'm';
}

/* Roman numeral of a parallel-key degree, marked ♭/♯ against the home
   key's degree on the same step (E major → E minor: III → ♭III). */
function relativeRoman(roman, parRootPc, homeRootPc){
  const d = ((parRootPc - homeRootPc) % 12 + 12) % 12;
  return (d === 11 ? '♭' : d === 1 ? '♯' : '') + roman;
}

/* Columns for one of the three views (see VIEWS). */
export function mapColumns(key, view = 'in'){
  const base = colorLadder(key);
  if (view === 'out'){
    const { mode } = keyInfo(key);
    const triads = diatonicChords(key);
    const inKey = new Set(scalePcs(key));
    return base.map((r, deg) => {
      const seen = new Set();
      const opts = [
        ...OUTSIDE[mode][deg].map(([q, note]) => {
          const name = withQuality(triads[deg], q);
          return name && { name, q, outside: outsideOf(name, inKey), note };
        }),
        ...r.extras,
      ].filter(c => c && c.outside.length && !seen.has(c.name) && seen.add(c.name));
      return { ...r, colors: opts, extras: [] };
    });
  }
  if (view === 'parallel'){
    const pk = parallelKey(key);
    const homeTriads = diatonicChords(key);
    return colorLadder(pk, key).map((r, deg) => {
      const pr = parseChordName(r.triad), hr = parseChordName(homeTriads[deg]);
      return { ...r, roman: relativeRoman(r.roman, pr.rootPc, hr.rootPc), parallel: true };
    });
  }
  return base.map(r => ({ ...r, extras: r.extras.filter(c => !c.outside.length) }));
}

/* Scale degree (0..6) a chord's root sits on in `key`, or -1. */
export function degreeOf(name, key){
  const p = parseChordName(name);
  if (!p) return -1;
  return diatonicChords(key).findIndex(n => { const d = parseChordName(n); return d && d.rootPc === p.rootPc; });
}

/* The chord on `name`'s degree at a recolor level (0 = triad). Keeps the
   original root spelling. null if the root isn't diatonic in `key`. */
export function recolorName(name, key, level){
  const deg = degreeOf(name, key);
  if (deg < 0) return null;
  const rung = colorLadder(key)[deg];
  const p = parseChordName(name);
  const pick = level <= 0 || !rung.colors.length
    ? parseChordName(rung.triad).quality
    : rung.colors[Math.min(level, rung.colors.length) - 1].q;
  return withQuality(p.rootName + '', pick) || name;
}

/* Next option in a chord's whole column: triad → colors → extras → triad. */
export function nextColorName(name, key){
  const deg = degreeOf(name, key);
  if (deg < 0) return null;
  const rung = colorLadder(key)[deg];
  const p = parseChordName(name);
  const quals = [parseChordName(rung.triad).quality, ...rung.colors.map(c => c.q), ...rung.extras.map(c => c.q)];
  const i = quals.indexOf(p.quality);
  return withQuality(p.rootName, quals[(i + 1) % quals.length]) || name;
}

/* Root-in-bass voicing for a colour chord (G#m#5 must sound as E/G#, not
   as E). Returns the frets to PIN on a track/table entry, or null when the
   chord book's default voicing is already that shape (so the entry stays
   un-pinned and its "auto" position control keeps meaning). */
export function colorVoicing(name){ return getVoicing(name, { rootBass: true }); }
export function pinnedFretsFor(name){
  const v = colorVoicing(name), d = getVoicing(name);
  if (!v) return null;
  return d && JSON.stringify(d.frets) === JSON.stringify(v.frets) ? null : [...v.frets];
}

/* ---- UI ----------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);
let mapKey = null;
let view = 'in';           // 'in' | 'out' | 'parallel' — persisted per browser
let onAdd = null;          // injected by trainer.js: (name, frets|null) → append to the active track

export function configureColorMap({ add } = {}){ if (add) onAdd = add; }
function currentKey(){
  if (mapKey && KEYS.includes(mapKey)) return mapKey;
  const k = getAppKey() || $('rail-key')?.value;
  return KEYS.includes(k) ? k : 'C';
}

function chipHTML(c, kind){
  const title = [c.name, c.note, c.outside.length ? `outside the key: ${c.outside.join(' ')}` : '', 'click to hear · drag onto the track or table']
    .filter(Boolean).join('\n');
  const out = c.outside.length ? `<span class="cm-out" aria-label="outside note">${c.outside.map(escHtml).join(' ')}</span>` : '';
  return `<div class="cm-chip cm-${kind}${c.outside.length ? ' cm-outside' : ''}" draggable="true" role="button" tabindex="0"
      data-action="cm:play" data-name="${escHtml(c.name)}" title="${escHtml(title)}">
    <span class="cm-chip-name">${escHtml(c.name)}</span>${out}
    <button type="button" class="cm-add" data-action="cm:add" data-name="${escHtml(c.name)}" aria-label="Add ${escHtml(c.name)} to the track" title="Add to the end of the track">+</button>
  </div>`;
}

function columnHTML(r){
  const triad = { name: r.triad, outside: r.triadOutside || [], note: FN_TEXT[r.fn] };
  return `<div class="cm-col cm-fn-${r.fn}" role="listitem">
    <div class="cm-colors">
      ${r.extras.slice().reverse().map(c => chipHTML(c, 'extra')).join('')}
      ${r.colors.slice().reverse().map(c => chipHTML(c, 'color')).join('')}
    </div>
    <div class="cm-rule" aria-hidden="true"></div>
    ${chipHTML(triad, 'triad')}
    <div class="cm-roman">${escHtml(r.roman)}</div>
    <div class="cm-fn" title="${escHtml(FN_TEXT[r.fn])}">${FN_LABEL[r.fn]}</div>
    <div class="cm-spell">${r.spelling.map(escHtml).join(' ')}</div>
  </div>`;
}

function bodyHTML(key){
  const par = view === 'parallel' ? parallelKey(key) : null;
  const banner = par ? `<div class="cm-parallel-bar">
      <span>Showing <strong>${escHtml(keyLabel(par))}</strong> against ${escHtml(keyLabel(key))} — flagged notes are the ones you'd borrow.</span>
      <button type="button" class="pb-btn" data-action="cm:modulate" data-key="${escHtml(par)}">⇄ modulate to ${escHtml(keyLabel(par))}</button>
    </div>` : '';
  return `<p class="trainer-hint cm-view-hint">${escHtml(VIEWS[view].hint)}</p>${banner}
    <div class="cm-grid cm-view-${view}" role="list">${mapColumns(key, view).map(columnHTML).join('')}</div>`;
}
function switchHTML(){
  return `<div class="cm-switch" role="radiogroup" aria-label="Color map view">${Object.entries(VIEWS).map(([id, v]) =>
    `<button type="button" role="radio" class="cm-switch-btn${id === view ? ' on' : ''}" aria-checked="${id === view}"
      data-action="cm:view" data-view="${id}">${escHtml(v.label)}</button>`).join('')}</div>`;
}

/* Whole section, rendered by trainer.js inside the "My chords" view. */
export function colorMapHTML(){
  const key = currentKey();
  const opts = KEYS.map(k => `<option value="${k}"${k === key ? ' selected' : ''}>${escHtml(keyLabel(k))}</option>`).join('');
  return `
  <details class="colormap" id="colormap" open>
    <summary><span class="section-label">Color map</span>
      <span class="trainer-hint cm-hint">Each degree's triad with richer chords stacked above it. Click to hear · drag onto the track or table · + to append.</span>
    </summary>
    <div class="cm-tools">
      <span id="colormap-switch">${switchHTML()}</span>
      <label class="cm-key-label">key
        <select id="colormap-key" class="tab-style-select" data-on-change="cm:key" aria-label="Color map key">${opts}</select>
      </label>
      <span class="cm-legend"><i class="cm-dot cm-fn-T"></i>tonic <i class="cm-dot cm-fn-PD"></i>predominant <i class="cm-dot cm-fn-D"></i>dominant <i class="cm-dot cm-dot-out"></i>outside / borrowed note</span>
    </div>
    <div id="colormap-body">${bodyHTML(key)}</div>
  </details>`;
}

export function redrawColorMap(){
  const body = $('colormap-body');
  if (!body) return;
  const key = currentKey();
  body.innerHTML = bodyHTML(key);
  const sel = $('colormap-key');
  if (sel && sel.value !== key) sel.value = key;
  const sw = $('colormap-switch');
  if (sw) sw.innerHTML = switchHTML();
}

export function setColorMapView(v){
  if (!VIEWS[v]) return;
  view = v;
  saveJSON(VIEW_KEY, view);
  redrawColorMap();
}
export function getColorMapView(){ return view; }

function playName(name){
  const v = colorVoicing(name);
  if (v && v.midis && v.midis.length) playChordNow(v.midis.map(midiToHz));
}

/* Drag: chips become a 'colormap' payload; the track and the chord table
   both accept it (trainer.js / chordpalette.js drop handlers). */
export function initColorMapDrag(root){
  if (!root || root.__colormapDragWired) return;
  root.__colormapDragWired = true;
  root.addEventListener('dragstart', e => {
    const chip = e.target.closest && e.target.closest('.cm-chip');
    if (!chip) return;
    const name = chip.dataset.name;
    const pinned = pinnedFretsFor(name);
    const v = colorVoicing(name);
    const payload = { source: 'colormap', name, frets: pinned || (v ? v.frets : null), pinned: !!pinned };
    setDragPayload(payload);
    try {
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
      e.dataTransfer.setData('text/plain', name);
      e.dataTransfer.effectAllowed = 'copy';
    } catch { /* ignore */ }
    chip.classList.add('dragging');
  });
  root.addEventListener('dragend', e => {
    const chip = e.target.closest && e.target.closest('.cm-chip');
    if (chip) chip.classList.remove('dragging');
    clearDragPayload();
  });
  root.addEventListener('keydown', e => {
    const chip = e.target.closest && e.target.closest('.cm-chip');
    if (chip && e.target === chip && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); playName(chip.dataset.name); }
  });
}

export function initColorMap(){
  const saved = loadJSON(VIEW_KEY);
  if (VIEWS[saved]) view = saved;
  registerActions({
    'cm:view': (el) => setColorMapView(el.dataset.view),
    'cm:modulate': (el) => { const k = el.dataset.key; if (!KEYS.includes(k)) return; mapKey = k; syncKey(k, 'colormap-key'); setColorMapView('in'); },
    'cm:play': (el) => playName(el.dataset.name),
    'cm:add': (el, e) => { e.stopPropagation(); if (onAdd) onAdd(el.dataset.name, pinnedFretsFor(el.dataset.name)); },
    'cm:key': (el) => { mapKey = el.value; syncKey(el.value, 'colormap-key'); redrawColorMap(); },
  });
  onAppKeyChange(k => { mapKey = k; redrawColorMap(); });
}
