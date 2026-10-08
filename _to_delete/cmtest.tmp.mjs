const root = process.argv[2];
globalThis.window = {}; 
const { colorLadder, recolorName, nextColorName } = await import(root + '/js/colormap.js').catch(e => { console.error('import fail', e.message); process.exit(1); });
const { getVoicing, parseChordName, MAX_PLAYABLE_SPAN } = await import(root + '/js/chordbook.js');
const { KEYS } = await import(root + '/js/theorydata.js');
let bad = 0;
for (const k of KEYS){
  const L = colorLadder(k);
  if (k==='E' || k==='Am') console.log(k, L.map(r => `${r.roman}:${r.triad}[${r.spelling.join(' ')}] ${r.colors.map(c=>c.name+(c.outside.length?'!'+c.outside:'')).join(',')} | ${r.extras.map(c=>c.name+(c.outside.length?'!'+c.outside:'')).join(',')}`).join('\n  '));
  for (const r of L) for (const c of [...r.colors, ...r.extras]){
    const v = getVoicing(c.name); const p = parseChordName(c.name);
    const want = new Set(p.intervals.map(i => (p.rootPc+i)%12));
    const have = v ? new Set(v.midis.map(m=>m%12)) : new Set();
    const cov = [...want].filter(x=>have.has(x)).length;
    if (r.colors.includes(c) && c.outside.length){ console.log('COLOR OUTSIDE', k, c.name, c.outside); bad++; }
    if (!v || !have.has(p.rootPc) || v.span > MAX_PLAYABLE_SPAN || cov < want.size - (want.size>4?1:0)) { console.log('VOICING', k, c.name, v && v.frets, 'cov', cov, '/', want.size, 'span', v&&v.span); bad++; }
  }
}
console.log('E recolor L1..3', [1,2,3].map(l => ['E','F#m','G#m','A','B','C#m','D#dim'].map(n=>recolorName(n,'E',l)).join(' ')));
console.log('cycle', ['E','Emaj7','E6','Emaj9','E7','Eadd9'].map(n=>nextColorName(n,'E')));
console.log('bad', bad);
