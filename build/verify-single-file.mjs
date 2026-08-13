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

check('no runtime errors during boot', errors.length === 0, errors.slice(0, 3).join(' | '));

let failed = 0;
for (const c of checks) {
  if (!c.pass) failed++;
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.extra ? `  (${c.extra})` : ''}`);
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
