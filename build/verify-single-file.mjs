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
  check('header tools in one row', d.querySelectorAll('.header-actions .hbtn').length === 3);
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
  check('practice mode button selects the drill', psteps()[1].classList.contains('done') && $('panel-mixer').classList.contains('active'));
  w.switchTab('practice');
  check('practice stat line renders', /today: \d+ card/.test($('practice-stat').textContent));
} catch (e) {
  check('clips / seed / rail interaction ran', false, e.message);
}

check('no runtime errors during boot', errors.length === 0, errors.slice(0, 3).join(' | '));

let failed = 0;
for (const c of checks) {
  if (!c.pass) failed++;
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.extra ? `  (${c.extra})` : ''}`);
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
