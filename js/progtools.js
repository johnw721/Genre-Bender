/* ============================================================
   progtools.js — the tools strip under a guitar tab / piano chart.

   One strip per instrument, rendered by renderGuitarTab /
   renderPianoChart into #<inst>-tools:

     • Hooktheory realism badge (when the pass ran) — score, bucket,
       weakest move, and the before → after when a retry was taken
     • voice-leading motion readout + "smooth voicings"
     • transpose −/+ (names, notes and tab move together)
     • capo suggestion (guitar): the capo that turns the progression
       into the most open shapes, with "use shapes"
     • history: every generation and every edit made here is a
       snapshot; click one to load it, ★ to keep it, ⇄ to flip
       between the last two you looked at (A/B), ↶ to undo

   Edits never mutate a snapshot: they deep-copy the current result,
   change the copy, record it as a new snapshot, and re-render. So
   A/B always compares two real versions.

   Persisted under GenreBenderHistory_v1 (15 unstarred + up to 15
   starred per instrument).
   ============================================================ */
import { store } from './store.js';
import { escHtml } from './util.js';
import { registerActions } from './actions.js';
import { registerStore, loadJSON, saveJSON } from './storage.js';
import { validateChordList } from './theory.js';
import { realismLabel } from './hooktheory.js';
import { syncKey } from './keysync.js';
import {
  notesToMidis, progressionMotion, smoothGuitarVoicings, smoothPianoVoicings, voicingsToTab,
  transposeChordName, transposeKey, transposeNotes, transposeTab, prefersFlats,
  suggestCapo, capoVoicings
} from './voicelead.js';

const HIST_KEY = registerStore('history', 'GenreBenderHistory_v1');
const MAX_PLAIN = 15, MAX_STARRED = 15;
const KEY_OPTIONS = ['Am', 'Em', 'Dm', 'Cm', 'Gm', 'A', 'C', 'D', 'E', 'G'];

let hist = { guitar: [], piano: [] };
const view = { guitar: { cur: null, prev: null }, piano: { cur: null, prev: null } };
const renderers = {};          // inst -> (result) => void   (set by guitar.js / piano.js)

function loadHist(){
  const s = loadJSON(HIST_KEY, null);
  if (s && Array.isArray(s.guitar) && Array.isArray(s.piano)) hist = s;
}
function saveHist(){ saveJSON(HIST_KEY, hist); }
const clone = (o) => JSON.parse(JSON.stringify(o));
const dataOf = (inst) => (inst === 'guitar' ? store.guitarTabData : store.pianoChordData);
function setData(inst, r){ if (inst === 'guitar') store.guitarTabData = r; else store.pianoChordData = r; }
const panelKey = (inst) => document.getElementById(`${inst}-key`)?.value || 'C';
const panelStyle = (inst) => document.getElementById(`${inst}-style`)?.value || '';

export function registerProgRenderer(inst, fn){ renderers[inst] = fn; }

/* ---- history ---------------------------------------------------------- */

/* Record a snapshot of `result` (already the live store value). `tag`
   names what made it ("generated", "smoothed", "+2", "capo 3"). */
export function recordSnapshot(inst, result, tag = 'generated'){
  if (!result || !Array.isArray(result.chords)) return null;
  const entry = {
    id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    ts: Date.now(),
    tag,
    key: result._key || panelKey(inst),
    style: panelStyle(inst),
    starred: false,
    data: clone(result),
  };
  const list = hist[inst];
  list.unshift(entry);
  // evict oldest unstarred beyond the cap; cap starred separately
  let plain = 0, starred = 0;
  hist[inst] = list.filter(e => (e.starred ? ++starred <= MAX_STARRED : ++plain <= MAX_PLAIN));
  saveHist();
  view[inst].prev = view[inst].cur;
  view[inst].cur = entry.id;
  result._hid = entry.id;
  return entry;
}

function loadSnapshot(inst, id){
  const e = hist[inst].find(x => x.id === id);
  if (!e) return;
  const r = clone(e.data);
  r._hid = e.id;
  if (view[inst].cur !== id){ view[inst].prev = view[inst].cur; view[inst].cur = id; }
  if (KEY_OPTIONS.includes(e.key) && e.key !== panelKey(inst)) syncKey(e.key, 'progtools');
  setData(inst, r);
  renderers[inst]?.(r);
}

/* Apply an edit: copy the current result, let fn change it, snapshot, render. */
function applyEdit(inst, tag, fn){
  const cur = dataOf(inst);
  if (!cur) return;
  const r = clone(cur);
  delete r._realism;              // the realism score described the old chords
  if (fn(r) === false) return;
  setData(inst, r);
  recordSnapshot(inst, r, tag);
  renderers[inst]?.(r);
}

/* ---- metrics ---------------------------------------------------------- */

function chordMidis(inst, c){
  return inst === 'piano' ? notesToMidis(`${c.left || ''} ${c.right || ''}`) : notesToMidis(c.notes);
}
export function motionOf(inst, r){
  return progressionMotion((r?.chords || []).map(c => chordMidis(inst, c)));
}

/* ---- edits ------------------------------------------------------------ */

function smooth(inst){
  applyEdit(inst, 'smoothed', (r) => {
    const names = r.chords.map(c => c.name);
    if (inst === 'guitar'){
      const vs = smoothGuitarVoicings(names);
      if (!vs.some(Boolean)) return false;
      r.chords.forEach((c, i) => { if (vs[i]){ c.notes = vs[i].notes; c.frets = vs[i].frets; } });
      // A chord-per-column tab only replaces the AI's tab for plain progressions;
      // riffs/arpeggios keep their tab and the chord cards carry the new voicings.
      if (!r.style || r.style === 'chord_progression' || panelStyle(inst) === 'chord_progression'){
        r.tab = voicingsToTab(vs, names);
      }
      r.chords = validateChordList(r.chords, 'notes').annotated;
    } else {
      const vs = smoothPianoVoicings(names, { flats: prefersFlats(panelKey(inst)) });
      if (!vs.some(Boolean)) return false;
      r.chords.forEach((c, i) => { if (vs[i]){ c.left = vs[i].left; c.right = vs[i].right; } });
      r.chords = validateChordList(r.chords, 'leftright').annotated;
    }
  });
}

function transpose(inst, n){
  const fromKey = dataOf(inst)?._key || panelKey(inst);
  const toKey = transposeKey(fromKey, n);
  const flats = prefersFlats(toKey);
  // Follow the progression with the key selects when the new key is one of
  // the app's ten (before rendering, so degree labels use the new key).
  if (KEY_OPTIONS.includes(toKey)) syncKey(toKey, 'progtools');
  applyEdit(inst, (n > 0 ? '+' : '') + n, (r) => {
    r.chords.forEach(c => {
      c.name = transposeChordName(c.name, n, flats);
      if (inst === 'guitar'){ c.notes = transposeNotes(c.notes, n, flats); if (c.frets) c.frets = null; }
      else { c.left = transposeNotes(c.left, n, flats); c.right = transposeNotes(c.right, n, flats); }
    });
    if (inst === 'guitar' && r.tab) r.tab = transposeTab(r.tab, n);
    r._key = toKey;
    r.chords = validateChordList(r.chords, inst === 'guitar' ? 'notes' : 'leftright').annotated;
  });
}

function useCapo(inst){
  const r0 = dataOf(inst);
  if (!r0) return;
  const { best } = suggestCapo(r0.chords.map(c => c.name));
  if (!best.capo) return;
  applyEdit(inst, `capo ${best.capo}`, (r) => {
    const vs = capoVoicings(best.shapes, best.capo);
    r.chords.forEach((c, i) => { if (vs[i]){ c.notes = vs[i].notes; c.frets = vs[i].frets; } });
    r.tab = voicingsToTab(vs, best.shapes, { capo: best.capo });
    r._capo = best.capo;
    r.notes = `Capo ${best.capo}: finger ${best.shapes.join(' – ')}. ` + (r.notes || '');
    r.chords = validateChordList(r.chords, 'notes').annotated;
  });
}

/* ---- render ----------------------------------------------------------- */

function realismHTML(rz){
  if (!rz) return '';
  const pct = (rz.score * 100).toFixed(1);
  const label = realismLabel(rz.score);
  const before = rz.before != null ? ` <span class="pt-dim">(was ${(rz.before * 100).toFixed(1)}%)</span>` : '';
  const weak = rz.weakest ? ` · weakest ${escHtml(rz.weakest.from)} → ${escHtml(rz.weakest.to)} ${(rz.weakest.p * 100).toFixed(1)}%` : '';
  const cover = rz.samples < rz.total ? ` · ${rz.samples}/${rz.total} moves scored` : '';
  return `<span class="pt-badge pt-${label.replace(' ', '-')}" title="Mean transition probability in Hooktheory's corpus (2-chord context)">🎵 ${pct}% · ${escHtml(label)}${before}</span><span class="pt-dim">${weak}${cover}</span>`;
}

function historyHTML(inst){
  const list = hist[inst];
  if (!list.length) return '';
  const cur = view[inst].cur;
  const chips = list.slice(0, 12).map((e, i) => {
    const names = (e.data.chords || []).map(c => c.name).join(' ');
    const t = new Date(e.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `<span class="pt-hchip${e.id === cur ? ' on' : ''}${e.starred ? ' starred' : ''}">
      <button type="button" class="pt-hload" data-action="prog:load" data-inst="${inst}" data-id="${e.id}" title="${escHtml(names)} · ${escHtml(e.key)} · ${t}">${escHtml(e.tag)}<span class="pt-dim"> ${escHtml(e.key)}</span></button><button type="button" class="pt-star" data-action="prog:star" data-inst="${inst}" data-id="${e.id}" aria-label="${e.starred ? 'Unstar' : 'Star'} this version" aria-pressed="${e.starred}">${e.starred ? '★' : '☆'}</button></span>`;
  }).join('');
  const canAB = view[inst].prev && list.some(e => e.id === view[inst].prev);
  const idx = list.findIndex(e => e.id === cur);
  const canUndo = idx >= 0 && idx < list.length - 1;
  return `<div class="pt-row pt-history" role="group" aria-label="${inst} history">
    <span class="pt-k">history</span>
    <button type="button" class="pb-btn" data-action="prog:ab" data-inst="${inst}" ${canAB ? '' : 'disabled'} title="Flip between the last two versions you viewed">⇄ A/B</button>
    <button type="button" class="pb-btn" data-action="prog:undo" data-inst="${inst}" ${canUndo ? '' : 'disabled'} title="Step back to the previous snapshot">↶ undo</button>
    <span class="pt-hchips">${chips}</span>
  </div>`;
}

export function renderProgTools(inst){
  const el = document.getElementById(`${inst}-tools`);
  const r = dataOf(inst);
  if (!el) return;
  if (!r || !Array.isArray(r.chords) || !r.chords.length){ el.innerHTML = ''; return; }
  // A session restored by persist.js points at its snapshot when one matches.
  if (!view[inst].cur && r._hid && hist[inst].some(e => e.id === r._hid)) view[inst].cur = r._hid;

  const motion = motionOf(inst, r);
  const key = r._key || panelKey(inst);
  let capoHTML = '';
  if (inst === 'guitar'){
    const { best } = suggestCapo(r.chords.map(c => c.name));
    const already = r._capo != null;
    capoHTML = best.capo > 0 && best.open > 0 && !already
      ? `<span class="pt-capo" title="Open-position shapes per capo position">capo ${best.capo} → ${escHtml(best.shapes.join(' '))} <span class="pt-dim">(${best.open}/${best.total} open)</span></span>
         <button type="button" class="pb-btn" data-action="prog:capo" data-inst="guitar">use shapes</button>`
      : (already ? `<span class="pt-capo">capo ${r._capo}</span>` : '');
  }
  const keyNote = r._key && !KEY_OPTIONS.includes(r._key)
    ? ` <span class="pt-dim" title="Not one of the app's ten keys, so the key selects stay put and degree labels use them">(now in ${escHtml(r._key)})</span>` : '';

  el.innerHTML = `
    ${r._realism ? `<div class="pt-row">${realismHTML(r._realism)}</div>` : ''}
    <div class="pt-row" role="group" aria-label="${inst} progression tools">
      <span class="pt-k">motion</span>
      <span class="pt-motion" title="Average semitones each voice moves between chords — lower is smoother">${motion.toFixed(1)} st/chord</span>
      <button type="button" class="pb-btn" data-action="prog:smooth" data-inst="${inst}" title="Re-voice every chord to minimize hand / voice movement (no AI)">⟲ smooth voicings</button>
      <span class="pt-k">transpose</span>
      <button type="button" class="pb-btn" data-action="prog:transpose" data-inst="${inst}" data-n="-1" aria-label="Transpose down a semitone">−1</button>
      <span class="pt-key">${escHtml(key)}</span>
      <button type="button" class="pb-btn" data-action="prog:transpose" data-inst="${inst}" data-n="1" aria-label="Transpose up a semitone">+1</button>${keyNote}
      ${capoHTML}
    </div>
    ${historyHTML(inst)}`;
}

export function initProgTools(){
  loadHist();
  const inst = (el) => (el.dataset.inst === 'piano' ? 'piano' : 'guitar');
  registerActions({
    'prog:smooth': (el) => smooth(inst(el)),
    'prog:transpose': (el) => transpose(inst(el), parseInt(el.dataset.n, 10) || 0),
    'prog:capo': (el) => useCapo(inst(el)),
    'prog:load': (el) => loadSnapshot(inst(el), el.dataset.id),
    'prog:star': (el) => {
      const i = inst(el), e = hist[i].find(x => x.id === el.dataset.id);
      if (!e) return;
      if (!e.starred && hist[i].filter(x => x.starred).length >= MAX_STARRED) return;
      e.starred = !e.starred; saveHist(); renderProgTools(i);
    },
    'prog:ab': (el) => { const i = inst(el); if (view[i].prev) loadSnapshot(i, view[i].prev); },
    'prog:undo': (el) => {
      const i = inst(el), list = hist[i];
      const idx = list.findIndex(e => e.id === view[i].cur);
      if (idx >= 0 && idx < list.length - 1) loadSnapshot(i, list[idx + 1].id);
    },
  });
}
