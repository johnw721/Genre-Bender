/* ============================================================
   loopers.js — per-card loop playback.

   Each chord card can independently loop at a fraction/multiple of
   the master tempo (½×, ¾×, 1×, 2×). A looper is just the shared
   loop engine (loopscheduler.js) driving a single chord on repeat
   at a tempo multiplier, pulsing the card while active.
   ============================================================ */
import { makeLooper } from './loopscheduler.js';
import { LOOP_RATES, LOOP_LABELS } from './config.js';

const cardLoopers = {};   // uid -> { looper, rateIdx }

export function cycleCardLoop(uid, freqs){
  const existing = cardLoopers[uid];
  const cur = existing ? existing.rateIdx : 0;
  const next = (cur + 1) % LOOP_RATES.length;
  stopCardLoop(uid);
  if (LOOP_RATES[next] !== null) startCardLoop(uid, freqs, next);
  else updateCardLoopUI(uid, 0);
}

function startCardLoop(uid, freqs, rateIdx){
  const pulse = () => {
    const card = document.querySelector(`.chord-card-item[data-uid="${uid}"]`);
    if (card && cardLoopers[uid]){
      card.classList.add('looping-active');
      setTimeout(() => {
        const c = document.querySelector(`.chord-card-item[data-uid="${uid}"]`);
        if (c) c.classList.remove('looping-active');
      }, 300);
    }
  };
  const looper = makeLooper({
    swing: true,
    onStep: pulse,
    onStop: () => {
      const card = document.querySelector(`.chord-card-item[data-uid="${uid}"]`);
      if (card) card.classList.remove('looping-active');
    },
  });
  cardLoopers[uid] = { looper, rateIdx };
  looper.start([{ freqs, beats: 4 }], { beatsPerChord: 4, mode: 'chord', rate: LOOP_RATES[rateIdx], loop: true });
  updateCardLoopUI(uid, rateIdx);
}

export function stopCardLoop(uid){
  const l = cardLoopers[uid];
  if (l){ l.looper.stop(); delete cardLoopers[uid]; }
  const card = document.querySelector(`.chord-card-item[data-uid="${uid}"]`);
  if (card) card.classList.remove('looping-active');
}

export function stopAllCardLoopers(){
  Object.keys(cardLoopers).forEach(stopCardLoop);
}

function updateCardLoopUI(uid, rateIdx){
  const btn = document.getElementById(`loop-btn-${uid}`);
  const rateel = document.getElementById(`loop-rate-${uid}`);
  if (!btn) return;
  const on = rateIdx > 0;
  btn.classList.toggle('looping', on);
  if (rateel) rateel.textContent = LOOP_LABELS[rateIdx];
}
