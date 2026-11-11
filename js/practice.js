/* ============================================================
   practice.js — "04 — Practice".

   Three 10–20 minute practice plans as live steppers, in the
   same shape as the Guided Workflow: every step reads the real
   app state (clip player, tags, metronome, trainer mode / view,
   today's SRS answer tally, the My-chords track, the chord table)
   and its button is a shortcut to the existing action. Steps the
   app cannot observe (you played it clean, you kept one fill) are
   manual ticks, stored per day. A day counts toward the streak
   once the chosen plan is fully done.

     A  Clip → chart   ear + transcription      (~15 min, 2×/week)
     B  Trainer-first  SRS fluency              (~12 min, daily)
     C  Blend & play   full pipeline            (~20 min, Saturday)

   B rotates drill modes by weekday:
     Mon sc · Tue s2n · Wed n2s · Thu mv · Fri prog · Sat/Sun mixed
   ============================================================ */
import { store } from './store.js';
import { getClips, getActiveClip, clipsSeedMixer, clipsToggleDock, clipsCaptureBpm, onClipsChange } from './clips.js';
import { generateBlend } from './blend.js';
import { generateGuitar } from './guitar.js';
import { exportMidi } from './midi.js';
import { switchTab, switchInnerTab } from './ui.js';
import { guitarSeq, pianoSeq, toggleSeq } from './sequencer.js';
import { toggleMetronome, getBPM } from './metronome.js';
import { getSwing } from './swing.js';
import { getAppKey } from './keysync.js';
import { trainerSetMode, trainerToggleView, trainerState } from './trainer.js';
import { trainerNav } from './trainernav.js';
import { srsToday, localDay } from './trainersrs.js';
import { paletteSize } from './chordpalette.js';
import { registerActions } from './actions.js';
import { registerStore, loadJSON, saveJSON } from './storage.js';
import { escHtml } from './util.js';

const $ = (id) => document.getElementById(id);

/* ---- persisted: chosen plan, manual ticks per day, completion log ---- */
const KEY = registerStore('practice', 'GenreBenderPractice_v1');
let db = { plan: 'B', ticks: {}, log: {} };
function load(){ Object.assign(db, loadJSON(KEY, {}) || {}); if (!db.ticks) db.ticks = {}; if (!db.log) db.log = {}; }
function save(){ saveJSON(KEY, db); }
function tickKey(){ return `${localDay()}|${db.plan}`; }
function ticked(id){ return !!(db.ticks[tickKey()] || {})[id]; }
function toggleTick(id){
  const k = tickKey();
  db.ticks[k] = db.ticks[k] || {};
  if (db.ticks[k][id]) delete db.ticks[k][id]; else db.ticks[k][id] = true;
  /* keep only the last 60 days of ticks */
  const keys = Object.keys(db.ticks).sort();
  while (keys.length > 60) delete db.ticks[keys.shift()];
  save();
}

/* ---- weekday rotation for plan B ---- */
const ROTATION = { 1: 'sc', 2: 's2n', 3: 'n2s', 4: 'mv', 5: 'prog', 6: 'mixed', 0: 'mixed' };
const MODE_LABEL = { sc: 'Scale shapes', s2n: 'Shape → Number', n2s: 'Number → Shape', mv: 'Moving shapes', prog: 'Progression ID', mixed: 'Mixed (SRS)', custom: 'My chords' };
export function todaysMode(d = new Date()){ return ROTATION[d.getDay()]; }
const QUIZ_TARGET = 20;

/* ---- state snapshot ---- */
function focusClip(){
  return getActiveClip()
    || (store.reference && getClips().find(c => c.id === store.reference.clipId))
    || getClips()[0] || null;
}
function metroPlaying(){ return $('metro-play-btn')?.classList.contains('playing'); }
function state(){
  const clip = focusClip();
  const trainer = trainerState();
  const today = srsToday();
  const mode = todaysMode();
  const answeredToday = mode === 'mixed' ? today.answered : (today.byKind[mode] || 0);
  return {
    clip, clipOpen: !!getActiveClip(), ref: store.reference, selected: store.selected,
    blend: store.blendData, tab: store.guitarTabData, chart: store.pianoChordData,
    playing: guitarSeq.playing || pianoSeq.playing, metro: metroPlaying(),
    bpm: getBPM(), swing: getSwing() > 0, key: getAppKey(),
    trainer, today, mode, answeredToday, table: paletteSize(),
  };
}

/* ---- navigation helpers ---- */
function innerBtn(re){ return [...document.querySelectorAll('.tab-inner-tab')].find(b => re.test(b.textContent)); }
function goTrainer(mode){
  if (mode === 'custom') trainerNav('chords');
  else trainerNav('drills', mode || null);
}
function goMyChords(){ goTrainer('custom'); }
function openPlayer(){ if (!$('clip-dock')?.classList.contains('closed')) return $('clip-url')?.focus(); clipsToggleDock(); }   // the player floats over any page
function clickAction(name){ document.querySelector(`[data-action="${name}"]`)?.click(); }

/* ---- step vocabulary ----
   auto step:   done(s) derived from state
   manual step: done = ticked(id); its button toggles the tick, and an
                optional `go` action is rendered as a second, ghost button. */
const trackHint = s => s.trainer.track ? `Active track “${s.trainer.track.name}” · ${s.trainer.track.chords} chord${s.trainer.track.chords === 1 ? '' : 's'}.` : 'No track yet.';
const tableHint = s => `Chord table has ${s.table} shape${s.table === 1 ? '' : 's'}.`;

const PLANS = {
  A: {
    title: 'Clip → chart', sub: 'ear + transcription · ~15 min · twice a week',
    steps: [
      { id: 'clip', title: 'Open a reference clip', mins: '0–3',
        hint: s => s.clipOpen ? `Playing “${s.clip.label}”.` : 'Copy a full X / Instagram / TikTok / YouTube URL and Ctrl/Cmd+V anywhere — then give it a label.',
        done: s => s.clipOpen, go: 'practice:player', label: s => s.clipOpen ? 'Add another' : 'Open the player' },
      { id: 'bpm', title: 'Capture its BPM', mins: '',
        hint: s => !s.clip ? 'Needs a clip first.' : s.clip.bpm ? `${s.clip.bpm} bpm saved on the clip.` : `Tap tempo along for 8+ beats (metronome is at ${s.bpm}), then capture it onto the clip.`,
        done: s => !!(s.clip && s.clip.bpm), ready: s => !!s.clip, go: 'practice:capturebpm', label: () => '↓ capture tapped bpm' },
      { id: 'key', title: 'Set the key + tags', mins: '',
        hint: s => !s.clip ? 'Needs a clip first.' : (s.clip.key && s.clip.genres) ? `${s.clip.genres} · ${s.clip.key}` : 'Pick the key in the transport bar. Not sure? Analyze the caption and write the guess back to the clip.',
        done: s => !!(s.clip && s.clip.key && s.clip.genres && s.clip.genres.trim()), ready: s => !!s.clip, go: 'practice:analyze', label: () => 'Analyze it ↗' },
      { id: 'track', title: 'Build the progression in My chords', mins: '3–10',
        hint: s => `${trackHint(s)} New track named after the clip → loop the clip → type frets, watch the readout, “+ add from frets” per chord. Quality toggles for colour, “🔑 make in key” for clashes.`,
        done: s => !!(s.trainer.track && s.trainer.track.chords >= 3), go: 'practice:mychords', label: () => 'Open My chords' },
      { id: 'play', title: 'Play it through 4× clean', mins: '10–15',
        hint: s => `${s.metro ? 'Click is rolling' : 'Start the click'} at ${s.bpm} bpm${s.swing ? ', swing on' : ' — consider a swing preset'}.`,
        manual: true, go: 'practice:metro', goLabel: s => s.metro ? 'Stop click' : 'Start click ▶' },
      { id: 'licks', title: 'One fill per gap you can actually play', mins: '',
        hint: () => 'Between each pair of chords: ▶ play the suggested fill → try it → 🔀 different lick until one fits.',
        manual: true, go: 'practice:mychords', goLabel: () => 'To the track' },
      { id: 'table', title: 'Keep 2–3 voicings', mins: '',
        hint: s => `${tableHint(s)} Drag the diagrams you liked from the track down into the table.`,
        manual: true, go: 'practice:mychords', goLabel: () => 'To the table' },
    ],
  },
  B: {
    title: 'Trainer-first', sub: 'SRS fluency · ~12 min · daily default',
    steps: [
      { id: 'clip', title: 'Open a clip for ambience', mins: '0–1',
        hint: s => s.clipOpen ? `“${s.clip.label}” in the clips player — leave it playing.` : 'Open any saved clip in the clips player so a reference is in your ear.',
        done: s => s.clipOpen, go: 'practice:player', label: () => 'Open the player' },
      { id: 'mode', title: s => `Today's drill: ${MODE_LABEL[s.mode]}`, mins: '',
        hint: s => s.trainer.mode === s.mode ? 'Selected.' : `Rotation — Mon Scale shapes · Tue Shape→Number · Wed Number→Shape · Thu Moving shapes · Fri Progression ID · Sat/Sun Mixed. Trainer is on ${MODE_LABEL[s.trainer.mode] || s.trainer.mode}.`,
        done: s => s.trainer.mode === s.mode, go: 'practice:mode', label: s => `Select ${MODE_LABEL[s.mode]}` },
      { id: 'quiz', title: `Answer ${QUIZ_TARGET} cards`, mins: '1–8',
        hint: s => {
          const acc = s.today.answered ? Math.round(s.today.right / s.today.answered * 100) + '% today' : 'nothing answered yet today';
          const view = (s.trainer.mode === s.mode && s.trainer.exploring) ? ' — you are in explore; switch back to quiz, explore never records.' : '';
          return `${s.answeredToday} / ${QUIZ_TARGET} in ${MODE_LABEL[s.mode]} · ${acc}. Stuck >15 s? Give up, read the reveal, move on.${view}`;
        },
        done: s => s.answeredToday >= QUIZ_TARGET, ready: s => s.trainer.mode === s.mode,
        go: 'practice:quiz', label: s => (s.trainer.mode === s.mode && s.trainer.exploring) ? '🎓 back to quiz' : 'Go quiz' },
      { id: 'explore', title: 'Four minutes of explore', mins: '8–12',
        hint: s => `🧭 explore this drill in the same mode, sandbox key = ${s.key}${s.clip ? ` (clip says ${s.clip.key || '?'})` : ''}. Degree chips, barre moves, scale boxes — watch the readout name what you play.`,
        manual: true, ready: s => s.trainer.mode === s.mode, go: 'practice:explore', goLabel: s => (s.trainer.mode === s.mode && s.trainer.exploring) ? 'Exploring ✓' : '🧭 Explore' },
      { id: 'table', title: 'Bank one voicing you found', mins: '',
        hint: s => `${tableHint(s)} In My chords: type its frets → “+ add to table”.`,
        manual: true, go: 'practice:mychords', goLabel: () => 'My chords' },
      { id: 'backup', title: 'Sunday: export everything', mins: 'weekly', sunday: true,
        hint: () => '⚙ AI → ↓ export everything — clips, trainer progress and the chord table live only in this browser.',
        manual: true, go: 'practice:backup', goLabel: () => '↓ export everything' },
    ],
  },
  C: {
    title: 'Blend & play', sub: 'full pipeline · ~20 min · Saturday',
    steps: [
      { id: 'seed', title: 'Seed the mixer from a clip', mins: '0–5',
        hint: s => s.ref ? `Blending toward “${s.ref.label}”.` : s.clip ? `“${s.clip.label}” → ⇢ seed mixer (needs genre tags + BPM).` : 'Open a saved clip first.',
        done: s => !!s.ref, ready: s => !!(s.clip && s.clip.genres && s.clip.bpm), go: 'practice:seed', label: () => 'Seed mixer ⇢' },
      { id: 'genre', title: 'Add one more genre, nudge the ratios', mins: '',
        hint: s => `${s.selected.length} genre${s.selected.length === 1 ? '' : 's'} selected.`,
        done: s => s.selected.length >= 2, go: 'practice:mixer', label: () => 'To the mixer' },
      { id: 'blend', title: 'Generate the blend', mins: '',
        hint: s => s.blend ? 'Creative direction is in.' : 'Ask for direction grounded in the reference.',
        done: s => !!s.blend, ready: s => s.selected.length >= 2, go: 'practice:blend', label: s => s.blend ? 'Regenerate' : 'Generate blend ↗' },
      { id: 'notate', title: 'Generate the tab + chord chart', mins: '',
        hint: s => (s.tab && s.chart) ? 'Both generated.' : s.tab ? 'Tab done — piano chart is one inner tab over.' : 'Guitar tab first; then Piano / chord chart.',
        done: s => !!s.tab, ready: s => s.selected.length >= 2, go: 'practice:notate', label: s => s.tab ? 'Regenerate tab' : 'Generate tab ↗' },
      { id: 'track', title: 'Rebuild it under your fingers', mins: '5–12',
        hint: s => `${trackHint(s)} New track “clip × genre” → chord table “fill 7ths” → drag shapes onto the track in the chart's order → re-voice each block.`,
        done: s => !!(s.trainer.track && s.trainer.track.chords >= 3), go: 'practice:mychords', label: () => 'Open My chords' },
      { id: 'compose', title: 'Play it in Compose', mins: '',
        hint: s => s.playing ? 'Rolling — guitar and piano on one clock.' : 'Start the tab (⊕ Compose runs both on one clock) and play along 2×.',
        done: s => s.playing, ready: s => !!(s.tab || s.chart), go: 'practice:play', label: s => s.playing ? 'Stop' : 'Play ▶' },
      { id: 'fills', title: 'Two clean fills', mins: '12–18',
        hint: () => 'Loop two adjacent chords. ▶ play the gap fill → copy → 🔀 different lick until one lands → 5× clean. Then the next gap.',
        manual: true, go: 'practice:mychords', goLabel: () => 'To the track' },
      { id: 'keep', title: 'Keep it', mins: '18–20',
        hint: s => `Export MIDI if it's worth keeping; drag the best voicings to the table (${s.table} there now); note in the clip what you blended it with.`,
        manual: true, go: 'practice:midi', goLabel: () => 'Export MIDI' },
    ],
  },
};

function activeSteps(plan){
  const sunday = new Date().getDay() === 0;
  return PLANS[plan].steps.filter(st => !st.sunday || sunday);
}
const txt = (v, s) => typeof v === 'function' ? v(s) : v;

/* ---- streak ---- */
function streak(){
  const today = localDay();
  const yesterday = localDay(Date.now() - 864e5);
  let n = 0, cursor = db.log[today] ? today : (db.log[yesterday] ? yesterday : null);
  if (!cursor) return 0;
  let t = new Date(cursor + 'T12:00:00').getTime();
  while (db.log[localDay(t)]) { n++; t -= 864e5; }
  return n;
}

/* ---- render ---- */
export function renderPractice(){
  const el = $('practice-steps');
  if (!el) return;
  const s = state();
  const plan = PLANS[db.plan];
  const steps = activeSteps(db.plan);

  document.querySelectorAll('.practice-plan').forEach(b => {
    const on = b.dataset.plan === db.plan;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const sub = $('practice-sub');
  if (sub) sub.textContent = plan.sub;

  let currentSet = false, doneCount = 0;
  el.innerHTML = steps.map((st, i) => {
    const ready = st.ready ? !!st.ready(s) : true;
    const done = st.manual ? ticked(st.id) : !!st.done(s);
    if (done) doneCount++;
    const current = !done && ready && !currentSet;
    if (current) currentSet = true;
    const cls = done ? 'done' : current ? 'current' : ready ? 'ready' : 'locked';
    const mins = st.mins ? `<span class="pstep-mins">${escHtml(st.mins)}${/\d/.test(st.mins) ? ' min' : ''}</span>` : '';
    const buttons = st.manual
      ? `${st.go ? `<button class="btn btn-ghost gstep-btn" type="button" data-action="${st.go}" ${ready ? '' : 'disabled'}>${escHtml(txt(st.goLabel, s))}</button>` : ''}
         <button class="btn ${current ? 'btn-primary' : 'btn-ghost'} gstep-btn pstep-tick" type="button" data-action="practice:tick" data-step="${st.id}" ${ready || done ? '' : 'disabled'}>${done ? 'undo' : '✓ mark done'}</button>`
      : `<button class="btn ${current ? 'btn-primary' : 'btn-ghost'} gstep-btn" type="button" data-action="${st.go}" ${ready ? '' : 'disabled'}>${escHtml(txt(st.label, s))}</button>`;
    return `<li class="gstep pstep ${cls}">
      <div class="gstep-num">${done ? '✓' : i + 1}</div>
      <div class="gstep-body">
        <div class="gstep-title">${escHtml(txt(st.title, s))}${mins}</div>
        <div class="gstep-hint">${escHtml(txt(st.hint, s))}</div>
      </div>
      <div class="pstep-btns">${buttons}</div>
    </li>`;
  }).join('');

  const total = steps.length;
  const prog = $('practice-progress');
  if (prog){
    prog.style.setProperty('--p', `${Math.round(doneCount / total * 100)}%`);
    prog.setAttribute('aria-valuemax', String(total));
    prog.setAttribute('aria-valuenow', String(doneCount));
  }
  const lbl = $('practice-progress-label');
  if (lbl) lbl.textContent = doneCount === total ? 'session done — see you tomorrow' : `${doneCount} / ${total}`;

  const day = localDay();
  if (doneCount === total && db.log[day] !== db.plan){ db.log[day] = db.plan; save(); }
  const stat = $('practice-stat');
  if (stat){
    const acc = s.today.answered ? ` · ${Math.round(s.today.right / s.today.answered * 100)}%` : '';
    const n = streak();
    stat.textContent = `today: ${s.today.answered} card${s.today.answered === 1 ? '' : 's'}${acc} · streak ${n} day${n === 1 ? '' : 's'} · table ${s.table}`;
  }
}

let pollTimer = null;
function visible(){ return $('panel-practice')?.classList.contains('active'); }
function startPoll(){
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (visible()) renderPractice(); else { clearInterval(pollTimer); pollTimer = null; } }, 1200);
}

/* Called by main.js's switchTab wrapper. */
export function practiceOnTab(id){
  if (id !== 'practice') return;
  renderPractice();
  if (!pollTimer) startPoll();
}

export function practiceSetPlan(p){
  if (!PLANS[p]) return;
  db.plan = p; save();
  renderPractice();
}

export function initPractice(){
  load();
  /* Every action re-renders once it has run (sync or async), so the list
     is already current when the user switches back to this tab. */
  const wrap = (map) => Object.fromEntries(Object.entries(map).map(([k, fn]) => [k, (el, ev) => {
    const r = fn(el, ev);
    if (r && typeof r.then === 'function') return r.finally(renderPractice);
    renderPractice();
    return r;
  }]));
  registerActions(wrap({
    'practice:plan':       (el) => practiceSetPlan(el.dataset.plan),
    'practice:tick':       (el) => { toggleTick(el.dataset.step); renderPractice(); },
    'practice:player':     () => openPlayer(),
    'practice:capturebpm': () => { const c = focusClip(); if (c) clipsCaptureBpm(c.id); renderPractice(); },
    'practice:analyze':    () => switchTab('upload'),
    'practice:mychords':   () => goMyChords(),
    'practice:metro':      () => { toggleMetronome(); renderPractice(); },
    'practice:mode':       () => goTrainer(todaysMode()),
    'practice:quiz':       () => { goTrainer(todaysMode()); if (trainerState().exploring) trainerToggleView(); },
    'practice:explore':    () => { goTrainer(todaysMode()); if (!trainerState().exploring) trainerToggleView(); },
    'practice:backup':     () => clickAction('backup:export'),
    'practice:seed':       () => { const c = focusClip(); if (c) clipsSeedMixer(c.id); renderPractice(); },
    'practice:mixer':      () => { switchTab('mixer'); $('genre-filter')?.focus(); },
    'practice:blend':      async () => { switchTab('mixer'); await generateBlend(); renderPractice(); },
    'practice:notate':     async () => { switchTab('mixer'); switchInnerTab('guitar', innerBtn(/guitar tab/i)); await generateGuitar(); renderPractice(); },
    'practice:play':       () => {
      if (guitarSeq.playing || pianoSeq.playing){ if (guitarSeq.playing) toggleSeq('guitar'); if (pianoSeq.playing) toggleSeq('piano'); }
      else if (store.guitarTabData) toggleSeq('guitar');
      else if (store.pianoChordData) toggleSeq('piano');
      renderPractice();
    },
    'practice:midi':       () => exportMidi('guitar'),
  }));
  onClipsChange(() => { if (visible()) renderPractice(); });
  renderPractice();
}
