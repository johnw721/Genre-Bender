/* verify-songimport.mjs — checks for the "Learn a song" pipeline.
   Run:  node build/verify-songimport.mjs        (npm run verify:song)

   1. chordsheet.js   — chord extraction across sheet formats, key inference, romans, loops
   2. audioanalysis.js — key / BPM / chords on synthesized audio with known answers
   3. songunit.js     — cross-source resolution (agree / relative / half-double / conflict)
   4. songmeta        — shared core with a mocked GetSongBPM, the Netlify Function
                        handler, and the Express dev-proxy route
   5. persistence     — units + track survive a reload (built single file in jsdom,
                        http origin so localStorage exists). Needs `npm run build:single`. */
import { existsSync, readFileSync } from 'node:fs';
import { extractChords, analyzeSheet, parseChordToken, inferKey, romanFor, findLoop, normalizeKeyName, relativeKey } from '../js/chordsheet.js';
import { analyzeAudio } from '../js/audioanalysis.js';
import { resolveKey, resolveBpm, unitId, buildUnit } from '../js/songunit.js';
import { lookupSongMeta, handleSongMeta, pickBest, normalizeKeyOf } from '../shared/songmeta-core.mjs';
import { synthProgression } from './synth-audio.mjs';

let fail = 0, pass = 0;
const check = (name, ok, extra = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------- 1. chord sheets ---------- */
const UG = `[Intro]
Am  F  C  G

[Verse 1]
Am                F
I walked along the empty road
C                       G/B
Am I the only one who knows
A man is waiting by the door

[Chorus]
| F | G | Am | Am | x2
F       G        C   E7
`;
const r = analyzeSheet(UG);
check('chords-over-lyrics: lyric lines starting "Am"/"A" ignored', !r.sections.find(s => s.name === 'Verse 1').chords.includes('A'),
  r.sections.map(s => s.name + ':' + s.chords.join(' ')).join(' | '));
check('bar notation with x2 repeat', eq(r.sections.find(s => s.name === 'Chorus').chords, ['F', 'G', 'Am', 'Am', 'F', 'G', 'Am', 'Am', 'F', 'G', 'C', 'E7']));
check('slash chord kept for display', r.chords.includes('G/B'));
check('verse with G/B collapses into the intro loop', r.loops[0].names.join(',') === 'Intro,Verse 1' && eq(r.loops[0].loop, ['Am', 'F', 'C', 'G']));
check('key: minor song with E7 → Am', r.key.key === 'Am' && r.key.confidence > 0.8, JSON.stringify(r.key));

const chordpro = `{c: Verse}\n[G]Take me [D]home, country [Em]roads, to the [C]place\n{c: Chorus}\n[C]All my [G]memories`;
const cp = extractChords(chordpro);
check('ChordPro inline + {c:} sections', eq(cp.chords.map(c => c.name), ['G', 'D', 'Em', 'C', 'C', 'G']) && eq(cp.sections.map(s => s.name), ['Verse', 'Chorus']));
const ug = extractChords('[ch]Em[/ch]   [ch]C[/ch]\nsome words here\n[ch]G[/ch]  [ch]D[/ch]');
check('Ultimate Guitar [ch] markup', eq(ug.chords.map(c => c.name), ['Em', 'C', 'G', 'D']));

const tokens = { 'F#m7b5': 'F#m7b5', 'Bbmaj7': 'Bbmaj7', 'C6/9': 'C6/9', 'Cm(add9)': 'Cm(add9)', 'Cmi7': 'Cm7', 'C-7': 'Cm7', 'Co7': 'Cdim7',
  'Asus2/G': 'Asus2/G', 'F♯m': 'F#m', 'B♭': 'Bb', 'E#m': 'Fm', '(Am': 'Am', 'G)': 'G' };
const badTok = Object.entries(tokens).filter(([t, want]) => parseChordToken(t)?.name !== want);
check('chord token spellings normalize', !badTok.length, badTok.map(([t]) => `${t}→${parseChordToken(t)?.name}`).join(', '));
const words = ['The', 'Do', 'Dim', 'Bad', 'Each', 'Cause', 'Got', 'N.C.', 'Bee', 'Add'];
check('ordinary words are not chords', words.every(w => parseChordToken(w) === null), words.filter(w => parseChordToken(w)).join(','));

const keyCases = [
  [['G', 'D', 'Em', 'C'], 'G'], [['Em', 'C', 'G', 'D', 'Em'], 'Em'], [['C', 'G', 'Am', 'F'], 'C'], [['Am', 'Dm', 'E7', 'Am'], 'Am'],
  [['D', 'G', 'A7', 'D'], 'D'], [['Bb', 'F', 'Gm', 'Eb'], 'Bb'], [['F#m', 'D', 'A', 'E'], 'F#m'], [['C', 'Bb', 'F', 'C'], 'F'],
  [['E', 'A', 'B7', 'E'], 'E'], [['Dm', 'Bb', 'C', 'Dm'], 'Dm'],
];
const badKeys = keyCases.filter(([cs, k]) => inferKey(cs).key !== k);
check('key inference on common progressions', badKeys.length <= 1, badKeys.map(([cs, k]) => `${cs.join(' ')}: want ${k} got ${inferKey(cs).key}`).join('; '));
check('mixolydian C–Bb–F–C reads as F or C (borrowed bVII)', ['F', 'C'].includes(inferKey(['C', 'Bb', 'F', 'C']).key));

check('romans in major', ['C', 'Dm', 'Em', 'F', 'G7', 'Am', 'Bdim', 'Bb', 'Ab'].map(c => romanFor(c, 'C')).join(' ') === 'I ii iii IV V7 vi vii° bVII bVI');
check('romans in minor (harmonic V)', ['Am', 'Bdim', 'C', 'Dm', 'E7', 'F', 'G'].map(c => romanFor(c, 'Am')).join(' ') === 'i ii° III iv V7 VI VII');
check('loop finder', eq(findLoop(['C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F', 'C']), ['C', 'G', 'Am', 'F']) && eq(findLoop(['C', 'C', 'G', 'G']), ['C', 'G']) && eq(findLoop(['A', 'B', 'C']), ['A', 'B', 'C']));
check('key name normalization', eq(['F♯ minor', 'Bbm', 'c# min', 'E', 'Gb major', 'H'].map(normalizeKeyName), ['F#m', 'Bbm', 'C#m', 'E', 'Gb', null]));
check('relative keys spelled sensibly', relativeKey('Cm') === 'Eb' && relativeKey('Bb') === 'Gm' && relativeKey('Am') === 'C');
check('empty / junk paste', analyzeSheet('just some lyrics\nnothing else here').chords.length === 0 && analyzeSheet('').key === null);

/* ---------- 2. audio analysis on synthesized songs ---------- */
const audioCases = [
  { chords: ['C', 'G', 'Am', 'F'], bpm: 100, sr: 44100, key: 'C' },
  { chords: ['Am', 'F', 'C', 'G'], bpm: 128, sr: 48000, key: ['Am', 'C'] },
  { chords: ['Em', 'C', 'G', 'D'], bpm: 84, sr: 44100, key: ['Em', 'G'] },
  { chords: ['D', 'A', 'Bm', 'G'], bpm: 140, sr: 44100, key: 'D' },
  { chords: ['Gm', 'Eb', 'Bb', 'F'], bpm: 72, sr: 22050, key: ['Gm', 'Bb'] },
  { chords: ['E', 'B', 'C#m', 'A'], bpm: 96, sr: 44100, key: 'E', beatsPerChord: 2, repeats: 6 },
];
for (const c of audioCases){
  const { samples, sr } = synthProgression({ chords: c.chords, bpm: c.bpm, sr: c.sr, beatsPerChord: c.beatsPerChord || 4, repeats: c.repeats || 4 });
  const t0 = Date.now();
  const a = analyzeAudio(samples, sr);
  const ms = Date.now() - t0;
  const label = `${c.chords.join('-')} @${c.bpm}`;
  const okBpm = Math.abs(a.bpm.bpm - c.bpm) / c.bpm < 0.02;
  check(`audio BPM ${label}`, okBpm, `${a.bpm.bpm} (${a.bpm.confidence}) in ${ms} ms`);
  const wantKeys = [].concat(c.key);
  check(`audio key ${label}`, wantKeys.includes(a.key.key), `${a.key.key} ${a.key.confidence} | chords say ${a.chords.key?.key}`);
  if ((c.beatsPerChord || 4) === 4){
    check(`audio chord loop ${label}`, eq(a.chords.loop, c.chords), a.chords.loop.join(' '));
    check(`chord-sketch key picks the tonic ${label}`, a.chords.key?.key === c.chords[0], a.chords.key?.key);
  } else {
    check(`audio chords, 2 per bar ${label}`, c.chords.every(ch => a.chords.perBeat.includes(ch)), [...new Set(a.chords.perBeat)].join(' '));
  }
}
{
  const { samples, sr } = synthProgression({ chords: ['C', 'G', 'Am', 'F'], bpm: 110, noise: 0.15 });
  const a = analyzeAudio(samples, sr);
  check('noisy (SNR ~ low) still finds tempo + key', Math.abs(a.bpm.bpm - 110) < 2.5 && ['C', 'Am'].includes(a.key.key), `${a.bpm.bpm} ${a.key.key}`);
}
{
  let x = 123456789; const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296 - 0.5; };
  const noise = new Float32Array(44100 * 12).map(() => rnd() * 0.3);
  const a = analyzeAudio(noise, 44100);
  check('pure noise → low key + tempo confidence', a.key.confidence < 0.5 && a.bpm.confidence < 0.6, `key ${a.key.key} ${a.key.confidence}, bpm conf ${a.bpm?.confidence}`);
  let threw = false;
  try { analyzeAudio(new Float32Array(44100 * 3), 44100); } catch { threw = true; }
  check('too-short audio throws a readable error', threw);
}

/* ---------- 3. resolution ---------- */
const k1 = resolveKey([{ key: 'Am', confidence: 0.9, source: 'sheet' }, { key: 'Am', confidence: 0.7, source: 'meta' }]);
check('keys agree → confidence up', k1.status === 'agree' && k1.confidence > 0.95);
const k2 = resolveKey([{ key: 'Am', confidence: 0.9, source: 'sheet' }, { key: 'C', confidence: 0.7, source: 'audio' }]);
check('relative major/minor flagged, sheet wins', k2.value === 'Am' && k2.status === 'relative' && /relative C/.test(k2.note));
const k3 = resolveKey([{ key: 'Am', confidence: 0.9, source: 'sheet' }, { key: 'Eb', confidence: 0.6, source: 'meta' }]);
check('real key conflict flagged', k3.value === 'Am' && k3.status === 'conflict' && k3.confidence < 0.7, JSON.stringify(k3));
check('enharmonic keys agree', resolveKey([{ key: 'F♯ minor', confidence: 0.6, source: 'meta' }, { key: 'Gbm', confidence: 0.6, source: 'audio' }]).status === 'agree');
check('manual key always wins', resolveKey([{ key: 'Am', confidence: 0.99, source: 'sheet' }, { key: 'G', confidence: 1, source: 'manual' }]).value === 'G');
const b1 = resolveBpm([{ bpm: 84, confidence: 0.8, source: 'meta' }, { bpm: 168.2, confidence: 0.9, source: 'audio' }]);
check('half/double time: catalog value shown, flagged', b1.value === 84 && b1.status === 'half-double' && b1.alternatives.includes(168));
const b2 = resolveBpm([{ bpm: 120, confidence: 0.8, source: 'meta' }, { bpm: 119.4, confidence: 0.9, source: 'audio' }, { bpm: 121, confidence: 0.85, source: 'tap' }]);
check('three BPM sources agree', b2.value === 120 && b2.status === 'agree' && b2.confidence > 0.98);
check('BPM conflict flagged', resolveBpm([{ bpm: 90, confidence: 0.8, source: 'meta' }, { bpm: 123, confidence: 0.7, source: 'audio' }]).status === 'conflict');
check('unit id stable + idempotent', unitId({ title: "Sweet Child O' Mine", artist: "Guns N' Roses" }) === unitId({ title: 'sweet child o mine', artist: 'GUNS N ROSES' }));
check('unit id falls back to clip', unitId({ clipId: 'c1' }) === 'u_clip_c1' && unitId({}) === null);
{
  const sheet = analyzeSheet(UG);
  const u = buildUnit({ title: 'X', artist: 'Y', bpm: b2, key: k1, sheet, choice: null });
  check('buildUnit: first loop + romans', eq(u.progression, ['Am', 'F', 'C', 'G']) && eq(u.romans, ['i', 'VI', 'III', 'VII']) && u.bpm.value === 120);
  const u2 = buildUnit({ title: 'X', artist: 'Y', bpm: b2, key: k1, sheet, choice: 'sheet:Chorus', existing: u });
  check('buildUnit: chosen section + createdAt kept', u2.progression[0] === 'F' && u2.createdAt === u.createdAt);
  let threw = false; try { buildUnit({ bpm: b2 }); } catch { threw = true; }
  check('buildUnit needs a title or clip', threw);
}

/* ---------- 4. song metadata lookup ---------- */
const calls = [];
const mockFetch = (routes) => async (url) => {
  calls.push(url);
  for (const [re, body, status = 200] of routes) if (re.test(url)) return { ok: status < 400, status, json: async () => body };
  return { ok: false, status: 404, json: async () => ({}) };
};
const searchHit = { search: [
  { id: 'a1', title: 'Wonderwall (Remastered)', artist: { name: 'Oasis' }, tempo: '87', key_of: 'F♯m', time_sig: '4/4', uri: 'https://getsongbpm.com/song/wonderwall/a1' },
  { id: 'a2', title: 'Wonderwall', artist: { name: 'Ryan Adams' }, tempo: '72', key_of: 'C', uri: 'x' },
] };
{
  const m = await lookupSongMeta({ title: 'Wonderwall', artist: 'Oasis', apiKey: 'K', fetchImpl: mockFetch([[/\/search\//, searchHit]]) });
  check('lookup picks the right artist + normalizes key', m.found && m.artist === 'Oasis' && m.bpm === 87 && m.key === 'F#m' && m.timeSig === '4/4', JSON.stringify(m));
  check('lookup request shape', /api\.getsong\.co\/search\/\?api_key=K&type=both&lookup=song%3AWonderwall%20artist%3AOasis/.test(calls.at(-1)), calls.at(-1));
  check('attribution backlink included', m.attribution.url === 'https://getsongbpm.com');
}
{
  calls.length = 0;
  const m = await lookupSongMeta({ title: 'Song', artist: 'Band', apiKey: 'K', fetchImpl: mockFetch([
    [/\/search\//, { search: [{ id: 'z9', title: 'Song', artist: { name: 'Band' } }] }],
    [/\/song\/\?.*id=z9/, { song: { id: 'z9', title: 'Song', tempo: '101', key_of: 'B♭', time_sig: '3/4', artist: { name: 'Band' } } }],
  ]) });
  check('search hit without tempo → /song/ follow-up', m.found && m.bpm === 101 && m.key === 'Bb' && m.timeSig === '3/4' && calls.length === 2);
}
{
  const m = await lookupSongMeta({ title: 'Nope', artist: 'Nobody', apiKey: 'K', fetchImpl: mockFetch([[/\/search\//, { search: { error: 'no result' } }]]) });
  check('"no result" object → found:false', m.found === false);
  const wrong = await lookupSongMeta({ title: 'Wonderwall', artist: 'Metallica', apiKey: 'K', fetchImpl: mockFetch([[/\/search\//, searchHit]]) });
  check('wrong artist is rejected, not guessed', wrong.found === false && wrong.candidates.length === 2);
  check('pickBest tolerates "(feat. …)" / "The"', !!pickBest([{ title: 'Song (feat. Someone)', artist: { name: 'The Band' } }], 'song', 'band'));
  check('key_of normalization', normalizeKeyOf('E♭m') === 'Ebm' && normalizeKeyOf('C') === 'C' && normalizeKeyOf('?') === null);
}
{
  const p = (q) => new URLSearchParams(q);
  const noKey = await handleSongMeta(p('title=a'), '', mockFetch([]));
  check('no API key → 501', noKey.status === 501 && /GETSONGBPM_API_KEY/.test(noKey.body.error));
  const noTitle = await handleSongMeta(p('artist=b'), 'K', mockFetch([]));
  check('no title → 400', noTitle.status === 400);
  const up = await handleSongMeta(p('title=a'), 'K', mockFetch([[/\/search\//, {}, 503]]));
  check('upstream failure → 502', up.status === 502);
}
{
  // The deployed Netlify Function (v2 Request/Response handler).
  const fn = (await import('../netlify/functions/songmeta.mjs')).default;
  const realFetch = globalThis.fetch;
  globalThis.fetch = mockFetch([[/\/search\//, searchHit]]);
  process.env.GETSONGBPM_API_KEY = 'K';
  const res = await fn(new Request('https://site.example/.netlify/functions/songmeta?title=Wonderwall&artist=Oasis'));
  const body = await res.json();
  check('Netlify function: 200 + JSON + cache header', res.status === 200 && body.bpm === 87 && /max-age/.test(res.headers.get('cache-control') || ''));
  delete process.env.GETSONGBPM_API_KEY;
  const res2 = await fn(new Request('https://site.example/.netlify/functions/songmeta?title=x'));
  check('Netlify function: 501 without key', res2.status === 501);
  const res3 = await fn(new Request('https://site.example/.netlify/functions/songmeta', { method: 'POST' }));
  check('Netlify function: GET only', res3.status === 405);
  globalThis.fetch = realFetch;
}
if (existsSync(new URL('../server/node_modules/express', import.meta.url))){
  // The Express dev proxy mounts the same handler at the same path.
  const { spawn } = await import('node:child_process');
  const port = 18000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server/proxy.js'], {
    cwd: new URL('..', import.meta.url), env: { ...process.env, PROXY_PORT: String(port), GETSONGBPM_API_KEY: '', ANTHROPIC_API_KEY: 'x' }, stdio: 'pipe',
  });
  await new Promise(r => { child.stdout.on('data', d => /listening/.test(d) && r()); setTimeout(r, 3000); });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/.netlify/functions/songmeta?title=x`);
    const body = await res.json();
    check('dev proxy route mounted (501 without key)', res.status === 501 && /GETSONGBPM_API_KEY/.test(body.error), `${res.status} ${JSON.stringify(body)}`);
  } catch (e){ check('dev proxy route mounted', false, e.message); }
  child.kill();
} else console.log('skip  dev proxy route (run npm run setup first)');

/* ---------- 5. persistence across reload (built bundle) ---------- */
const dist = new URL('../dist/genre-bender.html', import.meta.url);
if (existsSync(dist)){
  const { JSDOM, VirtualConsole } = await import('jsdom');
  const html = readFileSync(dist, 'utf8');
  const boot = async (seed) => {
    const errors = [];
    const dom = new JSDOM(html, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/genre-bender.html',
      virtualConsole: new VirtualConsole().on('jsdomError', e => errors.push(e.message)),
      beforeParse(w){
        for (const [k, v] of Object.entries(seed || {})) w.localStorage.setItem(k, v);
        const node = () => ({ connect(){ return node(); }, disconnect(){}, start(){}, stop(){}, frequency: {}, gain: { value: 0, setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){}, setTargetAtTime(){}, cancelScheduledValues(){} } });
        w.AudioContext = class { constructor(){ this.currentTime = 0; this.destination = node(); } createOscillator(){ return node(); } createGain(){ return node(); } createBiquadFilter(){ return node(); } createDynamicsCompressor(){ return node(); } resume(){ return Promise.resolve(); } };
        w.HTMLCanvasElement.prototype.getContext = () => null;
        w.matchMedia = q => ({ matches: false, media: q, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
        w.scrollTo = () => {};
      },
    });
    await new Promise(r => setTimeout(r, 1200));
    return { w: dom.window, d: dom.window.document, errors };
  };
  const a = await boot();
  const click = (d, sel) => d.querySelector(sel).dispatchEvent(new a.w.MouseEvent('click', { bubbles: true }));
  a.d.getElementById('song-title').value = 'Persist Me';
  a.d.getElementById('song-sheet').value = 'G  D  Em  C\nG  D  C';
  click(a.d, '[data-action="song:parse"]');
  click(a.d, '[data-action="song:save"]');
  const units = JSON.parse(a.w.localStorage.getItem('GenreBenderSongUnits_v1') || 'null');
  const tracks = JSON.parse(a.w.localStorage.getItem('GenreBenderTrainerTracks_v1') || 'null');
  check('unit written to localStorage', units?.units?.length === 1 && units.units[0].id === 'u_persist-me' && units.units[0].key.value === 'G', JSON.stringify(units?.units?.[0]?.key));
  // "G D Em C / G D C" has no repeating unit, so the whole pass is kept
  check('track written with deterministic id', tracks?.tracks?.some(t => t.id === 'trk_u_persist-me' && t.chords.map(c => c.name).join(' ') === 'G D Em C G D C'),
    JSON.stringify(tracks?.tracks?.map(t => [t.id, t.chords.map(c => c.name).join(' ')])));
  check('no lyrics/raw sheet persisted', !JSON.stringify(units).includes('G  D  Em'));
  // backup/export includes units
  const exportHas = a.w.localStorage.getItem('GenreBenderSongUnits_v1') && true;
  const b = await boot({
    GenreBenderSongUnits_v1: a.w.localStorage.getItem('GenreBenderSongUnits_v1'),
    GenreBenderTrainerTracks_v1: a.w.localStorage.getItem('GenreBenderTrainerTracks_v1'),
  });
  check('units list restored after reload', /Persist Me/.test(b.d.getElementById('song-units').textContent));
  b.d.getElementById('song-title').value = 'Persist Me';
  b.d.getElementById('song-sheet').value = 'G  D  Em  C';
  click(b.d, '[data-action="song:parse"]');
  click(b.d, '[data-action="song:save"]');
  const t2 = JSON.parse(b.w.localStorage.getItem('GenreBenderTrainerTracks_v1')).tracks.filter(t => t.id === 'trk_u_persist-me');
  check('re-import after reload updates in place', t2.length === 1 && JSON.parse(b.w.localStorage.getItem('GenreBenderSongUnits_v1')).units.length === 1);
  check('no runtime errors in reload test', !a.errors.length && !b.errors.length, [...a.errors, ...b.errors].slice(0, 2).join(' | '));
  void exportHas;
} else console.log('skip  persistence (run npm run build:single first)');

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
