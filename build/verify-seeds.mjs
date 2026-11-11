/* verify-seeds.mjs — idempotency + portability checks for seed packs.
   Run:  node build/verify-seeds.mjs */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { validatePack, mergeSeedPack, encodeSeedPayload, decodeSeedPayload, seedTrackId, packToClips } from '../js/seeds.js';
import { parseChordName } from '../js/chordbook.js';
import { buildSnippet } from './seed-pack.mjs';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const okAsync = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const clone = (x) => JSON.parse(JSON.stringify(x));

for (const f of fs.readdirSync('seeds').filter(f => f.endsWith('.pack.json'))){
  const pack = JSON.parse(fs.readFileSync(`seeds/${f}`, 'utf8'));
  ok(`${f}: valid, every chord parses`, () => assert.deepEqual(validatePack(pack, { parseChord: parseChordName }), []));
}

const pack = JSON.parse(fs.readFileSync('seeds/rnb-neosoul-guitar.pack.json', 'utf8'));
const mine = { id: 'trk_mine', name: 'My chords', chords: [{ name: 'C', frets: null }] };

const r1 = mergeSeedPack([mine], pack);
ok('first apply adds every track, keeps existing ones', () => {
  assert.equal(r1.added.length, pack.tracks.length);
  assert.deepEqual(r1.tracks[0], mine);
  assert.equal(r1.firstId, seedTrackId(pack.id, pack.tracks[0].sid));
  assert.ok(r1.tracks[1].meta.link.startsWith('https://open.spotify.com/track/'));
});
const r2 = mergeSeedPack(clone(r1.tracks), pack);
ok('second apply is a no-op (idempotent)', () => {
  assert.equal(r2.added.length + r2.updated.length + r2.kept.length, 0);
  assert.deepEqual(r2.tracks, r1.tracks);
});
ok('input array is never mutated', () => {
  const before = clone(r1.tracks); mergeSeedPack(r1.tracks, { ...pack, rev: 9 }); assert.deepEqual(r1.tracks, before);
});
const pack2 = clone(pack); pack2.rev = pack.rev + 1; pack2.tracks[0].chords = ['Gmaj9', 'Am9', 'Bbmaj7', 'Dmaj9'];
ok('new rev refreshes untouched tracks', () => {
  const r = mergeSeedPack(clone(r1.tracks), pack2);
  assert.equal(r.updated.length, pack.tracks.length);
  assert.equal(r.tracks[1].chords[0].name, 'Gmaj9');
  assert.equal(r.tracks[1].seed.rev, pack2.rev);
});
ok('new rev keeps your edited chords (meta still refreshes)', () => {
  const t = clone(r1.tracks); t[1].chords.push({ name: 'E7', frets: null });
  const r = mergeSeedPack(t, pack2);
  assert.deepEqual(r.kept, [t[1].name]);
  assert.equal(r.tracks[1].chords.at(-1).name, 'E7');
  assert.equal(r.tracks[1].seed.rev, pack2.rev);
  // and stays "edited" on the next rev too
  const r3 = mergeSeedPack(r.tracks, { ...pack2, rev: pack2.rev + 1 });
  assert.deepEqual(r3.kept, [t[1].name]);
});
ok('force overwrites edits', () => {
  const t = clone(r1.tracks); t[1].chords = [{ name: 'E7', frets: null }];
  const r = mergeSeedPack(t, pack2, { force: true });
  assert.equal(r.tracks[1].chords[0].name, 'Gmaj9');
});
ok('bad packs are rejected', () => {
  assert.throws(() => mergeSeedPack([], { ...pack, id: 'Bad Id' }));
  assert.ok(validatePack({ ...pack, tracks: [pack.tracks[0], pack.tracks[0]] }).some(e => /duplicated/.test(e)));
  assert.ok(validatePack(clone({ ...pack, tracks: [{ ...pack.tracks[0], chords: ['Hmaj7'] }] }), { parseChord: parseChordName }).length);
});
ok('clips list: one clean link per track', () => {
  const c = packToClips(pack);
  assert.equal(c.length, pack.tracks.length);
  assert.ok(c.every(x => !x.url.includes('?') && x.key && x.bpm));
});
await okAsync('#seed= payload round-trips', async () => {
  assert.deepEqual(await decodeSeedPayload(await encodeSeedPayload(pack)), pack);
});
ok('console snippet: works with no seeds.js, idempotent', () => {
  const store = new Map([['GenreBenderTrainerTracks_v1', JSON.stringify({ tracks: [mine], activeId: mine.id })]]);
  const localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  let reloads = 0; const location = { reload: () => reloads++ };
  const run = () => new Function('localStorage', 'location', 'console', 'return ' + buildSnippet(pack).replace(/^\/\*.*\*\/\n/, ''))(localStorage, location, { log(){} });
  const a = run(); const after1 = store.get('GenreBenderTrainerTracks_v1');
  const b = run(); const after2 = store.get('GenreBenderTrainerTracks_v1');
  assert.equal(a.added.length, pack.tracks.length);
  assert.equal(b.unchanged.length, pack.tracks.length);
  assert.equal(after1, after2);
  assert.equal(reloads, 1);
});
console.log(`\n${n} seed checks passed`);
