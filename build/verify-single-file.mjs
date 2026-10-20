/* verify-single-file.mjs — smoke test for dist/genre-bender.html.

   Run:  node build/verify-single-file.mjs dist/genre-bender.html
   jsdom has no Web Audio / canvas, so those are stubbed. We're checking
   that the bundle parses, boots, and builds its UI without errors. */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const file = process.argv[2];
const html = readFileSync(file, 'utf8');

const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'file:///tmp/genre-bender.html',
  virtualConsole: new (await import('jsdom')).VirtualConsole()
    .on('jsdomError', e => errors.push('jsdomError: ' + (e.stack || e.message)))
    .on('error', (...a) => errors.push('console.error: ' + a.join(' '))),
  beforeParse(window) {
    class FakeParam { constructor(){ this.value = 0; }
      setValueAtTime(){return this;} linearRampToValueAtTime(){return this;}
      exponentialRampToValueAtTime(){return this;} setTargetAtTime(){return this;}
      cancelScheduledValues(){return this;} }
    const node = () => ({
      connect(){ return node(); }, disconnect(){}, start(){}, stop(){},
      frequency: new FakeParam(), gain: new FakeParam(), detune: new FakeParam(),
      Q: new FakeParam(), type: 'sine', buffer: null, loop: false,
      onended: null, playbackRate: new FakeParam(),
    });
    class FakeAudioContext {
      constructor(){ this.currentTime = 0; this.sampleRate = 44100;
        this.destination = node(); this.state = 'running'; }
      createOscillator(){ return node(); } createGain(){ return node(); }
      createBiquadFilter(){ return node(); } createBufferSource(){ return node(); }
      createDynamicsCompressor(){ return node(); } createStereoPanner(){ return node(); }
      createConvolver(){ return node(); } createDelay(){ return node(); }
      createWaveShaper(){ return node(); } createAnalyser(){ return node(); }
      createBuffer(c, l){ return { getChannelData: () => new Float32Array(l), length: l }; }
      decodeAudioData(){ return Promise.resolve(this.createBuffer(1, 1)); }
      resume(){ return Promise.resolve(); } suspend(){ return Promise.resolve(); }
      close(){ return Promise.resolve(); }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
    window.HTMLCanvasElement.prototype.getContext = () => ({
      canvas: {}, save(){}, restore(){}, beginPath(){}, closePath(){}, moveTo(){},
      lineTo(){}, arc(){}, fill(){}, stroke(){}, fillRect(){}, clearRect(){},
      strokeRect(){}, fillText(){}, strokeText(){}, translate(){}, rotate(){},
      scale(){}, setTransform(){}, measureText: () => ({ width: 10 }),
      createLinearGradient: () => ({ addColorStop(){} }), setLineDash(){},
    });
    window.matchMedia = window.matchMedia || (q => ({
      matches: false, media: q, addListener(){}, removeListener(){},
      addEventListener(){}, removeEventListener(){},
    }));
    window.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 16);
    window.cancelAnimationFrame = id => clearTimeout(id);
    window.scrollTo = () => {};
  },
});

await new Promise(r => setTimeout(r, 1500));
const w = dom.window;
const d = w.document;

const checks = [];
const check = (name, pass, extra = '') => checks.push({ name, pass, extra });

check('window.Tonal loaded (inlined)', typeof w.Tonal === 'object' && !!w.Tonal.Chord);
check('embedded @font-face rules', (html.match(/@font-face/g) || []).length >= 8,
      `${(html.match(/@font-face/g) || []).length} faces`);
check('no external http(s) resources', !/(?:src|href)="https?:\/\//.test(html));
check('no local file references', !/(?:src|href)="(?:js|css)\//.test(html));
check('default endpoint is Anthropic API', html.includes('https://api.anthropic.com/v1/messages'));
check('no localhost proxy default', !html.includes('localhost:8787'));

const globals = ['switchTab', 'generateBlend', 'toggleMetronome', 'openSettings',
                 'trainerNext', 'fretPlayChord', 'generatePhrase', 'exportMidi'];
const missing = globals.filter(g => typeof w[g] !== 'function');
check('inline handlers bridged to window', missing.length === 0, missing.join(', '));

check('genre library rendered', d.querySelectorAll('.chip').length > 40,
      `${d.querySelectorAll('.chip').length} chips`);
check('beat grid built', d.querySelectorAll('#beat-grid *').length > 0,
      `${d.querySelectorAll('#beat-grid *').length} nodes`);
check('fretboard rendered', d.querySelectorAll('[class*=fret]').length > 10,
      `${d.querySelectorAll('[class*=fret]').length} nodes`);
check('tabs present', d.querySelectorAll('.tab').length >= 3);
check('panels present', d.querySelectorAll('.panel').length >= 3);

// Every inline on* handler must resolve to a real function on window.
const handlerNames = new Set();
for (const el of d.querySelectorAll('*')) {
  for (const attr of el.attributes || []) {
    if (attr.name.startsWith('on')) {
      // Bare calls only — "(?<!\.)" skips method calls like document.getElementById().
      const m = attr.value.match(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g) || [];
      m.forEach(x => handlerNames.add(x.replace(/\s*\($/, '')));
    }
  }
}
const jsBuiltins = new Set(['if','for','while','return','typeof','function','event','this','switch','catch']);
const unresolved = [...handlerNames].filter(n =>
  !jsBuiltins.has(n) && typeof w[n] !== 'function' && typeof w[n] === 'undefined');
check('all inline on* handlers resolve', unresolved.length === 0, unresolved.join(', '));

// Interaction: switch tabs, toggle a genre chip, run the trainer.
try {
  w.switchTab('guided');
  w.switchTab('mixer');
  d.querySelector('.chip')?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  w.trainerNext?.();
  check('tab switch + chip click + trainerNext ran', true);
} catch (e) {
  check('tab switch + chip click + trainerNext ran', false, e.message);
}


// Every data-action / data-on-* name in the markup (and in rendered clip markup)
// must be registered with actions.js.
{
  const names = new Set();
  const attrs = ['data-action', 'data-on-change', 'data-on-input', 'data-on-enter'];
  for (const el of d.querySelectorAll(attrs.map(a => `[${a}]`).join(','))) {
    for (const a of attrs) if (el.hasAttribute(a)) names.add(el.getAttribute(a));
  }
  const missing = [...names].filter(n => !w.GenreBender?.hasAction(n));
  check('all data-action handlers registered', names.size > 0 && missing.length === 0,
        missing.length ? missing.join(', ') : `${names.size} actions`);
}

// Two-pane shell: rail holds tempo keeper + session + clip player, outside the panels.
check('rail contains tempo keeper + clip player',
      !!d.querySelector('.rail #bpm-slider') && !!d.querySelector('.rail #clip-dock') && !d.querySelector('.panel #clip-dock'));

// Reference clips: paste → embed, save, tags, BPM hand-off, seed mixer, survives tab switch.
// jsdom reports a 1024px viewport, so the player runs in floating mode here.
try {
  const $ = id => d.getElementById(id);
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const change = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  check('clip player floating + closed at boot (narrow viewport)',
        $('clip-dock').classList.contains('floating') && $('clip-dock').classList.contains('closed'));
  click($('clips-btn'));
  check('header button opens player', !$('clip-dock').classList.contains('closed'));
  $('clip-url').value = 'https://www.tiktok.com/@u/video/7301234567890123456';
  click(d.querySelector('[data-action="clips:add"]'));
  const ifr = $('clip-frame').querySelector('iframe');
  check('clip embeds via official endpoint', ifr?.src === 'https://www.tiktok.com/embed/v2/7301234567890123456');
  $('clip-url').value = 'https://x.com/a/status/42'; click(d.querySelector('[data-action="clips:add"]'));
  $('clip-url').value = 'https://www.tiktok.com/@u/video/7301234567890123456'; click(d.querySelector('[data-action="clips:add"]'));
  check('clips saved + deduped by url', d.querySelectorAll('.clip-item').length === 2);
  const active = d.querySelector('.clip-item.active');
  const id = active?.dataset.id;
  change(d.querySelector('#clip-meta [data-field="bpm"]'), '140');
  change(d.querySelector('#clip-meta [data-field="genres"]'), 'phonk, jersey club, not-a-genre');
  change(d.querySelector('#clip-meta [data-field="key"]'), 'G major');
  const tagInputs = [...d.querySelectorAll('#clip-meta .clip-tags input')].map(i => i.value);
  check('clip tags round-trip', tagInputs.includes('140') && tagInputs.includes('phonk, jersey club, not-a-genre'));
  click(d.querySelector('[data-action="clips:usebpm"]'));
  check('clip bpm → tempo keeper', $('bpm-slider')?.value === '140');
  w.setBPM(92);
  click(d.querySelector('[data-action="clips:seed"]'));
  const sel = [...d.querySelectorAll('.chip.selected')].map(c => c.dataset.genre).sort();
  check('seed mixer selects catalog genres', sel.join('|') === 'Jersey club|Phonk', sel.join(', '));
  check('seed mixer sets key everywhere', $('guitar-key').value === 'G' && $('rail-key').value === 'G' && $('piano-key').value === 'G');
  check('seed mixer sets tempo', $('bpm-slider').value === '140');
  check('rail mirrors selection + reference',
        d.querySelectorAll('#rail-genres .rail-genre').length === 2 && $('rail-reference').style.display !== 'none');
  check('seed lands on mixer tab', $('panel-mixer').classList.contains('active'));
  w.switchTab('guided');
  check('clip player survives tab switch', !$('clip-dock').classList.contains('closed') && !!$('clip-frame').querySelector('iframe'));
  click(d.querySelector('[data-action="clips:clear-ref"]'));
  check('reference clears', $('rail-reference').style.display === 'none');
  $('clip-url').value = 'https://example.com/x'; click(d.querySelector('[data-action="clips:add"]'));
  check('unknown link falls back to open-in-tab', !!$('clip-frame').querySelector('a[target="_blank"]'));
  click(d.querySelector('[data-action="clips:remove"]'));
  check('clip removal', d.querySelectorAll('.clip-item').length === 2);
  // Analyze picker follows the clips list
  check('analyze picker lists saved clips', d.querySelectorAll('#analyze-clip option').length === 2);
  // Guided workflow reflects live state
  w.switchTab('guided');
  const steps = () => [...d.querySelectorAll('#guided-steps .gstep')];
  check('guided stepper renders 6 steps', steps().length === 6);
  // (the tagged clip was removed above, so "tag" is the open step; seed stays done via the reference)
  check('guided marks clip + seed done, tag current',
        steps()[0].classList.contains('done') && steps()[2].classList.contains('done') && steps()[1].classList.contains('current'),
        steps().map(s => s.className.replace('gstep ', '')).join(', '));
  w.clearAll();
  check('clearAll empties rail', d.querySelectorAll('#rail-genres .rail-genre').length === 0);
  w.switchTab('guided');
  check('guided re-evaluates after clear', !steps()[2].classList.contains('done'));
  check('header tools in one row', d.querySelectorAll('.header-actions .hbtn').length === 4);
  // Practice stepper reflects live state
  w.switchTab('practice');
  check('practice panel shows', $('panel-practice').classList.contains('active'));
  const psteps = () => [...d.querySelectorAll('#practice-steps .pstep')];
  check('practice plan B renders 5–6 steps', psteps().length >= 5 && psteps().length <= 6, String(psteps().length));
  click(d.querySelector('.practice-plan[data-plan="A"]'));
  check('practice plan switch → A (7 steps)', psteps().length === 7 && d.querySelector('.practice-plan[data-plan="A"]').classList.contains('selected'));
  check('practice step 1 not done with no open clip', !psteps()[0].classList.contains('done'));
  click(d.querySelector('.pstep-tick'));
  check('manual tick marks a step done', psteps().some(li => li.classList.contains('done') && li.querySelector('.pstep-tick')?.textContent === 'undo'));
  click(d.querySelector('.pstep-tick[data-step]'));
  click(d.querySelector('.practice-plan[data-plan="B"]'));
  check("practice B names today's drill", /Today's drill/.test(psteps()[1].textContent));
  click(psteps()[1].querySelector('.gstep-btn'));
  check('practice mode button selects the drill', psteps()[1].classList.contains('done') && ($('panel-trainer') || $('panel-mixer')).classList.contains('active'));
  w.switchTab('practice');
  check('practice stat line renders', /today: \d+ card/.test($('practice-stat').textContent));
} catch (e) {
  check('clips / seed / rail interaction ran', false, e.message);
}

// Learn a song: paste → lookup (stubbed server fn) → save unit → My chords track; idempotent re-save.
try {
  const $ = id => d.getElementById(id);
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const enter = el => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  // file:// is an opaque origin in jsdom (no localStorage), so state is read
  // back from what the app renders: the saved-units list and My chords view.
  const unitRows = () => [...d.querySelectorAll('#song-units .song-unit')].map(r => r.textContent.replace(/\s+/g, ' ').trim());
  const showTrack = () => { click(d.querySelector('[data-action="song:openTrack"]')); const q = $('trainer-question'); w.switchTab('upload'); return q; };
  const trackTabs = (q) => [...q.querySelectorAll('.trainer-track-tabs *')].filter(el => !el.children.length && /♪ Test Song/.test(el.textContent)).length;
  const trackChords = (q) => [...q.querySelectorAll('#trainer-custom-diagrams [data-track-idx]')].map(b => (b.querySelector('.trainer-diagram-label')?.textContent || '').trim().replace(/^\d+\.\s*/, '').split(/\s/)[0]);
  w.switchTab('upload');
  check('learn-a-song panel present', !!$('song-sheet') && !!$('song-output') && !!d.querySelector('[data-action="song:parse"]'));
  check('tab capture disabled where unsupported', $('song-capture-btn').disabled === true);
  $('song-title').value = 'Test Song';
  $('song-artist').value = 'Tester';
  $('song-sheet').value = '[Verse]\nAm        F\nwalking down the line\nC         G\nsinging all the time\n[Chorus]\nF  G  Am\nhold on\nF  G  C  E7\n';
  click(d.querySelector('[data-action="song:parse"]'));
  check('paste → chords + key', /Am – F – C – G/.test($('song-output').textContent) && /i – VI – III – VII/.test($('song-output').textContent),
        $('song-status').textContent);
  // server function stubbed: first a deploy without functions (HTML), then a real answer
  w.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'text/html' }, json: async () => ({}) });
  click(d.querySelector('[data-action="song:lookup"]'));
  await new Promise(r => setTimeout(r, 50));
  check('lookup degrades on static hosting', /not available here/.test($('song-output').textContent));
  let calledUrl = '';
  w.fetch = async (url) => { calledUrl = String(url); return { ok: true, status: 200, headers: { get: () => 'application/json' },
    json: async () => ({ found: true, title: 'Test Song', artist: 'Tester', bpm: 96, key: 'Am', timeSig: '4/4',
      attribution: { text: 'Tempo & key data: GetSongBPM', url: 'https://getsongbpm.com' } }) }; };
  click(d.querySelector('[data-action="song:lookup"]'));
  await new Promise(r => setTimeout(r, 50));
  check('lookup calls the server function', calledUrl.startsWith('/.netlify/functions/songmeta?title=Test%20Song&artist=Tester'), calledUrl);
  const keyCard = [...d.querySelectorAll('.song-field')].find(c => /Key/.test(c.querySelector('.chord-card-label').textContent));
  check('sheet + lookup keys cross-check (agree)', keyCard?.dataset.status === 'agree' && /Am/.test(keyCard.textContent));
  check('GetSongBPM backlink shown', !!d.querySelector('#song-output a[href="https://getsongbpm.com"]'));
  click(d.querySelector('[data-action="song:save"]'));
  const r1 = unitRows();
  check('save → one unit with progression', r1.length === 1 && /Test Song — Tester/.test(r1[0]) && /Am · 96 BPM · Am F C G/.test(r1[0]), r1.join(' / '));
  check('save → tempo keeper + app key', $('bpm-slider').value === '96' && $('rail-key').value === 'Am');
  let q = showTrack();
  check('save → My chords track injected', trackTabs(q) === 1 && trackChords(q).join(' ') === 'Am F C G', `${trackTabs(q)} tab(s): ${trackChords(q).join(' ')}`);
  // choose the chorus loop, override BPM by typing, save again: same unit, same track, updated
  const chorus = [...d.querySelectorAll('input[name="song-prog"]')].find(i => /Chorus/.test(i.value));
  chorus.checked = true; chorus.dispatchEvent(new w.Event('change', { bubbles: true }));
  $('song-bpm-input').value = '100'; enter($('song-bpm-input'));
  check('manual BPM override shown', /\byou\b/.test([...d.querySelectorAll('.song-field')].find(c => c.querySelector('.chord-card-label').textContent === 'BPM').textContent));
  click(d.querySelector('[data-action="song:save"]'));
  const r2 = unitRows();
  q = showTrack();
  check('re-save is idempotent (1 unit, 1 track)', r2.length === 1 && trackTabs(q) === 1, `${r2.length} unit(s), ${trackTabs(q)} track(s)`);
  check('re-save updates progression + BPM', trackChords(q).join(' ') === 'F G Am F G C E7' && /100 BPM/.test(r2[0]), `${trackChords(q).join(' ')} | ${r2[0]}`);
  check('open track → My chords view', /♪ Test Song/.test(q.textContent));
  // Hover tab: floats the active track's progression
  click(d.querySelector('[data-action="song:openTrack"]'));
  click(d.querySelector('#trainer-question [data-action="progtab:toggle"]'));
  const pt = $('prog-tab');
  const cells = () => [...pt.querySelectorAll('.prog-tab-cell')];
  check('hover tab opens from My chords', pt.classList.contains('open') && cells().length === 7);
  check('hover tab shows chords + romans in the song key',
        cells().map(c => c.querySelector('.prog-tab-chord').textContent).join(' ') === 'F G Am F G C E7' &&
        cells().map(c => c.querySelector('.prog-tab-roman').textContent).join(' ') === 'VI VII i VI VII III V7' &&
        /Am/.test(pt.querySelector('.prog-tab-meta').textContent), cells().map(c => c.textContent.trim()).join(' | '));
  click(pt.querySelector('[data-action="progtab:step"][data-dir="1"]'));
  click(pt.querySelector('[data-action="progtab:step"][data-dir="1"]'));
  check('step moves the highlight', cells().findIndex(c => c.classList.contains('current')) === 2);
  click(pt.querySelector('[data-action="progtab:step"][data-dir="-1"]'));
  click(pt.querySelector('[data-action="progtab:step"][data-dir="-1"]'));
  click(pt.querySelector('[data-action="progtab:step"][data-dir="-1"]'));
  check('step wraps around', cells().findIndex(c => c.classList.contains('current')) === 6);
  click(cells()[3]);
  check('click a chord jumps to it', cells()[3].classList.contains('current'));
  click(pt.querySelector('[data-action="progtab:play"]'));
  check('loop starts', /stop/.test(pt.querySelector('[data-action="progtab:play"]').textContent));
  click(pt.querySelector('[data-action="progtab:play"]'));
  check('loop stops', /loop/.test(pt.querySelector('[data-action="progtab:play"]').textContent));
  w.trainerRemoveCustomChord(6);
  check('hover tab follows track edits', cells().length === 6);
  click(pt.querySelector('[data-action="progtab:collapse"]'));
  check('collapse hides the body', pt.classList.contains('collapsed'));
  click(pt.querySelector('[data-action="progtab:collapse"]'));
  w.switchTab('practice');
  check('hover tab stays across tab switches', pt.classList.contains('open'));
  click(pt.querySelector('.prog-tab-head [data-action="progtab:toggle"]'));
  check('hover tab closes', !pt.classList.contains('open'));
  w.switchTab('upload');
  click(d.querySelector('[data-action="song:new"]'));
  check('new clears the form', $('song-title').value === '' && $('song-output').classList.contains('placeholder'));
  click(d.querySelector('#song-units [data-action="song:load"]'));
  check('load saved unit restores values', $('song-title').value === 'Test Song' && /F – G – Am/.test($('song-output').textContent) && /100/.test($('song-output').textContent));
} catch (e) {
  check('learn-a-song interaction ran', false, e.stack || e.message);


// ---- progression tools, Hooktheory dialog, MIDI in, speed trainer ----
try {
  const $ = id => d.getElementById(id);
  const click = el => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const T = w.GenreBender._test;
  w.switchTab('mixer');

  click($('hooktheory-btn'));
  check('hooktheory dialog opens with a masked password field',
        $('hooktheory-modal').style.display === 'flex' && $('ht-pass').type === 'password');
  click(d.querySelector('[data-action="hooktheory:close"]'));
  check('hooktheory dialog closes', $('hooktheory-modal').style.display === 'none');
  check('realism mode selects populated (default balanced)',
        $('guitar-realism').options.length === 4 && $('guitar-realism').value === 'balanced' && $('piano-realism').value === 'balanced');

  // Guitar: a hand-made result through the real renderer.
  w.syncKey('Am', 'test');
  T.store.guitarTabData = { title: 't', description: '', tab: 'e|--0--|', notes: '',
    chords: [{ name: 'Am7', notes: 'A2 E3 G3 C4 E4', duration_beats: 4 }, { name: 'Fmaj7', notes: 'F2 C3 E3 A3', duration_beats: 4 },
             { name: 'C', notes: 'C3 E3 G3 C4 E4', duration_beats: 4 }, { name: 'G', notes: 'G2 B2 D3 G3 B3 G4', duration_beats: 4 }] };
  T.renderGuitarTab(T.store.guitarTabData, 'chord_progression');
  check('tools strip renders motion readout', /st\/chord/.test($('guitar-tools').textContent), $('guitar-tools').textContent.trim().slice(0, 60));
  const before = T.store.guitarTabData.chords.map(c => c.notes).join('|');
  click(d.querySelector('[data-action="prog:smooth"][data-inst="guitar"]'));
  const after = T.store.guitarTabData.chords.map(c => c.notes).join('|');
  check('smooth voicings re-voices + snapshots', before !== after && d.querySelectorAll('#guitar-tools .pt-hchip').length === 1 && /^e\|/m.test(T.store.guitarTabData.tab));
  click(d.querySelector('[data-action="prog:transpose"][data-inst="guitar"][data-n="1"]'));
  click(d.querySelector('[data-action="prog:transpose"][data-inst="guitar"][data-n="1"]'));
  const names = T.store.guitarTabData.chords.map(c => c.name).join(' ');
  check('transpose +2 moves names', names === 'Bm7 Gmaj7 D A', names);
  check('transpose leaves key selects when the key is not one of the ten', $('guitar-key').value === 'Am' && /Bm/.test($('guitar-tools').textContent));
  click(d.querySelector('[data-action="prog:ab"][data-inst="guitar"]'));
  check('A/B flips to the previous snapshot', T.store.guitarTabData.chords[0].name === 'A#m7' || T.store.guitarTabData.chords[0].name === 'Bbm7',
        T.store.guitarTabData.chords[0].name);
  click(d.querySelector('[data-action="prog:star"][data-inst="guitar"]'));
  check('star marks a snapshot', d.querySelectorAll('#guitar-tools .pt-hchip.starred').length === 1);

  T.store.guitarTabData = { title: 't', tab: '', notes: '', chords: ['Bb', 'Gm', 'Eb', 'F'].map(n => ({ name: n, notes: 'C3 E3 G3', duration_beats: 4 })) };
  T.renderGuitarTab(T.store.guitarTabData, 'chord_progression');
  check('capo suggestion for Bb Gm Eb F is capo 3', /capo 3 → G Em C D/.test($('guitar-tools').textContent));
  click(d.querySelector('[data-action="prog:capo"]'));
  check('use shapes writes a capo tab', /^Capo 3/.test(T.store.guitarTabData.tab) && T.store.guitarTabData.chords[0].notes === 'A#2 D3 F3 A#3 D4 A#4',
        T.store.guitarTabData.chords[0].notes);

  // Piano smoothing
  T.store.pianoChordData = { title: 'p', chords: [{ name: 'Dm7', left: 'D2', right: 'F4 A4 C5 D5' }, { name: 'G7', left: 'G2', right: 'B2 D3 F3 G3' }, { name: 'Cmaj7', left: 'C2', right: 'C5 E5 G5 B5' }] };
  T.renderPianoChart(T.store.pianoChordData, 'chord_voicings');
  const m1 = parseFloat($('piano-tools').textContent.match(/([\d.]+) st\/chord/)[1]);
  click(d.querySelector('[data-action="prog:smooth"][data-inst="piano"]'));
  const m2 = parseFloat($('piano-tools').textContent.match(/([\d.]+) st\/chord/)[1]);
  check('piano smoothing lowers motion', m2 < m1, `${m1} → ${m2}`);

  // MIDI in (jsdom has no Web MIDI — must say so, and the parser must still name chords)
  click($('midi-btn'));
  check('MIDI card shows + explains unsupported browser', $('rail-midi').style.display === '' && /isn.t available/.test($('midi-status').textContent));
  [[0x90, 60, 90], [0x90, 64, 90], [0x90, 67, 90], [0x90, 71, 90]].forEach(b => T.midiFeed(b));
  const cap = T.midiFlush();
  check('MIDI notes C E G B → Cmaj7', cap && /^C(maj7|M7)$/.test(cap.symbol), cap && cap.symbol);
  [[0x80, 60, 0], [0x80, 64, 0], [0x80, 67, 0], [0x80, 71, 0]].forEach(b => T.midiFeed(b));
  click($('midi-add-table'));
  check('captured chord goes to the chord table', /chord table|already/.test($('midi-status').textContent), $('midi-status').textContent);
  click($('midi-btn'));
  check('MIDI toggle hides the card', $('rail-midi').style.display === 'none');

  // Speed trainer
  const ramp = [0, 1, 2, 3, 4, 20].map(n => T.rampTempo({ start: 80, target: 120, step: 4, every: 2 }, n));
  check('ramp rule 80→120 +4 every 2', ramp.join(',') === '80,80,84,84,88,120', ramp.join(','));
  w.switchTab('practice');
  $('speed-source').value = 'piano';
  $('speed-source').dispatchEvent(new w.Event('change', { bubbles: true }));
  click($('speed-go'));
  check('speed trainer starts at the start tempo', /80\s*BPM/.test($('speed-readout').textContent) && $('bpm-display').textContent === '80', $('speed-readout').textContent.trim());
  click($('speed-go'));
  check('speed trainer stops', $('speed-go').getAttribute('aria-pressed') === 'false');
} catch (e) {
  check('tools / midi / speed interaction ran', false, e.stack || e.message);
}

check('no runtime errors during boot', errors.length === 0, errors.slice(0, 3).join(' | '));

let failed = 0;
for (const c of checks) {
  if (!c.pass) failed++;
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.extra ? `  (${c.extra})` : ''}`);
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
