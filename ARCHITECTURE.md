# Genre Bender — Architecture & Project Hierarchy

This document maps the file structure, what each module owns, how the
modules depend on one another, and how data flows through the app.

---

## 0. Shell (face-lift, Phase 1)

Four destinations over the existing panels — nothing was renamed, so old entry points still work:

| Destination | Panels | Sub-nav |
|---|---|---|
| **Songs** (home) | `panel-upload` — song library cards, *Learn a song* and *Describe a clip* as folds | — |
| **Play** | `panel-trainer` (sub `chords` / `colormap`) | My chords · Color map |
| **Practice** | `panel-practice`, `panel-trainer` (sub `drills`) | Today · Drills |
| **Create** | `panel-mixer`, `panel-guided` | Genre mixer · Guided workflow |

`nav.js` owns the top bar, sub-nav, ⋯ menu, transport popovers and the light/dark theme
(`GenreBenderTheme_v1`, applied before first paint by an inline script). `ui.switchTab` and
`trainernav.applySub` fire `gb:nav`; `nav.refresh()` reads what is on screen and repaints, so the
nav can never disagree with the view. The old left rail is gone: tempo keeper + key live in the
**transport bar** (`#transport`, same element ids), the active track's progression is the
transport strip (`progtab.js`, one looper; the old floating hover tab is retired — its track
switcher + beats moved into the strip's track popover), MIDI is a floating card, the session blend
sits atop Create and the trainer shortcuts atop Practice.

**Play is one workspace** (`study.js`): video pane (`#cm-clip`, folded away until a clip is
loaded), color map and My chords + chord library, resizable, side-by-side or stacked, phone tabs.
`trainerNav('chords'|'colormap')` opens it and focuses that pane; Drills stay under Practice.
Opening a saved clip routes into Play (`clips.setClipOpenRoute`) — there is one video player.

**Feedback**: `toast.js` gives one bottom toast — `✓ …` for saves/adds, and **Undo** (6 s) for
deletes instead of `confirm()` (delete/clear track, clear/remove shapes, delete saved song).
**Tips**: instruction text carries `.tip` and only shows with `body.show-tips` (⋯ → Show tips);
`tips.js` also runs a 3-step first-run tour (`GenreBenderTips_v1`, skip with `?notour`).
**Touch**: `chordpeek.isTouch()` (coarse pointer / last pointer was a finger, or
`window.__gbForceTouch`) makes chord cards carry **+ track / + keep** buttons, since drag-and-drop
doesn't work on phones; coarse pointers get ≥44 px targets.

Styling: `tokens.css` (palette, `--ui` system sans, `--code` DM Mono, radii, light theme) →
feature sheets → `theme.css` (shared component restyle) → `layout.css` (shell, transport, Songs
cards, phone breakpoints at 720 / 420 px).

---

## 1. File tree

```
genre-bender/
├── index.html              # Markup + a11y attributes; links CSS, loads js/main.js as a module
├── README.md               # Overview, how to run, self-hosting + Lambda proxy
├── ARCHITECTURE.md         # This file
├── .gitignore
│
├── css/                    # One stylesheet per concern, loaded in cascade order
│   ├── tokens.css          # :root design tokens + prefers-reduced-motion
│   ├── base.css            # Reset, body, background grid, .app shell, cursor, warnings
│   ├── header-tabs.css     # Header, logo, top-level tabs, panels, section labels
│   ├── mixer.css           # Genre library, chips, selected bar, sliders, blend output
│   ├── metronome.css       # Metronome, beat grid, swing row, chord-count row
│   ├── notation.css        # Tab panel, playback toolbar, chord cards, loopers, compose banner
│   ├── clips.css           # Reference-clips player (docked / floating modes)
│   └── shell.css           # Two-pane layout: sticky left rail + main column; analyze panel
│
└── js/                     # ES modules (no bundler)
    ├── config.js           # Static config: GENRES, MAX_GENRES, API_CONFIG, LOOP_RATES/LABELS
    ├── util.js             # escHtml(), extractJSON()
    ├── store.js            # Shared mutable state: selected[], guitarTabData, pianoChordData
    ├── api.js              # callClaude() — single fetch wrapper around the AI endpoint
    ├── theory.js           # Note/MIDI/Hz conversion + chord validation (uses window.Tonal)
    ├── swing.js            # Swing amount state + swingOffsetSec() timing helper
    ├── audio.js            # Web Audio: context, playNote/chord/arp/strum scheduling
    ├── metronome.js        # BPM/time-sig state, beat grid, metronome transport, tap tempo
    ├── sequencer.js        # Tempo-locked guitar/piano sequencers + Compose sync
    ├── loopers.js          # Per-card loop scheduling
    ├── cards.js            # Chord-card DOM: build, click, drag-reorder, rebuild
    ├── blend.js            # Mixer "creative direction" generation + render
    ├── guitar.js           # Guitar-tab generation + render
    ├── piano.js            # Piano chord-chart generation + render
    ├── midi.js             # Pure-JS Standard MIDI File (type-1) export
    ├── ui.js               # Tab / inner-tab view switching
    ├── library.js          # Genre library UI, selection, ratios, sync
    ├── storage.js          # loadJSON/saveJSON + store registry → exportAll/importAll backup
    ├── actions.js          # data-action event delegation (replacement for the window bridge)
    ├── clips.js            # Reference-clips player: URL→embed parser, saved list, seed mixer, JSON I/O
    ├── analyze.js          # Analyze Track v1: AI genre/BPM/key inference from clip text
    ├── guided.js           # Guided Workflow: stepper deriving done/current from store + clips; buttons call existing actions
    ├── chordpalette.js     # "Chord table": persisted draggable chord-diagram cards inside the trainer's "My chords" track view
    ├── colormap.js         # "Color map": per-degree color ladders (in scale / out of scale / parallel views) + recolor helpers
    ├── keypicker.js        # Split key input: every select[data-keypick] becomes letter · ♮♯♭ · maj/min (hidden select stays the source of truth)
    ├── melody.js           # Melody lens: parse typed notes/frets, score chord fit (tones / colour / ♭9 clash), keys that hold the melody
    ├── melodyneck.js       # Melody on the fretboard: exact frets, or a suggested fingering window + path (SVG)
    ├── shortcuts.js        # Keyboard shortcuts (T/C/M, 1–7, N, Space, H, ?) + help overlay
    ├── practice.js         # 04 — Practice: three daily plans as live steppers (auto steps read store/clips/trainer/SRS; manual ticks per day)
    ├── trainernav.js       # 05 — Shape Trainer tab: Drills / My chords / Color map sub-tabs + the sidebar trainer card
    ├── speedtrainer.js     # Practice-tab tempo ramp: loops a progression, +N BPM every M passes to a target; best tempo per source
    ├── hooktheory.js       # Hooktheory Trends layer (no DOM): auth, cached trends fetch, degree mapping, realism scoring + realismPass, sampled skeletons, smoke test
    ├── hooktheoryui.js     # Hooktheory connect dialog, header state (incl. expiry), realism-mode selects
    ├── voicelead.js        # Pure progression math: motion, guitar/piano voice-leading (Viterbi), transpose names/notes/tab, capo suggestion
    ├── progtools.js        # Tools strip under guitar/piano output: realism badge, motion, smooth, transpose, capo, history + A/B + undo
    ├── midiin.js           # Web MIDI input: live chord naming (+ degree), sustain pedal, → My chords / chord table, auto-add
    └── main.js             # Entry point: imports modules, bridges handlers to window, boots
```

---

## 2. Layered dependency model

Modules are organized in rough layers. Arrows point **downward** (a layer
imports only from layers below it), except for the documented circular pair
in the feature layer.

```
                         ┌───────────┐
   entry / boot          │  main.js  │
                         └─────┬─────┘
                               │ imports + window-bridge
      ┌────────────────────────┼─────────────────────────────┐
      ▼                        ▼                              ▼
  feature layer          feature layer                  feature layer
  blend.js  guitar.js    library.js  ui.js              sequencer.js ⇄ cards.js
  piano.js  midi.js                                     loopers.js
      │          │             │                              │
      └────┬─────┴──────┬──────┴───────────┬──────────────────┘
           ▼            ▼                   ▼
       service layer
   api.js   audio.js   metronome.js   swing.js   theory.js
           │            │                   │        │
           └────────────┴─────────┬─────────┴────────┘
                                  ▼
                          foundation layer
                   config.js     util.js     store.js
                                  │
                                  ▼
                       external (CDN, global)
                          window.Tonal
```

- **Foundation** (`config`, `util`, `store`) imports nothing internal.
- **Cross-cutting** (added later): `theorydata.js` (shared trainer
  vocabulary — keys, romans, barre shapes, progression templates,
  scale-box notes), `keysync.js` (one current key across all panels'
  key selects + the trainer explore sandbox), and `persist.js`
  (session persistence: genres/ratios, blend, tab, chart, phrase,
  BPM, swing and form controls survive a refresh via localStorage;
  restored at boot through the same exported render functions the
  generators use — `blend.renderResult`, `guitar.renderGuitarTab`,
  `piano.renderPianoChart`, `composer.restorePhraseView`).
- **Service** modules wrap one capability each (network, sound, tempo,
  swing, music theory) and depend only on foundation.
- **Feature** modules orchestrate services into user-facing actions.
- **Entry** (`main.js`) wires everything and exposes the handlers the inline
  HTML refers to.

---

## 3. Module responsibilities & key exports

| Module | Owns | Key exports |
|---|---|---|
| `config.js` | All static config | `GENRES`, `MAX_GENRES`, `API_CONFIG`, `LOOP_RATES`, `LOOP_LABELS` |
| `util.js` | Generic helpers | `escHtml`, `extractJSON` |
| `store.js` | Shared mutable state | `store` (`.selected`, `.guitarTabData`, `.pianoChordData`), `clearSelected` |
| `api.js` | AI calls | `callClaude(messages, {maxTokens})` |
| `theory.js` | Music math | `noteToMidi`, `midiToHz`, `noteToHz`, `parseNoteString`, `validateChordList` |
| `swing.js` | Swing feel | `getSwing`, `setSwing`, `applySwingPreset`, `swingOffsetSec` |
| `audio.js` | Sound output | `getCtx`, `playNote`, `playChordAtTime`, `playArpeggioAtTime`, `playStrumAtTime`, `playChordNow` |
| `metronome.js` | Tempo + click | `getBPM`, `setBPM`, `setTimeSig`, `buildBeatGrid`, `toggleMetronome`, `tapTempo` |
| `loopscheduler.js` | Shared chord-loop engine (schedule-ahead, swing, rate, loop/one-shot, start-time sync) | `makeLooper` |
| `sequencer.js` | Tempo-locked playback (delegates to loopscheduler) | `guitarSeq`, `pianoSeq`, `toggleSeq`, `updateSeqBtn`, `stopAllSeqs`, `toggleCompose`, `stopCompose`, `updateComposeBanner` |
| `loopers.js` | Per-card loops (delegates to loopscheduler) | `cycleCardLoop`, `stopCardLoop`, `stopAllCardLoopers` |
| `cards.js` | Chord-card DOM | `buildChordCardHTML`, `handleCardClick`, `initDragDrop`, `rebuildCardsUI`, `getSeqChords` |
| `blend.js` | Mixer output | `generateBlend`, `renderResult` |
| `guitar.js` | Guitar tab | `generateGuitar`, `renderGuitarTab` |
| `piano.js` | Piano chart | `generatePiano`, `renderPianoChart` |
| `fretchords.js` | Frets → live progressions (local, no AI; per-progression loop via loopscheduler) | `initFretChords`, `updateFretChords`, `fretToggleProg`, `fretToggleLoop`, `fretPlayChord`, `clearFrets`, `randomFrets` |
| `midi.js` | Export | `exportMidi` |
| `ui.js` | View switching | `switchTab`, `switchInnerTab` |
| `storage.js` | One door to localStorage; registry of stores for backup | `registerStore`, `loadJSON`, `saveJSON`, `removeKey`, `exportAll`, `importAll`, `downloadJSON` |
| `actions.js` | `data-action` / `data-on-change` / `data-on-input` / `data-on-enter` delegation | `registerActions`, `initActions`, `hasAction`, `actionNames` |
| `clips.js` | Reference clips player (X / Instagram / TikTok / YouTube embeds; list under `GenreBenderClips_v1`, dock prefs under `GenreBenderClipDock_v1`); seed mixer → `store.reference` | `parseClipUrl`, `matchGenres`, `normalizeKey`, `initClips`, `clipsAdd`, `clipsOpen`, `clipsRemove`, `clipsUpdate`, `clipsSeedMixer`, `clipsClearReference`, `clipsUseBpm`, `clipsCaptureBpm`, `clipsExport`, `clipsImport`, `getClips`, `getClip`, `getActiveClip`, `onClipsChange` |
| `analyze.js` | Analyze Track v1 (text-based inference; writes tags back, seeds mixer) | `initAnalyze`, `analyzeClip` |
| `guided.js` | Guided Workflow stepper (no state of its own; re-renders on tab show, clip changes, light poll) | `initGuided`, `renderGuided`, `guidedOnTab` |
| `practice.js` | Practice plans A/B/C (`GenreBenderPractice_v1`: chosen plan, per-day manual ticks, completion log → streak); plan B rotates the drill mode by weekday | `initPractice`, `renderPractice`, `practiceOnTab`, `practiceSetPlan`, `todaysMode` |
| `hooktheory.js` | Optional Hooktheory Trends layer — session-only activkey, 2-chord-context realism scoring (rare floor; unmapped chords skip only their moves), weighted skeleton sampling, realism modes (`score` / `conventional` / `balanced` / `adventurous`) | `hooktheoryAuth`, `hooktheoryLogout`, `onHooktheoryChange`, `fetchChordTrend`, `symbolToDegree`, `degreeToSymbol`, `scoreProgressionRealism`, `realismPass`, `buildTrendSkeleton`, `sampleNode`, `getRealismMode`, `setRealismMode`, `hooktheorySmokeTest` |
| `hooktheoryui.js` | Connect dialog (masked password), header button state, mode selects | `initHooktheoryUI` |
| `voicelead.js` | Deterministic progression math (pure, node-testable) | `motionBetween`, `progressionMotion`, `smoothGuitarVoicings`, `smoothPianoVoicings`, `voicingsToTab`, `transposeChordName`, `transposeKey`, `transposeNotes`, `transposeTab`, `suggestCapo`, `capoVoicings` |
| `progtools.js` | Tools strip + history (`GenreBenderHistory_v1`, 15 + 15 starred per instrument). Edits copy the current result, snapshot it, re-render — so A/B compares real versions | `initProgTools`, `renderProgTools`, `recordSnapshot`, `registerProgRenderer`, `motionOf` |
| `midiin.js` | Web MIDI input (Chromium only; explains itself elsewhere) | `initMidiIn`, `midiSupported` |
| `speedtrainer.js` | Tempo-ramp loop on `makeLooper` (`GenreBenderSpeed_v1`) | `initSpeedTrainer`, `rampTempo`, `speedChords` |
| `library.js` | Genre selection | `buildLibrary`, `toggleGenre`, `clearAll`, `syncUI`, `removeByIdx`, `updateRatio`, `blendDescriptor` |
| `main.js` | Boot + bridge | (none — side effects only) |

---

## 4. The two intentional design decisions worth knowing

### a. The `window` bridge in `main.js`
The original single-file app used inline `onclick="generateBlend()"`
handlers. ES module scope is **not** global, so those handlers would break.
Rather than rewrite every handler, `main.js` does a single
`Object.assign(window, {...})` to expose exactly the functions the markup
names. The markup stays declarative; the logic stays modular. To go
zero-globals, swap the inline handlers for `addEventListener` calls and
delete the bridge.

### b. Shared state lives in `store.js`, not in `export let`
`selected`, `guitarTabData`, and `pianoChordData` are mutated from several
modules. Exporting a reassignable `let` and importing it elsewhere gives a
read-only binding — reassignment in the source module would not be visible
to importers, and importers cannot reassign at all. Wrapping them as
properties of a single exported `store` object means every module reads and
writes the *same* live values. `metroBPM` and `swingAmount` stay private to
their modules and are exposed through accessors (`getBPM()`,
`swingOffsetSec()`) instead.

### c. The shell: rail vs. main
`index.html` is `.header` → `.shell` (`aside.rail` + `main.main`). The
rail holds what should never disappear: the tempo keeper (moved out of
the mixer panel; same element ids, so `metronome.js`/`persist.js` are
untouched), the Session card (`#rail-key` joins `keysync`'s mirrored
selects; `#rail-genres` / `#rail-reference` are painted by
`library.syncUI`), and `#clip-dock`. Because none of that is inside a
`.panel`, `switchTab` never hides it and an embedded clip keeps playing
across tab changes. `clips.js` decides the player's *mode*: `docked`
(static in the rail) or `floating` (fixed, draggable, resizable); below
1180px the rail stacks above the tabs and the player is forced floating.

### d. Clip → mixer is the "reference" hand-off
`clipsSeedMixer` maps a clip's free-text genre tags onto catalog names
(`matchGenres`), its key onto the app's 10 keys (`normalizeKey`), pushes
BPM, and sets `store.reference`. `blend.referenceLine()` folds that into
the prompt so the creative direction is anchored to something the
producer actually heard; `clearAll` / the rail's ✕ clear it. `analyze.js`
is the same loop from the other side: AI proposes tags → apply → seed.

### e. Two ways handlers reach the DOM (transitional)
Older markup uses inline `onclick` + the window bridge. Newer modules
(`clips`, `analyze`, settings backup) register with `actions.js` and use
`data-action` markup, so nothing lands on `window`. The build verifier
checks that every `data-action` in the page resolves. Migrate a module
by swapping its inline handlers for data attributes and moving its
`Object.assign(window, …)` entries into a `registerActions({...})`.

### f. Persistence goes through `storage.js`
Every module that saves state registers its key (`registerStore`) and
uses `loadJSON`/`saveJSON`; keys are unchanged, so old saves load. The
registry is what makes ⚙ → *export everything* / *import backup* work.
API credentials are intentionally unregistered.

### g. The `cards.js ⇄ sequencer.js` cycle is safe
These two import from each other. This is fine because each only *calls* the
other's functions at runtime (inside event handlers / playback ticks), never
at module top-level during evaluation. By the time any handler fires, both
modules are fully initialized.

---

## 4b. Phrase Composer subsystem (no AI in the note path)

A later feature: generate 2–16 bar phrases that interweave a chord comp
with a diatonic lead line (slides, hammer-ons, pull-offs, bends, vibrato).
The design goal is that **fret numbers never come from the model** — they
come from two frozen "books," so output is in-key and playable by
construction. AI is an optional toggle that only arranges the *progression*.

New modules:

| Module | Owns | Key exports |
|---|---|---|
| `chordbook.js` | Chord voicing book (source of truth) | `getVoicing`, `OPEN_VOICINGS`, `parseChordName` |
| `scales.js` | Scale book: diatonic chords, scale-position boxes, progression templates | `diatonicChords`, `buildBox`, `pentPcs`, `PROGRESSIONS`, `keyInfo` |
| `techniques.js` | Technique enum + ASCII-tab token rendering | `TECHNIQUES`, `leadToken`, `TECH_LEGEND` |
| `phrase.js` | Deterministic generator pipeline | `buildPhrase` |
| `tabrender.js` | Timeline → ASCII tab | `renderTab` |
| `composer.js` | UI controller, AI-arrange toggle, playback, export | `generatePhrase`, `regeneratePhrase`, `phrasePlay`, `phraseStop`, `exportComposerMidi` |

`chordbook.getVoicing` resolves a chord name from a set of candidate
voicings — hand-seeded open shapes, movable barre shapes, compact 4-string
(drop-2-style) voicings, and a generic voicer — all built from a built-in
interval table (no external library needed). It scores candidates by
root-presence and chord-tone coverage first, then by proximity to a target
neck fret (`nearFret`) so the comp can be pulled into the same region as the
lead box. `opts.style` ('barre' | 'compact') restricts the family. The book
covers maj/min/dom7/min7/maj7/m7b5/dim/dim7/aug/sus2/sus4/6/m6/add9/9/maj9/m9.

`scales.positionCenter(key, position)` maps the UI's position choice ('open',
'auto', or a fret number) to a `{ center, nearFret }` pair; the lead box is
built at `center` and chord voicings are fetched `nearFret`, so both sit in
one region (verified gap of ~1–2 frets).

`theory.js` gained fretboard helpers (`STRING_OPEN_MIDI`, `stringFretToMidi`,
`pcToName`, `nameToPc`) and `audio.js` gained a monophonic `playLeadEvent`
lead voice supporting pitch ramps (slide/bend), legato (hammer/pull) and
vibrato. `midi.js` gained `exportPhraseMidi`.

**Generation pipeline** (`phrase.buildPhrase`, fully deterministic, seeded):
```
key + bars + density
  → scales.diatonicChords(key)            (in-key chord names)
  → progression: template (or AI degrees) fitted to bar count
  → per bar: chordbook.getVoicing(name)   (chord comp from the book)
           + lead walk over scales.buildBox(pentPcs, homeFret)
             stepwise motion, chord-tone targeting on strong beats,
             techniques chosen by physical rule (fret distance/direction)
  → timeline { bars:[ {chordName, events:[chord, notes…]} ] }
```
The AI toggle calls `composer.aiArrange`, which asks the model **only** for a
progression (`{name, degrees:[0-6]}`), validates the degrees, and falls back
to a template on any problem. Notes are always built locally.

```
generatePhrase → (optional) aiArrange → buildPhrase → store.phraseData
   → tabrender.renderTab → <pre>
   → phrasePlay: schedule chord (audio.playStrumAtTime) + lead
     (audio.playLeadEvent) against getBPM/getCtx, optional loop
   → exportComposerMidi → midi.exportPhraseMidi
```

---

## 4c. Shape Trainer subsystem (no AI anywhere)

Drills that connect **scale shapes ⇄ chord shapes ⇄ chords ⇄ numbers**,
driven by a Leitner spaced-repetition queue persisted in localStorage.
Five question kinds: Scale shapes (name the key of a position box, roots
marked), Shape→Number (name the degree of a shown voicing), Number→Shape
(enter frets for "the IV in G"; verified by pitch-class math, so any
voicing counts), Moving shapes (name the chord of a barre shape at fret
N), and Progression ID (hear/see chords, name the degree sequence).

Every fretboard is drawn by a **layered renderer**: a scale-box layer
(hollow dots, solid roots) and a chord layer (voicing dots, or chord-tone
highlights inside the box) that are toggleable independently and persist
per browser — this is how scale shapes and chord shapes stay intertwined.
In Number→Shape the scale layer doubles as the hint and the chord layer
holds the answer, so it stays hidden until the reveal.

| Module | Owns | Key exports |
|---|---|---|
| `fretdiagram.js` | Layered fretboard SVG (scale + chord layers, per-row fret numbers, windows) — pure | `layeredFretSVG`, `windowFor` |
| `trainersrs.js` | Leitner boxes, due-card picking, deck stats, per-day answer tally (`GenreBenderTrainerToday_v1`) (pure, testable) | `srsRecord`, `srsPick`, `srsStats`, `srsToday`, `localDay`, `srsResetAll` |
| `trainer.js` | Decks, question builders, answer checking, layer toggles, quiz⇄explore view pref, trainer UI | `initTrainer`, `trainerSetMode`, `trainerNext`, `trainerAnswer`, `trainerCheckShape`, `trainerGiveUp`, `trainerPlay`, `trainerToggleLayer`, `trainerToggleView`, `trainerResetStats` |
| `chordpalette.js` | The "chord table": a curated, persisted set of chord shapes (`{id,name,frets}`) shown as draggable diagram cards inside the "My chords" track view — add by name/frets, quick-fill a key's triads or sevenths, reorder by drag, accept shapes dragged off a track | `initPalette`, `paletteHTML`, `redrawPalette`, `initPaletteDrag`, `paletteAdd`, `paletteFillKey`, `get/set/clearDragPayload`, `DRAG_MIME` |
| `melodyneck.js` | `layoutMelody` / `neckSVG`: frets typed in frets mode are drawn where played; name-typed notes get a 5-fret window chosen for least hand movement (lower positions preferred, typed octaves honoured) and a greedy nearest-position path. Draws the key's scale faintly (roots ringed), melody spots as numbered pills (repeats read "1·6"), out-of-key notes amber, the path dashed. | `layoutMelody`, `neckSVG` |
| `seeds.js` | Seed packs for My chords (pure): `validatePack`, idempotent `mergeSeedPack` (stable ids `seed_<pack>_<sid>`, rev-gated, keeps user-edited chords via `seed.sig`, `force` overrides), `packToClips`, `#seed=` codec. Packs live in `seeds/*.pack.json`; see seeds/README.md | `mergeSeedPack`, `validatePack`, `packToClips`, `encodeSeedPayload`, `decodeSeedPayload` |
| `seedimport.js` | The ways a pack gets in: ⤓ seed pack file picker, `#seed=` link on load, `GenreBender.applySeedPack`. Goes through `trainer.trainerApplySeedPack` + `clipsImport`, opens My chords. Seeded tracks render a meta card (`trackMetaHTML`: link, key + use key, BPM, progression source/confidence, tap-to-add color chart) | `applySeedPack`, `seedImportFile`, `seedLinkFor`, `initSeedImport` |
| `shortcuts.js` | Single-key shortcuts, ignored while typing: T / C / M open Drills / My chords / Color map; 1–7 play the degree chord (Shift = first colour), or answer 1–4 in a drill; N next question; Space plays the melody (when Play has one) else loops / stops the active progression, ← / → step it, H melody + harmony; `/` opens the chord finder, which is also a command bar (`new track Verse`, `color map in E`, `practice`, `dark`, `tips`, `tour`); ? / Esc toggle the help overlay (also the ⌨ button in the trainer header). | `initShortcuts`, `toggleShortcutHelp` |
| `melody.js` | Pure melody helpers for the color map's melody lens. `parseMelody(text, 'notes'|'frets')` reads `E G# B C#5` or `e7 B8` / `e: 7 9 10 B: 8` / `1:7` (E = low E, e = high e, tab numbers 1 = high e); `chordFit(name, summary)` splits the melody into chord tones, colour tones and clashes (½ step above a chord tone) and scores 0–3; `keysForMelody` ranks the keys whose scale holds every note. The color map (`GenreBenderColorMapMelody_v1`) lights chips by fit, ★s the 3 best in the current view, fades clashes, highlights melody notes in column spellings / out-of-scale anchors, offers one-click key changes, and plays the melody at the current tempo. | `parseMelody`, `summarize`, `chordFit`, `keysForMelody`, `samePitchKey`  **Reference clip (inline, no pop-out):** the color map's session row puts a saved-clip picker + paste box + inline embed beside the melody box. Picking a clip loads `clip.melody` (`clipsUpdate(id,'melody',{text,mode})`, saved with the clip list); with no clip the melody uses its own slot (`GenreBenderColorMapMelody_v1` also remembers the picked clip). Buttons: use the clip's key tag, ↑/↓ BPM, tag the clip with the melody's key. Taking a clip inline calls `clips.clipsDetachDock()` (dock iframe unloaded, pop-out closed/collapsed) so only one player runs; opening a clip in the dock re-attaches it (`onDockReattach` clears the inline one). Links pasted while the map is on screen go inline via `clips.setClipPasteRoute`; `clipsAdd(url,{open:false})` saves without opening the dock.  **Harmonizer:** `parseMelody` marks bars at `|`; `splitBars` groups by those marks or every N notes; `harmonize` picks a chord per bar from the in-scale columns (borrowed / out-of-scale only when nothing in key covers the bar), ties → fewer tones, small no-repeat nudge, tonic lean on first/last bar; top 3 kept for ⟳. The color map shows it under the melody (▶ play with chords, → new track via `configureColorMap({ newTrack })`). **Clip loop:** YouTube embeds run with `enablejsapi=1`; the map talks to the player over postMessage (listening → infoDelivery currentTime; seekTo / setPlaybackRate) for an A–B loop + speed saved as `clip.loop`. **Clip sync:** `clips.js` packs the list into a `#clips=` link (deflate-raw + base64url when available), merges on arrival (new links added, empty tags filled, newer melody/loop win, nothing deleted), and offers share sheet / copy links / paste-many in the dock and the color map. |
| `keypicker.js` | Split key picker. Every key `<select data-keypick>` (rail, guitar, piano, composer, chord table, color map, trainer explore) is filled with `theorydata.ALL_KEYS` (17 roots × maj/min), hidden, and fronted by letter / accidental / mode controls. Picker changes write the select and dispatch a real `change`; programmatic writes (`value` / `selectedIndex`, e.g. keysync, persistence, explore shuffle) are intercepted per instance so the picker repaints. E♯/F♭/B♯/C♭ are not offered. Later-rendered selects are enhanced by a MutationObserver. Flat keys spell with flats via `scales.spellPc` / `prefersFlats`. | `initKeyPickers`, `enhanceKeySelect`, `enhanceKeySelects` |
| `trainernav.js` | Reaching the trainer. The Shape Trainer is the top-level tab `panel-trainer` (moved out of the Mixer's inner tabs) with sub-tabs **Drills** (mode row + quiz card), **My chords** (track + chord table, color map below for drag-in) and **Color map** (map alone; + still appends) — the sub-tab and last drill persist (`GenreBenderTrainerNav_v1`). The color map is mounted once into `#colormap-host` (`colormap.mountColorMap`). The sidebar `#rail-trainer` card shows due / answered-today (`trainer.trainerDueSummary`, refreshed via `onTrainerStats`), "▶ Today: <drill>" (Practice's weekday rotation), My chords with the track's chord count, and Color map. `trainerNav(sub, mode|'today')` is the single entry point (sidebar, Practice buttons, legacy `trainerOpenColorMap`). | `trainerNav`, `trainerOpenColorMap`, `trainerOnTab`, `initTrainerNav`, `getTrainerSub`, `refreshRail` |
| `colormap.js` | The "color map" in My chords (also opened by the trainer's 🎨 Color map button). 3-way switch (`GenreBenderColorMapView_v1`): **In scale** — per degree, the triad + same-function richer chords (I → maj7/6/maj9, iii → m7/m♯5 = I/3, V → 7/11/13, vii° → m7♭5/dim♭9); **Out of scale** — one column per note *between* the degrees (major: ♭II ♭III ♯IV/♭V ♭VI ♭VII; minor: ♭II ♮III ♯IV/♭V ♮VI ♮VII) with the chords built on it (Neapolitan, borrowed, tritone subs, passing °7); **Parallel** — the parallel key against the home key + "⇄ modulate". **✎ edit** makes every column editable (rename in place, ✕ remove, add by suffix or full name, drag ⠿ reorder, drop chords in from track/table/other columns); edits are stored relative to the column root `{off,q}` per mode+view (`GenreBenderColorMapEdits_v1`) so they transpose to every key; ↺ resets a view. In-scale columns (edited) drive the track's 🎨 recolor levels and the per-chord 🎨 color cycle; out-of-scale columns drive the cycle for chromatic roots. Colour chords voice root-in-bass (`getVoicing(name,{rootBass:true})`). Key select is mirrored by `keysync` (as is the chord table's `palette-key`). | `mapColumns`, `colorLadder`, `parallelKey`, `recolorName`, `nextColorName`, `degreeOf`, `pinnedFretsFor`, `colorMapHTML`, `initColorMap`, `initColorMapDrag`, `setColorMapView`, `resetColorMapEdits` |
| `trainerexplore.js` | Per-mode explore sandboxes: fret entry + live chord/degree/scale analysis, degree chips, movable barre, progression stepper, scale-box picker | `renderExplore`, `redrawExploreDiagrams`, `configureExplore`, `explore*` handlers |

Each drill mode also has a **quiz ⇄ explore toggle** (persisted per mode):
explore swaps the quiz for a sandbox where the Number→Shape fret-entry
element is always present and live-identifies whatever you play (chord
symbol via `fretchords.detectChordAndKey`, Roman numeral in the chosen
key, out-of-scale count), while mode-specific controls auto-fill the
frets. Explore never records SRS progress.

**"My chords" drag-and-drop.** The track view renders each chord block
with `data-track-idx` and a draggable handle (the diagram itself — the
controls under it hold inputs that must stay selectable), and always
renders the `#trainer-custom-diagrams` row as a drop zone. Two sources
drop there: a chord-table card (inserts a copy of that *exact* voicing
before/after the hovered block, between two chords when hovering the
lick, or at the end on empty space) and another track chord (reorder).
The table (`#palette-grid`) accepts the reverse — a track chord dragged
down is saved with its resolved frets pinned. Both sides use one
delegated listener set on `#trainer-question` (wired once, survives
re-renders) and share a payload `{source:'palette'|'track', name, frets,
id|idx}` mirrored in module state, because `dragover` cannot read
`dataTransfer` contents. Position within the row is decided by pointer x
against the hovered block's midpoint (`.drop-before` / `.drop-after`).

`trainer.js ⇄ trainerexplore.js`
is a runtime-only circular pair (same pattern as cards ⇄ sequencer).

Questions are built entirely from the two frozen books
(`chordbook.getVoicing`, `scales.diatonicChords`/`scalePcs`/`pentPcs`)
plus the barre-shape tables (`E_SHAPES`/`A_SHAPES`, now exported); audio
reuses `audio.playChordNow`/`playNote` and `loopscheduler.makeLooper`.

---

## 4c½. Learn a song (song units)

```
paste ──► chordsheet.analyzeSheet ─┐
title/artist ──► /.netlify/functions/songmeta ──► shared/songmeta-core.mjs (GetSongBPM)
file / tab capture ──► Web Audio decode ──► audioanalysis.analyzeAudio
tap ──► metronome.getBPM ──────────┤
                                   ▼
                     songunit.resolveKey / resolveBpm   (provenance + confidence,
                                   │                     agree / relative / half-double / conflict)
                                   ▼
             songunit.buildUnit ──► GenreBenderSongUnits_v1  (registered → in backups)
                                   ├─► trainer.trainerUpsertTrack('trk_' + unit.id)   idempotent
                                   ├─► metronome.setBPM + keysync.syncKey             (color map follows)
                                   └─► clips.clipsUpdate (bpm, key) when a clip is linked
```

| Module | Owns | Key exports |
|---|---|---|
| `chordsheet.js` | Pure: chord-token parsing, sheet extraction (sections, repeats, inline/UG markup), loop finding, ranked key inference, Roman numerals | `analyzeSheet`, `extractChords`, `parseChordToken`, `inferKey`, `findLoop`, `romanFor`, `toRomans`, `normalizeKeyName`, `relativeKey`, `sameKey` |
| `audioanalysis.js` | Pure DSP (no deps): downsample, STFT, whitened chroma → Krumhansl–Kessler key; spectral-flux onsets → tempo (autocorrelation + log-tempo prior) → beat grid; per-beat triad templates + Viterbi → per-bar chords | `analyzeAudio`, `detectKey`, `detectTempo` |
| `songunit.js` | Pure: merge sources, flag disagreements, stable unit ids, unit shape | `resolveKey`, `resolveBpm`, `buildUnit`, `unitId`, `progressionOptions` |
| `songimport.js` | The panel: three paths, overrides, save/load/delete units, open track | `initSongImport`, `saveUnit`, `getUnits` |
| `progtab.js` | Transport strip for the active My chords track: chords, tempo-locked loop (own `makeLooper`), step / jump, track popover (switcher, beats per chord, Open in Play); follows `trainer.onTracksChange` + `keysync.onAppKeyChange`; prefs in `GenreBenderProgTab_v1` | `initProgTab`, `progPlay`, `progStep`, `trackKey`, `entryFreqs` |
| `toast.js` | One bottom toast; optional Undo callback | `toast`, `hideToast` |
| `tips.js` | Show-tips toggle + 3-step first-run tour | `initTips`, `setTips`, `startTour` |
| `shared/songmeta-core.mjs` | Server-side GetSongBPM lookup + match ranking (used by the Netlify Function and the dev proxy) | `lookupSongMeta`, `handleSongMeta` |

Tests: `npm run verify:song` (parser, DSP on synthesized audio with known key/tempo/chords,
resolver, mocked GetSongBPM, the Netlify handler, the dev-proxy route, persistence across
reload); the single-file verifier drives the panel end to end.

---

## 4d. Explore mode

`explore.js` owns the ✦ explore toggle in the top tab bar. Toggling it
ON shuffles the whole bench (random genre blend + ratios, tempo, swing,
every panel's key/style/settings, a random fret shape, a random trainer
drill) and jumps to a random inner tab; while ON, every inner-tab switch
re-rolls that panel (the `switchInnerTab` bridge in `main.js` feeds it).
It only rolls local settings — it never calls the AI. Key exports:
`toggleExplore`, `exploreOnInnerTab`, `exploreShuffle`, `isExploreOn`.

---

## 5. Data flow examples

**Generating a blend**
```
user clicks chips → library.toggleGenre → store.selected[] updated → syncUI()
user clicks "Generate" → blend.generateBlend
   → reads store.selected + ratios
   → api.callClaude(prompt)            (POST API_CONFIG.endpoint)
   → util.extractJSON(response)
   → blend.renderResult (escHtml all model text)
```

**Generating & playing a chord progression**
```
guitar.generateGuitar / piano.generatePiano
   → api.callClaude → extractJSON
   → theory.validateChordList (window.Tonal)
   → store.guitarTabData / store.pianoChordData
   → cards.rebuildCardsUI → buildChordCardHTML

user hits play → sequencer.toggleSeq
   → reads BPM via metronome.getBPM, swing via swing.swingOffsetSec
   → cards.getSeqChords → audio.playChordAtTime / playStrumAtTime
Compose mode → sequencer.toggleCompose syncs guitarSeq + pianoSeq on one clock
```

**Export**
```
midi.exportMidi → reads store.guitarTabData / pianoChordData
   → theory.noteToMidi → writes a type-1 SMF Blob → browser download
```
