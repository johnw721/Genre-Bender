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
const bootDest = d.querySelector('.dest.active')?.dataset.dest;
check('boots on Songs', bootDest === 'songs' && d.getElementById('panel-upload').classList.contains('active'), bootDest);
check('destinations present (Songs / Play / Practice / Create)',
      [...d.querySelectorAll('.dest-nav .dest')].map(b => b.textContent.trim()).join(' ') === 'Songs Play Practice Create');
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

// Shell: transport bar holds the tempo keeper + key, outside the panels; clips float.
check('transport holds tempo keeper + key, outside panels',
      !!d.querySelector('#transport #bpm-slider') && !!d.querySelector('#transport #rail-key') && !d.querySelector('.panel #bpm-slider'));
check('clip player floats outside panels', !!d.getElementById('clip-dock') && !d.querySelector('.panel #clip-dock'));
{
  const $ = id => d.getElementById(id);
  const click = el => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const destOn = () => d.querySelector('.dest.active')?.dataset.dest;
  const subs = () => [...d.querySelectorAll('#subnav .subnav-item')].map(b => b.textContent.trim() + (b.classList.contains('active') ? '*' : '')).join(' ');
  click(d.querySelector('.dest[data-dest="play"]'));
  check('Play opens the workspace (video · map · chords)', d.body.classList.contains('study-open') && destOn() === 'play' && subs() === '' &&
        !!d.querySelector('#study [data-pane="map"] #colormap-host') && !!d.querySelector('#study [data-pane="chords"] #trainer-card'), subs());
  check('no clip yet → video pane folded away', d.getElementById('study').classList.contains('no-video'));
  click(d.querySelector('.dest[data-dest="practice"]'));
  check('Practice → today', $('panel-practice').classList.contains('active') && subs() === 'Today* Drills', subs());
  click(d.querySelector('#subnav [data-sub="drills"]'));
  check('Practice sub-nav → drills (trainer)', $('panel-trainer').classList.contains('active') && $('inner-trainer').dataset.sub === 'drills' && destOn() === 'practice');
  w.trainerNav('chords');
  check('old entry points move the nav (trainerNav → Play)', destOn() === 'play');
  w.switchTab('guided');
  check('switchTab(guided) → Create / Guided', destOn() === 'create' && /Guided workflow\*/.test(subs()), subs());
  click(d.querySelector('.dest[data-dest="play"]'));
  check('Play remembers last sub (My chords)', $('inner-trainer').dataset.sub === 'chords');
  click($('menu-btn'));
  check('menu opens with the 4 tools', !$('menu-pop').hidden && d.querySelectorAll('#menu-pop .hbtn').length === 4);
  click(d.body);
  check('menu closes on outside click', $('menu-pop').hidden);
  click(d.querySelector('[data-pop="tp-tempo-pop"]'));
  check('tempo popover opens from the BPM', !$('tp-tempo-pop').hidden && $('tp-key-pop').hidden);
  click(d.querySelector('[data-pop="tp-key-pop"]'));
  check('key popover replaces it', $('tp-tempo-pop').hidden && !$('tp-key-pop').hidden);
  w.syncKey('F#m', 'test');
  check('transport key label follows the app key', $('tp-key-label').textContent === 'F♯m', $('tp-key-label').textContent);
  w.syncKey('Am', 'test');
  click(d.querySelector('[data-action="ui:theme"]'));
  const t1 = d.documentElement.dataset.theme;
  click(d.querySelector('[data-action="ui:theme"]'));
  check('theme toggles light ⇄ dark', t1 === 'light' && d.documentElement.dataset.theme === 'dark');
  w.switchTab('mixer');
}

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
  const ifr = $('cm-clip-frame')?.querySelector('iframe');
  check('a clip opens in Play\'s video pane (official embed)', d.body.classList.contains('study-open') && ifr?.src === 'https://www.tiktok.com/embed/v2/7301234567890123456',
        ifr?.src);
  check('the floating window never runs a second player', !$('clip-frame').querySelector('iframe'));
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
  check('leaving Play closes the workspace', !d.body.classList.contains('study-open'));
  w.trainerNav('chords');
  check('the clip is still loaded when you come back to Play', !!$('cm-clip-frame')?.querySelector('iframe'));
  w.switchTab('guided');
  click(d.querySelector('[data-action="clips:clear-ref"]'));
  check('reference clears', $('rail-reference').style.display === 'none');
  $('clip-url').value = 'https://example.com/x'; click(d.querySelector('[data-action="clips:add"]'));
  check('unknown link falls back to open-in-tab', !!$('cm-clip-frame')?.querySelector('a[target="_blank"]'));
  w.switchTab('guided');
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
  // Transport strip: the active track's progression (the old hover tab's job)
  const strip = () => [...d.querySelectorAll('#transport-prog .tp-chord')];
  const cur = () => strip().findIndex(c => c.classList.contains('current'));
  check('strip shows the active track', strip().map(c => c.textContent).join(' ') === 'F G Am F G C E7' && /♪ Test Song/.test($('transport-prog').textContent));
  const stepBtn = (dir) => d.querySelector(`#transport-prog [data-action="progtab:step"][data-dir="${dir}"]`);
  click(d.querySelector('#transport-prog [data-action="progtab:jump"][data-idx="0"]'));
  click(stepBtn(1)); click(stepBtn(1));
  check('step moves the highlight', cur() === 2);
  click(stepBtn(-1)); click(stepBtn(-1)); click(stepBtn(-1));
  check('step wraps around', cur() === 6);
  click(strip()[3]);
  check('click a chord jumps to it', cur() === 3);
  const loopBtn = () => d.querySelector('#transport-prog [data-role="loop"]');
  click(loopBtn());
  check('loop starts', loopBtn().classList.contains('on'));
  click(loopBtn());
  check('loop stops', !loopBtn().classList.contains('on'));
  // track popover: switcher + beats (moved from the hover tab)
  click(d.querySelector('#transport-prog [data-pop="tp-track-pop"]'));
  check('track popover opens with track + beats', !$('tp-track-pop').hidden &&
        !!$('tp-track-pop').querySelector('[data-on-change="progtab:track"]') && !!$('tp-track-pop').querySelector('[data-on-change="progtab:beats"]'));
  d.body.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  check('no floating hover tab any more', !d.querySelector('.prog-tab.open') && !d.querySelector('[data-action="progtab:toggle"]'));
  // Chord peek: hovering a strip chord shows its guitar diagram
  const over = (el, type) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, relatedTarget: d.body }));
  over(strip()[2], 'pointerover');
  const peek = $('chord-peek');
  check('hovering a strip chord shows its diagram', !peek.hidden && peek.querySelector('b').textContent === 'Am' && peek.querySelector('.chord-peek-head span')?.textContent === 'i' &&
        !!peek.querySelector('svg.chord-box') && /3 2 2 1 0|0 0 2 2 1 0|x 0 2 2 1 0/.test(peek.textContent), peek.textContent.replace(/\s+/g, ' ').trim());
  over(strip()[2], 'pointerout');
  check('moving off hides the diagram', peek.hidden);
  // Keyboard: ←/→ step the progression, Space loops it (no melody loaded)
  const key = (k, extra = {}) => d.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
  click(d.querySelector('#transport-prog [data-action="progtab:jump"][data-idx="0"]'));
  key('ArrowRight'); key('ArrowRight');
  check('→ steps the progression', cur() === 2, String(cur()));
  key('ArrowLeft');
  check('← steps back', cur() === 1, String(cur()));
  key(' ');
  check('Space loops the progression', loopBtn().classList.contains('on'));
  key(' ');
  check('Space again stops it', !loopBtn().classList.contains('on'));
  // Touch: tapping a color-map chord shows the shape with + track / + keep
  w.__gbForceTouch = true;
  w.trainerNav('colormap');
  const chip = d.querySelector('#colormap-host [data-action="cm:peek"], #colormap-host .cm-chip');
  if (chip) click(chip.matches('[data-action="cm:peek"]') ? chip : chip.querySelector('[data-action="cm:peek"]') || chip);
  const tAct = [...d.querySelectorAll('#chord-peek .chord-peek-actions button')].map(b => b.textContent);
  check('touch: tapping a map chord offers + track / + keep', tAct.join('|') === '+ track|+ keep', tAct.join('|') || 'no buttons');
  const nBefore = trackChords(showTrack()).length;
  const tName = d.querySelector('#chord-peek .chord-peek-actions button')?.dataset.name;
  click(d.querySelector('#chord-peek .chord-peek-actions button'));
  const afterChords = trackChords(showTrack());
  check('+ track appends the chord and toasts', afterChords.length === nBefore + 1 && afterChords.at(-1) === tName &&
        !$('gb-toast').hidden && /added/.test($('gb-toast').textContent), `${nBefore}→${afterChords.length} ${tName} | ${$('gb-toast')?.textContent}`);
  w.trainerRemoveCustomChord(afterChords.length - 1);
  w.__gbForceTouch = false;
  w.trainerRemoveCustomChord(6);
  check('strip follows track edits', strip().length === 6);

  // Color map: clicking a chord shows its shape for a moment
  w.syncKey('C', 'test');
  w.trainerNav('colormap');
  const fChip = d.querySelector('.cm-col[data-col="d3"] .cm-chip[data-name="F"]') || d.querySelector('.cm-chip[data-name="F"]');
  click(fChip);
  const pk = $('chord-peek');
  check('color map: click a chord → diagram', pk && !pk.hidden && pk.querySelector('b').textContent === 'F' && /IV/.test(pk.textContent) && !!pk.querySelector('svg.chord-box'),
        pk && pk.textContent.replace(/\s+/g, ' ').trim().slice(0, 40));
  // Chord finder
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: '/', bubbles: true }));
  const cf = $('chord-finder'), cfIn = $('cf-input'), cfOut = () => $('cf-results');
  const typeIn = (v) => { cfIn.value = v; cfIn.dispatchEvent(new w.Event('input', { bubbles: true })); };
  check('finder opens with "/"', cf && !cf.hidden && check.length !== undefined);
  typeIn('dm7');
  check('finder: one chord → shapes + where in the map', /Dm7/.test(cfOut().querySelector('.cf-chord-name').textContent) &&
        cfOut().querySelectorAll('.cf-shape svg.chord-box').length >= 2 && /ii/.test(cfOut().querySelector('.cf-where').textContent) && /D F A C/.test(cfOut().textContent),
        cfOut().textContent.replace(/\s+/g, ' ').slice(0, 120));
  typeIn('Eb');
  check('finder: a root alone → chords on it', cfOut().querySelectorAll('.cf-suggest .cf-chip').length >= 10 && /Ebmaj7/.test(cfOut().textContent), cfOut().querySelectorAll('.cf-suggest .cf-chip').length + ' ' + cfOut().textContent.replace(/\s+/g,' ').slice(0,200));
  typeIn('Bb7');
  const keyChips = [...cfOut().querySelectorAll('.cf-keys .cf-chip')].map(b => b.dataset.key);
  check('finder: outside chord → keys that hold it (no enharmonic dupes)', /not on the C major map|out of scale|parallel/.test(cfOut().querySelector('.cf-where').textContent) &&
        keyChips.length >= 1 && !(keyChips.includes('D#') && keyChips.includes('Eb')), cfOut().querySelector('.cf-where').textContent.trim().slice(0, 100));
  typeIn('neo soul loop 🎸 Fmaj7 - Em7 - Dm7 - G13 #guitar https://www.instagram.com/reel/CxAbC123/');
  check('finder: pasted caption → all chords + key', cfOut().querySelectorAll('.cf-mini').length === 4 && /likely key/.test(cfOut().querySelector('.cf-label').textContent) &&
        !!cfOut().querySelector('[data-action="finder:clip"]'), cfOut().querySelector('.cf-label').textContent);
  click(cfOut().querySelector('[data-action="finder:clip"]'));
  const dockText = () => ($('clip-meta')?.textContent || '') + ($('clip-list')?.textContent || '');
  check('finder: save link as clip keeps the caption chords', /Fmaj7/.test($('clip-list').textContent), $('clip-list').textContent.slice(0, 120));
  click(cfOut().querySelector('[data-action="finder:track"]'));
  check('finder: new track from caption chords', cf.hidden && $('inner-trainer').dataset.sub === 'chords' &&
        /Fmaj7\s*Em7\s*Dm7\s*G13/.test([...d.querySelectorAll('#transport-prog .tp-chord')].map(b => b.textContent).join(' ')));
  w.trainerNav('chords');
  w.syncKey('C', 'test');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  typeIn('Am7');
  click(cfOut().querySelector('[data-action="finder:map"]'));
  await new Promise(r => setTimeout(r, 120));
  const am7 = d.querySelector('.cm-chip.cm-flash');
  check('finder: Show in color map → map, chip flashed', cf.hidden && $('inner-trainer').dataset.sub === 'colormap' && am7 && am7.dataset.name === 'Am7', am7 && am7.dataset.name);
  // A link pasted with its caption: caption kept as notes, chords shown in the color map clip row
  d.dispatchEvent(Object.assign(new w.Event('paste', { bubbles: true }), { clipboardData: { getData: () => 'Chords: Cmaj7 Am7 Dm7 G7 https://www.instagram.com/reel/Zz9Yy8/' } }));
  await new Promise(r => setTimeout(r, 20));
  check('pasted link + caption → clip notes + chord chips', /Cmaj7/.test($('cm-clip-tags')?.textContent || '') && d.querySelectorAll('#cm-clip-tags .cm-cchip').length === 4,
        ($('cm-clip-tags')?.textContent || '').replace(/\s+/g, ' ').slice(0, 120));
  click(d.querySelector('#cm-clip-tags .cm-cchip'));
  check('clip chord chip → diagram', !$('chord-peek').hidden && $('chord-peek').querySelector('b').textContent === 'Cmaj7');

  // Chord library follows the color map key
  const autoNames = () => [...d.querySelectorAll('#palette-grid .palette-auto .palette-card-label')].map(e => e.textContent.trim()).join(' ');
  w.trainerNav('chords');
  w.syncKey('C', 'test');
  check('chord library leads with the key chords', autoNames() === 'C Dm Em F G Am Bdim', autoNames());
  const cmKey = $('colormap-key');
  cmKey.value = 'Bb'; cmKey.dispatchEvent(new w.Event('change', { bubbles: true }));
  check('changing the color map key rebuilds the chord library', /^Bb Cm Dm Eb F Gm Adim$/.test(autoNames()), autoNames());
  w.paletteSetFlavour('sevenths');
  check('library as 7ths', /^Bbmaj7 Cm7 Dm7 Ebmaj7 F7 Gm7 Am7b5$/.test(autoNames()), autoNames());
  const saved0 = d.querySelectorAll('#palette-grid .palette-card:not(.palette-auto)').length;
  click(d.querySelector('#palette-grid .palette-auto .palette-keep'));
  check('+ keeps a key chord in your shapes', d.querySelectorAll('#palette-grid .palette-card:not(.palette-auto)').length === saved0 + 1);
  w.paletteSetFollow(false);
  check('follow key can be turned off', !d.querySelector('#palette-grid .palette-auto') && $('palette-follow')?.getAttribute('aria-pressed') === 'false');
  w.paletteSetFollow(true); w.paletteSetFlavour('triads'); w.syncKey('C', 'test');

  // Study view: a pasted link opens video + color map + My chords + library in one view
  w.switchTab('upload');
  const pasteText = (t) => d.dispatchEvent(Object.assign(new w.Event('paste', { bubbles: true }), { clipboardData: { getData: () => t } }));
  pasteText('Groove: Dm9 G13 Cmaj9 https://www.youtube.com/watch?v=abcDEF12345');
  await new Promise(r => setTimeout(r, 30));
  const study = $('study');
  check('pasting a link (off the map) opens the study view', study && !study.hidden && d.body.classList.contains('study-open'));
  check('study holds the real player, color map and My chords + library',
        !!study.querySelector('[data-pane="video"] #cm-clip') && !!study.querySelector('[data-pane="map"] #colormap-host #colormap-body') &&
        !!study.querySelector('[data-pane="chords"] #trainer-card #palette-grid'));
  check('the pasted clip is loaded with its caption chords', /Dm9/.test($('cm-clip-tags').textContent) && /abcDEF12345/.test($('study-clip-name').textContent),
        $('study-clip-name').textContent);
  click(study.querySelector('.cm-chip[data-name="C"]') || study.querySelector('.cm-chip'));
  check('color map works inside study (click → diagram)', !$('chord-peek').hidden);
  const before = study.style.getPropertyValue('--study-a');
  study.querySelector('.study-split[data-split="a"]').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  check('splitter resizes the panes', study.style.getPropertyValue('--study-a') !== before, `${before} → ${study.style.getPropertyValue('--study-a')}`);
  click(study.querySelector('[data-action="study:toggle"][data-pane="video"]'));
  check('a pane can be hidden', study.querySelector('.study-pane[data-pane="video"]').classList.contains('off') && study.classList.contains('no-video'));
  click(study.querySelector('[data-action="study:toggle"][data-pane="video"]'));
  click(study.querySelector('[data-action="study:max"][data-pane="map"]'));
  check('a pane can be maximized', study.dataset.max === 'map' && study.querySelector('.study-pane[data-pane="chords"]').classList.contains('off'));
  click(study.querySelector('[data-action="study:max"][data-pane="map"]'));
  const sel = $('colormap-key'); sel.value = 'G'; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  check('in study, the library follows the map key too', /^G Am Bm C D Em F#dim$/.test(autoNames()), autoNames());
  pasteText('https://www.youtube.com/watch?v=zzzYYY98765');
  await new Promise(r => setTimeout(r, 30));
  check('pasting another link while open swaps the video', /zzzYYY98765/.test($('study-clip-name').textContent));
  w.switchTab('upload');
  check('leaving Play puts every view back',
        study.hidden && !!d.querySelector('#inner-trainer > #trainer-card') && !!d.querySelector('#inner-trainer > #colormap-host') &&
        !!d.querySelector('#colormap-host .cm-session > #cm-clip'));
  w.syncKey('C', 'test');
  w.switchTab('upload');
  click(d.querySelector('[data-action="song:new"]'));
  check('new clears the form', $('song-title').value === '' && $('song-output').classList.contains('placeholder'));
  click(d.querySelector('#song-units [data-action="song:load"]'));
  check('load saved unit restores values', $('song-title').value === 'Test Song' && /F – G – Am/.test($('song-output').textContent) && /100/.test($('song-output').textContent));
} catch (e) {
  check('learn-a-song interaction ran', false, e.stack || e.message);
}

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

// Consistency, tips, tour, command bar
try {
  const $ = (id) => d.getElementById(id);
  const click = el => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const finder = (text) => { click($('finder-btn')); const i = $('cf-input'); i.value = text; i.dispatchEvent(new w.Event('input', { bubbles: true })); return $('cf-results'); };
  const enterF = () => $('cf-input').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  // key-aware spelling: ♭VII in C is Bb, not A#  (also: the "color map in C" command)
  const dbgC = finder('color map in C').textContent.trim().slice(0, 60); enterF();
  await new Promise(res => setTimeout(res, 30));
  const outText = (() => { w.trainerNav('colormap'); const b = d.querySelector('[data-action="cm:view"][data-view="out"]'); click(b); return $('colormap-host').textContent; })();
  check('out-of-scale columns spell flats in C (Bb7, Eb, Ab)', /Bb7/.test(outText) && /Eb/.test(outText) && !/A#7/.test(outText), (outText.match(/[A-G][#b]7/g) || []).slice(0, 8).join(' ') + ' [' + dbgC + '] key=' + (d.querySelector('[data-on-change="cm:key"]')?.value) + ' view=' + d.querySelector('[data-action="cm:view"].on, [data-action="cm:view"][aria-pressed="true"]')?.dataset.view);
  // delete track → Undo
  w.trainerNav('chords');
  const tabs = () => d.querySelectorAll('#trainer-question .trainer-track-tab').length;
  w.trainerNewTrack('Scratch');
  const n = tabs();
  w.trainerDeleteTrack();
  check('delete track has no confirm() and offers Undo', tabs() === n - 1 && !!$('gb-toast').querySelector('[data-toast-undo]'), `${n}→${tabs()}`);
  click($('gb-toast').querySelector('[data-toast-undo]'));
  check('Undo brings the track back', tabs() === n && /Scratch/.test($('trainer-question').textContent));
  w.trainerDeleteTrack();
  check('no duplicate track name heading in options', !d.querySelector('#trainer-question .track-more summary .trainer-track-name'));
  // tips toggle
  check('tips hidden by default', !d.body.classList.contains('show-tips'));
  click($('tips-btn'));
  check('Show tips turns them on', d.body.classList.contains('show-tips') && /Hide tips/.test($('tips-btn').textContent));
  click($('tips-btn'));
  // tour
  click(d.querySelector('[data-action="tour:start"]'));
  const tour = () => $('gb-tour');
  check('tour step 1 points at Songs', tour() && !tour().hidden && /1 \/ 3/.test(tour().textContent) && d.querySelector('.dest[data-dest="songs"]').classList.contains('tour-target'));
  click(tour().querySelector('[data-action="tour:next"]')); click(tour().querySelector('[data-action="tour:next"]'));
  check('tour step 3 points at the transport strip', /3 \/ 3/.test(tour().textContent) && $('transport-prog').classList.contains('tour-target'));
  click(tour().querySelector('[data-action="tour:end"]'));
  check('tour closes', tour().hidden && !d.querySelector('.tour-target'));
  // chord finder as a command bar
  let r = finder('color map in E');
  check('finder command: "color map in E"', /Color map in E major/.test(r.textContent), r.textContent.trim().slice(0, 80));
  enterF();
  await new Promise(res => setTimeout(res, 30));
  check('Enter runs it (key → E, map open)', $('chord-finder').hidden && d.body.classList.contains('study-open') && /E major/.test($('colormap-host').textContent));
  r = finder('practice');
  check('finder command: practice', /Practice → Drills/.test(r.textContent));
  r = finder('Am');
  check('a chord name still wins over commands', !/Commands/.test(r.textContent) && /Am/.test(r.textContent));
  r = finder('new track Bridge');
  check('finder command: new track with a name', /New track "Bridge"/.test(r.textContent), r.textContent.trim().slice(0, 60));
  $('cf-input').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
} catch (e) {
  check('consistency / tips / tour / commands ran', false, e.stack || e.message);
}

check('no runtime errors during boot', errors.length === 0, errors.slice(0, 3).join(' | '));

let failed = 0;
for (const c of checks) {
  if (!c.pass) failed++;
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.extra ? `  (${c.extra})` : ''}`);
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
