# Genre Bender — Architecture & Project Hierarchy

This document maps the file structure, what each module owns, how the
modules depend on one another, and how data flows through the app.

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
│   └── notation.css        # Tab panel, playback toolbar, chord cards, loopers, compose banner
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

### c. The `cards.js ⇄ sequencer.js` cycle is safe
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
| `trainersrs.js` | Leitner boxes, due-card picking, deck stats (pure, testable) | `srsRecord`, `srsPick`, `srsStats`, `srsResetAll` |
| `trainer.js` | Decks, question builders, answer checking, layer toggles, quiz⇄explore view pref, trainer UI | `initTrainer`, `trainerSetMode`, `trainerNext`, `trainerAnswer`, `trainerCheckShape`, `trainerGiveUp`, `trainerPlay`, `trainerToggleLayer`, `trainerToggleView`, `trainerResetStats` |
| `trainerexplore.js` | Per-mode explore sandboxes: fret entry + live chord/degree/scale analysis, degree chips, movable barre, progression stepper, scale-box picker | `renderExplore`, `redrawExploreDiagrams`, `configureExplore`, `explore*` handlers |

Each drill mode also has a **quiz ⇄ explore toggle** (persisted per mode):
explore swaps the quiz for a sandbox where the Number→Shape fret-entry
element is always present and live-identifies whatever you play (chord
symbol via `fretchords.detectChordAndKey`, Roman numeral in the chosen
key, out-of-scale count), while mode-specific controls auto-fill the
frets. Explore never records SRS progress. `trainer.js ⇄ trainerexplore.js`
is a runtime-only circular pair (same pattern as cards ⇄ sequencer).

Questions are built entirely from the two frozen books
(`chordbook.getVoicing`, `scales.diatonicChords`/`scalePcs`/`pentPcs`)
plus the barre-shape tables (`E_SHAPES`/`A_SHAPES`, now exported); audio
reuses `audio.playChordNow`/`playNote` and `loopscheduler.makeLooper`.

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
