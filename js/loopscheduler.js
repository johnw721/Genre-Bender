/* ============================================================
   loopscheduler.js — the single chord-loop engine.

   Every "play a sequence of chords against the metronome clock"
   feature in the app (the guitar/piano sequencers, the per-card
   loopers, and the Frets→chords progressions) used to hand-roll
   the same self-scheduling tick loop. This module is that loop,
   factored out once:

     • schedules chords ahead of the audio clock (glitch-free),
     • re-reads BPM every tick so tempo changes track live,
     • applies chord-level swing,
     • supports a tempo multiplier (½×, 1×, 2× …),
     • loops forever OR plays a single pass then stops,
     • lets two loopers share one start time (compose sync),
     • calls back on each chord (highlight) and on stop (cleanup).

   makeLooper() returns a controller. It owns NO DOM and NO chord
   theory — callers pass in chords ({ freqs, beats? }) and DOM
   highlighting via the onStep / onStop callbacks.
   ============================================================ */
import { getCtx, playChordAtTime, playArpeggioAtTime, playStrumAtTime } from './audio.js';
import { swingOffsetSec } from './swing.js';
import { getBPM } from './metronome.js';

const TICK_SEC = 0.1;          // how often the scheduler wakes up
const LEAD_SEC = 0.05;         // default lead-in before the first chord

/* Schedule one chord's audio at time `t` (already swung). */
function voiceChord(mode, freqs, t, dur, spb){
  if (!freqs || !freqs.length) return;
  if (mode === 'arpeggio')   playArpeggioAtTime(freqs, t, dur * 0.95, spb);
  else if (mode === 'strum') playStrumAtTime(freqs, t, dur, spb);
  else                        playChordAtTime(freqs, t, dur * 0.9);
}

/*
  makeLooper({ swing=true, onStep, onStop })

  onStep(index, time, ctx) fires (via a timer aligned to the chord's
  start) once per scheduled chord — use it to light up UI.
  onStop() fires whenever playback stops (manual, restart, or the
  natural end of a one-shot pass) — use it to clear UI + buttons.
*/
export function makeLooper({ swing = true, onStep = null, onStop = null } = {}){
  const L = {
    playing: false,
    loop: true,
    mode: 'chord',
    rate: 1,
    beatsPerChord: 4,
    chords: [],
    pos: 0,
    nextTime: 0,
    timer: null,
    _stepTimers: [],
  };

  /* Start (or restart) playback.
     opts: { beatsPerChord, mode, rate, loop, startTime } */
  L.start = function(chords, opts = {}){
    L.stop();
    if (!chords || !chords.length) return;
    L.chords        = chords;
    L.beatsPerChord = opts.beatsPerChord || 4;
    L.mode          = opts.mode  || 'chord';
    L.rate          = opts.rate  || 1;
    L.loop          = opts.loop !== false;          // default: loop
    L.pos           = 0;
    L.playing       = true;
    L.nextTime      = (typeof opts.startTime === 'number')
      ? opts.startTime
      : getCtx().currentTime + LEAD_SEC;
    L._tick();
  };

  L.stop = function(){
    const wasActive = L.playing || L.timer || L._stepTimers.length;
    L.playing = false;
    clearTimeout(L.timer); L.timer = null;
    L._stepTimers.forEach(clearTimeout); L._stepTimers = [];
    if (wasActive && onStop) onStop();
  };

  L._tick = function(){
    if (!L.playing) return;
    const ctx = getCtx();
    const spb = 60 / (getBPM() * L.rate);
    const window = spb * L.beatsPerChord + 0.2;     // schedule-ahead horizon

    while (L.nextTime < ctx.currentTime + window){
      const snap  = L.pos % L.chords.length;
      const chord = L.chords[snap];
      const beats = (chord && chord.beats) || L.beatsPerChord;
      const dur   = spb * beats;
      const t     = L.nextTime;
      const tPlay = swing ? t + swingOffsetSec(spb * beats, L.pos % 2) : t;

      voiceChord(L.mode, chord && chord.freqs, tPlay, dur, spb);

      if (onStep){
        const delay = Math.max(0, (t - ctx.currentTime) * 1000);
        L._stepTimers.push(setTimeout(() => onStep(snap, t, ctx), delay));
      }

      L.nextTime += dur;
      L.pos++;

      // One-shot: once the final chord is scheduled, arm a stop and
      // do not reschedule the tick.
      if (!L.loop && L.pos >= L.chords.length){
        const stopDelay = Math.max(0, (L.nextTime - ctx.currentTime) * 1000) + 60;
        L._stepTimers.push(setTimeout(() => L.stop(), stopDelay));
        L.timer = null;
        return;
      }
    }
    L.timer = setTimeout(L._tick, TICK_SEC * 1000);
  };

  return L;
}
