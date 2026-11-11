/* Genre Bender seed pack "rnb-neosoul-guitar" rev 2 — paste into the devtools console on any Genre Bender tab. Safe to re-run. */
(() => {
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

const SEED_FORMAT = 'genre-bender-seed-pack';
const SEED_PARAM = 'seed=';

const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

function seedTrackId(packId, sid){ return `seed_${packId}_${sid}`; }

function normChord(c){
  if (typeof c === 'string') return { name: c.trim(), frets: null };
  const frets = Array.isArray(c?.frets) && c.frets.length === 6
    ? c.frets.map(f => (f == null || f === 'x') ? null : +f) : null;
  return { name: String(c?.name || '').trim(), frets };
}
function chordsSig(chords){
  return (chords || []).map(c => `${c.name}@${c.frets ? c.frets.map(f => f ?? 'x').join(',') : ''}`).join('|');
}
function safeLink(u){ return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : ''; }

/* Returns a list of problems (empty = valid). parseChord is optional
   (chordbook.parseChordName) so the CLI/tests can check chord names. */
function validatePack(p, { parseChord } = {}){
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
function mergeSeedPack(tracks, pack, { force = false } = {}){
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
function packToClips(pack){
  return (pack.tracks || []).filter(t => safeLink(t.meta?.link)).map(t => ({
    url: t.meta.link,
    label: t.meta.title ? `${t.meta.title} — ${t.meta.artist || ''}`.replace(/ — $/, '') : t.name,
    key: t.meta.key || '', bpm: t.meta.bpm || null,
    genres: 'R&B, Neo-soul', notes: `seed:${pack.id}`,
  }));
}


  const pack = {"format":"genre-bender-seed-pack","v":1,"id":"rnb-neosoul-guitar","rev":2,"title":"R&B / neo-soul guitar — 5 study tracks","createdAt":"2026-11-03","notes":"rev 2: progressions now taken from published chord charts (2+ sources compared per song). Confidence reflects how well the sources agree.","tracks":[{"sid":"best-part","name":"Best Part — Daniel Caesar ft. H.E.R.","chords":["Dmaj7","Am7","Gmaj7","Bbmaj7"],"meta":{"artist":"Daniel Caesar ft. H.E.R.","title":"Best Part","link":"https://open.spotify.com/track/1Q7EgiMOuwDcB0PJC6AzON","key":"D","bpm":75,"bpmNote":"variable, around 75","colorChart":["Dmaj9","Em9(11)","F#m7(11)","Gmaj9(#11)","A13(9)","Bm9(11)","C#m7b5(11)"],"progression":"chart","progressionNote":"Intro/verse loop — four charts agree on this order. Am7 = minor v (borrowed), Bbmaj7 = borrowed bVI: try the color map's out-of-scale view.","confidence":"high","sources":["https://www.e-chords.com/chords/daniel-caesar/best-part","https://guitartwitt.com/daniel-caesar-best-part-chords-feat-h-e-r/","https://www.guitartabsexplorer.com/daniel-caesar/best-part-(ver2)-crd","https://tabs.ultimate-guitar.com/d/daniel_caesar/best_part_crd.htm"]}},{"sid":"get-you","name":"Get You — Daniel Caesar ft. Kali Uchis","chords":["Em","F#m7","Bm","A7"],"meta":{"artist":"Daniel Caesar ft. Kali Uchis","title":"Get You","link":"https://open.spotify.com/track/2uP6t2J5MEwhr9rDkAAzwh","key":"Em","bpm":74,"colorChart":["Em9(11)","F#m7b5(11)","Gmaj9","Am9(11)","Bm7(11)","Cmaj9(#11)","D13(9)"],"progression":"chart","progressionNote":"i–ii–v–IV7 loop throughout — the most-viewed charts agree. F#m7 and A7 put a C# in the key (E Dorian, not natural minor). Common richer variants: Em9–F#m7–Bm7–Bbm7–Am7–A7 (chromatic walk down).","confidence":"high","sources":["https://tabs.ultimate-guitar.com/d/daniel_caesar/get_you_crd.htm","https://pt.ultimate-guitar.com/tab/daniel-caesar/get-you-chords-1934197","https://pt.ultimate-guitar.com/tab/daniel-caesar/get-you-chords-2300421"]}},{"sid":"japanese-denim","name":"Japanese Denim — Daniel Caesar","chords":["Ebmaj7","Bb","Fm7","Abm6","Db"],"meta":{"artist":"Daniel Caesar","title":"Japanese Denim","link":"https://open.spotify.com/track/7IVukH71OXfAu3KudrrizN","key":"Eb","bpm":124,"bpmNote":"12/8 sway — charts count it ~62–68 BPM","colorChart":["Ebmaj9","Fm9(11)","Gm7(11)","Abmaj9(#11)","Bb13(9)","Cm9(11)","Dm7b5(11)"],"progression":"chart","progressionNote":"Intro/verse loop — several charts agree (some write Eb / Abm). Abm = borrowed iv minor, Db = bVII.","confidence":"high","sources":["https://www.guitartabsexplorer.com/daniel-caesar/japanese-denim-crd","https://e-chords.com/ukulele/daniel-caesar/japanese-denim","https://ukutabs.com/es/d/daniel-caesar/japanese-denim/","https://www.musicgateway.com/song-key-bpm/daniel-caesar/japanese-denim"]}},{"sid":"memory","name":"Memory — Tom Misch","chords":["Dbmaj7","Ab","Bbm7","Gbmaj7","Fm7"],"meta":{"artist":"Tom Misch","title":"Memory","link":"https://open.spotify.com/track/6LUG39CQPJSRC6Pq3myHNk","key":"Db","bpm":83,"keyNote":"listed as C# major (enharmonic)","colorChart":["Dbmaj9","Ebm9(11)","Fm7(11)","Gbmaj9(#11)","Ab13(9)","Bbm9(11)","Cm7b5(11)"],"progression":"analysis","progressionNote":"I–V–vi–IV–iii. Two sources agree on Db / Ab / Bbm / Gb (one adds Fm), but both are mostly auto-detected — ear-check the order. Capo 1 + C-family shapes is the easy route.","confidence":"medium","sources":["https://chordify.net/chords/tom-misch-songs/memory-chords","https://guitartuna.com/chords/memory-tom-misch-easy-guitar-chords-67cb4317bbbe9ff91cb92f27","https://tunebat.com/Info/Memory-Tom-Misch/6LUG39CQPJSRC6Pq3myHNk"],"bpmNote":"83–88 across sources"}},{"sid":"dark-red","name":"Dark Red — Steve Lacy","chords":["A#","G#m","F#","B7","Bmaj7"],"meta":{"artist":"Steve Lacy","title":"Dark Red","link":"https://open.spotify.com/track/3cJjqvXbFwiWgnuWgoyhPM","key":"D#m","bpm":136,"bpmNote":"feels half-time (~68)","colorChart":["D#m9(11)","Fm7b5(11)","F#maj9","G#m9(11)","A#m7(11)","Bmaj9(#11)","C#13(9)"],"progression":"chart","progressionNote":"Intro/verse loop from two hand-made charts that agree (one spells it Bb–Abm–Gb). The key is the uncertain part. B7 → Bmaj7 is the signature move.","confidence":"medium","sources":["https://tabs.ultimate-guitar.com/tab/steve-lacy/dark-red-chords-2488815","https://tabs.ultimate-guitar.com/tab/steve-lacy/dark-red-chords-1986265","https://songs-5d4d4bntm-klangio.vercel.app/en/s/Steve%20Lacy/Dark%20Red/x-OzspEcQG8"],"keyNote":"sources say G#m / Bb / Ebm — D#m fits the loop best (A# is its V)"}}]};
  const KEY = 'GenreBenderTrainerTracks_v1';
  let doc = null; try { doc = JSON.parse(localStorage.getItem(KEY)); } catch {}
  const r = mergeSeedPack(doc && Array.isArray(doc.tracks) ? doc.tracks : [], pack);
  const activeId = r.firstId || (doc && doc.activeId) || (r.tracks[0] && r.tracks[0].id);
  localStorage.setItem(KEY, JSON.stringify({ tracks: r.tracks, activeId }));
  console.log('[seed]', pack.id, { added: r.added, updated: r.updated, kept: r.kept, unchanged: r.unchanged });
  if (typeof location !== 'undefined' && location.reload && (r.added.length || r.updated.length || r.kept.length)) location.reload();
  return r;
})();
