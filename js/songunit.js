/* ============================================================
   songunit.js — merge evidence from several sources into one
   song-study "unit" (link, BPM, key, color chart key, closest
   chord progression), with provenance and confidence per field.

   Sources, each optional:
     manual  — something you typed / clicked (always wins)
     sheet   — a pasted chord sheet (chordsheet.analyzeSheet)
     meta    — catalog lookup by title/artist (GetSongBPM)
     audio   — in-browser audio analysis (audioanalysis.analyzeAudio)
     tap     — the tempo keeper's BPM after tapping along

   Cross-checks: two sources agreeing raises confidence; a relative
   major/minor disagreement or a half/double-time BPM is flagged
   instead of silently picked. Pure — no DOM, no storage.
   ============================================================ */
import { sameKey, relativeKey, normalizeKeyName, toRomans } from './chordsheet.js';

// Tie-break order when supports are equal.
const PRIORITY = { manual: 5, sheet: 4, tap: 3, meta: 3, audio: 2, 'audio-chords': 2 };

export const SOURCE_LABEL = {
  manual: 'you', sheet: 'chord sheet', meta: 'GetSongBPM', audio: 'audio analysis',
  'audio-chords': 'audio chords', tap: 'tap tempo',
};

/* [{ key, confidence, source }] -> { value, source, confidence, status, note, candidates } | null
   status: 'single' | 'agree' | 'relative' | 'conflict' | 'manual' */
export function resolveKey(sources){
  const list = (sources || [])
    .map(s => s && { ...s, key: normalizeKeyName(s.key) })
    .filter(s => s && s.key && s.confidence > 0);
  if (!list.length) return null;
  const manual = list.find(s => s.source === 'manual');
  if (manual) return { value: manual.key, source: 'manual', confidence: 1, status: 'manual', note: '', candidates: [] };

  const keys = [];
  for (const s of list) if (!keys.some(k => sameKey(k, s.key))) keys.push(s.key);
  const scored = keys.map(k => {
    let support = 0, rel = 0, best = null;
    for (const s of list){
      if (sameKey(s.key, k)){
        support += s.confidence;
        if (!best || PRIORITY[s.source] > PRIORITY[best.source]) best = s;
      } else if (sameKey(relativeKey(s.key), k)) rel += s.confidence;
    }
    return { key: k, support, score: support + 0.35 * rel, source: best.source };
  }).sort((a, b) => (b.score - a.score) || (PRIORITY[b.source] - PRIORITY[a.source]));

  const top = scored[0];
  const total = list.reduce((a, s) => a + s.confidence, 0);
  const agreeing = list.filter(s => sameKey(s.key, top.key));
  const relatives = list.filter(s => sameKey(relativeKey(s.key), top.key));
  const others = list.length - agreeing.length - relatives.length;

  let status = 'single', note = '';
  let confidence = Math.max(...agreeing.map(s => s.confidence));
  if (agreeing.length >= 2){
    status = 'agree';
    // independent sources agreeing: 1 - Π(1 - c)
    confidence = 1 - agreeing.reduce((p, s) => p * (1 - s.confidence), 1);
    note = `${agreeing.map(s => SOURCE_LABEL[s.source] || s.source).join(' + ')} agree`;
  }
  if (others > 0){
    status = 'conflict';
    confidence = Math.min(confidence, top.support / total);
    const odd = list.filter(s => !sameKey(s.key, top.key) && !sameKey(relativeKey(s.key), top.key));
    note = `${odd.map(s => `${SOURCE_LABEL[s.source] || s.source} says ${s.key}`).join('; ')} — check by ear`;
  } else if (relatives.length){
    if (status !== 'agree') status = 'relative';
    confidence *= 0.85;
    note = (note ? note + '; ' : '') +
      `${relatives.map(s => SOURCE_LABEL[s.source] || s.source).join(' + ')} heard the relative ${relatives[0].key} — same notes, different home chord`;
  }
  return {
    value: top.key,
    source: top.source,
    confidence: Math.round(Math.min(0.99, confidence) * 100) / 100,
    status, note,
    candidates: scored.slice(0, 4).map(s => s.key),
  };
}

const ratio = (a, b) => a / b;
const near = (x, target, tol = 0.035) => Math.abs(x - target) / target <= tol;

/* [{ bpm, confidence, source }] -> { value, source, confidence, status, note, alternatives } | null
   status: 'single' | 'agree' | 'half-double' | 'conflict' | 'manual' */
export function resolveBpm(sources){
  const list = (sources || []).filter(s => s && Number.isFinite(+s.bpm) && +s.bpm > 0 && s.confidence > 0)
    .map(s => ({ ...s, bpm: +s.bpm }));
  if (!list.length) return null;
  const manual = list.find(s => s.source === 'manual');
  if (manual) return { value: Math.round(manual.bpm), source: 'manual', confidence: 1, status: 'manual', note: '', alternatives: halfDouble(manual.bpm) };

  const scored = list.map(c => {
    let support = 0, octave = 0;
    for (const s of list){
      const r = ratio(s.bpm, c.bpm);
      if (near(r, 1)) support += s.confidence;
      else if (near(r, 2) || near(r, 0.5)) octave += s.confidence;
    }
    return { ...c, support, score: support + 0.3 * octave };
  }).sort((a, b) => (b.score - a.score) || (PRIORITY[b.source] - PRIORITY[a.source]));
  let top = scored[0];
  // Half/double-time between sources: both readings are valid, so let the
  // more trustworthy source (catalog / your tapping over audio DSP) set
  // which one is shown rather than whichever is more confident.
  const octOf = (t) => list.filter(s => near(ratio(s.bpm, t.bpm), 2) || near(ratio(s.bpm, t.bpm), 0.5));
  const better = octOf(top).sort((a, b) => PRIORITY[b.source] - PRIORITY[a.source])[0];
  if (better && PRIORITY[better.source] > PRIORITY[top.source] &&
      list.filter(s => near(ratio(s.bpm, top.bpm), 1)).length < 2){
    top = scored.find(s => s.source === better.source && s.bpm === better.bpm) || top;
  }
  const same = list.filter(s => near(ratio(s.bpm, top.bpm), 1));
  const oct = list.filter(s => near(ratio(s.bpm, top.bpm), 2) || near(ratio(s.bpm, top.bpm), 0.5));
  const other = list.length - same.length - oct.length;

  let status = 'single', note = '';
  let confidence = Math.max(...same.map(s => s.confidence));
  if (same.length >= 2){
    status = 'agree';
    confidence = 1 - same.reduce((p, s) => p * (1 - s.confidence), 1);
    note = `${same.map(s => SOURCE_LABEL[s.source] || s.source).join(' + ')} agree`;
  }
  if (oct.length){
    status = status === 'agree' ? 'agree' : 'half-double';
    note = (note ? note + '; ' : '') + `${oct.map(s => `${SOURCE_LABEL[s.source] || s.source} counts ${Math.round(s.bpm)}`).join(', ')} (half/double time — both are "right", pick how you feel it)`;
  }
  if (other){
    status = 'conflict';
    confidence = Math.min(confidence, top.support / list.reduce((a, s) => a + s.confidence, 0));
    note = (note ? note + '; ' : '') + list.filter(s => !same.includes(s) && !oct.includes(s))
      .map(s => `${SOURCE_LABEL[s.source] || s.source} says ${Math.round(s.bpm)}`).join(', ') + ' — tap along to settle it';
  }
  // Prefer the catalog's / tapper's exact figure among agreeing sources.
  const shown = same.slice().sort((a, b) => PRIORITY[b.source] - PRIORITY[a.source])[0];
  return {
    value: Math.round(shown.bpm),
    source: shown.source,
    confidence: Math.round(Math.min(0.99, confidence) * 100) / 100,
    status, note,
    alternatives: halfDouble(shown.bpm),
  };
}

function halfDouble(bpm){
  return [bpm / 2, bpm * 2].filter(b => b >= 40 && b <= 260).map(Math.round);
}

/* Stable id: same title/artist (or same clip) always maps to the same
   unit, which is what makes re-importing idempotent. */
export function unitId({ title, artist, clipId }){
  const slug = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (title && slug(title)) return `u_${slug(title)}${artist && slug(artist) ? '__' + slug(artist) : ''}`.slice(0, 80);
  if (clipId) return `u_clip_${clipId}`;
  return null;
}

/* Progression options: one per distinct section loop from the sheet,
   plus the audio sketch's loop. */
export function progressionOptions({ sheet, audio }){
  const out = [];
  for (const l of (sheet?.loops || [])){
    out.push({ id: 'sheet:' + l.names.join('+'), label: l.names.join(' / '), chords: l.loop, source: 'sheet' });
  }
  if (audio?.chords?.loop?.length){
    out.push({ id: 'audio:loop', label: 'Audio sketch (loop)', chords: audio.chords.loop, source: 'audio-chords' });
  }
  return out;
}

/* Assemble the persisted unit. `choice` is a progression option id. */
export function buildUnit({ title = '', artist = '', clipId = null, url = '', bpm, key, timeSig = null, sheet = null, audio = null, meta = null, choice = null, existing = null }){
  const id = unitId({ title, artist, clipId });
  if (!id) throw new Error('Give the song a title (or link a clip) so it can be saved.');
  const options = progressionOptions({ sheet, audio });
  const chosen = options.find(o => o.id === choice) || options[0] || null;
  const now = new Date().toISOString();
  const keyVal = key?.value || null;
  return {
    v: 1,
    id,
    title: title.trim(),
    artist: artist.trim(),
    clipId: clipId || null,
    url: url || '',
    bpm: bpm ? { value: bpm.value, source: bpm.source, confidence: bpm.confidence } : null,
    key: key ? { value: keyVal, source: key.source, confidence: key.confidence } : null,
    timeSig: timeSig || null,
    progression: chosen ? chosen.chords.slice(0, 32) : [],
    progressionFrom: chosen ? { id: chosen.id, label: chosen.label, source: chosen.source } : null,
    romans: chosen && keyVal ? toRomans(chosen.chords.slice(0, 32), keyVal) : [],
    sections: (sheet?.loops || []).map(l => ({ names: l.names, loop: l.loop })),
    sourceUrl: meta?.sourceUrl || '',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}
