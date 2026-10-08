/* ============================================================
   clips.js — reference clips dock.

   Paste a link (X/Twitter, Instagram post/reel, TikTok, YouTube
   incl. Shorts) and it opens in a floating dock that stays
   mounted while you move between tabs — metronome, loopers and
   sequencers keep running underneath. Saved clips live in
   localStorage with an editable label plus key / BPM / genre
   tags, and the whole list can be exported / imported as JSON.

   Why embeds, not a raw iframe: every one of these platforms
   blocks their normal pages from loading inside a frame
   (X-Frame-Options / CSP). Each does publish an official embed
   endpoint, so parseClipUrl() maps a pasted URL onto that. Links
   we can't map still save; they just open in a new tab.

   The dock is the first step toward "clip as input": a saved
   clip carries the BPM you tapped against it and the genres you
   heard, so later features (seeding the mixer from a clip,
   feeding tags to the AI, analysing a clip) already have the
   data shape they need.

   "Seed mixer" closes the loop: a clip's genre tags become the
   mixer selection, its key becomes the app key, its BPM the tempo,
   and store.reference tells blend.js what to blend toward.

   Handlers are registered with actions.js (data-action markup),
   not the window bridge. The dock has two modes — docked in the
   left rail (default on wide screens) or floating — and is forced
   floating on narrow viewports where the rail stacks.
   ============================================================ */
import { escHtml } from './util.js';
import { getBPM, setBPM } from './metronome.js';
import { GENRES, MAX_GENRES } from './config.js';
import { store, clearSelected } from './store.js';
import { syncUI } from './library.js';
import { syncKey } from './keysync.js';
import { switchTab } from './ui.js';
import { registerActions } from './actions.js';
import { registerStore, loadJSON, saveJSON, downloadJSON } from './storage.js';

const LIST_KEY = registerStore('clips', 'GenreBenderClips_v1');
const DOCK_KEY = registerStore('clipDock', 'GenreBenderClipDock_v1');
const WIDE = '(min-width: 1180px)';

const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------
   URL → embed mapping. Pure function; unit-checked in
   build/verify-clips.mjs.
   --------------------------------------------------------------- */
export function parseClipUrl(raw){
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.replace(/^(www|m|mobile)\./, '').toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  const base = { url: url.href, embedUrl: null, aspect: 'card', note: '' };

  /* X / Twitter: /<user>/status/<id> */
  if (host === 'twitter.com' || host === 'x.com'){
    const i = parts.indexOf('status');
    const id = i !== -1 ? (parts[i + 1] || '').match(/^\d+/)?.[0] : null;
    if (id) return { ...base, platform: 'x', id,
      embedUrl: `https://platform.twitter.com/embed/Tweet.html?id=${id}&theme=dark&dnt=true&hideThread=true` };
    return { ...base, platform: 'x', id: null, note: 'Not a post link — open externally.' };
  }

  /* Instagram: /p|reel|reels|tv/<code> (optionally prefixed with /<user>) */
  if (host === 'instagram.com'){
    const i = parts.findIndex(p => ['p', 'reel', 'reels', 'tv'].includes(p));
    const code = i !== -1 ? parts[i + 1] : null;
    if (code && /^[\w-]+$/.test(code)){
      const kind = parts[i] === 'p' ? 'p' : 'reel';
      return { ...base, platform: 'instagram', id: code,
        aspect: kind === 'reel' ? 'portrait' : 'card',
        embedUrl: `https://www.instagram.com/${kind}/${code}/embed/` };
    }
    return { ...base, platform: 'instagram', id: null, note: 'Not a post/reel link — open externally.' };
  }

  /* TikTok: /@user/video/<id>  (vm.tiktok.com short links can't be
     resolved from the browser — they open externally) */
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')){
    const i = parts.indexOf('video');
    const id = i !== -1 ? (parts[i + 1] || '').match(/^\d+/)?.[0] : null;
    if (id) return { ...base, platform: 'tiktok', id, aspect: 'portrait',
      embedUrl: `https://www.tiktok.com/embed/v2/${id}` };
    return { ...base, platform: 'tiktok', id: null,
      note: 'Short link — paste the full tiktok.com/@user/video/… URL to embed.' };
  }

  /* YouTube: watch?v=, youtu.be/<id>, /shorts/<id>, /embed/<id> */
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com'){
    let id = null, shorts = false;
    if (host === 'youtu.be') id = parts[0];
    else if (parts[0] === 'shorts'){ id = parts[1]; shorts = true; }
    else if (parts[0] === 'embed') id = parts[1];
    else id = url.searchParams.get('v');
    if (id && /^[\w-]{6,}$/.test(id)){
      const t = url.searchParams.get('t');
      const start = t ? `&start=${parseInt(t, 10) || 0}` : '';
      return { ...base, platform: 'youtube', id, aspect: shorts ? 'portrait' : 'landscape',
        embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0${start}` };
    }
    return { ...base, platform: 'youtube', id: null, note: 'Not a video link — open externally.' };
  }

  return { ...base, platform: 'other', id: null, note: 'Unknown site — opens in a new tab.' };
}

export const PLATFORM_LABEL = {
  x: 'X', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', other: 'Link',
};

/* ---------------------------------------------------------------
   Saved list
   --------------------------------------------------------------- */
let clips = [];
let activeId = null;

function loadList(){
  const s = loadJSON(LIST_KEY, null, { version: 1 });
  clips = Array.isArray(s?.clips) ? s.clips.filter(c => c && c.url) : [];
}
const listeners = new Set();
/* Subscribe to list changes (analyze.js keeps its clip picker in sync). */
export function onClipsChange(fn){ listeners.add(fn); return () => listeners.delete(fn); }
function saveList(){
  saveJSON(LIST_KEY, { v: 1, clips });
  listeners.forEach(fn => { try { fn(getClips()); } catch (e) { console.error(e); } });
}
export function getClips(){ return clips.slice(); }
export function getClip(id){ return clips.find(c => c.id === id) || null; }
export function getActiveClip(){ return getClip(activeId); }

function newId(){ return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function defaultLabel(meta){
  const p = PLATFORM_LABEL[meta.platform] || 'Link';
  if (meta.id) return `${p} · ${meta.id.length > 14 ? meta.id.slice(0, 14) + '…' : meta.id}`;
  try { return `${p} · ${new URL(meta.url).hostname}`; } catch { return p; }
}

/* Add (or re-open if already saved) the URL in the paste box. */
export function clipsAdd(rawUrl){
  const input = $('clip-url');
  const raw = rawUrl ?? input?.value ?? '';
  const meta = parseClipUrl(raw);
  const status = $('clip-status');
  if (!meta){
    if (status) status.textContent = 'That doesn\'t look like a link.';
    return null;
  }
  let clip = clips.find(c => c.url === meta.url);
  if (!clip){
    clip = {
      id: newId(), url: meta.url, platform: meta.platform, mediaId: meta.id,
      label: defaultLabel(meta), key: '', bpm: null, genres: '',
      notes: '', addedAt: new Date().toISOString(),
    };
    clips.unshift(clip);
    saveList();
  }
  if (input) input.value = '';
  if (status) status.textContent = meta.note || '';
  clipsOpen(clip.id);
  renderList();
  return clip;
}

export function clipsRemove(id){
  clips = clips.filter(c => c.id !== id);
  saveList();
  if (activeId === id){ activeId = null; renderPlayer(); }
  renderList();
}

/* Edit one field on a saved clip (label / key / bpm / genres / notes). */
export function clipsUpdate(id, field, value){
  const clip = clips.find(c => c.id === id);
  if (!clip) return;
  if (field === 'bpm'){
    const n = parseInt(value, 10);
    clip.bpm = Number.isFinite(n) ? Math.max(20, Math.min(300, n)) : null;
  } else if (['label', 'key', 'genres', 'notes'].includes(field)){
    clip[field] = String(value ?? '').trim();
  } else return;
  saveList();
  if (id === activeId) renderPlayer(false);
  renderList();
}

/* Tempo hand-off: push the clip's saved BPM to the tempo keeper, or
   grab whatever the tempo keeper says (tap along, then capture). */
export function clipsUseBpm(id){
  const clip = clips.find(c => c.id === id);
  if (!clip?.bpm) return;
  const slider = $('bpm-slider');
  if (slider) slider.value = clip.bpm;
  setBPM(clip.bpm);
  flash(`Tempo set to ${clip.bpm} BPM`);
}
export function clipsCaptureBpm(id){
  const clip = clips.find(c => c.id === id);
  if (!clip) return;
  clip.bpm = getBPM();
  saveList();
  renderPlayer(false);
  renderList();
  flash(`Saved ${clip.bpm} BPM to clip`);
}

/* ---------------------------------------------------------------
   Seed the mixer from a clip — the "clip as input" hand-off.
   --------------------------------------------------------------- */
const ALL_GENRES = Object.values(GENRES).flatMap(c => c.genres);
const KEY_OPTIONS = ['Am','Em','Dm','Cm','Gm','A','C','D','E','G'];

/* "phonk, jersey club; lo-fi" → matching catalog names, in order. */
export function matchGenres(text){
  const wanted = String(text || '').split(/[,;/\n]+/).map(t => t.trim().toLowerCase()).filter(Boolean);
  const out = [];
  for (const w of wanted){
    const norm = w.replace(/[^a-z0-9&]+/g, '');
    const hit = ALL_GENRES.find(g => g.toLowerCase() === w)
      || ALL_GENRES.find(g => g.toLowerCase().replace(/[^a-z0-9&]+/g, '') === norm)
      || ALL_GENRES.find(g => g.toLowerCase().includes(w) || w.includes(g.toLowerCase()));
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

/* "A minor" / "a min" / "Am" → "Am"; "C major" / "C" → "C". null if not in the app's 10 keys. */
export function normalizeKey(text){
  const t = String(text || '').trim();
  if (!t) return null;
  const m = t.match(/^([A-Ga-g])\s*(#|b)?\s*(m(?:in(?:or)?)?|maj(?:or)?|-)?\.?$/i);
  if (!m) return null;
  const root = m[1].toUpperCase() + (m[2] || '');
  const minor = !!m[3] && (m[3] === '-' || /^m(in(or)?)?$/i.test(m[3]));
  const key = root + (minor ? 'm' : '');
  return KEY_OPTIONS.includes(key) ? key : null;
}

export function clipsSeedMixer(id){
  const clip = getClip(id);
  if (!clip) return;
  const genres = matchGenres(clip.genres).slice(0, MAX_GENRES);
  const key = normalizeKey(clip.key);

  if (genres.length){
    clearSelected();
    document.querySelectorAll('.chip.selected').forEach(c => {
      c.classList.remove('selected'); c.setAttribute('aria-pressed', 'false'); delete c.dataset.idx;
    });
    const ratio = Math.round(100 / genres.length);
    genres.forEach((g, i) => {
      store.selected.push({ name: g, ratio });
      const chip = document.querySelector(`.chip[data-genre="${CSS.escape(g)}"]`);
      if (chip){ chip.classList.add('selected'); chip.setAttribute('aria-pressed', 'true'); chip.dataset.idx = i + 1; }
    });
  }
  if (key) syncKey(key, null);
  if (clip.bpm){
    const slider = $('bpm-slider');
    if (slider) slider.value = clip.bpm;
    setBPM(clip.bpm);
  }
  store.reference = {
    clipId: clip.id, label: clip.label, url: clip.url, platform: clip.platform,
    key: key || clip.key || '', bpm: clip.bpm || null, genres: clip.genres || '', notes: clip.notes || '',
  };
  syncUI();            // repaints selected bar, sliders, rail
  renderPlayer(false);
  switchTab('mixer');
  const parts = [];
  if (genres.length) parts.push(`${genres.length} genre${genres.length === 1 ? '' : 's'}`);
  if (key) parts.push(key);
  if (clip.bpm) parts.push(`${clip.bpm} bpm`);
  flash(parts.length ? `Seeded mixer: ${parts.join(' · ')}` : 'Blending toward this clip (add genre tags to select chips)');
  const unmatched = String(clip.genres || '').split(/[,;/\n]+/).map(t => t.trim()).filter(Boolean).length - genres.length;
  if (unmatched > 0) setTimeout(() => flash(`${unmatched} tag${unmatched === 1 ? '' : 's'} didn't match a catalog genre`), 2300);
}

export function clipsClearReference(){
  store.reference = null;
  syncUI();
  renderPlayer(false);
}

/* ---------------------------------------------------------------
   Export / import
   --------------------------------------------------------------- */
export function clipsExport(){
  downloadJSON({ v: 1, exportedAt: new Date().toISOString(), clips },
    `genre-bender-clips-${new Date().toISOString().slice(0, 10)}.json`);
}

export function clipsImportFile(inputEl){
  const file = inputEl?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const incoming = Array.isArray(data) ? data : data?.clips;
      const n = clipsImport(incoming);
      flash(`Imported ${n} clip${n === 1 ? '' : 's'}`);
    } catch { flash('Could not read that file'); }
    inputEl.value = '';
  };
  reader.readAsText(file);
}

/* Merge by URL — existing clips keep their tags. Returns count added. */
export function clipsImport(list){
  if (!Array.isArray(list)) throw new Error('bad list');
  let added = 0;
  for (const c of list){
    const meta = parseClipUrl(c?.url);
    if (!meta || clips.some(x => x.url === meta.url)) continue;
    clips.push({
      id: newId(), url: meta.url, platform: meta.platform, mediaId: meta.id,
      label: String(c.label || defaultLabel(meta)), key: String(c.key || ''),
      bpm: Number.isFinite(+c.bpm) && +c.bpm > 0 ? Math.round(+c.bpm) : null,
      genres: String(c.genres || ''), notes: String(c.notes || ''),
      addedAt: c.addedAt || new Date().toISOString(),
    });
    added++;
  }
  saveList();
  renderList();
  return added;
}

/* ---------------------------------------------------------------
   Player
   --------------------------------------------------------------- */
export function clipsOpen(id){
  activeId = id;
  renderPlayer(true);
  renderList();
  expandDock();
}

let lastFrameSrc = null;
function renderPlayer(reloadFrame = true){
  const frame = $('clip-frame');
  const meta  = $('clip-meta');
  if (!frame || !meta) return;
  const clip = clips.find(c => c.id === activeId);
  if (!clip){
    frame.innerHTML = '<div class="clip-empty">Paste a link above to open it here.<br><span>X · Instagram · TikTok · YouTube</span></div>';
    meta.innerHTML = '';
    lastFrameSrc = null;
    return;
  }
  const parsed = parseClipUrl(clip.url) || { embedUrl: null, aspect: 'card', note: '' };
  frame.dataset.aspect = parsed.aspect;
  if (parsed.embedUrl){
    if (reloadFrame && lastFrameSrc !== parsed.embedUrl){
      frame.innerHTML = `<iframe src="${escHtml(parsed.embedUrl)}" title="${escHtml(clip.label)}"
        allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
        allowfullscreen referrerpolicy="strict-origin-when-cross-origin" loading="eager"></iframe>`;
      lastFrameSrc = parsed.embedUrl;
    }
  } else {
    lastFrameSrc = null;
    frame.innerHTML = `<div class="clip-empty">${escHtml(parsed.note || 'This link can\'t be embedded.')}<br>
      <a class="btn btn-ghost" href="${escHtml(clip.url)}" target="_blank" rel="noopener noreferrer">Open in new tab ↗</a></div>`;
  }
  const q = (v) => escHtml(v ?? '');
  const isRef = store.reference?.clipId === clip.id;
  meta.innerHTML = `
    <input class="clip-label" value="${q(clip.label)}" aria-label="Clip label"
      data-on-change="clips:update" data-id="${clip.id}" data-field="label">
    <div class="clip-tags">
      <label>key<input value="${q(clip.key)}" placeholder="Am" maxlength="8"
        data-on-change="clips:update" data-id="${clip.id}" data-field="key"></label>
      <label>bpm<input type="number" min="20" max="300" value="${clip.bpm ?? ''}" placeholder="—"
        data-on-change="clips:update" data-id="${clip.id}" data-field="bpm"></label>
      <label class="wide">genres<input value="${q(clip.genres)}" placeholder="phonk, jersey club"
        data-on-change="clips:update" data-id="${clip.id}" data-field="genres"></label>
    </div>
    <input class="clip-notes" value="${q(clip.notes)}" placeholder="caption / what you hear (feeds Analyze)"
      aria-label="Clip notes" data-on-change="clips:update" data-id="${clip.id}" data-field="notes">
    <div class="clip-actions">
      <button class="clip-mini primary${isRef ? ' on' : ''}" type="button" data-action="clips:seed" data-id="${clip.id}"
        title="Select this clip's genres in the mixer, set its key and BPM, and blend toward it">${isRef ? '✓ seeded' : '⇢ seed mixer'}</button>
      <button class="clip-mini" type="button" data-action="clips:usebpm" data-id="${clip.id}" ${clip.bpm ? '' : 'disabled'}
        title="Push this clip's BPM to the tempo keeper">↑ bpm</button>
      <button class="clip-mini" type="button" data-action="clips:capturebpm" data-id="${clip.id}"
        title="Tap tempo along with the clip, then capture the metronome's BPM here">↓ bpm</button>
      <a class="clip-mini" href="${escHtml(clip.url)}" target="_blank" rel="noopener noreferrer" title="Open on the platform">↗</a>
      <button class="clip-mini danger" type="button" data-action="clips:remove" data-id="${clip.id}" title="Remove from saved clips">✕</button>
    </div>`;
}

function renderList(){
  const el = $('clip-list');
  const count = $('clip-count');
  if (count) count.textContent = clips.length ? `${clips.length} saved` : '';
  if (!el) return;
  if (!clips.length){
    el.innerHTML = '<div class="clip-list-empty">No saved clips yet.</div>';
    return;
  }
  el.innerHTML = clips.map(c => `
    <button type="button" class="clip-item${c.id === activeId ? ' active' : ''}" data-action="clips:open" data-id="${c.id}" title="${escHtml(c.url)}">
      <span class="clip-badge ${c.platform}">${escHtml(PLATFORM_LABEL[c.platform] || 'Link')}</span>
      <span class="clip-item-label">${escHtml(c.label)}</span>
      <span class="clip-item-tags">${[c.key, c.bpm ? c.bpm + ' bpm' : '', c.genres].filter(Boolean).map(escHtml).join(' · ')}</span>
    </button>`).join('');
}

/* ---------------------------------------------------------------
   Dock: show / collapse / drag / remember position
   --------------------------------------------------------------- */
let dockState = { mode: 'docked', open: false, collapsed: false, x: null, y: null, w: null, h: null };

function loadDock(){ Object.assign(dockState, loadJSON(DOCK_KEY, {}) || {}); }
function saveDock(){ saveJSON(DOCK_KEY, dockState); }

function isWide(){
  try { return !!(window.matchMedia && window.matchMedia(WIDE).matches); } catch { return false; }
}
/* Docked only makes sense while the rail is beside the content. */
function effectiveMode(){ return isWide() && dockState.mode === 'docked' ? 'docked' : 'floating'; }

function applyDock(){
  const dock = $('clip-dock');
  const btn  = $('clips-btn');
  const modeBtn = $('clip-mode-btn');
  if (!dock) return;
  const mode = effectiveMode();
  dock.classList.toggle('floating', mode === 'floating');
  dock.classList.toggle('docked',   mode === 'docked');
  dock.classList.toggle('collapsed', !!dockState.collapsed);
  if (mode === 'floating'){
    dock.classList.toggle('closed', !dockState.open);
    if (dockState.w && !dockState.collapsed){ dock.style.width = dockState.w + 'px'; dock.style.height = dockState.h + 'px'; }
    else { dock.style.width = ''; dock.style.height = ''; }
    if (dockState.x != null){
      const maxX = Math.max(0, window.innerWidth  - 120);
      const maxY = Math.max(0, window.innerHeight - 40);
      dock.style.left = Math.min(Math.max(0, dockState.x), maxX) + 'px';
      dock.style.top  = Math.min(Math.max(0, dockState.y), maxY) + 'px';
      dock.style.right = 'auto'; dock.style.bottom = 'auto';
    }
  } else {
    dock.classList.remove('closed');
    dock.style.cssText = '';
  }
  if (btn) btn.setAttribute('aria-pressed', String(mode === 'docked' ? !dockState.collapsed : !!dockState.open));
  if (modeBtn){
    const canDock = isWide();
    modeBtn.style.display = canDock ? '' : 'none';
    modeBtn.textContent = dockState.mode === 'docked' ? '⇱' : '⇲';
    modeBtn.title = dockState.mode === 'docked' ? 'Float the player' : 'Dock the player in the rail';
  }
}

/* Header "▶ clips" button: opens/closes when floating, expands/collapses when docked. */
export function clipsToggleDock(){
  if (effectiveMode() === 'docked'){
    dockState.collapsed = !dockState.collapsed;
  } else {
    dockState.open = !dockState.open;
    if (dockState.open) dockState.collapsed = false;
  }
  saveDock(); applyDock();
  if (!dockState.collapsed) setTimeout(() => $('clip-url')?.focus(), 50);
}
export function clipsCollapse(){
  dockState.collapsed = !dockState.collapsed;
  saveDock(); applyDock();
}
export function clipsToggleMode(){
  dockState.mode = dockState.mode === 'docked' ? 'floating' : 'docked';
  if (dockState.mode === 'floating') dockState.open = true;
  dockState.collapsed = false;
  saveDock(); applyDock();
}
function expandDock(){
  dockState.open = true; dockState.collapsed = false;
  saveDock(); applyDock();
}

function initDrag(){
  const dock = $('clip-dock');
  const grip = $('clip-drag');
  if (!dock || !grip) return;
  let sx, sy, ox, oy, dragging = false;
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (effectiveMode() === 'docked') return;
    if (e.target.closest('button')) return;
    dragging = true;
    const r = dock.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    grip.setPointerCapture(e.pointerId);
    dock.classList.add('dragging');
  });
  grip.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dockState.x = ox + (e.clientX - sx);
    dockState.y = oy + (e.clientY - sy);
    applyDock();
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    dock.classList.remove('dragging');
    try { grip.releasePointerCapture(e.pointerId); } catch {}
    saveDock();
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);

  /* remember a manual resize (CSS resize: both) */
  if ('ResizeObserver' in window){
    let first = true;
    new ResizeObserver(() => {
      if (first){ first = false; return; }
      if (dockState.collapsed || effectiveMode() !== 'floating' || dock.classList.contains('closed')) return;
      const r = dock.getBoundingClientRect();
      if (r.width < 200) return;
      dockState.w = Math.round(r.width); dockState.h = Math.round(r.height);
      saveDock();
    }).observe(dock);
  }
}

/* Paste anywhere on the page (outside an input) with a recognised link
   → straight into the dock. */
function initGlobalPaste(){
  document.addEventListener('paste', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const text = e.clipboardData?.getData('text') || '';
    const meta = parseClipUrl(text);
    if (meta && meta.platform !== 'other'){ e.preventDefault(); clipsAdd(text); }
  });
}

let flashTimer;
function flash(msg){
  const s = $('clip-status');
  if (!s) return;
  s.textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { s.textContent = ''; }, 2200);
}

export function initClips(){
  registerActions({
    'clips:toggle':     () => clipsToggleDock(),
    'clips:collapse':   () => clipsCollapse(),
    'clips:mode':       () => clipsToggleMode(),
    'clips:add':        () => clipsAdd(),
    'clips:add-enter':  (el, e) => { e.preventDefault(); clipsAdd(); },
    'clips:open':       (el) => clipsOpen(el.dataset.id),
    'clips:remove':     (el) => clipsRemove(el.dataset.id),
    'clips:update':     (el) => clipsUpdate(el.dataset.id, el.dataset.field, el.value),
    'clips:seed':       (el) => clipsSeedMixer(el.dataset.id),
    'clips:clear-ref':  () => clipsClearReference(),
    'clips:usebpm':     (el) => clipsUseBpm(el.dataset.id),
    'clips:capturebpm': (el) => clipsCaptureBpm(el.dataset.id),
    'clips:export':     () => clipsExport(),
    'clips:import':     (el) => clipsImportFile(el),
  });
  loadList();
  loadDock();
  applyDock();
  renderList();
  renderPlayer();
  initDrag();
  initGlobalPaste();
  window.addEventListener('resize', applyDock);
  try { window.matchMedia?.(WIDE)?.addEventListener?.('change', applyDock); } catch {}
}
