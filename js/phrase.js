/* ============================================================
   phrase.js — the deterministic phrase generator.

   Builds a 2-16 bar phrase that interweaves a chord comp with a
   diatonic lead line (slides, hammer-ons, pull-offs, bends,
   vibrato). NOTHING here invents fret numbers freely:
     - chords come from chordbook.getVoicing (the chord book)
     - lead notes come from scales.buildBox (the scale book)
   so everything is in-key and playable by construction.

   AI, when enabled, only chooses the progression + feel up front
   (see composer.js); the notes themselves are always built here.
   ============================================================ */
import { getVoicing, parseChordName } from './chordbook.js';
import {
  keyInfo, diatonicChords, pentPcs, buildBox,
  positionCenter, PROGRESSIONS, fitProgression
} from './scales.js';
import { midiToHz, pcToName, STRING_OPEN_MIDI } from './theory.js';
import { bassFromVoicing, fretsToMidis, LAYER_ORDER } from './phraselayers.js';

/* Small seeded RNG (mulberry32) so a given seed reproduces a phrase. */
function rng(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

/* Density presets: how busy the lead is and how the chord is voiced. */
const DENSITY = {
  none:   { slots: 0, chordBeats: 4, techProb: 0    },
  light:  { slots: 3, chordBeats: 2, techProb: 0.35 },
  medium: { slots: 5, chordBeats: 1, techProb: 0.5  },
  heavy:  { slots: 7, chordBeats: 0.5, techProb: 0.65 }
};

const SUBDIV = 8;          // eighth-note grid in 4/4
const BEAT_PER_SLOT = 0.5; // eighth note = half a beat

/* Choose a lead event from the box near the previous note. */
function nextLeadNote(rnd, box, prevIdx, chordPcs, isStrong, techProb){
  // Move stepwise most of the time; occasionally leap toward a chord tone.
  let idx;
  if (isStrong && rnd() < 0.5){
    const tones = box.map((n, i) => ({ i, isTone: chordPcs.has(n.midi % 12) }))
                     .filter(x => x.isTone);
    idx = tones.length ? pick(rnd, tones).i : prevIdx;
  } else {
    const step = pick(rnd, [-2, -1, -1, 1, 1, 2]);
    idx = Math.min(box.length - 1, Math.max(0, prevIdx + step));
  }
  const note = box[idx];
  const ev = {
    type: 'note', string: note.string, fret: note.fret, midi: note.midi,
    hz: midiToHz(note.midi), beats: BEAT_PER_SLOT, technique: 'none', at: 0
  };

  // Decide a technique by physical rule against a candidate target.
  if (rnd() < techProb){
    const sameString = box.filter(n => n.string === note.string);
    const here = sameString.findIndex(n => n.fret === note.fret);
    const tgt = sameString[here + pick(rnd, [-2, -1, 1, 2])];
    if (tgt){
      const diff = tgt.fret - note.fret;
      const target = { fret: tgt.fret, midi: tgt.midi, hz: midiToHz(tgt.midi) };
      if (Math.abs(diff) >= 3)            { ev.technique = 'slide';  ev.to = target; }
      else if (diff > 0)                  { ev.technique = 'hammer'; ev.to = target; }
      else if (diff < 0)                  { ev.technique = 'pull';   ev.to = target; }
    } else if (isStrong && chordPcs.has(note.midi % 12)){
      // strong-beat chord tone with no slide target -> bend or vibrato
      ev.technique = rnd() < 0.5 ? 'vibrato' : 'bend';
      if (ev.technique === 'bend'){
        const wholeUp = note.midi + 2;
        ev.to = { fret: note.fret + 2, midi: wholeUp, hz: midiToHz(wholeUp) };
      }
    }
  }
  return { ev, idx };
}

/* Public: build a phrase timeline.
   opts = { key, bars, density, progressionDeg?, seed? }
   progressionDeg (optional) overrides the auto-picked progression
   (this is the hook the AI toggle uses). Returns:
   { key, progressionName, timeSignature:[4,4], bars:[ {chordName, events:[...]} ] } */
export function buildPhrase(opts){
  const key = opts.key || 'Am';
  const bars = Math.max(2, Math.min(16, opts.bars || 4));
  const density = DENSITY[opts.density] || DENSITY.light;
  const seed = opts.seed ?? (Date.now() & 0xffffffff);
  const rnd = rng(seed);

  const { mode } = keyInfo(key);
  const diatonic = diatonicChords(key);

  // Progression: AI-supplied degrees, else a template fitted to bar count.
  // `quals` (optional, parallel to deg) overrides the diatonic triad quality
  // per bar so gospel/neo-soul templates render with real extensions.
  let deg, progName, quals = null;
  if (Array.isArray(opts.progressionDeg) && opts.progressionDeg.length){
    deg = fitProgression(opts.progressionDeg.map(d => ((d % 7) + 7) % 7), bars);
    progName = opts.progressionName || 'custom';
  } else {
    const tmpl = pick(rnd, PROGRESSIONS[mode]);
    deg = fitProgression(tmpl.deg, bars);
    progName = tmpl.name;
    if (Array.isArray(tmpl.quals)) quals = fitProgression(tmpl.quals, bars);
  }

  // Neck position shared by the chord comp and the lead box so they
  // sit in the same region of the fretboard.
  const { center, nearFret } = positionCenter(key, opts.position);
  // Optional voicing family: 'barre' (full) or 'compact' (drop-2 style).
  const style = (opts.voicingStyle === 'barre' || opts.voicingStyle === 'compact')
    ? opts.voicingStyle : undefined;

  // Global default layer for every bar ('both' | 'bass' | 'lick'); the UI can
  // override individual bars later.
  const defaultLayer = LAYER_ORDER.includes(opts.layer) ? opts.layer : 'both';

  // Lead box for the key (pentatonic, around the chosen position).
  const box = buildBox(pentPcs(key), center);
  let prevIdx = Math.floor(box.length / 2);

  const outBars = deg.map((d, bi) => {
    let chordName = diatonic[d];
    if (quals && quals[bi]){
      // keep the diatonic root, swap in the template's extended quality
      const root = (chordName.match(/^[A-G][#b]?/) || [''])[0];
      chordName = root + quals[bi];
    }
    const voicing = getVoicing(chordName, { nearFret, style }) || { frets: [], midis: [] };
    // Lead-line chord-tone targeting still uses the FULL voicing's tones.
    const chordPcs = new Set(voicing.midis.map(m => m % 12));
    // The played/shown comp is the bass layer: the voicing reduced to its
    // low strings (root-focused), so it reads cleanly against the lead.
    const bassFrets = bassFromVoicing(voicing.frets || []);
    const bassMidis = fretsToMidis(bassFrets);

    const events = [{
      type: 'chord', layer: 'bass', name: chordName, frets: bassFrets,
      midis: bassMidis, freqs: bassMidis.map(midiToHz), beats: density.chordBeats,
      strum: 'down', at: 0
    }];

    // Lead notes: fill `slots` of the eighth-note grid after the chord stab.
    if (density.slots > 0 && box.length){
      const startSlot = Math.round(density.chordBeats / BEAT_PER_SLOT);
      const free = [];
      for (let s = startSlot; s < SUBDIV; s++) free.push(s);
      // pick a spread of slots
      const chosen = [];
      const want = Math.min(density.slots, free.length);
      while (chosen.length < want && free.length){
        const j = Math.floor(rnd() * free.length);
        chosen.push(free.splice(j, 1)[0]);
      }
      chosen.sort((a, b) => a - b).forEach(slot => {
        const isStrong = slot % 2 === 0;
        const { ev, idx } = nextLeadNote(rnd, box, prevIdx, chordPcs, isStrong, density.techProb);
        ev.at = slot * BEAT_PER_SLOT;
        ev.layer = 'lick';
        events.push(ev);
        prevIdx = idx;
      });
    }
    return { chordName, events, layer: defaultLayer };
  });

  // Optional: diminished passing chords. Between two consecutive chords whose
  // roots are a whole step apart, insert a dim7 on the chromatic note between
  // them (e.g. Ab → Bb gets a passing Adim7), sounding on the bar's second
  // half. Diminished 7ths are symmetric, so the same shape covers either
  // direction of motion. (See the gospel guide's passing-chord section.)
  if (opts.passingChords){
    for (let i = 0; i < outBars.length - 1; i++){
      const a = parseChordName(outBars[i].chordName);
      const b = parseChordName(outBars[i + 1].chordName);
      if (!a || !b) continue;
      const diff = ((b.rootPc - a.rootPc) % 12 + 12) % 12;
      if (diff !== 2 && diff !== 10) continue;        // not a whole step apart
      const passPc = (a.rootPc + (diff === 2 ? 1 : -1) + 12) % 12;
      const passName = pcToName(passPc) + 'dim7';
      const pv = getVoicing(passName, { nearFret }) || { frets: [], midis: [] };
      if (!pv.midis.length) continue;
      const pBassFrets = bassFromVoicing(pv.frets || []);
      const pBassMidis = fretsToMidis(pBassFrets);
      if (!pBassMidis.length) continue;
      const mainChord = outBars[i].events.find(e => e.type === 'chord');
      if (mainChord) mainChord.beats = Math.min(mainChord.beats || 4, 2);
      outBars[i].events.push({
        type: 'chord', layer: 'bass', name: passName, frets: pBassFrets, midis: pBassMidis,
        freqs: pBassMidis.map(midiToHz), beats: 2, strum: 'down', at: 2, passing: true
      });
    }
  }

  return { key, progressionName: progName, seed, position: opts.position || 'open', voicingStyle: opts.voicingStyle || 'auto', timeSignature: [4, 4], bars: outBars };
}

/* Public: build a short (2-8 note) pentatonic lead run that connects
   two chords — a "fill"/lick suggestion for the gap between adjacent
   chords in a tab. Same construction as the phrase's lead line
   (buildBox + physical-distance technique rules): starts near a tone
   of the FROM chord, walks stepwise through the box, and resolves
   onto a tone of the TO chord on its last note. Deterministic for a
   given seed. opts = { key, fromChordName, toChordName, notes?, seed? }.
   Returns { key, fromChordName, toChordName, seed, events } or null
   if either chord name can't be resolved to a voicing. */
export function buildLick(opts = {}){
  const key = opts.key || 'C';
  const seed = opts.seed ?? (Date.now() & 0xffffffff);
  const rnd = rng(seed);
  const count = Math.max(2, Math.min(8, opts.notes || 4));

  const fromV = getVoicing(opts.fromChordName || '');
  if (!fromV) return null;
  const toV = getVoicing(opts.toChordName || '', { nearFret: Math.round(fromV.center) });
  if (!toV) return null;
  const fromPcs = new Set(fromV.midis.map(m => m % 12));
  const toPcs = new Set(toV.midis.map(m => m % 12));

  const center = Math.round((fromV.center + toV.center) / 2) || 2;
  const box = buildBox(pentPcs(key), center);
  if (!box.length) return null;

  const toneIdxs = (pcs) => box.map((n, i) => ({ i, hit: pcs.has(n.midi % 12) })).filter(x => x.hit).map(x => x.i);
  const fromIdxs = toneIdxs(fromPcs);
  let idx = fromIdxs.length ? pick(rnd, fromIdxs) : Math.floor(box.length / 2);

  const events = [];
  for (let i = 0; i < count; i++){
    const isLast = i === count - 1;
    if (isLast){
      // Resolve onto whichever TO-chord tone is nearest the current position.
      const toIdxs = toneIdxs(toPcs);
      if (toIdxs.length) idx = toIdxs.reduce((best, j) => Math.abs(j - idx) < Math.abs(best - idx) ? j : best, toIdxs[0]);
    } else {
      const step = pick(rnd, [-2, -1, -1, 1, 1, 2]);
      idx = Math.min(box.length - 1, Math.max(0, idx + step));
    }
    const note = box[idx];
    const ev = {
      type: 'note', string: note.string, fret: note.fret, midi: note.midi,
      hz: midiToHz(note.midi), beats: BEAT_PER_SLOT, technique: 'none', at: i * BEAT_PER_SLOT
    };
    if (isLast){
      ev.technique = 'vibrato';               // land the resolving note with a little shake
    } else if (rnd() < 0.4){
      const sameString = box.filter(n => n.string === note.string);
      const here = sameString.findIndex(n => n.fret === note.fret);
      const tgt = sameString[here + pick(rnd, [-2, -1, 1, 2])];
      if (tgt){
        const diff = tgt.fret - note.fret;
        const target = { fret: tgt.fret, midi: tgt.midi, hz: midiToHz(tgt.midi) };
        if (Math.abs(diff) >= 3)      { ev.technique = 'slide';  ev.to = target; }
        else if (diff > 0)            { ev.technique = 'hammer'; ev.to = target; }
        else if (diff < 0)            { ev.technique = 'pull';   ev.to = target; }
      }
    }
    events.push(ev);
  }
  return { key, fromChordName: opts.fromChordName, toChordName: opts.toChordName, seed, events };
}
