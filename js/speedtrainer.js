/* ============================================================
   speedtrainer.js — tempo-ramp practice loop ("04 — Practice").

   Loops a progression — the guitar tab, the piano chart, or the
   active My-chords track — starting at a comfortable tempo and
   raising the metronome by `step` BPM every `every` clean passes
   until `target`, then holds there. Stopping records the fastest
   tempo you completed a full pass at, per source, so the readout
   can say "best 112".

   Uses the shared loop engine (loopscheduler.makeLooper), which
   re-reads getBPM() every tick — so the ramp is just setBPM() at
   the top of a pass, and the rail's tempo keeper shows it moving.
   Turn on the rail metronome for a click.
   ============================================================ */
import { makeLooper } from './loopscheduler.js';
import { getBPM, setBPM } from './metronome.js';
import { getSeqChords } from './cards.js';
import { stopAllSeqs } from './sequencer.js';
import { store } from './store.js';
import { trainerTrackChords } from './trainer.js';
import { midiToHz } from './theory.js';
import { registerActions } from './actions.js';
import { registerStore, loadJSON, saveJSON } from './storage.js';
import { escHtml } from './util.js';

const $ = (id) => document.getElementById(id);
const KEY = registerStore('speedTrainer', 'GenreBenderSpeed_v1');

let cfg = { source: 'guitar', start: 80, target: 120, step: 4, every: 2, mode: 'strum', best: {} };
let run = null;   // { source, bpm, pass, len, completedBpm, startedAt }

const SOURCE_LABEL = { guitar: 'guitar tab', piano: 'piano chart', track: 'My chords track' };

function load(){ const s = loadJSON(KEY, null); if (s) cfg = { ...cfg, ...s, best: { ...(s.best || {}) } }; }
function save(){ saveJSON(KEY, cfg); }

/* The chords for a source in the loop engine's { freqs, beats, name } shape. */
export function speedChords(source){
  if (source === 'guitar' && store.guitarTabData?.chords) return getSeqChords('guitar', store.guitarTabData.chords);
  if (source === 'piano' && store.pianoChordData?.chords) return getSeqChords('piano', store.pianoChordData.chords);
  if (source === 'track'){
    const t = trainerTrackChords();
    return t.chords.map(c => ({ name: c.name, freqs: c.midis.map(midiToHz), beats: 4 }));
  }
  return [];
}

/* Pure ramp rule: the tempo for the pass about to start. */
export function rampTempo({ start, target, step, every }, passesDone){
  const up = target >= start;
  const bumps = Math.floor(passesDone / Math.max(1, every));
  const bpm = start + (up ? 1 : -1) * bumps * Math.abs(step);
  return up ? Math.min(target, bpm) : Math.max(target, bpm);
}

const looper = makeLooper({
  swing: true,
  onStep(snap){
    if (!run) return;
    if (snap === 0){
      if (run.started){
        run.pass++;
        run.completedBpm = Math.max(run.completedBpm, run.bpm);
        const next = rampTempo(cfg, run.pass);
        if (next !== run.bpm){ run.bpm = next; setBPM(next); }
      }
      run.started = true;
    }
    run.chord = snap;
    paint();
  },
  onStop(){ finish(); },
});

function readInputs(){
  const num = (id, lo, hi, d) => { const v = parseInt($(id)?.value, 10); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  cfg.source = $('speed-source')?.value || cfg.source;
  cfg.start  = num('speed-start', 40, 220, cfg.start);
  cfg.target = num('speed-target', 40, 220, cfg.target);
  cfg.step   = num('speed-step', 1, 20, cfg.step);
  cfg.every  = num('speed-every', 1, 8, cfg.every);
  cfg.mode   = $('speed-mode')?.value || cfg.mode;
  save();
}

function startRun(){
  readInputs();
  const chords = speedChords(cfg.source);
  if (!chords.length){
    setStatus(`No ${SOURCE_LABEL[cfg.source]} yet — ${cfg.source === 'track' ? 'add chords in the trainer’s My chords view' : 'generate one in the mixer tab'} first.`);
    return;
  }
  stopAllSeqs();
  run = { source: cfg.source, bpm: cfg.start, pass: 0, len: chords.length, completedBpm: 0, started: false, chord: 0, prevBpm: getBPM() };
  setBPM(cfg.start);
  looper.start(chords, { beatsPerChord: chords[0].beats || 4, mode: cfg.mode, loop: true });
  setStatus('');
  paint();
}

function finish(){
  if (!run) return;
  const r = run;
  run = null;
  if (r.completedBpm){
    const prev = cfg.best[r.source] || 0;
    if (r.completedBpm > prev){ cfg.best[r.source] = r.completedBpm; save(); }
    setStatus(`${r.pass} pass${r.pass === 1 ? '' : 'es'} · fastest clean pass ${r.completedBpm} BPM${r.completedBpm > prev ? ' — new best' : ''}`);
  } else setStatus('stopped before a full pass');
  paint();
}

function setStatus(msg){ const el = $('speed-status'); if (el) el.textContent = msg; }

function paint(){
  const btn = $('speed-go');
  if (btn){ btn.textContent = run ? '■ stop' : '▶ start ramp'; btn.setAttribute('aria-pressed', String(!!run)); }
  const out = $('speed-readout');
  if (!out) return;
  const best = cfg.best[cfg.source];
  if (run){
    const atTarget = run.bpm === cfg.target;
    const pct = cfg.target === cfg.start ? 100 : Math.round(100 * (run.bpm - cfg.start) / (cfg.target - cfg.start));
    out.innerHTML = `<span class="speed-bpm">${run.bpm}</span><span class="speed-unit">BPM</span>
      <span class="speed-meta">pass ${run.pass + 1} · chord ${run.chord + 1}/${run.len} · ${atTarget ? 'at target ✓' : `→ ${cfg.target}`}</span>
      <span class="speed-bar" style="--p:${Math.max(0, Math.min(100, pct))}%" role="progressbar" aria-valuemin="${cfg.start}" aria-valuemax="${cfg.target}" aria-valuenow="${run.bpm}"></span>`;
  } else {
    out.innerHTML = `<span class="speed-meta">${escHtml(SOURCE_LABEL[cfg.source])} · ${cfg.start} → ${cfg.target} BPM, +${cfg.step} every ${cfg.every} pass${cfg.every === 1 ? '' : 'es'}${best ? ` · best ${best}` : ''}</span>`;
  }
}

function fillInputs(){
  const set = (id, v) => { const el = $(id); if (el) el.value = String(v); };
  set('speed-source', cfg.source); set('speed-start', cfg.start); set('speed-target', cfg.target);
  set('speed-step', cfg.step); set('speed-every', cfg.every); set('speed-mode', cfg.mode);
}

export function speedRunning(){ return !!run; }

export function initSpeedTrainer(){
  load();
  fillInputs();
  registerActions({
    'speed:toggle': () => (run ? looper.stop() : startRun()),
    'speed:cfg': () => { readInputs(); paint(); },
    'speed:from-bpm': () => { const el = $('speed-start'); if (el){ el.value = String(getBPM()); readInputs(); paint(); } },
  });
  paint();
}
