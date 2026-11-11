/* ============================================================
   seeds.js — seed packs for "My chords" (pure, no DOM).

   A seed pack is a JSON file (seeds/*.pack.json) that pre-fills
   trainer tracks: name, chord sequence, and a `meta` card (link,
   key, BPM, color chart, progression source). Applying a pack is
   IDEMPOTENT:
     • every seeded track has a stable id  seed_<packId>_<sid>, so
       re-applying never duplicates;
     • a track already at this pack's rev (or newer) is left alone;
     • a newer rev refreshes meta, and refreshes chords only if you
       haven't edited them since they were seeded (a signature of the
       seeded chords is kept in track.seed.sig). { force:true }
       overwrites your edits too.
   Portable: the same pack goes in as a file (⤓ seed pack), a link
   (#seed=…), or a console snippet (build/seed-pack.mjs --snippet).
   ============================================================ */

export const SEED_FORMAT = 'genre-bender-seed-pack';
export const SEED_PARAM = 'seed=';

const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

export function seedTrackId(packId, sid){ return `seed_${packId}_${sid}`; }

function normChord(c){
  if (typeof c === 'string') return { name: c.trim(), frets: null };
  const frets = Array.isArray(c?.frets) && c.frets.length === 6
    ? c.frets.map(f => (f == null || f === 'x') ? null : +f) : null;
  return { name: String(c?.name || '').trim(), frets };
}
export function chordsSig(chords){
  return (chords || []).map(c => `${c.name}@${c.frets ? c.frets.map(f => f ?? 'x').join(',') : ''}`).join('|');
}
function safeLink(u){ return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : ''; }

/* Returns a list of problems (empty = valid). parseChord is optional
   (chordbook.parseChordName) so the CLI/tests can check chord names. */
export function validatePack(p, { parseChord } = {}){
  const errs = [];
  if (!p || typeof p !== 'object') return ['not an object'];
  if (p.format !== SEED_FORMAT) errs.push(`format must be "${SEED_FORMAT}"`);
  if (p.v !== 1) errs.push('v must be 1');
  if (!SLUG.test(p.id || '')) errs.push('id must be a lowercase slug');
  if (!Number.isInteger(p.rev) || p.rev < 1) errs.push('rev must be an integer ≥ 1');
  if (!Array.isArray(p.tracks) || !p.tracks.length) { errs.push('tracks must be a non-empty array'); return errs; }
  const seen = new Set();
  p.tracks.forEach((t, i) => {
    const at = `tracks[${i}]`;
    if (!SLUG.test(t?.sid || '')) errs.push(`${at}.sid must be a lowercase slug`);
    else if (seen.has(t.sid)) errs.push(`${at}.sid "${t.sid}" is duplicated`);
    seen.add(t?.sid);
    if (!t?.name || typeof t.name !== 'string') errs.push(`${at}.name missing`);
    if (!Array.isArray(t?.chords) || !t.chords.length) errs.push(`${at}.chords must be a non-empty array`);
    else if (parseChord) t.chords.map(normChord).forEach(c => {
      let ok = false; try { ok = !!parseChord(c.name); } catch { ok = false; }
      if (!ok) errs.push(`${at}: chord "${c.name}" doesn't parse`);
    });
    if (t?.meta?.link && !safeLink(t.meta.link)) errs.push(`${at}.meta.link must be an https URL`);
  });
  return errs;
}

function cleanMeta(m){
  if (!m || typeof m !== 'object') return null;
  const out = {};
  for (const k of ['artist', 'title', 'key', 'keyNote', 'bpmNote', 'progression', 'progressionNote', 'confidence'])
    if (m[k] != null && m[k] !== '') out[k] = String(m[k]);
  const link = safeLink(m.link); if (link) out.link = link;
  if (Number.isFinite(+m.bpm) && +m.bpm > 0) out.bpm = Math.round(+m.bpm);
  if (Array.isArray(m.colorChart)) out.colorChart = m.colorChart.map(String).filter(Boolean).slice(0, 12);
  if (Array.isArray(m.sources)) out.sources = m.sources.map(safeLink).filter(Boolean).slice(0, 8);
  return out;
}

/* Merge a pack into a tracks array. Never mutates the input; never
   deletes anything. Returns { tracks, added, updated, kept, unchanged }
   (arrays of track names) + firstId (first added/updated track). */
export function mergeSeedPack(tracks, pack, { force = false } = {}){
  const errs = validatePack(pack);
  if (errs.length) throw new Error('Bad seed pack: ' + errs[0]);
  const out = (Array.isArray(tracks) ? tracks : []).slice();
  const r = { added: [], updated: [], kept: [], unchanged: [], firstId: null };
  for (const st of pack.tracks){
    const id = seedTrackId(pack.id, st.sid);
    const chords = st.chords.map(normChord);
    const sig = chordsSig(chords);
    const meta = cleanMeta(st.meta);
    const i = out.findIndex(t => t && t.id === id);
    if (i < 0){
      const t = { id, name: st.name, chords, seed: { pack: pack.id, sid: st.sid, rev: pack.rev, sig } };
      if (meta) t.meta = meta;
      out.push(t);
      r.added.push(st.name); r.firstId ??= id;
      continue;
    }
    const have = out[i];
    if (!force && have.seed && have.seed.rev >= pack.rev){ r.unchanged.push(have.name); continue; }
    const edited = !force && (!have.seed || chordsSig(have.chords) !== have.seed.sig);
    const next = { ...have, seed: { pack: pack.id, sid: st.sid, rev: pack.rev, sig: edited ? (have.seed?.sig ?? '') : sig } };
    if (meta) next.meta = meta; else delete next.meta;
    if (!edited){ next.chords = chords; next.name = st.name; delete next.licks; delete next.colorLevel; }
    out[i] = next;
    (edited ? r.kept : r.updated).push(next.name); r.firstId ??= id;
  }
  r.tracks = out;
  return r;
}

/* Clips list entries (clips.js clipsImport shape) for the pack's links,
   so they show up in the clip dock / color-map picker with key + BPM. */
export function packToClips(pack){
  return (pack.tracks || []).filter(t => safeLink(t.meta?.link)).map(t => ({
    url: t.meta.link,
    label: t.meta.title ? `${t.meta.title} — ${t.meta.artist || ''}`.replace(/ — $/, '') : t.name,
    key: t.meta.key || '', bpm: t.meta.bpm || null,
    genres: 'R&B, Neo-soul', notes: `seed:${pack.id}`,
  }));
}

/* ---- link codec: 'j' + base64url(JSON) or 'z' + base64url(deflate-raw) */
function b64url(bytes){
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s){
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
async function pipe(bytes, stream){
  return new Uint8Array(await new Response(new Response(bytes).body.pipeThrough(stream)).arrayBuffer());
}
export async function encodeSeedPayload(pack){
  const bytes = new TextEncoder().encode(JSON.stringify(pack));
  if (typeof CompressionStream === 'function'){
    try { return 'z' + b64url(await pipe(bytes, new CompressionStream('deflate-raw'))); } catch { /* fall through */ }
  }
  return 'j' + b64url(bytes);
}
export async function decodeSeedPayload(payload){
  const kind = payload[0];
  let bytes = unb64url(payload.slice(1));
  if (kind === 'z'){
    if (typeof DecompressionStream !== 'function') throw new Error('this browser cannot read compressed seed links');
    bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  } else if (kind !== 'j') throw new Error('not a seed link');
  return JSON.parse(new TextDecoder().decode(bytes));
}
