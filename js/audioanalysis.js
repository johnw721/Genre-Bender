/* ============================================================
   audioanalysis.js — key, BPM and a chord sketch from raw audio.

   Pure DSP on a mono Float32Array: no DOM, no Web Audio, no
   dependencies, so it runs (and is tested) in Node exactly as it
   runs in the browser. The UI decodes a file / tab capture with
   Web Audio and hands the samples here.

   Pipeline
     samples ─ downsample (~11–12 kHz) ─┬─ STFT 4096 → chroma (12 pitch classes / frame)
                                        │     ├─ key:    Krumhansl–Kessler profile correlation
                                        │     └─ chords: per-beat chroma vs 24 triad templates,
                                        │                Viterbi-smoothed, majority per bar
                                        └─ STFT 1024 → spectral-flux onset envelope
                                              └─ tempo: autocorrelation w/ a log-tempo prior,
                                                 then beat phase by onset alignment

   Honest limits (the UI repeats these): it detects major/minor
   triads only, assumes a steady tempo and 4/4 bars, and dense mixes,
   heavy distortion or jazz voicings will confuse it. Treat the chord
   output as a sketch to check by ear, and key/BPM as good guesses.
   ============================================================ */
import { keyName, ROOT_SPELLING, findLoop, dedupeAdjacent, inferKey } from './chordsheet.js';

const TARGET_SR = 11025;

/* ---- FFT (iterative radix-2, in place) --------------------------------- */
function makeFFT(n){
  const levels = Math.log2(n);
  if (levels % 1) throw new Error('FFT size must be a power of 2');
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++){ cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++){
    let r = 0;
    for (let b = 0, x = i; b < levels; b++, x >>= 1) r = (r << 1) | (x & 1);
    rev[i] = r;
  }
  return function fft(re, im){
    for (let i = 0; i < n; i++){
      const j = rev[i];
      if (j > i){ let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size *= 2){
      const half = size / 2, step = n / size;
      for (let i = 0; i < n; i += size){
        for (let j = i, k = 0; j < i + half; j++, k += step){
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = -re[l] * sin[k] + im[l] * cos[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  };
}

function hann(n){
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
  return w;
}

/* Magnitude spectra for every hop. Calls onFrame(mag, frameIndex). */
function stft(x, n, hop, onFrame){
  const fft = makeFFT(n), win = hann(n);
  const re = new Float64Array(n), im = new Float64Array(n), mag = new Float64Array(n / 2);
  let f = 0;
  for (let start = 0; start + n <= x.length; start += hop, f++){
    for (let i = 0; i < n; i++){ re[i] = x[start + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < n / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    onFrame(mag, f);
  }
  return f;
}

/* ---- pre-processing --------------------------------------------------- */

/* Box-filter decimation to ~11 kHz. Crude, but the analysis only needs
   content below ~2 kHz, and the averaging is the anti-alias filter. */
export function downsample(x, sr){
  const factor = Math.max(1, Math.floor(sr / TARGET_SR));
  if (factor === 1) return { x: Float32Array.from(x), sr };
  const out = new Float32Array(Math.floor(x.length / factor));
  for (let i = 0; i < out.length; i++){
    let s = 0;
    const o = i * factor;
    for (let j = 0; j < factor; j++) s += x[o + j];
    out[i] = s / factor;
  }
  return { x: out, sr: sr / factor };
}

/* ---- chroma ----------------------------------------------------------- */
const CHROMA_N = 4096, CHROMA_HOP = 1024;
const CHROMA_LO = 55, CHROMA_HI = 2000;   // Hz — skip kick rumble & cymbal fizz

export function chromagram(x, sr){
  const binHz = sr / CHROMA_N;
  const kLo = Math.max(1, Math.ceil(CHROMA_LO / binHz)), kHi = Math.min(CHROMA_N / 2 - 1, Math.floor(CHROMA_HI / binHz));
  // Precompute bin -> (pitch class, weight). Weight favors bins near a
  // semitone center so energy between notes doesn't smear across two classes.
  const binPc = new Int8Array(kHi + 1), binW = new Float64Array(kHi + 1);
  // How much weight each pitch class collects from a perfectly flat
  // spectrum. Bins aren't spread evenly over the 12 classes in a finite
  // range, so without dividing this out, noise/drums lean toward a key.
  const baseline = new Float64Array(12);
  for (let k = kLo; k <= kHi; k++){
    const midi = 69 + 12 * Math.log2((k * binHz) / 440);
    const near = Math.round(midi);
    const d = midi - near;
    binPc[k] = ((near % 12) + 12) % 12;
    binW[k] = Math.exp(-(d * d) / (2 * 0.2 * 0.2));
    baseline[binPc[k]] += binW[k];
  }
  const meanBase = baseline.reduce((a, b) => a + b, 0) / 12;
  for (let p = 0; p < 12; p++) baseline[p] = baseline[p] / meanBase || 1;
  const frames = [], energy = [];
  stft(x, CHROMA_N, CHROMA_HOP, (mag) => {
    const c = new Float64Array(12);
    let e = 0;
    for (let k = kLo; k <= kHi; k++){
      // peak-pick: only local maxima carry pitch, which drops broadband noise
      if (mag[k] < mag[k - 1] || mag[k] < mag[k + 1]) continue;
      const v = Math.sqrt(mag[k]) * binW[k];
      c[binPc[k]] += v;
      e += v;
    }
    for (let p = 0; p < 12; p++) c[p] /= baseline[p];
    frames.push(c);
    energy.push(e);
  });
  return { frames, energy, fps: sr / CHROMA_HOP, hopSec: CHROMA_HOP / sr, winSec: CHROMA_N / sr };
}

function normalize(v){
  let s = 0;
  for (const a of v) s += a * a;
  s = Math.sqrt(s) || 1;
  return Array.from(v, a => a / s);
}

/* ---- key -------------------------------------------------------------- */
// Krumhansl–Kessler probe-tone profiles.
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a, b){
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++){ ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++){ const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return num / (Math.sqrt(da * db) || 1);
}

export function detectKey(chromaFrames, energy){
  const total = new Float64Array(12);
  const maxE = Math.max(1e-9, ...energy);
  chromaFrames.forEach((c, i) => {
    if (energy[i] < maxE * 0.05) return;          // near-silent frame
    const n = normalize(c);
    for (let p = 0; p < 12; p++) total[p] += n[p];
  });
  const scored = [];
  for (let tonic = 0; tonic < 12; tonic++){
    for (const [mode, prof] of [['major', KK_MAJOR], ['minor', KK_MINOR]]){
      const rotated = Array.from({ length: 12 }, (_, i) => prof[((i - tonic) % 12 + 12) % 12]);
      scored.push({ key: keyName(tonic, mode), r: pearson(total, rotated) });
    }
  }
  scored.sort((a, b) => b.r - a.r);
  const margin = scored[0].r - scored[1].r;
  // A margin of ~0.1 in correlation is a clear winner — but only if the
  // best profile fits at all: tonal music correlates ~0.85–0.97, while
  // noise or drums alone land around 0.5–0.7 by chance.
  const fit = Math.max(0, Math.min(1, (scored[0].r - 0.7) / 0.22));
  const confidence = Math.min(0.97, (0.5 + 0.45 * Math.tanh(margin / 0.06)) * (0.3 + 0.7 * fit));
  return {
    key: scored[0].key,
    confidence: Math.round(confidence * 100) / 100,
    candidates: scored.slice(0, 4).map(s => ({ key: s.key, score: Math.round(s.r * 1000) / 1000 })),
    profile: Array.from(total),
  };
}

/* ---- onset envelope + tempo ------------------------------------------- */
const ONSET_N = 1024, ONSET_HOP = 128;

export function onsetEnvelope(x, sr){
  let prev = null;
  const env = [];
  stft(x, ONSET_N, ONSET_HOP, (mag) => {
    const cur = new Float64Array(mag.length);
    let flux = 0;
    for (let k = 1; k < mag.length; k++){
      cur[k] = Math.log1p(100 * mag[k]);
      if (prev){ const d = cur[k] - prev[k]; if (d > 0) flux += d; }
    }
    env.push(flux);
    prev = cur;
  });
  const fps = sr / ONSET_HOP;
  // Frame f's flux reflects audio around the middle of its window.
  const offsetSec = (ONSET_N / 2) / sr;
  // remove the slowly varying loudness trend (~0.4 s moving average)
  const w = Math.max(1, Math.round(0.4 * fps));
  const out = new Float64Array(env.length);
  let acc = 0;
  for (let i = 0; i < env.length; i++){
    acc += env[i];
    if (i >= w) acc -= env[i - w];
    const mean = acc / Math.min(i + 1, w);
    out[i] = Math.max(0, env[i] - mean);
  }
  return { env: out, fps, offsetSec };
}

export function detectTempo(env, fps, { minBpm = 55, maxBpm = 210, prior = 115 } = {}){
  const lagMin = Math.floor(60 * fps / maxBpm), lagMax = Math.ceil(60 * fps / minBpm);
  const n = env.length;
  if (n < lagMax * 3) return null;
  const acMax = Math.min(n - 1, 2 * lagMax + 2);
  const ac = new Float64Array(acMax + 1);
  for (let lag = Math.max(1, lagMin - 1); lag <= acMax; lag++){
    let s = 0;
    for (let i = lag; i < n; i++) s += env[i] * env[i - lag];
    ac[lag] = s / (n - lag);
  }
  // Score each lag by its own peak plus its double (a real beat period
  // also lines up two beats later), weighted by a log-tempo prior that
  // gently prefers the 80–160 range players count in.
  let best = -1, bestScore = -Infinity, sum = 0, cnt = 0;
  for (let lag = lagMin; lag <= lagMax; lag++){
    const bpm = 60 * fps / lag;
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / prior) / 0.9, 2));
    const dbl = 2 * lag <= acMax ? ac[2 * lag] : 0;
    const score = (ac[lag] + 0.5 * dbl) * w;
    sum += ac[lag]; cnt++;
    if (score > bestScore){ bestScore = score; best = lag; }
  }
  // parabolic refinement around the integer lag
  const y0 = ac[best - 1], y1 = ac[best], y2 = ac[best + 1];
  const denom = y0 - 2 * y1 + y2;
  const shift = denom ? Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / denom)) : 0;
  const period = best + shift;
  const bpm = 60 * fps / period;
  const prominence = ac[best] / ((sum / cnt) || 1);   // ~1 = flat, >2 = clear pulse
  const confidence = Math.max(0.2, Math.min(0.95, 0.35 + 0.3 * Math.log2(Math.max(1, prominence))));
  return {
    bpm: Math.round(bpm * 10) / 10,
    periodFrames: period,
    confidence: Math.round(confidence * 100) / 100,
    alternatives: [bpm / 2, bpm * 2].filter(b => b >= 40 && b <= 260).map(b => Math.round(b * 10) / 10),
  };
}

/* Beat times (s) for a known period: pick the phase whose comb of beats
   collects the most onset energy. */
export function beatTimes(env, fps, periodFrames, offsetSec = 0){
  let bestPhase = 0, bestSum = -1;
  const steps = Math.max(1, Math.round(periodFrames));
  for (let ph = 0; ph < steps; ph++){
    let s = 0;
    for (let t = ph; t < env.length; t += periodFrames) s += env[Math.round(t)] || 0;
    if (s > bestSum){ bestSum = s; bestPhase = ph; }
  }
  const beats = [];
  for (let t = bestPhase; t < env.length; t += periodFrames) beats.push(t / fps + offsetSec);
  return beats;
}

/* ---- chords ----------------------------------------------------------- */
const TEMPLATES = (() => {
  const out = [];
  for (let r = 0; r < 12; r++){
    for (const [q, third] of [['', 4], ['m', 3]]){
      const v = new Array(12).fill(0);
      v[r] = 1; v[(r + third) % 12] = 1; v[(r + 7) % 12] = 1;
      out.push({ name: ROOT_SPELLING[r] + q, v: normalize(v) });
    }
  }
  return out;
})();

/* Average chroma over each beat, match against triad templates, and
   Viterbi-smooth with a fixed switch penalty so single noisy beats
   don't flip the chord. Returns one chord name per beat. */
export function chordsPerBeat(chroma, beats, { switchPenalty = 0.12 } = {}){
  const { frames, energy, hopSec, winSec } = chroma;
  const maxE = Math.max(1e-9, ...energy);
  const obs = [];
  for (let b = 0; b < beats.length - 1; b++){
    const c = new Float64Array(12);
    let used = 0;
    for (let f = 0; f < frames.length; f++){
      const center = f * hopSec + winSec / 2;
      if (center < beats[b] || center >= beats[b + 1]) continue;
      if (energy[f] < maxE * 0.03) continue;
      const n = normalize(frames[f]);
      for (let p = 0; p < 12; p++) c[p] += n[p];
      used++;
    }
    const cn = normalize(c);
    obs.push(used ? TEMPLATES.map(t => t.v.reduce((s, x, i) => s + x * cn[i], 0)) : null);
  }
  // Viterbi over 24 states; silent beats emit a flat score (stay put).
  const S = TEMPLATES.length;
  let score = new Float64Array(S);
  const back = [];
  obs.forEach((o, t) => {
    const next = new Float64Array(S), bp = new Int16Array(S);
    let bestPrev = 0;
    for (let s = 1; s < S; s++) if (score[s] > score[bestPrev]) bestPrev = s;
    for (let s = 0; s < S; s++){
      const stay = score[s], jump = score[bestPrev] - switchPenalty;
      if (t === 0 || stay >= jump){ next[s] = stay; bp[s] = s; }
      else { next[s] = jump; bp[s] = bestPrev; }
      next[s] += o ? o[s] : 0;
    }
    score = next;
    back.push(bp);
  });
  if (!obs.length) return [];
  let s = 0;
  for (let i = 1; i < S; i++) if (score[i] > score[s]) s = i;
  const path = new Array(obs.length);
  for (let t = obs.length - 1; t >= 0; t--){ path[t] = s; s = back[t][s]; }
  return path.map(i => TEMPLATES[i].name);
}

/* One chord per 4/4 bar. The bar phase (which beat is "1") is the one
   that puts the most chord changes on downbeats. */
export function chordsPerBar(beatChords, beatsPerBar = 4){
  let bestPhase = 0, bestHits = -1;
  for (let ph = 0; ph < beatsPerBar; ph++){
    let hits = 0;
    for (let i = 1; i < beatChords.length; i++){
      if (beatChords[i] !== beatChords[i - 1] && (i - ph) % beatsPerBar === 0) hits++;
    }
    if (hits > bestHits){ bestHits = hits; bestPhase = ph; }
  }
  const bars = [];
  const majority = (from, to) => {
    const counts = new Map();
    for (let i = from; i < to; i++) counts.set(beatChords[i], (counts.get(beatChords[i]) || 0) + (i === from ? 1.5 : 1));
    return [...counts].sort((a, b) => b[1] - a[1])[0][0];
  };
  // A pickup of 2+ beats before the first downbeat is kept as its own bar
  // (the analysis usually starts mid-bar, and that bar is often chord 1).
  if (bestPhase >= 2) bars.push(majority(0, bestPhase));
  for (let start = bestPhase; start + beatsPerBar <= beatChords.length; start += beatsPerBar){
    bars.push(majority(start, start + beatsPerBar));
  }
  return { bars, barPhase: bestPhase };
}

/* ---- one call ---------------------------------------------------------- */

/* samples: mono Float32Array; sampleRate in Hz.
   opts.maxSeconds caps the analysed span (default 240). */
export function analyzeAudio(samples, sampleRate, { maxSeconds = 240, startSeconds = 0 } = {}){
  const startIdx = Math.max(0, Math.floor(startSeconds * sampleRate));
  const endIdx = Math.min(samples.length, startIdx + Math.floor(maxSeconds * sampleRate));
  const slice = samples.subarray ? samples.subarray(startIdx, endIdx) : samples.slice(startIdx, endIdx);
  const { x, sr } = downsample(slice, sampleRate);
  const seconds = x.length / sr;
  if (seconds < 6) throw new Error('Need at least ~6 seconds of audio to analyse.');

  const chroma = chromagram(x, sr);
  const key = detectKey(chroma.frames, chroma.energy);

  const { env, fps, offsetSec } = onsetEnvelope(x, sr);
  const tempo = detectTempo(env, fps);

  let beatChordList = [], bars = [], loop = [], chordKey = null;
  if (tempo){
    const beats = beatTimes(env, fps, tempo.periodFrames, offsetSec);
    beatChordList = chordsPerBeat(chroma, beats);
    bars = chordsPerBar(beatChordList).bars;
    loop = findLoop(bars);
    chordKey = inferKey(bars);
  }
  return {
    seconds: Math.round(seconds * 10) / 10,
    key,
    bpm: tempo,
    chords: {
      perBeat: beatChordList,
      perBar: bars,
      sequence: dedupeAdjacent(bars),
      loop,
      key: chordKey,
    },
  };
}
