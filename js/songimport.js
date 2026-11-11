/* ============================================================
   songimport.js — "Learn a song" panel (03 — Analyze Track).

   "I want to learn that song" → a saved unit (BPM, key, color-map
   key, closest chord progression) and a prefilled My chords track.
   Three evidence paths, all optional, merged by songunit.js:

     1. Paste a chord sheet      → chordsheet.analyzeSheet   (local)
     2. Look up title/artist     → SONGMETA_ENDPOINT          (server fn)
     3. Analyze audio            → audioanalysis.analyzeAudio (local)
        - an audio/video file you pick (works on iPhone too:
          screen-record the clip, then choose the recording)
        - or capture a playing tab's audio (desktop Chrome/Edge)
     + tap tempo                 → whatever the tempo keeper says

   Saving is idempotent: the unit id comes from title/artist (or the
   linked clip), so saving again updates the same unit and the same
   track. Raw pasted text (which usually includes lyrics) is never
   stored — only the extracted chords.
   ============================================================ */
import { registerActions } from './actions.js';
import { registerStore, loadJSON, saveJSON } from './storage.js';
import { escHtml } from './util.js';
import { SONGMETA_ENDPOINT } from './config.js';
import { analyzeSheet, toRomans, normalizeKeyName, sameKey, relativeKey } from './chordsheet.js';
import { analyzeAudio } from './audioanalysis.js';
import { resolveKey, resolveBpm, buildUnit, progressionOptions, unitId, SOURCE_LABEL } from './songunit.js';
import { getBPM, setBPM } from './metronome.js';
import { syncKey } from './keysync.js';
import { getClips, getClip, onClipsChange, clipsUpdate } from './clips.js';
import { trainerUpsertTrack } from './trainer.js';
import { trainerNav } from './trainernav.js';
import { ALL_KEYS as APP_KEYS } from './theorydata.js';
import { getCtx } from './audio.js';

const $ = (id) => document.getElementById(id);
const UNITS_KEY = registerStore('songUnits', 'GenreBenderSongUnits_v1');

let units = [];
const state = {
  sheet: null,          // analyzeSheet() result
  meta: null,           // lookup result
  metaError: '',
  audio: null,          // analyzeAudio() result
  audioLabel: '',
  tapBpm: null,
  manualKey: null,
  manualBpm: null,
  choice: null,         // progression option id
  loaded: null,         // a saved unit being revisited
  busy: '',
};

/* ---- persistence -------------------------------------------------- */
function loadUnits(){
  const s = loadJSON(UNITS_KEY, null, { version: 1 });
  units = Array.isArray(s?.units) ? s.units.filter(u => u && u.id) : [];
}
function saveUnits(){ saveJSON(UNITS_KEY, { v: 1, units }); }
export function getUnits(){ return units.slice(); }

/* ---- evidence → resolved fields ---------------------------------- */
function audioKeySource(){
  const a = state.audio;
  if (!a) return null;
  const chroma = a.key, chordK = a.chords?.key;
  // The chroma profile and the chord-sketch key aren't independent, so
  // they count as one source. When they're relatives, the chord sketch's
  // tonic heuristics (first/last/most-played chord) pick major vs minor.
  if (chordK && sameKey(relativeKey(chordK.key), chroma.key))
    return { key: chordK.key, confidence: Math.min(chroma.confidence, 0.75), source: 'audio' };
  return { key: chroma.key, confidence: chroma.confidence * 0.9, source: 'audio' };
}

function resolved(){
  const L = state.loaded;
  const keySrc = [
    state.manualKey && { key: state.manualKey, confidence: 1, source: 'manual' },
    state.sheet?.key && { key: state.sheet.key.key, confidence: state.sheet.key.confidence, source: 'sheet' },
    state.meta?.found && state.meta.key && { key: state.meta.key, confidence: 0.7, source: 'meta' },
    audioKeySource(),
    !state.sheet && !state.meta && !state.audio && L?.key && { key: L.key.value, confidence: L.key.confidence, source: L.key.source },
  ].filter(Boolean);
  const bpmSrc = [
    state.manualBpm && { bpm: state.manualBpm, confidence: 1, source: 'manual' },
    state.meta?.found && state.meta.bpm && { bpm: state.meta.bpm, confidence: 0.8, source: 'meta' },
    state.audio?.bpm && { bpm: state.audio.bpm.bpm, confidence: state.audio.bpm.confidence * 0.9, source: 'audio' },
    state.tapBpm && { bpm: state.tapBpm, confidence: 0.85, source: 'tap' },
    !state.meta && !state.audio && !state.tapBpm && L?.bpm && { bpm: L.bpm.value, confidence: L.bpm.confidence, source: L.bpm.source },
  ].filter(Boolean);
  return { key: resolveKey(keySrc), bpm: resolveBpm(bpmSrc) };
}

function options(){
  const opts = progressionOptions({ sheet: state.sheet, audio: state.audio });
  if (!opts.length && state.loaded?.progression?.length){
    opts.push({ id: 'saved', label: state.loaded.progressionFrom?.label || 'Saved progression', chords: state.loaded.progression, source: state.loaded.progressionFrom?.source || 'sheet' });
  }
  return opts;
}

/* ---- form helpers -------------------------------------------------- */
const formTitle = () => ($('song-title')?.value || '').trim();
const formArtist = () => ($('song-artist')?.value || '').trim();
const formClip = () => $('song-clip')?.value || '';

function status(msg, tone = ''){
  const s = $('song-status');
  if (!s) return;
  s.textContent = msg || '';
  s.dataset.tone = tone;
}

function renderClipPicker(){
  const sel = $('song-clip');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— no clip —</option>' +
    getClips().map(c => `<option value="${escHtml(c.id)}">${escHtml(c.label)}</option>`).join('');
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

/* ---- path 1: paste ------------------------------------------------- */
function parseSheet(){
  const text = $('song-sheet')?.value || '';
  if (!text.trim()){ status('Paste a chord sheet first.', 'warn'); return; }
  const r = analyzeSheet(text);
  if (!r.chords.length){
    state.sheet = null;
    status('No chord symbols found. Chords need to be on their own lines (or in [brackets]).', 'warn');
  } else {
    state.sheet = r;
    state.choice = null;
    status(`Found ${r.chords.length} chords in ${r.sections.length} section${r.sections.length === 1 ? '' : 's'}.`);
  }
  render();
}

/* ---- path 2: lookup ------------------------------------------------ */
async function lookup(){
  const title = formTitle(), artist = formArtist();
  if (!title){ status('Type the song title (and artist) to look it up.', 'warn'); return; }
  state.busy = 'meta'; state.metaError = ''; render();
  try {
    const url = `${SONGMETA_ENDPOINT}?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')){
      // Static hosting without functions answers with index.html / a 404 page.
      throw new Error('Lookup service not available here — it runs on Netlify (or `npm start` locally).');
    }
    const body = await res.json();
    if (res.status === 501) throw new Error('Lookup not configured: set GETSONGBPM_API_KEY on the server (Netlify env vars or server/.env).');
    if (!res.ok) throw new Error(body.error || `Lookup failed (${res.status})`);
    state.meta = body;
    if (!body.found){
      const near = (body.candidates || []).map(c => `${c.title} — ${c.artist}`).join('; ');
      state.metaError = `No confident match for "${title}"${artist ? ` by ${artist}` : ''}.${near ? ` Closest: ${near}` : ''}`;
    }
  } catch (e){
    state.meta = null;
    state.metaError = e.message || String(e);
  }
  state.busy = '';
  render();
}

/* ---- path 3: audio ------------------------------------------------- */
function toMono(buf){
  const n = buf.length, ch = buf.numberOfChannels;
  if (ch === 1) return buf.getChannelData(0);
  const out = new Float32Array(n);
  for (let c = 0; c < ch; c++){
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += d[i] / ch;
  }
  return out;
}

async function runAnalysis(arrayBuffer, label){
  state.busy = 'audio'; render();
  // let the "analyzing…" state paint before the CPU-bound work starts
  await new Promise(r => setTimeout(r, 30));
  try {
    const ctx = getCtx();
    const buf = await new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);   // Safari: callback form
      if (p && p.then) p.then(resolve, reject);
    });
    const t0 = performance.now();
    state.audio = analyzeAudio(toMono(buf), buf.sampleRate, { maxSeconds: 240 });
    state.audioLabel = `${label} · ${state.audio.seconds}s analysed in ${Math.round(performance.now() - t0)} ms`;
    state.choice = state.sheet ? state.choice : null;
    status('');
  } catch (e){
    state.audio = null;
    status(`Couldn't analyse that audio: ${e?.message || e}`, 'warn');
  }
  state.busy = '';
  render();
}

async function analyzeFile(){
  const f = $('song-audio')?.files?.[0];
  if (!f){ status('Choose an audio or video file first (an iPhone screen recording works).', 'warn'); return; }
  if (f.size > 80 * 1024 * 1024){ status('That file is over 80 MB — trim it to the part you want to learn.', 'warn'); return; }
  await runAnalysis(await f.arrayBuffer(), f.name);
}

export function canCaptureTab(){
  return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && window.MediaRecorder);
}

async function captureTab(){
  if (!canCaptureTab()){ status("This browser can't capture tab audio (iPhone Safari can't). Screen-record the clip and choose the file instead.", 'warn'); return; }
  const secs = Math.max(8, Math.min(60, +($('song-capture-secs')?.value || 20)));
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: 'include',
    });
  } catch { status('Capture cancelled.'); return; }
  const audioTracks = stream.getAudioTracks();
  if (!audioTracks.length){
    stream.getTracks().forEach(t => t.stop());
    status('No audio in that share — pick a *tab* and tick "Share tab audio".', 'warn');
    return;
  }
  const rec = new MediaRecorder(new MediaStream(audioTracks));
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise(r => { rec.onstop = r; });
  rec.start(1000);
  state.busy = 'capture'; render();
  let left = secs;
  status(`Recording tab audio… ${left}s — play the song now.`);
  const tick = setInterval(() => { left--; if (left > 0) status(`Recording tab audio… ${left}s`); }, 1000);
  const stopAll = () => { if (rec.state !== 'inactive') rec.stop(); stream.getTracks().forEach(t => t.stop()); };
  audioTracks[0].addEventListener('ended', stopAll);     // user hit "Stop sharing"
  setTimeout(stopAll, secs * 1000);
  await done;
  clearInterval(tick);
  const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
  await runAnalysis(await blob.arrayBuffer(), 'Tab capture');
}

/* ---- tap / manual -------------------------------------------------- */
function useTap(){
  state.tapBpm = getBPM();
  status(`Using ${state.tapBpm} BPM from the tempo keeper (tap ⦿ in the left rail along with the song first).`);
  render();
}
function setManualKey(el){
  const k = normalizeKeyName(el?.dataset?.key || el?.value);
  state.manualKey = k || null;
  render();
}
function setManualBpm(el){
  const n = Math.round(+(el?.dataset?.bpm || el?.value));
  state.manualBpm = Number.isFinite(n) && n >= 30 && n <= 300 ? n : null;
  render();
}
function clearManual(){ state.manualKey = null; state.manualBpm = null; render(); }

/* ---- apply / save ------------------------------------------------- */
function applyTempoKey(){
  const r = resolved();
  const done = [];
  if (r.bpm){
    const slider = $('bpm-slider');
    if (slider) slider.value = r.bpm.value;
    setBPM(r.bpm.value);
    done.push(`${r.bpm.value} BPM`);
  }
  if (r.key){
    // The key pickers list one spelling per key (e.g. Eb, not D#): match enharmonically.
    const appKey = APP_KEYS.find(k => k === r.key.value) || APP_KEYS.find(k => sameKey(k, r.key.value)) || r.key.value;
    syncKey(appKey, 'songimport');
    done.push(`key ${appKey}`);
  }
  status(done.length ? `Set ${done.join(' · ')}` : 'Nothing to apply yet.', done.length ? '' : 'warn');
  return r;
}

export function saveUnit(){
  const r = resolved();
  const opts = options();
  const choice = state.choice || opts[0]?.id || null;
  const clipId = formClip() || state.loaded?.clipId || null;
  const clip = clipId ? getClip(clipId) : null;
  let unit;
  try {
    const id = unitId({ title: formTitle(), artist: formArtist(), clipId });
    unit = buildUnit({
      title: formTitle() || clip?.label || '', artist: formArtist(), clipId, url: clip?.url || state.loaded?.url || '',
      bpm: r.bpm, key: r.key, timeSig: state.meta?.timeSig || state.loaded?.timeSig || null,
      sheet: state.sheet || (state.loaded ? { loops: state.loaded.sections.map(s => ({ names: s.names, loop: s.loop })) } : null),
      audio: state.audio, meta: state.meta, choice,
      existing: units.find(u => u.id === id),
    });
  } catch (e){ status(e.message, 'warn'); return null; }

  const i = units.findIndex(u => u.id === unit.id);
  if (i >= 0) units[i] = unit; else units.unshift(unit);
  saveUnits();

  if (unit.progression.length){
    trainerUpsertTrack({
      id: `trk_${unit.id}`,
      name: `♪ ${unit.title}`.slice(0, 40),
      chords: unit.progression.map(name => ({ name })),
    });
  }
  if (clip){
    if (unit.bpm) clipsUpdate(clip.id, 'bpm', String(unit.bpm.value));
    if (unit.key) clipsUpdate(clip.id, 'key', unit.key.value);
  }
  applyTempoKey();
  state.loaded = unit;
  status(`Saved "${unit.title}"${unit.progression.length ? ' and updated its My chords track' : ''}. Saving again updates the same unit.`);
  render();
  return unit;
}

function openTrack(){ trainerNav('chords'); }

function loadUnit(el){
  const u = units.find(x => x.id === el?.dataset?.id);
  if (!u) return;
  resetEvidence();
  state.loaded = u;
  if ($('song-title')) $('song-title').value = u.title || '';
  if ($('song-artist')) $('song-artist').value = u.artist || '';
  renderClipPicker();
  if ($('song-clip')) $('song-clip').value = u.clipId && getClip(u.clipId) ? u.clipId : '';
  status(`Loaded "${u.title}". Add evidence or change anything, then save to update it.`);
  render();
}

function deleteUnit(el){
  const u = units.find(x => x.id === el?.dataset?.id);
  if (!u || !confirm(`Delete the saved unit "${u.title}"? (Its My chords track stays.)`)) return;
  units = units.filter(x => x.id !== u.id);
  saveUnits();
  if (state.loaded?.id === u.id) state.loaded = null;
  render();
}

function resetEvidence(){
  Object.assign(state, { sheet: null, meta: null, metaError: '', audio: null, audioLabel: '', tapBpm: null, manualKey: null, manualBpm: null, choice: null, loaded: null });
}
function newSong(){
  resetEvidence();
  ['song-title', 'song-artist', 'song-sheet'].forEach(id => { if ($(id)) $(id).value = ''; });
  if ($('song-audio')) $('song-audio').value = '';
  if ($('song-clip')) $('song-clip').value = '';
  status('');
  render();
}

/* ---- rendering ----------------------------------------------------- */
const pct = (c) => `${Math.round((c || 0) * 100)}%`;
function badge(src, conf){
  return `<span class="song-src" data-src="${escHtml(src)}">${escHtml(SOURCE_LABEL[src] || src)}${conf != null ? ` · ${pct(conf)}` : ''}</span>`;
}

function evidenceHTML(){
  const rows = [];
  if (state.sheet){
    const k = state.sheet.key;
    rows.push(`<li>${badge('sheet')} ${state.sheet.chords.length} chords · key ${escHtml(k?.key || '?')} (${pct(k?.confidence)}; next: ${escHtml((k?.candidates || []).slice(1, 3).map(c => c.key).join(', '))})</li>`);
  }
  if (state.meta?.found){
    const m = state.meta;
    rows.push(`<li>${badge('meta')} ${escHtml(m.title)} — ${escHtml(m.artist)}: ${m.bpm ? Math.round(m.bpm) + ' BPM' : 'no BPM'} · ${escHtml(m.key || 'no key')}${m.timeSig ? ' · ' + escHtml(m.timeSig) : ''}
      <a href="${escHtml(m.attribution?.url || 'https://getsongbpm.com')}" target="_blank" rel="noopener">${escHtml(m.attribution?.text || 'GetSongBPM')}</a></li>`);
  } else if (state.metaError){
    rows.push(`<li>${badge('meta')} <span class="song-warn">${escHtml(state.metaError)}</span></li>`);
  }
  if (state.audio){
    const a = state.audio;
    rows.push(`<li>${badge('audio')} ${escHtml(state.audioLabel)}: ${a.bpm ? a.bpm.bpm + ' BPM (' + pct(a.bpm.confidence) + ')' : 'no steady pulse'} · key ${escHtml(a.key.key)} (${pct(a.key.confidence)})${a.chords.loop.length ? ' · loop ' + escHtml(a.chords.loop.join(' – ')) : ''}</li>`);
  }
  if (state.tapBpm) rows.push(`<li>${badge('tap')} ${state.tapBpm} BPM</li>`);
  if (state.loaded && !state.sheet && !state.meta && !state.audio) rows.push(`<li>${badge('saved')} the saved unit's values</li>`);
  return rows.length ? `<ul class="song-evidence">${rows.join('')}</ul>` : '';
}

function fieldCard(label, valueHTML, r, extraHTML = ''){
  const st = r?.status || '';
  return `<div class="chord-card song-field" data-status="${st}">
    <div class="chord-card-label">${label}</div>
    <div class="chord-card-value">${valueHTML}</div>
    ${r ? `<div class="song-field-meta">${badge(r.source, r.confidence)}${st && st !== 'single' && st !== 'manual' ? ` <em>${escHtml(st)}</em>` : ''}</div>` : ''}
    ${r?.note ? `<div class="song-note">${escHtml(r.note)}</div>` : ''}
    ${extraHTML}
  </div>`;
}

function render(){
  const out = $('song-output');
  if (!out) return;
  const busy = state.busy;
  ['song-lookup-btn', 'song-file-btn', 'song-capture-btn', 'song-parse-btn'].forEach(id => {
    if ($(id)) $(id).disabled = !!busy || (id === 'song-capture-btn' && !canCaptureTab());
  });

  const r = resolved();
  const opts = options();
  const chosen = opts.find(o => o.id === state.choice) || opts[0] || null;
  const anything = r.key || r.bpm || opts.length;

  const busyLine = busy === 'meta' ? 'Looking up BPM / key…' : busy === 'audio' ? 'Analysing audio…' : busy === 'capture' ? 'Capturing tab audio…' : '';
  if (!anything && !busy){
    out.className = 'tab-output placeholder';
    out.innerHTML = (evidenceHTML() || '') + 'Use any of the three paths above. Each fills in what it can, and they cross-check each other.';
    renderUnits();
    return;
  }
  out.className = 'tab-output has-content';

  const keyCands = (r.key?.candidates || []).filter(k => k !== r.key?.value);
  const keyExtra = `<div class="song-chips">${keyCands.map(k => `<button type="button" class="btn btn-ghost song-chip" data-action="song:key" data-key="${escHtml(k)}">${escHtml(k)}?</button>`).join('')}
      <input class="song-mini" id="song-key-input" placeholder="key" aria-label="Set key manually" data-on-enter="song:keyInput" value=""></div>`;
  const bpmExtra = `<div class="song-chips">${(r.bpm?.alternatives || []).map(b => `<button type="button" class="btn btn-ghost song-chip" data-action="song:bpm" data-bpm="${b}">${b}?</button>`).join('')}
      <input class="song-mini" id="song-bpm-input" placeholder="bpm" inputmode="numeric" aria-label="Set BPM manually" data-on-enter="song:bpmInput"></div>`;

  const progOpts = opts.map(o => `<label class="song-prog${chosen && chosen.id === o.id ? ' active' : ''}">
      <input type="radio" name="song-prog" value="${escHtml(o.id)}" data-on-change="song:choose" ${chosen && chosen.id === o.id ? 'checked' : ''}>
      <span class="song-prog-name">${escHtml(o.label)}</span>
      <span class="song-prog-chords">${escHtml(o.chords.join(' – '))}</span>
      ${r.key ? `<span class="song-prog-romans">${escHtml(toRomans(o.chords, r.key.value).join(' – '))}</span>` : ''}
      ${o.source === 'audio-chords' ? '<span class="song-note">sketch from audio — major/minor triads only, check by ear</span>' : ''}
    </label>`).join('');

  out.innerHTML = `
    ${busyLine ? `<div class="song-busy">${busyLine}<span class="cursor"></span></div>` : ''}
    ${evidenceHTML()}
    <div class="result-block"><div class="result-block-title">Unit</div>
      <div class="chord-grid">
        ${fieldCard('Key', r.key ? escHtml(r.key.value) : '—', r.key, keyExtra)}
        ${fieldCard('BPM', r.bpm ? String(r.bpm.value) : '—', r.bpm, bpmExtra)}
        ${fieldCard('Time', escHtml(state.meta?.timeSig || state.loaded?.timeSig || '4/4?'), null)}
      </div>
      ${state.manualKey || state.manualBpm ? '<button type="button" class="btn btn-ghost song-chip" data-action="song:clearManual">↺ undo my overrides</button>' : ''}
    </div>
    <div class="result-block"><div class="result-block-title">Progression → My chords track</div>
      ${progOpts || '<span class="rail-empty">Paste a chord sheet or analyse audio to get a progression. (A lookup gives BPM/key only.)</span>'}
    </div>
    <div class="action-row">
      <button class="btn btn-ghost" type="button" data-action="song:apply" title="Set the tempo keeper and app key">Apply tempo + key</button>
      <button class="btn btn-primary" type="button" data-action="song:save" title="Save the unit (idempotent) and create/refresh its My chords track">Save unit → My chords</button>
      ${state.loaded?.progression?.length ? '<button class="btn btn-ghost" type="button" data-action="song:openTrack">Open track ↗</button>' : ''}
    </div>`;
  renderUnits();
}

function renderUnits(){
  const list = $('song-units');
  if (!list) return;
  if (!units.length){ list.innerHTML = ''; return; }
  list.innerHTML = `<div class="result-block-title">Saved units</div>` + units.map(u => `
    <div class="song-unit${state.loaded?.id === u.id ? ' active' : ''}">
      <button type="button" class="song-unit-open" data-action="song:load" data-id="${escHtml(u.id)}">
        <strong>${escHtml(u.title)}</strong>${u.artist ? ` — ${escHtml(u.artist)}` : ''}
        <small>${u.key ? escHtml(u.key.value) : '?'} · ${u.bpm ? u.bpm.value + ' BPM' : '? BPM'}${u.progression.length ? ' · ' + escHtml(u.progression.slice(0, 6).join(' ')) + (u.progression.length > 6 ? '…' : '') : ''}</small>
      </button>
      <button type="button" class="btn btn-ghost song-chip" data-action="song:delete" data-id="${escHtml(u.id)}" aria-label="Delete ${escHtml(u.title)}">✕</button>
    </div>`).join('');
}

/* ---- boot ---------------------------------------------------------- */
export function initSongImport(){
  loadUnits();
  registerActions({
    'song:parse':       () => parseSheet(),
    'song:lookup':      () => lookup(),
    'song:file':        () => analyzeFile(),
    'song:capture':     () => captureTab(),
    'song:tap':         () => useTap(),
    'song:key':         (el) => setManualKey(el),
    'song:keyInput':    (el) => setManualKey(el),
    'song:bpm':         (el) => setManualBpm(el),
    'song:bpmInput':    (el) => setManualBpm(el),
    'song:clearManual': () => clearManual(),
    'song:choose':      (el) => { state.choice = el.value; render(); },
    'song:apply':       () => applyTempoKey(),
    'song:save':        () => saveUnit(),
    'song:openTrack':   () => openTrack(),
    'song:load':        (el) => loadUnit(el),
    'song:delete':      (el) => deleteUnit(el),
    'song:new':         () => newSong(),
  });
  onClipsChange(renderClipPicker);
  renderClipPicker();
  if ($('song-capture-btn') && !canCaptureTab()) $('song-capture-btn').title = "Tab audio capture needs desktop Chrome / Edge — on iPhone, screen-record and choose the file";
  render();
}
