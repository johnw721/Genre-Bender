/* ============================================================
   audio.js — WebAudio synthesis primitives.

   Owns the shared AudioContext and the voice used everywhere
   (a triangle oscillator + an octave-up sine for body). Higher
   layers (sequencer, loopers, metronome) schedule against these.
   ============================================================ */
import { swingOffsetSec } from './swing.js';

let audioCtx = null;

/* Lazily create / resume a single AudioContext (must be triggered
   by a user gesture the first time, per browser autoplay rules). */
export function getCtx(){
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  // 'suspended' is the desktop autoplay gate; iOS also parks the context in
  // 'interrupted' after a phone call, app switch or screen lock and never
  // resumes it on its own — so resume from anything that isn't running.
  if (audioCtx.state !== 'running'){
    const r = audioCtx.resume();
    if (r && r.catch) r.catch(() => {});
  }
  return audioCtx;
}

/* iOS unlock: Safari only lets a context start from inside a user gesture,
   and on some versions only once a sound has actually been started in that
   gesture. Play one silent sample on the first touch/click/key anywhere so
   every later playback (buttons, card taps, sequencers) just works. */
function unlockAudio(){
  try {
    const ctx = getCtx();
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
  } catch { /* best effort */ }
  UNLOCK_EVENTS.forEach(ev => document.removeEventListener(ev, unlockAudio, true));
}
const UNLOCK_EVENTS = ['touchend', 'pointerdown', 'keydown'];
if (typeof document !== 'undefined'){
  UNLOCK_EVENTS.forEach(ev => document.addEventListener(ev, unlockAudio, { capture: true, passive: true }));
  // Re-arm after iOS interrupts the context (call, lock, app switch).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && audioCtx && audioCtx.state !== 'running') getCtx();
  });
}

/* One plucked/struck voice at frequency hz starting at time t. */
export function playNote(hz, t, dur, vol = 0.16, wave = 'triangle'){
  const ctx = getCtx();
  const o = ctx.createOscillator(),  g  = ctx.createGain();
  const o2 = ctx.createOscillator(), g2 = ctx.createGain();
  o.type = wave;  o.frequency.value = hz;
  o2.type = 'sine'; o2.frequency.value = hz * 2;
  o.connect(g);  g.connect(ctx.destination);
  o2.connect(g2); g2.connect(ctx.destination);
  const atk = 0.005, dec = Math.min(dur * 0.8, 0.8);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + atk);
  g.gain.exponentialRampToValueAtTime(0.001, t + atk + dec);
  g2.gain.setValueAtTime(0, t);
  g2.gain.linearRampToValueAtTime(vol * 0.3, t + atk);
  g2.gain.exponentialRampToValueAtTime(0.001, t + atk + dec * 0.6);
  o.start(t);  o.stop(t + atk + dec + 0.05);
  o2.start(t); o2.stop(t + atk + dec * 0.6 + 0.05);
}

/* Block chord: all notes together with a tiny humanizing spread. */
export function playChordAtTime(freqs, t, dur){
  freqs.forEach((hz, i) => playNote(hz, t + i * 0.015, dur, 0.14));
}

/* Arpeggio: notes spread across the duration, swing on odd indices. */
export function playArpeggioAtTime(freqs, t, dur, spb){
  const n = freqs.length;
  const gap = dur / (n + 1);
  const beatSpb = spb || (dur / 4);
  freqs.forEach((hz, i) => {
    const swing = swingOffsetSec(beatSpb, i);
    playNote(hz, t + i * gap + swing, gap * 2, 0.17);
  });
}

/* Strum: quick downward sweep, swing on up-strokes (odd indices). */
export function playStrumAtTime(freqs, t, dur, spb){
  const beatSpb = spb || (dur / 4);
  freqs.forEach((hz, i) => {
    const swing = swingOffsetSec(beatSpb, i);
    playNote(hz, t + i * 0.04 + swing, dur * 0.9, 0.15);
  });
}

/* Immediate one-shot used for tapping a chord card. */
export function playChordNow(freqs){
  playChordAtTime(freqs, getCtx().currentTime, 1.2);
}

/* ============================================================
   Technique voice (added for the phrase composer).
   A monophonic lead voice that supports pitch ramps (slide/bend),
   legato re-pitch (hammer/pull) and vibrato. Distinct timbre from
   the chord voice above so lead lines sit on top of comping.
   ============================================================ */
function leadVoice(hzStart, hzEnd, t, dur, opts = {}){
  const ctx = getCtx();
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(hzStart, t);
  if (hzEnd && hzEnd !== hzStart){
    const rampDur = opts.legato ? Math.min(0.05, dur * 0.35) : dur * 0.6;
    try { o.frequency.exponentialRampToValueAtTime(Math.max(1, hzEnd), t + rampDur); }
    catch { o.frequency.linearRampToValueAtTime(hzEnd, t + rampDur); }
  }
  // gentle lowpass so the saw isn't harsh
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 2600;
  o.connect(lp); lp.connect(g); g.connect(ctx.destination);
  const vol = opts.vol ?? 0.16;
  const atk = opts.legato ? 0.002 : 0.006;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + atk);
  g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.08, dur));
  if (opts.vibrato){
    const lfo = ctx.createOscillator(), la = ctx.createGain();
    lfo.type = 'sine'; lfo.frequency.value = 5.5; la.gain.value = hzStart * 0.018;
    lfo.connect(la); la.connect(o.frequency);
    lfo.start(t); lfo.stop(t + dur + 0.05);
  }
  o.start(t); o.stop(t + dur + 0.06);
}

/* Play one lead event (see techniques.js) at time t, beat = spb seconds. */
export function playLeadEvent(ev, t, spb){
  const dur = (ev.beats || 0.5) * spb;
  const hz = ev.hz;
  switch (ev.technique){
    case 'slide':
    case 'bend':
      leadVoice(hz, ev.to ? ev.to.hz : hz, t, dur, {}); break;
    case 'hammer':
    case 'pull':
      leadVoice(hz, ev.to ? ev.to.hz : hz, t, dur, { legato: true }); break;
    case 'vibrato':
      leadVoice(hz, hz, t, dur, { vibrato: true }); break;
    default:
      leadVoice(hz, hz, t, dur, {});
  }
}
