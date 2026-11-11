/* ============================================================
   songmeta-core.mjs — title + artist → BPM / key / time signature.

   Shared by the Netlify Function (netlify/functions/songmeta.mjs)
   and the local dev proxy (server/proxy.js), so production and
   `npm start` behave identically. Runs server-side only: the
   GetSongBPM API key never reaches the browser.

   Provider: GetSongBPM (https://getsongbpm.com/api). Free key; their
   terms require a visible backlink to getsongbpm.com wherever the
   data is shown — the client renders one from `attribution`.

   lookupSongMeta() never throws for "not found" — it returns
   { found:false } — and throws only for configuration / upstream
   failures, which the handlers turn into 5xx responses.
   ============================================================ */

const BASE = 'https://api.getsong.co';

/* Lowercase, strip accents/punctuation/"(feat. …)"/"- Remastered" noise. */
export function normText(s){
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\((?:feat|ft|with)\.?[^)]*\)/g, ' ')
    .replace(/\s-\s.*(?:remaster|version|live|edit|mix).*$/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the\s+/, '')
    .trim();
}

/* Token-overlap similarity in [0,1] (Dice coefficient on words). */
export function similarity(a, b){
  const A = normText(a).split(' ').filter(Boolean), B = normText(b).split(' ').filter(Boolean);
  if (!A.length || !B.length) return 0;
  if (A.join(' ') === B.join(' ')) return 1;
  const setB = new Set(B);
  const shared = A.filter(w => setB.has(w)).length;
  return (2 * shared) / (A.length + B.length);
}

/* "F♯m" / "B♭" / "Em" → "F#m" / "Bb" / "Em"; null if unreadable. */
export function normalizeKeyOf(k){
  if (!k) return null;
  const t = String(k).trim().replace(/♯/g, '#').replace(/♭/g, 'b');
  const m = t.match(/^([A-G])([#b]?)\s*(m|min|minor|maj|major)?$/i);
  if (!m) return null;
  const minor = m[3] ? /^m(in(or)?)?$/i.test(m[3]) : false;
  return m[1].toUpperCase() + (m[2] || '') + (minor ? 'm' : '');
}

function artistName(song){
  const a = song && song.artist;
  if (!a) return '';
  return typeof a === 'string' ? a : (a.name || '');
}

/* Pick the best search hit for the requested title/artist. */
export function pickBest(results, title, artist){
  const scored = (results || []).map(r => {
    const t = similarity(r.title || r.song_title || '', title);
    const a = artist ? similarity(artistName(r), artist) : 0.5;
    return { r, t, a, score: t * 0.65 + a * 0.35 };
  }).sort((x, y) => y.score - x.score);
  const best = scored[0];
  if (!best || best.t < 0.5 || (artist && best.a < 0.34)) return null;
  return best;
}

function shape(song, match){
  const tempo = parseFloat(song.tempo);
  return {
    found: true,
    title: song.title || song.song_title || '',
    artist: artistName(song),
    bpm: Number.isFinite(tempo) && tempo > 0 ? tempo : null,
    key: normalizeKeyOf(song.key_of),
    timeSig: song.time_sig || null,
    matchScore: Math.round(match.score * 100) / 100,
    source: 'getsongbpm',
    sourceUrl: song.uri || 'https://getsongbpm.com',
    attribution: { text: 'Tempo & key data: GetSongBPM', url: 'https://getsongbpm.com' },
  };
}

/* { title, artist, apiKey, fetchImpl? } → shaped result. */
export async function lookupSongMeta({ title, artist = '', apiKey, fetchImpl = globalThis.fetch }){
  if (!apiKey){
    const e = new Error('GETSONGBPM_API_KEY is not set on the server.');
    e.status = 501;
    throw e;
  }
  title = String(title || '').trim().slice(0, 120);
  artist = String(artist || '').trim().slice(0, 120);
  if (!title){
    const e = new Error('title is required');
    e.status = 400;
    throw e;
  }
  const lookup = artist ? `song:${title} artist:${artist}` : title;
  const type = artist ? 'both' : 'song';
  const url = `${BASE}/search/?api_key=${encodeURIComponent(apiKey)}&type=${type}&lookup=${encodeURIComponent(lookup)}&limit=10`;
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!res.ok){
    const e = new Error(`GetSongBPM search failed (${res.status})`);
    e.status = 502;
    throw e;
  }
  const data = await res.json();
  // "no result" comes back as {search:{error:"no result"}}, not an empty array.
  const results = Array.isArray(data && data.search) ? data.search : [];
  const best = pickBest(results, title, artist);
  if (!best) return { found: false, candidates: results.slice(0, 5).map(r => ({ title: r.title, artist: artistName(r) })) };

  let song = best.r;
  // Search hits usually carry tempo/key; if not, fetch the full song record.
  if ((song.tempo == null || song.key_of == null) && song.id){
    const r2 = await fetchImpl(`${BASE}/song/?api_key=${encodeURIComponent(apiKey)}&id=${encodeURIComponent(song.id)}`,
      { headers: { Accept: 'application/json' } });
    if (r2.ok){
      const d2 = await r2.json();
      if (d2 && d2.song) song = { ...song, ...d2.song };
    }
  }
  return shape(song, best);
}

/* Shared HTTP-ish handler: query params in, { status, body } out. */
export async function handleSongMeta(params, apiKey, fetchImpl){
  try {
    const out = await lookupSongMeta({ title: params.get('title'), artist: params.get('artist') || '', apiKey, fetchImpl });
    return { status: 200, body: out };
  } catch (err){
    return { status: err.status || 502, body: { error: err.message || String(err) } };
  }
}
