/* synth-audio.mjs — deterministic test signals for verify-songimport.mjs.
   Strummed triads (with a bass root and a few harmonics) on every beat,
   plus a short noise click, so key, tempo and chords are known exactly. */
const PC = { C:0, 'C#':1, Db:1, D:2, Eb:3, 'D#':3, E:4, F:5, 'F#':6, G:7, Ab:8, 'G#':8, A:9, Bb:10, B:11 };

function chordMidis(name){
  const m = name.match(/^([A-G][#b]?)(m?)$/);
  const r = PC[m[1]];
  const third = m[2] ? 3 : 4;
  const base = 48 + r;                       // C3..B3 region
  return { bass: 36 + r, tones: [base, base + third, base + 7, base + 12] };
}
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function synthProgression({ chords, bpm, beatsPerChord = 4, repeats = 4, sr = 44100, noise = 0.02, seed = 7 }){
  const beat = 60 / bpm;
  const totalBeats = chords.length * beatsPerChord * repeats;
  const len = Math.ceil((totalBeats * beat + 1) * sr);
  const out = new Float32Array(len);
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let b = 0; b < totalBeats; b++){
    const name = chords[Math.floor(b / beatsPerChord) % chords.length];
    const { bass, tones } = chordMidis(name);
    const t0 = Math.round(b * beat * sr);
    const dur = Math.round(beat * sr);
    const voices = [[bass, 0.6], ...tones.map(m => [m, 0.35])];
    for (const [m, amp] of voices){
      const f = hz(m);
      for (let i = 0; i < dur && t0 + i < len; i++){
        const env = Math.exp(-3 * i / dur);
        const ph = 2 * Math.PI * f * i / sr;
        out[t0 + i] += amp * env * (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph));
      }
    }
    // percussive click on the beat (accent on 1)
    const clickLen = Math.round(0.015 * sr), acc = b % 4 === 0 ? 0.9 : 0.5;
    for (let i = 0; i < clickLen; i++) out[t0 + i] += acc * rnd() * (1 - i / clickLen);
  }
  for (let i = 0; i < len; i++) out[i] = out[i] * 0.25 + noise * rnd();
  return { samples: out, sr };
}
