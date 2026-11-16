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
  fretChangeQuality, refreshFretLabels
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
  trainerPlayLick, trainerRerollLick, trainerRedraw, trainerAddPaletteFromFrets,
  trainerRecolorTrack, trainerColorChord,
  trainerPreviewCustomChordPosition, trainerStepCustomChordPosition, trainerUseTrackKey
} from './trainer.js';
import { initSeedImport, seedImportFile } from './seedimport.js';
import { trainerNav, trainerOpenColorMap, trainerOnTab, initTrainerNav } from './trainernav.js';
import { initShortcuts, toggleShortcutHelp } from './shortcuts.js';
import { initColorMap } from './colormap.js';
import {
  palettePlay, paletteRemove, paletteAddByName, paletteFillFromControls, paletteClear,
  paletteSetFollow, paletteFollowsKey, paletteSetFlavour, paletteKeep
} from './chordpalette.js';
import { toggleExplore, exploreOnInnerTab } from './explore.js';
import { initPersistence } from './persist.js';
import { initActions, hasAction, actionNames } from './actions.js';
import { initKeyPickers } from './keypicker.js';
import { initClips } from './clips.js';
import { initAnalyze } from './analyze.js';
import { initSongImport } from './songimport.js';
import { initProgTab } from './progtab.js';
import { initNav } from './nav.js';
import { initChordFinder } from './chordfinder.js';
import { initStudy } from './study.js';
import { initGuided, guidedOnTab } from './guided.js';
import { initPractice, practiceOnTab } from './practice.js';
import {
  toggleFretLabels, toggleChordLabels, onLabelsChange, syncLabelToggleUI
} from './labels.js';
import { store } from './store.js';
import { renderGuitarTab } from './guitar.js';
import { renderPianoChart } from './piano.js';
import { restorePhraseView } from './composer.js';
import { syncKey, initKeySync } from './keysync.js';
import { hooktheorySmokeTest } from './hooktheory.js';
import { initHooktheoryUI } from './hooktheoryui.js';
import { initProgTools } from './progtools.js';
import { initTips } from './tips.js';
import { initMidiIn, _midiFeed, _midiFlush } from './midiin.js';
import { initSpeedTrainer, rampTempo, speedChords } from './speedtrainer.js';
import {
  exploreFretInput, exploreSetKey, exploreLoadDegree, exploreMv,
  exploreSetProg, exploreLoadProgChord, explorePlayProg, exploreStopProg,
  exploreSetScale, explorePlayBox, explorePlayShape, exploreClearFrets
} from './trainerexplore.js';

/* Newer modules (clips, analyze, settings backup) register handlers with
   actions.js and use data-action markup instead of this bridge. The one
   namespaced global below is for the build verifier + devtools. */
window.GenreBender = {
  hasAction, actionNames, hooktheorySmokeTest,
  // test hooks for build/verify-single-file.mjs (and devtools poking)
  _test: { store, renderGuitarTab, renderPianoChart, midiFeed: _midiFeed, midiFlush: _midiFlush, rampTempo, speedChords },
};

Object.assign(window, {
  // seed packs (My chords)
  seedImportFile, trainerUseTrackKey,
  // mixer / library
  buildLibrary, clearAll, removeByIdx, updateRatio, filterGenres, clearGenreFilter,
  generateBlend,
  // generators
  generateGuitar, generatePiano, exportMidi,
  // view switching (inner-tab switches feed explore mode's re-roll)
  switchTab: (id) => { switchTab(id); guidedOnTab(id); practiceOnTab(id); trainerOnTab(id); },
  switchInnerTab: (id, btn) => { switchInnerTab(id, btn); exploreOnInnerTab(id); },
  toggleExplore,
  // shared current key
  syncKey,
  // notation labelling (fret numbers <-> notes, chord names <-> degrees)
  toggleFretLabels, toggleChordLabels,
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
  trainerPlayLick, trainerRerollLick, trainerAddPaletteFromFrets,
  trainerRecolorTrack, trainerColorChord,
  trainerPreviewCustomChordPosition, trainerStepCustomChordPosition, trainerOpenColorMap, trainerNav,
  toggleShortcutHelp,
  // chord table (drag-and-drop palette inside "My chords")
  palettePlay, paletteRemove, paletteAddByName, paletteFillFromControls, paletteClear,
  paletteSetFollow, paletteFollowsKey, paletteSetFlavour, paletteKeep,
  // trainer explore sandbox
  exploreFretInput, exploreSetKey, exploreLoadDegree, exploreMv,
  exploreSetProg, exploreLoadProgChord, explorePlayProg, exploreStopProg,
  exploreSetScale, explorePlayBox, explorePlayShape, exploreClearFrets,
});

/* ---- notation labelling ---------------------------------------------------
   The two header toggles are global, so one subscriber repaints every panel
   that renders a fret number or a chord name. Each repaint is guarded: a
   panel with no content (or one that throws) must not stop the others. */
function repaintForLabels(){
  const val = (id) => document.getElementById(id)?.value;
  if (store.guitarTabData){
    try { renderGuitarTab(store.guitarTabData, val('guitar-style') || 'chord_progression'); }
    catch (e) { console.error('relabel guitar:', e); }
  }
  if (store.pianoChordData){
    try { renderPianoChart(store.pianoChordData, val('piano-style') || 'chord_voicings'); }
    catch (e) { console.error('relabel piano:', e); }
  }
  if (store.phraseData){
    try { restorePhraseView(); } catch (e) { console.error('relabel phrase:', e); }
  }
  try { refreshFretLabels(); } catch (e) { console.error('relabel frets:', e); }
  try { trainerRedraw(); } catch (e) { console.error('relabel trainer:', e); }
}
onLabelsChange(repaintForLabels);

/* Boot */
initActions();       // data-action delegation must exist before any module registers
initKeyPickers();    // split every key <select> into letter · accidental · mode (before persistence restores values)
buildLibrary();
buildBeatGrid();
initFretChords();
initTrainer();
initColorMap();      // color map handlers (data-action) + follow the app key
initTrainerNav();    // 05 — Shape Trainer sub-tabs, color map mount, sidebar trainer card
initShortcuts();     // T / C / M, 1–7, N, Space, H, ? (keyboard)
syncLabelToggleUI();   // light the toggles to match the saved preference
initClips();         // reference clips player (restores saved list + dock mode)
initSeedImport();    // seed packs: #seed= links, ⤓ seed pack file, GenreBender.applySeedPack
initAnalyze();       // "03 — Analyze Track" (reads the clips list)
initSongImport();    // "Learn a song": paste / lookup / audio → unit → My chords track
initProgTab();       // floating progression "hover tab" for the active My chords track
initGuided();        // "02 — Guided Workflow" stepper over existing actions
initPractice();      // "04 — Practice" daily plans (reads trainer / clips / store)
initSpeedTrainer();  // tempo-ramp loop inside the practice tab
initHooktheoryUI();  // connect dialog, header state, realism-mode selects
initMidiIn();        // MIDI keyboard → live chord names → My chords / chord table
initProgTools();     // history + voice-leading / transpose / capo strip (before restore renders)
initPersistence();   // restore reads the UI the inits above built
initKeySync();       // last: mirror the restored guitar key into the rail + other selects
initStudy();
initTips();          // 💡 tips toggle (⋯ menu) + 3-step first-run tour         // ⤢ study view: pasted link + color map + My chords + chord library, resizable
initChordFinder();   // 🔎 quick chord search: shapes, color-map location, captions → tracks
initNav();           // shell: Songs / Play / Practice / Create, menu, theme, transport popovers
