/* ============================================================
   chordfinder.js — quick chord search (🔎 in the top bar, "/" or
   Ctrl/⌘ K anywhere).

   Type one chord  → its shapes (up to four voicings), notes, where it
                     sits in the color map for the current key, and
                     buttons to hear it, add it to the track, or jump
                     to it in the color map.
   Type a root     → the common chords on that root to pick from.
   Paste a caption → every chord it names (a reel / TikTok caption, a
   or a link        shared post, a chord line) with mini diagrams, the
                     likely key, and buttons to make a track, open the
                     color map in that key, or save the link as a clip
                     with the caption kept as its notes.
   ============================================================ */
import { registerActions } from './actions.js';
import { escHtml } from './util.js';
import { parseChordName, getVoicing, voicingCandidates } from './chordbook.js';
import { parseChordToken, chordsIn, splitLinkText, inferKey, romanFor, toRomans } from './chordsheet.js';
import { chordDiagramSVG } from './fretchords.js';
import { showChordPeek, hideChordPeek } from './chordpeek.js';
import { locateChord, keysWithChord, revealInColorMap, colorVoicing, FN_LABEL } from './colormap.js';
import { getAppKey, syncKey } from './keysync.js';
import { ALL_KEYS as APP_KEYS, keyLabel } from './theorydata.js';
import { sameKey } from './chordsheet.js';
import { STRING_OPEN_MIDI, midiToHz } from './theory.js';
import { playChordNow } from './audio.js';
import { trainerAddChord, trainerUpsertTrack, trainerNewTrack } from './trainer.js';
import { normalizeKeyName } from './chordsheet.js';
import { clipsAdd, parseClipUrl } from './clips.js';
import { paletteAdd, redrawPalette } from './chordpalette.js';
import { toast } from './toast.js';

const $ = (id) => document.getElementById(id);
const SUGGEST = ['', 'm', '7', 'maj7', 'm7', 'sus2', 'sus4', 'add9', '9', 'm9', 'dim', '6', 'm7b5', '13'];
let lastFocus = null;

/* ---- pure: what did the user type? ------------------------------------ */

/* → { kind: 'empty' | 'chord' | 'root' | 'many' | 'none', ... } */
export function readQuery(text){
  const raw = String(text || '').trim();
  if (!raw) return { kind: 'empty' };
  const { url, rest } = splitLinkText(raw);
  const body = url ? rest : raw;
  if (!url && !/\s/.test(body)){
    const one = parseChordToken(body.replace(/^./, c => c.toUpperCase()));
    if (one) return { kind: 'chord', name: one.name };
    const r = body.match(/^([a-gA-G])([#b♯♭]?)$/);
    if (r) return { kind: 'root', root: r[1].toUpperCase() + r[2].replace('♯', '#').replace('♭', 'b') };
  }
  const chords = chordsIn(body);
  if (chords.length === 1 && !url) return { kind: 'chord', name: chords[0] };
  if (chords.length) return { kind: 'many', chords, url, caption: rest };
  return { kind: 'none', url };
}

/* Up to `n` distinct playable shapes, the app's default first. */
export function shapesFor(name, n = 4){
  const seen = new Set(), out = [];
  const add = (f) => { if (!f) return; const k = JSON.stringify(f); if (!seen.has(k)){ seen.add(k); out.push(f); } };
  add(getVoicing(name)?.frets);
  for (const v of voicingCandidates(name)) add(v.frets);
  return out.slice(0, n);
}

const fretsToHz = (frets) => frets.map((f, s) => (f === null || f === undefined) ? null : midiToHz(STRING_OPEN_MIDI[s] + f)).filter(Boolean);
const keyName = () => getAppKey() || 'C';
const toAppKey = (k) => APP_KEYS.find(x => x === k) || APP_KEYS.find(x => sameKey(x, k)) || k;

/* ---- rendering ---------------------------------------------------------- */
function chordHTML(name){
  const p = parseChordName(name.split('/')[0]);
  const key = keyName();
  // spell from the chord's own root: Eb → Eb G Bb, D → D F# A
  const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'], SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const names = p && (/b/.test(p.rootName) || p.rootName === 'F' || (p.intervals[1] === 3 && /^(C|G|D)$/.test(p.rootName))) ? FLAT : SHARP;
  const notes = p ? p.intervals.map(i => names[(p.rootPc + i) % 12]).join(' ') : '';
  const loc = locateChord(name, key);
  const where = !loc ? '' : loc.exact
    ? `<b>${escHtml(loc.roman)}</b> · ${escHtml(FN_LABEL[loc.fn] || '')} — ${loc.view === 'in' ? 'in scale' : loc.view === 'out' ? 'out of scale (chromatic)' : 'parallel key'} in ${escHtml(keyLabel(key))}`
    : `not on the ${escHtml(keyLabel(key))} map — closest column: <b>${escHtml(loc.roman)}</b>`;
  const others = loc && loc.exact && loc.view === 'in' ? [] : keysWithChord(name, 4).filter(k => !sameKey(k, key));
  const shapes = shapesFor(name);
  return `
    <div class="cf-chord-head">
      <div><div class="cf-chord-name">${escHtml(name)}</div><div class="cf-chord-notes">${escHtml(notes)}</div></div>
      <div class="cf-where">${where}${others.length ? `<div class="cf-keys">diatonic in: ${others.map(k =>
        `<button type="button" class="cf-chip" data-action="finder:key" data-key="${escHtml(k)}" data-name="${escHtml(name)}" title="Switch to ${escHtml(keyLabel(k))} and show it on the color map">${escHtml(keyLabel(k))}</button>`).join('')}</div>` : ''}</div>
    </div>
    <div class="cf-shapes">${shapes.length ? shapes.map((f, i) => `
      <button type="button" class="cf-shape" data-action="finder:hear" data-frets="${f.map(v => v ?? 'x').join(',')}" title="Hear this shape">
        ${chordDiagramSVG(f)}<span>${i === 0 ? 'default' : f.filter(v => v > 0).length ? Math.min(...f.filter(v => v > 0)) + 'fr' : 'open'}</span>
      </button>`).join('') : '<div class="cf-empty">No guitar shape in the chord book for this one.</div>'}</div>
    <div class="cf-actions">
      <button type="button" class="btn btn-ghost" data-action="finder:hear" data-name="${escHtml(name)}">▶ Hear</button>
      <button type="button" class="btn btn-ghost" data-action="finder:add" data-name="${escHtml(name)}" title="Append to the active My chords track">+ Add to track</button>
      ${loc ? `<button type="button" class="btn btn-primary" data-action="finder:map" data-name="${escHtml(name)}">Show in color map →</button>` : ''}
    </div>`;
}

function rootHTML(root){
  return `<div class="cf-label">Chords on ${escHtml(root)}</div>
    <div class="cf-suggest">${SUGGEST.map(q => root + q).filter(n => parseChordName(n)).map(n =>
      `<button type="button" class="cf-chip" data-action="finder:pick" data-name="${escHtml(n)}">${escHtml(n)}</button>`).join('')}</div>`;
}

function manyHTML(q){
  const k = inferKey(q.chords);
  const key = k?.key || keyName();
  const romans = toRomans(q.chords, key);
  const meta = q.url ? parseClipUrl(q.url) : null;
  return `
    <div class="cf-label">${q.chords.length} chord${q.chords.length === 1 ? '' : 's'} found${k ? ` · likely key <b>${escHtml(keyLabel(toAppKey(k.key)))}</b> (${Math.round(k.confidence * 100)}%)` : ''}</div>
    <div class="cf-many">${q.chords.slice(0, 24).map((n, i) => {
      const f = getVoicing(n)?.frets;
      return `<button type="button" class="cf-mini" data-action="finder:pick" data-name="${escHtml(n)}" title="Open ${escHtml(n)}">
        <b>${escHtml(n)}</b><span>${escHtml(romans[i] || '')}</span>${f ? chordDiagramSVG(f) : ''}</button>`;
    }).join('')}</div>
    <div class="cf-actions">
      <button type="button" class="btn btn-primary" data-action="finder:track" data-chords="${escHtml(q.chords.join(' '))}" data-caption="${escHtml((q.caption || '').slice(0, 60))}">+ New track from these</button>
      ${k ? `<button type="button" class="btn btn-ghost" data-action="finder:keymap" data-key="${escHtml(toAppKey(k.key))}">Color map in ${escHtml(keyLabel(toAppKey(k.key)))} →</button>` : ''}
      ${meta && meta.platform !== 'other' ? `<button type="button" class="btn btn-ghost" data-action="finder:clip" title="Save the link to your clips with this caption as its notes">⤓ Save link as clip</button>` : ''}
    </div>`;
}

function render(){
  const out = $('cf-results');
  if (!out) return;
  const raw = $('cf-input')?.value;
  const q = readQuery(raw);
  out.dataset.kind = q.kind;
  // a command phrase ("color map in C") can contain chord-looking letters, so
  // commands are checked for everything except a single clean chord name
  const cmds = commandsFor(raw);
  // "color map in C" reads as the chord C too — a whole command phrase wins
  cmdList = q.kind !== 'chord' || cmds.some(c => c.strong) ? cmds : [];
  if (cmds.some(c => c.strong)){ out.innerHTML = commandsHTML(cmdList); return; }
  if (cmdList.length && q.kind !== 'root' && (q.kind !== 'many' || q.chords.length <= 2)){ out.innerHTML = commandsHTML(cmdList); return; }
  if (q.kind === 'many') cmdList = [];
  if (q.kind === 'empty'){
    out.innerHTML = `<div class="cf-hint">Type a chord — <code>F#m7</code>, <code>Bbmaj9</code>, <code>G/B</code> — or a root like <code>D</code> to browse.
      <br>Paste a reel / TikTok caption or a shared link with chords in it to pull them all out.
      <br>Or type a command: <code>new track</code>, <code>color map in E</code>, <code>practice</code>, <code>dark</code>.</div>`;
  } else if (q.kind === 'chord'){
    // a bare root ("Eb") is a chord too — show it, plus the family to pick from
    const root = q.name.match(/^[A-G][#b]?$/);
    out.innerHTML = chordHTML(q.name) + (root ? `<div class="cf-family">${rootHTML(q.name)}</div>` : '');
  }
  else if (q.kind === 'root') out.innerHTML = commandsHTML(cmdList) + rootHTML(q.root);
  else if (q.kind === 'many') out.innerHTML = manyHTML(q);
  else out.innerHTML = `<div class="cf-hint">No chord names in that${q.url ? ' link text' : ''}. Try something like <code>Am7</code> or <code>Cmaj7 - Dm7 - G7</code>.</div>`;
}

/* ---- commands: the finder doubles as a command bar -------------------
   "new track Verse", "color map in E", "key of F#m", "play", "practice",
   "drills", "dark", "tips", "tour", "shortcuts", "clips". A chord name
   always wins ("D" is a chord, not "dark"). */
const nav = (dest) => () => document.querySelector(`.dest[data-dest="${dest}"]`)?.click();
const tn = (sub) => () => window.trainerNav?.(sub);
const clickId = (id) => () => document.getElementById(id)?.click();
const COMMANDS = [
  { words: ['songs', 'song', 'learn', 'import'],       label: 'Go to Songs',           run: nav('songs') },
  { words: ['play', 'workspace', 'study'],             label: 'Go to Play',            run: nav('play') },
  { words: ['my chords', 'chords', 'track'],           label: 'Play → My chords',      run: tn('chords') },
  { words: ['color map', 'colour map', 'map'],         label: 'Play → Color map',      run: tn('colormap') },
  { words: ['practice', 'drills', 'quiz', 'trainer'],  label: 'Practice → Drills',     run: tn('drills') },
  { words: ['create', 'compose', 'generate', 'blend'], label: 'Go to Create',          run: nav('create') },
  { words: ['theme', 'dark', 'light'],                 label: 'Switch light / dark',   run: clickId('theme-btn') },
  { words: ['tips', 'hints', 'help'],                  label: 'Show / hide tips',      run: clickId('tips-btn') },
  { words: ['tour'],                                   label: 'Quick tour',            run: () => document.querySelector('[data-action="tour:start"]')?.click() },
  { words: ['shortcuts', 'keys', 'keyboard'],          label: 'Keyboard shortcuts',    run: () => window.toggleShortcutHelp?.(true) },
  { words: ['clips', 'saved clips', 'videos'],         label: 'Saved clips',           run: clickId('clips-btn') },
];
function commandsFor(raw){
  const t = String(raw || '').trim().toLowerCase();
  if (t.length < 2) return [];
  const out = [];
  // "new track [name]"
  let m = t.match(/^(?:new|add|make)\s+track\s*(.*)$/);
  if (m || 'new track'.startsWith(t)){
    const name = m ? raw.trim().replace(/^\S+\s+track\s*/i, '') : '';
    out.push({ strong: !!m, label: `New track${name ? ` "${name}"` : ''}`, run: () => { trainerNewTrack(name || undefined); window.trainerNav?.('chords'); } });
  }
  // "color map in E" / "key of F#m" / "key Bb minor"
  m = t.match(/^(?:(?:colou?r\s*map|map)\s+(?:in\s+)?|key\s+(?:of\s+)?|in\s+)(.+)$/);
  const k = m && normalizeKeyName(m[1].replace(/\b(\w)/, c => c.toUpperCase()));
  if (k && APP_KEYS.includes(k)) out.push({ strong: true, label: `Color map in ${keyLabel(k)}`, run: () => { syncKey(k, 'finder'); window.trainerNav?.('colormap'); } });
  for (const c of COMMANDS){
    if (c.words.some(w => w.startsWith(t) || t === w)) out.push(c);
  }
  return out.slice(0, 5);
}
let cmdList = [];
function commandsHTML(list){
  if (!list.length) return '';
  return `<div class="cf-label">Commands</div><div class="cf-cmds">${list.map((c, i) =>
    `<button type="button" class="cf-cmd${i === 0 ? ' first' : ''}" data-action="finder:cmd" data-idx="${i}">${escHtml(c.label)}${i === 0 ? ' <kbd>↵</kbd>' : ''}</button>`).join('')}</div>`;
}
function runCommand(i){
  const c = cmdList[i];
  if (!c) return false;
  close();
  setTimeout(() => c.run(), 0);
  return true;
}

/* ---- open / close ---------------------------------------------------- */
function ensure(){
  let el = $('chord-finder');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'chord-finder';
  el.className = 'cf-overlay';
  el.hidden = true;
  el.innerHTML = `
    <div class="cf-panel" role="dialog" aria-modal="true" aria-label="Chord finder">
      <div class="cf-search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <input id="cf-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"
          placeholder="Chord (F#m7) — or paste a caption / link with chords" aria-label="Chord or text with chords" data-on-input="finder:input">
        <button type="button" class="icon-btn" data-action="finder:close" aria-label="Close">✕</button>
      </div>
      <div class="cf-results" id="cf-results" aria-live="polite"></div>
    </div>`;
  el.addEventListener('pointerdown', (e) => { if (e.target === el) close(); });
  document.body.appendChild(el);
  return el;
}

export function openFinder(text = ''){
  const el = ensure();
  lastFocus = document.activeElement;
  el.hidden = false;
  document.body.classList.add('cf-open');
  const input = $('cf-input');
  if (typeof text === 'string' && text) input.value = text;
  render();
  setTimeout(() => { input.focus(); input.select?.(); }, 0);
}
function close(){
  const el = $('chord-finder');
  if (!el || el.hidden) return;
  el.hidden = true;
  document.body.classList.remove('cf-open');
  hideChordPeek();
  lastFocus?.focus?.();
}
export function finderIsOpen(){ return !!$('chord-finder') && !$('chord-finder').hidden; }

function goToMap(name){
  close();
  if (typeof window.trainerNav === 'function') window.trainerNav('colormap');
  // let the map paint, then switch view / scroll / flash / show the shape
  setTimeout(() => revealInColorMap(name), 60);
}

export function initChordFinder(){
  registerActions({
    // chord-card buttons (touch screens): add the shape to the track / keep it
    'peek:track':      (el) => {
      const frets = el.dataset.frets ? el.dataset.frets.split(',').map(v => v === 'x' ? null : +v) : null;
      trainerAddChord(el.dataset.name, frets);
    },
    'peek:keep':       (el) => {
      if (paletteAdd(el.dataset.name)){ redrawPalette(); toast(`✓ Kept ${el.dataset.name} in your shapes`); }
      else toast(`${el.dataset.name} is already in your shapes`);
    },
    'finder:open':     () => openFinder(),
    'finder:openText': (el) => openFinder(el.dataset.text || ''),
    'finder:close':    () => close(),
    'finder:input':    () => render(),
    'finder:cmd':      (el) => runCommand(+el.dataset.idx),
    'finder:pick':     (el) => { const i = $('cf-input'); if (i){ i.value = el.dataset.name; render(); i.focus(); } },
    'finder:hear':     (el) => {
      if (el.dataset.frets){
        const f = el.dataset.frets.split(',').map(v => v === 'x' ? null : +v);
        playChordNow(fretsToHz(f));
      } else {
        const v = colorVoicing(el.dataset.name) || getVoicing(el.dataset.name);
        if (v?.midis?.length) playChordNow(v.midis.map(midiToHz));
      }
    },
    'finder:add':      (el) => { trainerAddChord(el.dataset.name); },
    'finder:map':      (el) => goToMap(el.dataset.name),
    'finder:key':      (el) => { syncKey(el.dataset.key, 'finder'); goToMap(el.dataset.name); },
    'finder:keymap':   (el) => { syncKey(el.dataset.key, 'finder'); close(); if (typeof window.trainerNav === 'function') window.trainerNav('colormap'); },
    'finder:track':    (el) => {
      const chords = el.dataset.chords.split(' ').filter(Boolean);
      const name = (el.dataset.caption || '').replace(/\s+/g, ' ').trim().slice(0, 32) || `Found · ${chords.slice(0, 4).join(' ')}`;
      // stable id per chord list, so making the same track twice updates it instead of duplicating
      const id = 'trk_find_' + chords.join('-').toLowerCase().replace(/[^a-z0-9#-]+/g, '').slice(0, 60);
      trainerUpsertTrack({ id, name, chords: chords.map(n => ({ name: n })) });
      close();
      if (typeof window.trainerNav === 'function') window.trainerNav('chords');
    },
    'finder:clip':     () => {
      const text = $('cf-input')?.value || '';
      const clip = clipsAdd(text, { open: false });
      const b = document.querySelector('[data-action="finder:clip"]');
      if (b) b.textContent = clip ? '✓ Saved to clips' : "Couldn't read that link";
      if (clip) toast('✓ Saved to clips');
    },
  });

  // "/" or Ctrl/⌘ K opens it; Escape closes; Enter on a single chord shows it on the map.
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') || e.target?.isContentEditable;
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)){ e.preventDefault(); finderIsOpen() ? close() : openFinder(); return; }
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); openFinder(); return; }
    if (!finderIsOpen()) return;
    if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && e.target?.id === 'cf-input'){
      const q = readQuery(e.target.value);
      if (cmdList[0]?.strong){ e.preventDefault(); runCommand(0); }
      else if (q.kind === 'chord'){ e.preventDefault(); goToMap(q.name); }
      else if (cmdList.length){ e.preventDefault(); runCommand(0); }
    }
  }, true);
}
