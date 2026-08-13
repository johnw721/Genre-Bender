/* ============================================================
   metronome.js — tempo keeper.

   Owns the master BPM (read by the sequencer and loopers via
   getBPM) plus time signature, beat-grid rendering, scheduled
   click synthesis, and tap-tempo detection.
   ============================================================ */
import { getCtx } from './audio.js';

let metroPlaying = false;
let metroBPM     = 120;
let metroBeats   = 4;
let metroBeat    = 0;
let metroNextTime = 0;
let metroTimer   = null;
let tapTimes     = [];

/* The current tempo, in BPM — the shared clock for all playback. */
export function getBPM(){ return metroBPM; }

export function setBPM(val){
  metroBPM = parseInt(val);
  const disp = document.getElementById('bpm-display');
  if (disp) disp.textContent = metroBPM;
}

export function setTimeSig(beats, btn){
  metroBeats = beats;
  metroBeat = 0;
  document.querySelectorAll('.metro-sig-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  buildBeatGrid();
}

export function buildBeatGrid(){
  const grid = document.getElementById('beat-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let i = 0; i < metroBeats; i++){
    const d = document.createElement('div');
    d.className = 'beat-dot' + (i === 0 ? ' accent' : '');
    d.id = `beat-${i}`;
    grid.appendChild(d);
  }
}

function scheduleClick(t, accent){
  const ctx = getCtx();
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.connect(g); g.connect(ctx.destination);
  o.frequency.value = accent ? 1000 : 660;
  g.gain.setValueAtTime(0.3, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  o.start(t); o.stop(t + 0.1);
}

function flashBeat(b){
  document.querySelectorAll('.beat-dot').forEach(d => d.classList.remove('active'));
  const d = document.getElementById(`beat-${b}`);
  if (d) d.classList.add('active');
}

function metroLoop(){
  const ctx = getCtx();
  const spb = 60 / metroBPM;
  while (metroNextTime < ctx.currentTime + 0.25){
    scheduleClick(metroNextTime, metroBeat === 0);
    const snap = metroBeat;
    setTimeout(() => flashBeat(snap), Math.max(0, (metroNextTime - ctx.currentTime) * 1000));
    metroNextTime += spb;
    metroBeat = (metroBeat + 1) % metroBeats;
  }
  metroTimer = setTimeout(metroLoop, 100);
}

export function toggleMetronome(){
  const btn = document.getElementById('metro-play-btn');
  if (metroPlaying){
    clearTimeout(metroTimer);
    metroPlaying = false;
    if (btn){ btn.textContent = '▶'; btn.classList.remove('playing'); btn.setAttribute('aria-pressed','false'); }
    document.querySelectorAll('.beat-dot').forEach(d => d.classList.remove('active'));
  } else {
    metroPlaying = true;
    metroBeat = 0;
    metroNextTime = getCtx().currentTime + 0.05;
    if (btn){ btn.textContent = '■'; btn.classList.add('playing'); btn.setAttribute('aria-pressed','true'); }
    metroLoop();
  }
}

export function tapTempo(){
  const now = performance.now();
  tapTimes.push(now);
  if (tapTimes.length > 8) tapTimes.shift();
  if (tapTimes.length >= 2){
    const gaps = [];
    for (let i = 1; i < tapTimes.length; i++) gaps.push(tapTimes[i] - tapTimes[i-1]);
    const avg = gaps.reduce((a,b) => a + b, 0) / gaps.length;
    const bpm = Math.max(40, Math.min(220, Math.round(60000 / avg)));
    const slider = document.getElementById('bpm-slider');
    if (slider) slider.value = bpm;
    setBPM(bpm);
  }
  // Reset the tap window if the gap got too long (new tempo intent).
  if (tapTimes.length >= 2 && (now - tapTimes[tapTimes.length - 2]) > 2000) tapTimes = [now];
}
