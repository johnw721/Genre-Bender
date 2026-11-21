import fs from 'node:fs';
import { mergeSeedPack } from '../js/seeds.js';
const p = JSON.parse(fs.readFileSync('seeds/rnb-neosoul-guitar.pack.json','utf8'));
const r1 = mergeSeedPack([], { ...p, rev: 1, tracks: p.tracks.map(t => ({ ...t, chords: ['C'] })) });
const r2 = mergeSeedPack(r1.tracks, p);
console.log('rev1 -> rev2:', { updated: r2.updated.length, kept: r2.kept.length }, r2.tracks.map(t => t.chords.map(c => c.name).join(' ')));
