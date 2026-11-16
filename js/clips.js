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
import { chordsIn, splitLinkText } from './chordsheet.js';
import { escHtml } from './util.js';
import { getBPM, setBPM } from './metronome.js';
import { GENRES, MAX_GENRES } from './config.js';
import { store, clearSelected } from './store.js';
import { syncUI } from './library.js';
import { syncKey } from './keysync.js';
import { ALL_KEYS as KEY_OPTIONS } from './theorydata.js';
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

/* Add (or re-open if already saved) the URL in the paste box.
   { open: false } just saves it (the color map's inline player picks
   it up) — no dock pop-out. */
export function clipsAdd(rawUrl, { open = true } = {}){
  const input = $('clip-url');
  const rawText = rawUrl ?? input?.value ?? '';
  // Shared posts arrive as "caption … https://link …": keep the caption as notes.
  const split = parseClipUrl(rawText) ? { url: rawText, rest: '' } : splitLinkText(rawText);
  const raw = split.url || rawText;
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
    if (split.rest) clip.notes = split.rest.slice(0, 500);
    clips.unshift(clip);
    saveList();
  } else if (split.rest && !clip.notes){
    clip.notes = split.rest.slice(0, 500);
    saveList();
  }
  if (open){
    if (input) input.value = '';
    if (status) status.textContent = meta.note || '';
    clipsOpen(clip.id);
  }
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
  } else if (field === 'melody'){
    // the color map's melody box, saved per clip: { text, mode } or null
    const ok = value && typeof value.text === 'string';
    if (ok && value.text.trim()) clip.melody = { text: value.text, mode: value.mode === 'frets' ? 'frets' : 'notes' };
    else delete clip.melody;
  } else if (field === 'loop'){
    // the color map's A–B loop + speed (YouTube): { a, b, on, rate }
    const v = cleanLoop(value);
    if (v) clip.loop = v; else delete clip.loop;
  } else return;
  clip.updatedAt = new Date().toISOString();
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
/* every key the app's pickers can hold (theorydata.ALL_KEYS) */

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
      flash(`Imported ${n} clip${n === 1 ? '' : 's'}${lastImportMerged ? `, updated ${lastImportMerged}` : ''}`);
    } catch { flash('Could not read that file'); }
    inputEl.value = '';
  };
  reader.readAsText(file);
}

function cleanLoop(v){
  if (!v || typeof v !== 'object') return null;
  const n = (x) => (Number.isFinite(+x) && +x >= 0 ? Math.round(+x * 10) / 10 : null);
  const out = { a: n(v.a), b: n(v.b), on: !!v.on, rate: [0.5, 0.75, 0.9, 1].includes(+v.rate) ? +v.rate : 1 };
  return (out.a === null && out.b === null && !out.on && out.rate === 1) ? null : out;
}
function cleanMelody(m){
  return m && typeof m.text === 'string' && m.text.trim() ? { text: m.text, mode: m.mode === 'frets' ? 'frets' : 'notes' } : null;
}

/* Merge by URL. New links are added; for links you already have, empty
   tags are filled in from the incoming copy and its melody / loop win if
   they're newer (or you have none) — nothing is ever deleted, so syncing
   both ways between devices is safe. Returns the count added; the count
   of existing clips that changed is in lastImportMerged. */
export let lastImportMerged = 0;
export function clipsImport(list){
  if (!Array.isArray(list)) throw new Error('bad list');
  let added = 0, merged = 0;
  for (const c of list){
    const meta = parseClipUrl(c?.url);
    if (!meta) continue;
    const have = clips.find(x => x.url === meta.url);
    if (have){
      let changed = false;
      for (const f of ['label', 'key', 'genres', 'notes']){
        if (!have[f] && c[f]){ have[f] = String(c[f]); changed = true; }
      }
      if (!have.bpm && Number.isFinite(+c.bpm) && +c.bpm > 0){ have.bpm = Math.round(+c.bpm); changed = true; }
      const newer = c.updatedAt && (!have.updatedAt || c.updatedAt > have.updatedAt);
      const m = cleanMelody(c.melody), l = cleanLoop(c.loop);
      if (m && (!have.melody || newer) && JSON.stringify(m) !== JSON.stringify(have.melody)){ have.melody = m; changed = true; }
      if (l && (!have.loop || newer) && JSON.stringify(l) !== JSON.stringify(have.loop)){ have.loop = l; changed = true; }
      if (changed){ merged++; if (newer) have.updatedAt = c.updatedAt; }
      continue;
    }
    const clip = {
      id: newId(), url: meta.url, platform: meta.platform, mediaId: meta.id,
      label: String(c.label || defaultLabel(meta)), key: String(c.key || ''),
      bpm: Number.isFinite(+c.bpm) && +c.bpm > 0 ? Math.round(+c.bpm) : null,
      genres: String(c.genres || ''), notes: String(c.notes || ''),
      addedAt: c.addedAt || new Date().toISOString(),
    };
    const m = cleanMelody(c.melody), l = cleanLoop(c.loop);
    if (m) clip.melody = m;
    if (l) clip.loop = l;
    if (c.updatedAt) clip.updatedAt = c.updatedAt;
    clips.push(clip);
    added++;
  }
  lastImportMerged = merged;
  saveList();
  renderList();
  return added;
}

/* ---------------------------------------------------------------
   Sync between devices (PC ⇄ iPhone) — no account, no server:
     • sync link: the whole list packed into a URL (#clips=…). Open it on
       the other device and the clips merge in. Share it however you like
       (AirDrop, Messages to yourself, Notes).
     • share…: the phone's share sheet with that link (Web Share API).
     • copy links: plain URLs, one per line (all, or just Instagram).
     • paste links: drop in a list of URLs (or a sync link) to add them.
   --------------------------------------------------------------- */
const SYNC_PARAM = 'clips=';
function b64urlFromBytes(bytes){
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function bytesFromB64url(s){
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
async function pipeBytes(bytes, stream){
  const buf = await new Response(new Response(bytes).body.pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(buf);
}
function compactList(){ /* short keys keep the link small */
  return clips.map(c => {
    const o = { u: c.url };
    if (c.label) o.l = c.label;
    if (c.key) o.k = c.key;
    if (c.bpm) o.b = c.bpm;
    if (c.genres) o.g = c.genres;
    if (c.notes) o.n = c.notes;
    if (c.melody) o.m = c.melody;
    if (c.loop) o.p = c.loop;
    if (c.addedAt) o.a = c.addedAt;
    if (c.updatedAt) o.t = c.updatedAt;
    return o;
  });
}
function expandList(arr){
  return (Array.isArray(arr) ? arr : []).map(o => ({
    url: o.u, label: o.l, key: o.k, bpm: o.b, genres: o.g, notes: o.n,
    melody: o.m, loop: o.p, addedAt: o.a, updatedAt: o.t,
  }));
}
export async function clipsSyncPayload(){
  const json = JSON.stringify({ v: 1, c: compactList() });
  const bytes = new TextEncoder().encode(json);
  if (typeof CompressionStream === 'function'){
    try { return 'z' + b64urlFromBytes(await pipeBytes(bytes, new CompressionStream('deflate-raw'))); } catch { /* fall through */ }
  }
  return 'j' + b64urlFromBytes(bytes);
}
export async function clipsDecodePayload(payload){
  const kind = payload[0], body = payload.slice(1);
  let bytes = bytesFromB64url(body);
  if (kind === 'z'){
    if (typeof DecompressionStream !== 'function') throw new Error('this browser cannot read compressed sync links');
    bytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
  } else if (kind !== 'j') throw new Error('not a sync link');
  const doc = JSON.parse(new TextDecoder().decode(bytes));
  return expandList(doc.c);
}
function appBase(){
  try { return location.href.split('#')[0]; } catch { return ''; }
}
export async function clipsSyncLink(){
  return `${appBase()}#${SYNC_PARAM}${await clipsSyncPayload()}`;
}
async function copyText(text){
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}
function syncStatus(msg){
  document.querySelectorAll('.clip-sync-status').forEach(el => { el.textContent = msg; });
}
export async function clipsCopySyncLink(){
  if (!clips.length){ syncStatus('No clips to sync yet.'); return; }
  const link = await clipsSyncLink();
  const ok = await copyText(link);
  syncStatus(ok ? `Sync link copied (${clips.length} clip${clips.length === 1 ? '' : 's'}). Open it on your other device — the clips merge in.`
                : 'Could not copy — your browser blocked the clipboard.');
  return link;
}
export async function clipsShareSync(){
  if (!clips.length){ syncStatus('No clips to share yet.'); return; }
  const url = await clipsSyncLink();
  if (navigator.share){
    try { await navigator.share({ title: 'Genre Bender clips', text: `${clips.length} reference clips`, url }); syncStatus('Shared.'); return; }
    catch (e){ if (e && e.name === 'AbortError') return; }
  }
  const ok = await copyText(url);
  syncStatus(ok ? 'Sharing isn\'t available here — the sync link was copied instead.' : 'Could not share or copy.');
}
export async function clipsCopyList(only = ''){
  const list = clips.filter(c => !only || c.platform === only).map(c => c.url);
  if (!list.length){ syncStatus(only ? `No ${PLATFORM_LABEL[only] || only} links saved.` : 'No links saved.'); return; }
  const ok = await copyText(list.join('\n'));
  syncStatus(ok ? `Copied ${list.length} link${list.length === 1 ? '' : 's'}.` : 'Could not copy.');
}
/* Paste box: any number of URLs (one per line, or mixed with text), or a
   sync link. Returns { added, merged }. */
export async function clipsAddMany(text){
  const t = String(text || '');
  const m = t.match(new RegExp('#' + SYNC_PARAM + '([A-Za-z0-9_-]+)'));
  if (m){
    const list = await clipsDecodePayload(m[1]);
    const added = clipsImport(list);
    return { added, merged: lastImportMerged };
  }
  const urls = [...new Set((t.match(/https?:\/\/[^\s<>"']+/g) || []).map(u => u.replace(/[),.;]+$/, '')))];
  const before = clips.length;
  urls.forEach(u => clipsAdd(u, { open: false }));
  return { added: clips.length - before, merged: 0 };
}
export async function clipsPasteFromBox(){
  const box = document.activeElement && document.activeElement.classList.contains('clip-sync-paste')
    ? document.activeElement : document.querySelector('.clip-sync-paste:not(:placeholder-shown)') || document.querySelector('.clip-sync-paste');
  if (!box) return;
  try {
    const r = await clipsAddMany(box.value);
    syncStatus(r.added || r.merged ? `Added ${r.added} clip${r.added === 1 ? '' : 's'}${r.merged ? `, updated ${r.merged}` : ''}.` : 'Nothing new in there.');
    document.querySelectorAll('.clip-sync-paste').forEach(b => { b.value = ''; });
  } catch (e){ syncStatus(`Couldn't read that: ${e.message || e}`); }
}
function safely(fn){
  Promise.resolve().then(fn).catch(e => syncStatus(`Sync didn't work here: ${e && e.message ? e.message : e}`));
}
/* The sync controls, shared by the dock and the color map. */
export function clipsSyncHTML(){
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return `<div class="clip-sync">
    <p class="clip-sync-help">Move clips between devices (iPhone ⇄ PC). Clips merge by link — melodies, loops and tags come along, and nothing is deleted.</p>
    <div class="clip-sync-row">
      <button type="button" class="clip-mini primary" data-action="clips:synclink" title="Copy a link that carries every saved clip — open it on the other device">⧉ copy sync link</button>
      ${canShare ? `<button type="button" class="clip-mini" data-action="clips:share" title="Share the sync link (AirDrop, Messages, Notes…)">⇪ share…</button>` : ''}
      <button type="button" class="clip-mini" data-action="clips:copylist" data-only="instagram" title="Copy every saved Instagram link, one per line">copy Instagram links</button>
      <button type="button" class="clip-mini" data-action="clips:copylist" title="Copy every saved link, one per line">copy all links</button>
    </div>
    <div class="clip-sync-row">
      <textarea class="clip-sync-paste" rows="2" placeholder="Paste links (one per line) or a sync link from your other device"></textarea>
      <button type="button" class="clip-mini primary" data-action="clips:pastemany">add</button>
    </div>
    <div class="clip-sync-status" aria-live="polite"></div>
  </div>`;
}
/* Arriving via a sync link: merge, say so, and tidy the address bar. */
async function importFromHash(){
  let h = '';
  try { h = location.hash || ''; } catch { return; }
  const i = h.indexOf(SYNC_PARAM);
  if (i < 0) return;
  try {
    const list = await clipsDecodePayload(h.slice(i + SYNC_PARAM.length));
    const added = clipsImport(list);
    toast(`Synced clips: ${added} new${lastImportMerged ? `, ${lastImportMerged} updated` : ''} (${list.length} in the link).`);
  } catch (e){
    toast(`That sync link couldn't be read: ${e.message || e}`);
  }
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* file:// etc */ }
}
function toast(msg){
  let el = document.getElementById('gb-toast');
  if (!el){
    el = document.createElement('div');
    el.id = 'gb-toast'; el.className = 'gb-toast'; el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 5000);
}

/* ---------------------------------------------------------------
   Player
   --------------------------------------------------------------- */
export function clipsOpen(id){
  if (frameDetached) clipsReattachDock();
  activeId = id;
  renderPlayer(true);
  renderList();
  expandDock();
}

let lastFrameSrc = null;
let frameDetached = false;      // the color map's inline player is playing instead
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
  if (frameDetached){
    frame.innerHTML = `<div class="clip-empty">Playing inline in the color map.<br>
      <button class="btn btn-ghost" type="button" data-action="clips:reattach">play here instead</button></div>`;
    lastFrameSrc = null;
  } else if (parsed.embedUrl){
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
    ${clipChordsHTML(clip)}
    <div class="clip-actions">
      <button class="clip-mini primary" type="button" data-action="study:open" data-clip="${clip.id}"
        title="Open this clip in the study view: video + color map + My chords + chord library, resizable">⤢ study</button>
      <button class="clip-mini${isRef ? ' on' : ''}" type="button" data-action="clips:seed" data-id="${clip.id}"
        title="Select this clip's genres in the mixer, set its key and BPM, and blend toward it">${isRef ? '✓ seeded' : '⇢ seed mixer'}</button>
      <button class="clip-mini" type="button" data-action="clips:usebpm" data-id="${clip.id}" ${clip.bpm ? '' : 'disabled'}
        title="Push this clip's BPM to the tempo keeper">↑ bpm</button>
      <button class="clip-mini" type="button" data-action="clips:capturebpm" data-id="${clip.id}"
        title="Tap tempo along with the clip, then capture the metronome's BPM here">↓ bpm</button>
      <a class="clip-mini" href="${escHtml(clip.url)}" target="_blank" rel="noopener noreferrer" title="Open on the platform">↗</a>
      <button class="clip-mini danger" type="button" data-action="clips:remove" data-id="${clip.id}" title="Remove from saved clips">✕</button>
    </div>`;
}

/* Chords named in the clip's label / caption → tappable chips (shape on tap)
   and a shortcut into the chord finder. */
function clipChordsHTML(clip){
  const found = chordsIn(`${clip.label || ''} ${clip.notes || ''}`);
  if (!found.length) return '';
  return `<div class="clip-chords" aria-label="Chords in this clip">
    ${found.slice(0, 12).map(n => `<button type="button" class="clip-cchip" data-action="cm:peek" data-name="${escHtml(n)}" title="Hear ${escHtml(n)} and see its shape">${escHtml(n)}</button>`).join('')}
    <button type="button" class="clip-mini" data-action="finder:openText" data-text="${escHtml(found.join(' '))}" title="Open in the chord finder: diagrams, key, make a track">🔎 chords</button>
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
      <span class="clip-item-tags">${[c.key, c.bpm ? c.bpm + ' bpm' : '', c.genres, chordsIn(`${c.label} ${c.notes}`).slice(0, 4).join(' ')].filter(Boolean).map(escHtml).join(' · ')}</span>
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
function effectiveMode(){ return 'floating'; }   // no side rail any more: the player always floats

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
    const canDock = false;
    modeBtn.style.display = canDock ? '' : 'none';
    modeBtn.textContent = dockState.mode === 'docked' ? '⇱' : '⇲';
    modeBtn.title = dockState.mode === 'docked' ? 'Float the player' : 'Dock the player in the rail';
  }
}

/* The color map plays a clip inline: unload the dock's iframe (so two
   players never run at once) and get the pop-out out of the way.
   Opening a clip in the dock again re-attaches it. */
export function clipsDetachDock(){
  frameDetached = true;
  renderPlayer(true);
  if (effectiveMode() === 'floating') dockState.open = false;
  else dockState.collapsed = true;
  saveDock(); applyDock();
}
export function clipsReattachDock(){
  if (!frameDetached) return;
  frameDetached = false;
  renderPlayer(true);
  detachListeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
}
const detachListeners = new Set();
/* The inline player listens so it can stop when the dock takes over. */
export function onDockReattach(fn){ detachListeners.add(fn); }

/* Pasting a link anywhere normally opens the dock; a view that has its
   own player (the color map) can claim the paste instead. */
let pasteRoute = null;
export function setClipPasteRoute(fn){ pasteRoute = typeof fn === 'function' ? fn : null; }
/* When no view claims the paste: the study view opens with it (else the dock). */
let pasteFallback = null;
export function setClipPasteFallback(fn){ pasteFallback = typeof fn === 'function' ? fn : null; }

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
    const meta = parseClipUrl(text) || parseClipUrl(splitLinkText(text).url);
    if (meta && meta.platform !== 'other'){
      e.preventDefault();
      if (pasteRoute && pasteRoute(text)) return;
      if (pasteFallback && pasteFallback(text)) return;
      clipsAdd(text);
    }
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
    'clips:reattach':   () => clipsReattachDock(),
    'clips:synclink':   () => safely(clipsCopySyncLink),
    'clips:share':      () => safely(clipsShareSync),
    'clips:copylist':   (el) => safely(() => clipsCopyList(el.dataset.only || '')),
    'clips:pastemany':  () => safely(clipsPasteFromBox),
    'clips:synctoggle': () => { const p = $('clip-sync-dock'); if (p){ p.hidden = !p.hidden; if (!p.hidden) p.innerHTML = clipsSyncHTML(); } },
    'clips:import':     (el) => clipsImportFile(el),
  });
  loadList();
  loadDock();
  applyDock();
  renderList();
  renderPlayer();
  initDrag();
  initGlobalPaste();
  importFromHash();
  window.addEventListener('hashchange', importFromHash);
  window.addEventListener('resize', applyDock);
  try { window.matchMedia?.(WIDE)?.addEventListener?.('change', applyDock); } catch {}
}
