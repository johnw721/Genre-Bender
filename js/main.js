/* ============================================================
   main.js — application entry point.

   The HTML uses inline on* handlers (onclick="generateBlend()"
   etc.) for readability. Because these files are ES modules,
   module-scoped functions are NOT global, so we explicitly bridge
   the handlers the markup references onto window here. This keeps
   the markup declarative while the logic stays modular.

   If you prefer zero globals, replace the inline handlers in
   index.html with addEventListener calls and delete this bridge.
   ============================================================ */
import { buildLibrary, clearAll, removeByIdx, updateRatio, filterGenres, clearGenreFilter } from './library.js';
import { generateBlend } from './blend.js';
import { generateGuitar } from './guitar.js';
import { generatePiano } from './piano.js';
import { exportMidi } from './midi.js';
import { switchTab, switchInnerTab } from './ui.js';
import { openSettings, closeSettings, saveSettings } from './settings.js';
import { setBPM, setTimeSig, toggleMetronome, tapTempo, buildBeatGrid } from './metronome.js';
import { setSwing, applySwingPreset } from './swing.js';
import {
  guitarSeq, pianoSeq, toggleSeq, updateSeqBtn,
  toggleCompose, stopCompose
} from './sequencer.js';
import {
  handleCardClick, changeCardQuality,
  startEditCard, cancelEditCard, saveEditCard, deleteCard
} from './cards.js';
import { cycleCardLoop } from './loopers.js';
import {
  generatePhrase, regeneratePhrase, phrasePlay, phraseStop, exportComposerMidi,
  setComposerLayer, cycleBarLayer, cycleCell
} from './composer.js';
import {
  initFretChords, updateFretChords, fretToggleProg, fretPlayProg, fretToggleLoop,
  fretPlayChord, fretShowChord, fretReplayChord, fretStop, clearFrets, randomFrets,
  fretChangeQuality
} from './fretchords.js';
import {
  initTrainer, trainerSetMode, trainerNext, trainerAnswer, trainerCheckShape,
  trainerGiveUp, trainerPlay, trainerResetStats, trainerToggleLayer, trainerToggleView,
  trainerAddCustomChord, trainerAddCustomChordFromFrets, trainerAddSuggested,
  trainerRemoveCustomChord, trainerClearCustomChords, trainerMoveCustomChord,
  trainerStartCustomChordEdit, trainerCancelCustomChordEdit, trainerSaveCustomChordEdit,
  trainerChangeCustomChordQuality, trainerSetCustomChordPosition, trainerResetCustomChordPosition,
  trainerFitChordToKey,
  trainerSwitchTrack, trainerNewTrack, trainerRenameTrack, trainerDeleteTrack,
  trainerPlayLick, trainerRerollLick
} from './trainer.js';
import { toggleExplore, exploreOnInnerTab } from './explore.js';
import { initPersistence } from './persist.js';
import { syncKey } from './keysync.js';
import {
  exploreFretInput, exploreSetKey, exploreLoadDegree, exploreMv,
  exploreSetProg, exploreLoadProgChord, explorePlayProg, exploreStopProg,
  exploreSetScale, explorePlayBox, explorePlayShape, exploreClearFrets
} from './trainerexplore.js';

Object.assign(window, {
  // mixer / library
  buildLibrary, clearAll, removeByIdx, updateRatio, filterGenres, clearGenreFilter,
  generateBlend,
  // generators
  generateGuitar, generatePiano, exportMidi,
  // view switching (inner-tab switches feed explore mode's re-roll)
  switchTab,
  switchInnerTab: (id, btn) => { switchInnerTab(id, btn); exploreOnInnerTab(id); },
  toggleExplore,
  // shared current key
  syncKey,
  // metronome + swing
  setBPM, setTimeSig, toggleMetronome, tapTempo,
  setSwing, applySwingPreset,
  // settings
  openSettings, closeSettings, saveSettings,
  // transport + compose
  guitarSeq, pianoSeq, toggleSeq, updateSeqBtn, toggleCompose, stopCompose,
  // cards + loopers
  handleCardClick, cycleCardLoop, changeCardQuality,
  startEditCard, cancelEditCard, saveEditCard, deleteCard,
  // phrase composer
  generatePhrase, regeneratePhrase, phrasePlay, phraseStop, exportComposerMidi,
  setComposerLayer, cycleBarLayer, cycleCell,
  // frets -> chords
  updateFretChords, fretToggleProg, fretPlayProg, fretToggleLoop, fretPlayChord,
  fretShowChord, fretReplayChord, fretStop, clearFrets, randomFrets, fretChangeQuality,
  // shape trainer
  trainerSetMode, trainerNext, trainerAnswer, trainerCheckShape,
  trainerGiveUp, trainerPlay, trainerResetStats, trainerToggleLayer, trainerToggleView,
  trainerAddCustomChord, trainerAddCustomChordFromFrets, trainerAddSuggested,
  trainerRemoveCustomChord, trainerClearCustomChords, trainerMoveCustomChord,
  trainerStartCustomChordEdit, trainerCancelCustomChordEdit, trainerSaveCustomChordEdit,
  trainerChangeCustomChordQuality, trainerSetCustomChordPosition, trainerResetCustomChordPosition,
  trainerFitChordToKey,
  trainerSwitchTrack, trainerNewTrack, trainerRenameTrack, trainerDeleteTrack,
  trainerPlayLick, trainerRerollLick,
  // trainer explore sandbox
  exploreFretInput, exploreSetKey, exploreLoadDegree, exploreMv,
  exploreSetProg, exploreLoadProgChord, explorePlayProg, exploreStopProg,
  exploreSetScale, explorePlayBox, explorePlayShape, exploreClearFrets,
});

/* Boot */
buildLibrary();
buildBeatGrid();
initFretChords();
initTrainer();
initPersistence();   // last: restore reads the UI the inits above built
