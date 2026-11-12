/* ============================================================
   chordsheet.js — pasted chord sheet → chords, key, Roman numerals.

   The "learn this song" path that is reliable *today*: copy a chord
   sheet from anywhere (Ultimate Guitar, a forum, ChordPro, your own
   notes), paste it, and this module pulls out the chord symbols,
   infers the key with a ranked list + confidence, converts to Roman
   numerals and compresses each section down to its repeating loop.

   Pure: no DOM, no network, no AI. Reuses the two frozen books
   (chordbook.parseChordName, scales.diatonicChords/keyInfo) so a
   chord this module accepts is a chord the rest of the app can voice.

   Handles:
     - chords-over-lyrics sheets   ("Am      F       C")
     - bar notation                ("| Am | F | C G |", "x2")
     - inline ChordPro / UG tags   ("[Am]Hello [ch]F[/ch]darkness")
     - section headers             ("[Verse 1]", "Chorus:", "{c: Bridge}")
     - slash chords                ("C/G" — the bass is kept for display,
                                    the chord above it drives analysis)
   ============================================================ */
import { parseChordName } from './chordbook.js';
import { diatonicChords, keyInfo } from './scales.js';

/* ---- chord token recognition --------------------------------------- */

// Roots the chord book knows directly, plus enharmonic spellings it doesn't.
const ENHARMONIC_ROOT = { Cb: 'B', Fb: 'E', 'E#': 'F', 'B#': 'C' };

// Everything that may follow the root. Deliberately strict so lyric
// words ("Am" aside) don't read as chords: a quality word, an optional
// extension number, then any run of alterations / adds / parentheses.
const SUFFIX_RE = new RegExp(
  '^(?:maj|Maj|MAJ|M|Δ|ma|min|mi|m|-|dim|°|o(?=7)|aug|\\+|ø|sus)?' +
  '(?:[0-9]{1,2})?' +
  '(?:(?:sus[24]?|add[0-9]{1,2}|maj[0-9]{0,2}|[#b+\\-][0-9]{1,2}|no[0-9]|\\([^)]{1,12}\\)|\\/9))*$'
);

const ROOT_RE = /^([A-G])([#b♯♭]?)(.*)$/;

/* "F♯m7/C♯" -> { name:"F#m7/C#", chord:"F#m7", bass:"C#" } or null. */
export function parseChordToken(raw){
  let tok = String(raw || '').trim()
    .replace(/♯/g, '#').replace(/♭/g, 'b')
    .replace(/^[[{]+|[\]},.;:!?*]+$/g, '');     // stray punctuation around a token
  // Strip only *unbalanced* parens so "Cm(add9)" survives but "(Am" / "G)" don't.
  const bal = (t) => (t.match(/\(/g) || []).length - (t.match(/\)/g) || []).length;
  while (tok.startsWith('(') && bal(tok) > 0) tok = tok.slice(1);
  while (tok.endsWith(')') && bal(tok) < 0) tok = tok.slice(0, -1);
  if (!tok || tok.length > 14) return null;
  const m = tok.match(ROOT_RE);
  if (!m) return null;
  let root = m[1] + (m[2] || '');
  let rest = m[3];

  // Slash bass ("/G", "/F#"). "6/9" never matches: a bass must be a note name.
  let bass = null;
  const slash = rest.match(/^(.*)\/([A-G][#b]?)$/);
  if (slash){
    rest = slash[1];
    bass = ENHARMONIC_ROOT[slash[2]] || slash[2];
  }
  if (!SUFFIX_RE.test(rest)) return null;

  root = ENHARMONIC_ROOT[root] || root;
  // Normalize the common shorthand the chord book doesn't read.
  let suffix = rest
    .replace(/^-(?=\d|$)/, 'm')          // C-7  -> Cm7
    .replace(/^mi(?!n)/, 'm')            // Cmi7 -> Cm7
    .replace(/^ma(?=\d)/, 'maj')         // Cma7 -> Cmaj7
    .replace(/^o(?=7)/, 'dim')            // Co7  -> Cdim7 (bare "o" would eat the word "Do")
    .replace(/^\+(?=\d|$)/, 'aug');      // C+   -> Caug
  const chord = root + suffix;
  if (!parseChordName(chord)) return null;
  return { name: bass ? `${chord}/${bass}` : chord, chord, bass };
}

/* ---- section headers ------------------------------------------------ */
const SECTION_WORDS = 'intro|verse|pre[- ]?chorus|chorus|refrain|bridge|outro|interlude|solo|instrumental|hook|breakdown|coda|tag|riff|ending|post[- ]?chorus|middle 8';
const SECTION_RE = new RegExp(`^\\s*(?:\\[|\\{\\s*(?:c|comment)\\s*:\\s*|#\\s*)?\\s*((?:${SECTION_WORDS})(?:\\s*\\d+)?)\\s*(?:\\]|\\}|:)?\\s*(?:x\\s*\\d+)?\\s*$`, 'i');

function sectionName(line){
  const m = line.match(SECTION_RE);
  if (!m) return null;
  const s = m[1].replace(/\s+/g, ' ').trim();
  return s[0].toUpperCase() + s.slice(1).toLowerCase();
}

/* Tokens that may sit on a chord line without making it a lyric line. */
const FILLER_RE = /^(?:\||\|\||\|:|:\||[-–—.%/]+|x\s*\d+|\d+x|\(x?\d+x?\)|N\.?C\.?|n\.c\.?|\*+)$/i;
const REPEAT_RE = /(?:^|\s)(?:x\s*(\d+)|(\d+)\s*x|\((?:x\s*)?(\d+)(?:\s*x)?\))\s*$/i;

/* ---- extraction ----------------------------------------------------- */

/* text -> {
     chords:   [{ name, chord, bass, section }]   every chord, in sheet order
     sections: [{ name, chords:[name…] }]         in order (repeats of a name kept)
     stats:    { lines, chordLines, inlineChords }
   } */
export function extractChords(text){
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  const sections = [];
  let current = null;
  let chordLines = 0, inlineChords = 0;

  const open = (name) => {
    current = { name, chords: [] };
    sections.push(current);
  };
  const push = (tok) => {
    if (!current) open('Song');
    const entry = { ...tok, section: current.name };
    out.push(entry);
    current.chords.push(tok.name);
  };

  for (const rawLine of lines){
    // UG copy/paste markup → ChordPro brackets; tabs → spaces.
    const line = rawLine.replace(/\[ch\]/gi, '[').replace(/\[\/ch\]/gi, ']')
      .replace(/\[\/?tab\]/gi, '').replace(/\t/g, '    ');
    if (!line.trim()) continue;

    const sec = sectionName(line);
    if (sec){ open(sec); continue; }

    // Inline bracketed chords inside a lyric line: "[Am]Hello [F]darkness".
    const bracketed = [...line.matchAll(/\[([^\]\s]{1,14})\]/g)].map(m => parseChordToken(m[1]));
    const lyricRest = line.replace(/\[[^\]]*\]/g, '').trim();
    if (bracketed.length && bracketed.every(Boolean) && lyricRest && /[a-z]{2}/.test(lyricRest)){
      bracketed.forEach(t => { push(t); inlineChords++; });
      continue;
    }

    // Chord line: (almost) every token is a chord or filler.
    const repeatM = line.match(REPEAT_RE);
    const repeat = repeatM ? Math.min(8, +(repeatM[1] || repeatM[2] || repeatM[3])) : 1;
    const tokens = line.replace(/\[|\]/g, ' ').split(/[\s|]+/).filter(Boolean);
    const parsed = tokens.map(t => FILLER_RE.test(t) ? 'filler' : parseChordToken(t));
    const chordToks = parsed.filter(p => p && p !== 'filler');
    const words = parsed.filter(p => p === null).length;
    if (!chordToks.length) continue;
    // Lyric lines that happen to start with "A" or "Am" fail this ratio.
    if (words > 0 && words >= chordToks.length * 0.25) continue;
    chordLines++;
    for (let r = 0; r < repeat; r++) chordToks.forEach(push);
  }
  return {
    chords: out,
    sections: sections.filter(s => s.chords.length),
    stats: { lines: lines.length, chordLines, inlineChords },
  };
}

/* ---- loop compression ----------------------------------------------- */

/* Drop immediate repeats: [C,C,G,G,Am] -> [C,G,Am]. */
export function dedupeAdjacent(seq){
  return seq.filter((c, i) => i === 0 || c !== seq[i - 1]);
}

/* Smallest repeating unit of a sequence, allowing a partial final
   repeat: [C,G,Am,F,C,G,Am,F,C,G] -> [C,G,Am,F]. A section that ends
   by rolling back onto its first chord ([Am,F,C,G,Am]) is a loop too.
   Falls back to the whole (deduped) sequence when nothing repeats. */
export function findLoop(seq, maxPeriod = 8){
  const s = dedupeAdjacent(seq);
  if (s.length <= 2) return s;
  // Compare on the chord above the bass, so "G" and "G/B" count as the
  // same harmony when looking for the period (the first pass keeps its
  // exact spelling in the result).
  const h = s.map(c => String(c).split('/')[0]);
  for (let p = 1; p <= Math.min(maxPeriod, s.length - 1); p++){
    let ok = true;
    for (let i = p; i < s.length; i++) if (h[i] !== h[i % p]){ ok = false; break; }
    // p < length, so the unit comes round again at least one chord's worth
    if (ok) return s.slice(0, p);
  }
  return s;
}

/* Unique section progressions in sheet order, merging sections that
   repeat ("Verse", "Verse 2" with the same loop collapse into one). */
export function sectionLoops(sections){
  const seen = new Map();
  const outList = [];
  for (const sec of sections){
    const loop = findLoop(sec.chords);
    if (!loop.length) continue;
    // same harmony = same loop, even if one pass spells a bass note (G vs G/B)
    const sig = loop.map(c => String(c).split('/')[0]).join(' ');
    if (seen.has(sig)){ seen.get(sig).names.push(sec.name); continue; }
    const entry = { name: sec.name, names: [sec.name], loop, count: sec.chords.length };
    seen.set(sig, entry);
    outList.push(entry);
  }
  return outList;
}

/* ---- key inference -------------------------------------------------- */

const KEY_ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_KEY_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
/* Key name for a tonic pitch class, spelled the way players write it
   (Bb major, C# minor — not A# major / Db minor). */
export function keyName(pc, mode){
  const i = ((pc % 12) + 12) % 12;
  return mode === 'minor' ? MINOR_KEY_ROOTS[i] + 'm' : KEY_ROOTS[i];
}
/* Chord root spelling used for chords detected from audio. */
export const ROOT_SPELLING = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export const ALL_KEYS = [
  ...KEY_ROOTS.map(r => r),
  ...MINOR_KEY_ROOTS.map(r => r + 'm'),
];

const isMinorish = (p) => p.intervals[1] === 3;   // m3 above root
const isDimish   = (p) => p.intervals[1] === 3 && p.intervals[2] === 6;

/* Score one key against the chord list. Weighted per chord occurrence.
   - diatonic root with the matching triad quality: +1
   - diatonic root, wrong quality (secondary dominant, modal mixture): +0.35
   - minor keys accept the harmonic-minor V / V7 as diatonic
   - non-diatonic root (borrowed bVII etc.): -0.25
   - tonic evidence: first chord, last chord, and most-played chord being
     the key's tonic chord with the right quality are the tie-breakers
     between relative major/minor (which share every diatonic chord). */
function scoreKey(key, parsed, counts){
  const { rootPc, mode } = keyInfo(key);
  const dia = diatonicChords(key).map(parseChordName);
  let score = 0;
  for (const p of parsed){
    const idx = dia.findIndex(d => d.rootPc === p.rootPc);
    if (idx < 0){ score -= 0.25; continue; }
    const want = dia[idx];
    const sameQual = isDimish(want) ? isDimish(p) || p.quality === 'm7b5'
      : isMinorish(want) === isMinorish(p);
    if (sameQual) score += 1;
    else if (mode === 'minor' && idx === 4 && !isMinorish(p)) score += 1;   // harmonic-minor V
    else score += 0.35;
  }
  const tonicQualOk = (p) => p.rootPc === rootPc && (mode === 'minor' ? isMinorish(p) : !isMinorish(p));
  if (tonicQualOk(parsed[0])) score += 1.5;
  if (tonicQualOk(parsed[parsed.length - 1])) score += 1.25;
  // most-frequent chord bonus
  let topName = null, topN = 0;
  for (const [n, c] of counts) if (c > topN){ topN = c; topName = n; }
  const top = topName && parseChordName(topName);
  if (top && tonicQualOk(top)) score += 1;
  // a dominant-7 on the 5th degree points hard at its tonic
  for (const p of parsed){
    if ((p.rootPc - rootPc + 12) % 12 === 7 && /^dom/.test(p.quality)) score += 0.4;
  }
  return score;
}

/* chord names -> { key, confidence, candidates:[{key,score}] } or null.
   Confidence is the margin between the best and second-best key,
   squashed to 0.5 (coin flip) … ~0.97, then discounted for very short
   inputs where any guess is shaky. */
export function inferKey(chordNames){
  const names = (chordNames || []).map(n => String(n).split('/')[0]);
  const parsed = names.map(parseChordName).filter(Boolean);
  if (!parsed.length) return null;
  const counts = new Map();
  for (const n of names) counts.set(n, (counts.get(n) || 0) + 1);
  const scored = ALL_KEYS.map(key => ({ key, score: scoreKey(key, parsed, counts) }))
    .sort((a, b) => b.score - a.score);
  const [a, b] = scored;
  const margin = a.score - (b ? b.score : 0);
  let confidence = 0.5 + 0.47 * Math.tanh(margin / 2.5);
  const distinct = new Set(parsed.map(p => p.rootPc)).size;
  if (distinct < 3) confidence *= 0.75;
  return {
    key: a.key,
    confidence: Math.round(confidence * 100) / 100,
    candidates: scored.slice(0, 4).map(s => ({ key: s.key, score: Math.round(s.score * 100) / 100 })),
  };
}

/* ---- Roman numerals ------------------------------------------------- */

// Semitone offset from the tonic -> numeral, per mode. Diatonic degrees
// are plain; chromatic ones use the spelling a player would write.
const NUMERAL_BY_OFFSET = {
  major: ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'],
  minor: ['I', 'bII', 'II', 'III', '#III', 'IV', '#IV', 'V', 'VI', '#VI', 'VII', '#VII'],
};
const EXT_SUFFIX = {
  maj: '', min: '', dim: '°', aug: '+', dom7: '7', min7: '7', maj7: 'maj7', m7b5: 'ø7',
  dim7: '°7', six: '6', min6: '6', sus2: 'sus2', sus4: 'sus4', add9: 'add9', madd9: 'add9',
  dom9: '9', min9: '9', maj9: 'maj9', dom11: '11', min11: '11', dom13: '13', min13: '13',
  maj11: 'maj11', maj13: 'maj13', six9: '6/9', dom7s9: '7#9', dom7b9: '7b9', dom7s5: '7#5',
  dom7b5: '7b5', minS5: '#5', dimb9: '°b9',
};

/* "F", key "C" -> "IV";  "E7", key "Am" -> "V7";  "Bb", key "C" -> "bVII". */
export function romanFor(chordName, key){
  const p = parseChordName(String(chordName).split('/')[0]);
  if (!p) return '?';
  const { rootPc, mode } = keyInfo(key);
  const off = (p.rootPc - rootPc + 12) % 12;
  let num = NUMERAL_BY_OFFSET[mode][off];
  const lower = isMinorish(p) || p.quality === 'dim' || p.quality === 'dim7' || p.quality === 'm7b5' || p.quality === 'dimb9';
  if (lower) num = num.replace(/[IV]+/, s => s.toLowerCase());
  const suf = EXT_SUFFIX[p.quality] ?? '';
  return num + suf;
}

export function toRomans(chordNames, key){
  return (chordNames || []).map(c => romanFor(c, key));
}

/* Relative major/minor of a key: "Am" <-> "C". */
export function relativeKey(key){
  const { rootPc, mode } = keyInfo(key);
  return mode === 'minor' ? keyName(rootPc + 3, 'major') : keyName(rootPc + 9, 'minor');
}

/* Same key, enharmonic spelling-insensitive: "Gb" === "F#", "D#m" === "Ebm". */
export function sameKey(a, b){
  if (!a || !b) return false;
  const A = keyInfo(normalizeKeyName(a)), B = keyInfo(normalizeKeyName(b));
  return A.rootPc === B.rootPc && A.mode === B.mode;
}

/* "F♯ minor", "Bbm", "c# min", "E" -> "F#m", "Bbm", "C#m", "E". null if unreadable. */
export function normalizeKeyName(text){
  if (!text) return null;
  const t = String(text).trim().replace(/♯/g, '#').replace(/♭/g, 'b');
  const m = t.match(/^([A-Ga-g])\s*([#b]?)\s*(m(?:in(?:or)?)?|maj(?:or)?|major|minor)?$/i);
  if (!m) return null;
  let root = m[1].toUpperCase() + (m[2] || '');
  root = ENHARMONIC_ROOT[root] || root;
  const minor = m[3] ? /^m(in)?/i.test(m[3]) && !/^maj/i.test(m[3]) : false;
  return root + (minor ? 'm' : '');
}

/* ---- one-call convenience ------------------------------------------- */

/* text -> full parse result for the UI / unit builder. */
export function analyzeSheet(text){
  const ex = extractChords(text);
  const names = ex.chords.map(c => c.name);
  const key = inferKey(names);
  const loops = sectionLoops(ex.sections).map(l => ({
    ...l,
    romans: key ? toRomans(l.loop, key.key) : [],
  }));
  return {
    chords: names,
    sections: ex.sections,
    loops,
    key,
    stats: ex.stats,
  };
}

/* ---- chords mentioned in free text (captions, notes, link shares) ---- */

/* "Chords: Am7 - D9 - Gmaj7 🎸 #guitar https://instagram.com/reel/…"
   → ['Am7', 'D9', 'Gmaj7']. Looser than extractChords (a caption mixes
   words and chords on one line), so the ambiguous single letters are
   only kept next to other chords: "A" alone in a sentence is a word.
   Order is kept; repeats are kept (it's a progression). */
export function chordsIn(text){
  const clean = String(text || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/#[\w-]+/g, ' ')                      // hashtags
    .replace(/@[\w.]+/g, ' ')                      // handles
    .replace(/\[ch\]|\[\/ch\]/gi, ' ');
  // A sheet-shaped paste reads better with the strict parser.
  const strict = extractChords(clean).chords.map(c => c.name);
  const toks = clean.split(/[\s,;|·•→>]+|(?<=\S)\s*[-–—]\s*(?=\S)/).filter(Boolean);
  const parsed = toks.map(t => parseChordToken(t.replace(/^[("'“]+|[)"'”:.!?]+$/g, '')));
  const loose = [];
  parsed.forEach((p, i) => {
    if (!p) return;
    if (/^(A|Am|E)$/.test(p.name)){
      const nb = [parsed[i - 1], parsed[i + 1]].filter(Boolean).length;
      if (!nb) return;                              // "A" / "Am" / "E" between words
    }
    loose.push(p.name);
  });
  return strict.length >= loose.length ? strict : loose;
}

/* First http(s) link in a blob of shared text, and what's left around it. */
export function splitLinkText(text){
  const s = String(text || '');
  const m = s.match(/https?:\/\/[^\s<>"']+/);
  if (!m) return { url: null, rest: s.trim() };
  const url = m[0].replace(/[),.;!?]+$/, '');
  const rest = (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
  return { url, rest };
}
