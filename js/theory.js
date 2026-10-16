/* ============================================================
   theory.js — pure music-theory helpers.

   Note-name <-> MIDI <-> frequency conversion, plus chord
   validation against Tonal.js (loaded globally via CDN as
   window.Tonal). No DOM, no audio — safe to unit test.
   ============================================================ */

const NOTE_PC = {C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11,Cb:11,'B#':0,Fb:4,'E#':5};

export function noteToMidi(note){
  const m = String(note).match(/^([A-G]#?b?)(\d)$/);
  if(!m) return null;
  return 12 * (parseInt(m[2]) + 1) + (NOTE_PC[m[1]] ?? 0);
}

export function midiToHz(m){ return 440 * Math.pow(2, (m - 69) / 12); }

export function noteToHz(n){ const m = noteToMidi(n); return m !== null ? midiToHz(m) : null; }

/* "A2 E3 A3" -> [freq, freq, freq] (unparseable tokens dropped). */
export function parseNoteString(str){
  return String(str || '').trim().split(/\s+/).map(noteToHz).filter(Boolean);
}

/* Validate a list of chords against their named spelling.
   noteSource: 'leftright' (piano left+right) or 'notes' (guitar).
   Returns { bad, annotated } where each annotated chord gains
   _valid (bool) and _correction (string hint). */
export function validateChordList(chords, noteSource){
  const bad = [];
  const annotated = chords.map(c => {
    const clone = Object.assign({}, c);
    let noteNames = [];
    if (noteSource === 'leftright') {
      noteNames = [
        ...String(c.left  || '').trim().split(/\s+/),
        ...String(c.right || '').trim().split(/\s+/)
      ].filter(Boolean);
    } else {
      noteNames = String(c.notes || '').trim().split(/\s+/).filter(Boolean);
    }
    const givenPCs = [...new Set(noteNames.map(n => n.replace(/\d/g,'').toUpperCase()))];
    let isValid = true, correctionMsg = '';
    try {
      const T = window.Tonal;
      if (T && T.Chord) {
        const info = T.Chord.get(c.name);
        if (info && info.notes && info.notes.length > 0) {
          const chordNotes = info.notes.map(n => (T.Note ? (T.Note.simplify(n) || n) : n));
          const missing = chordNotes.filter(cn =>
            !givenPCs.some(gp =>
              gp.replace(/[♭b]/g,'b').replace(/[♯#]/g,'#').toUpperCase() === cn.toUpperCase()
            )
          );
          const coverage = (chordNotes.length - missing.length) / chordNotes.length;
          if (coverage < 0.6) {
            isValid = false;
            correctionMsg = `expected ${chordNotes.join(' ')}`;
            bad.push({ name: c.name, allNotes: noteNames, expected: chordNotes });
          }
        }
      }
    } catch { isValid = true; }
    clone._valid = isValid;
    clone._correction = correctionMsg;
    return clone;
  });
  return { bad, annotated };
}

/* ============================================================
   Fretboard helpers (added for the phrase composer).
   Standard tuning, string index 0..5 = low->high: E2 A2 D3 G3 B3 E4.
   ============================================================ */
export const STRING_OPEN_MIDI = [40, 45, 50, 55, 59, 64]; // [E2,A2,D3,G3,B3,E4]
export const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

/* MIDI for a given string (0=low E .. 5=high e) at a fret. */
export function stringFretToMidi(stringIdx, fret){
  return STRING_OPEN_MIDI[stringIdx] + fret;
}

/* Pitch class (0-11) -> sharp note name. */
export function pcToName(pc){ return NOTE_NAMES[((pc % 12) + 12) % 12]; }

/* Pitch class for a note name (sharps or flats). */
const _PC = {C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11,Cb:11,'B#':0,Fb:4,'E#':5};
export function nameToPc(name){ return _PC[name] ?? 0; }
