/* ============================================================
   sequencer.js — tempo-locked playback for each instrument.

   makeSeq() builds an independent transport (guitar + piano each
   get one). The actual scheduling/looping/swing now lives in the
   shared loop engine (loopscheduler.js); this module is just the
   instrument-specific facade: it wires the engine's per-chord
   callback to light up the matching card + position dot, and keeps
   the small public API the markup relies on (.start/.stop/.playing).
   Compose mode starts both transports from one shared start time so
   they stay locked together.
   ============================================================ */
import { getCtx } from './audio.js';
import { getSeqChords } from './cards.js';
import { store } from './store.js';
import { makeLooper } from './loopscheduler.js';

function makeSeq(id){
  const cardSelector = `.chord-card-item[data-seq="${id}"]`;
  const dotPrefix    = `seq-dot-${id}-`;

  const clearHighlights = () => {
    document.querySelectorAll(`${cardSelector}.playing`).forEach(c => c.classList.remove('playing'));
    document.querySelectorAll(`[id^="${dotPrefix}"].active`).forEach(d => d.classList.remove('active'));
  };

  const looper = makeLooper({
    swing: true,
    onStep(snap){
      clearHighlights();
      const card = document.querySelector(`${cardSelector}[data-chord-idx="${snap}"]`);
      if (card) card.classList.add('playing');
      const dot = document.getElementById(`${dotPrefix}${snap}`);
      if (dot) dot.classList.add('active');
    },
    onStop: clearHighlights,
  });

  // Facade: the small surface the rest of the app (and inline
  // handlers) use — .playing, .start(chords, beats, mode[, startTime]),
  // .stop(). Guitar/piano loop continuously, so loop is always true.
  return {
    id,
    get playing(){ return looper.playing; },
    start(chords, beatsPerChord, mode, startTime){
      looper.start(chords, {
        beatsPerChord: beatsPerChord || 4,
        mode: mode || 'chord',
        loop: true,
        startTime,
      });
    },
    stop(){ looper.stop(); },
  };
}

export const guitarSeq = makeSeq('guitar');
export const pianoSeq  = makeSeq('piano');

export function stopAllSeqs(){ guitarSeq.stop(); pianoSeq.stop(); updateComposeBanner(); }

/* ---- transport buttons --------------------------------------------------- */
export function toggleSeq(instrument){
  const seq  = instrument === 'guitar' ? guitarSeq : pianoSeq;
  const data = instrument === 'guitar' ? store.guitarTabData : store.pianoChordData;
  if (seq.playing){ seq.stop(); updateSeqBtn(instrument); return; }
  if (!data || !data.chords) return;
  const mode = document.getElementById(`${instrument}-pb-mode`)?.value || 'chord';
  const chords = getSeqChords(instrument, data.chords);
  if (!chords.length) return;
  seq.start(chords, chords[0].beats || 4, mode);
  updateSeqBtn(instrument);
}

export function updateSeqBtn(instrument){
  const seq = instrument === 'guitar' ? guitarSeq : pianoSeq;
  const btn = document.getElementById(`${instrument}-play-btn`);
  if (!btn) return;
  btn.textContent = seq.playing ? '⏸ playing...' : '▶ play in tempo';
  btn.classList.toggle('active-playing', seq.playing);
}

/* ---- compose: play guitar + piano together ------------------------------- */
let composeActive = false;

export function toggleCompose(){
  if (composeActive){ stopCompose(); return; }
  if (!store.guitarTabData || !store.pianoChordData) return;
  composeActive = true;
  guitarSeq.stop(); pianoSeq.stop();
  const gMode = document.getElementById('guitar-pb-mode')?.value || 'chord';
  const pMode = document.getElementById('piano-pb-mode')?.value || 'chord';
  const gChords = getSeqChords('guitar', store.guitarTabData.chords);
  const pChords = getSeqChords('piano',  store.pianoChordData.chords);
  if (!gChords.length || !pChords.length){ composeActive = false; return; }
  // Anchor both transports to one shared future start time.
  const startTime = getCtx().currentTime + 0.05;
  guitarSeq.start(gChords, gChords[0].beats || 4, gMode, startTime);
  pianoSeq.start(pChords, pChords[0].beats || 4, pMode, startTime);
  updateSeqBtn('guitar'); updateSeqBtn('piano'); updateComposeBanner();
}

export function stopCompose(){
  composeActive = false; guitarSeq.stop(); pianoSeq.stop();
  updateSeqBtn('guitar'); updateSeqBtn('piano'); updateComposeBanner();
}

export function updateComposeBanner(){
  const banner = document.getElementById('compose-banner');
  const btn = document.getElementById('compose-btn');
  if (!banner) return;
  const hasGuitar = !!store.guitarTabData, hasPiano = !!store.pianoChordData;
  banner.style.display = hasGuitar && hasPiano ? 'flex' : 'none';
  if (banner.style.display === 'none') return;
  banner.classList.toggle('active', composeActive);
  if (btn){
    btn.textContent = composeActive ? '⏸ composing...' : '⊕ Compose';
    btn.classList.toggle('active-playing', composeActive);
  }
}
