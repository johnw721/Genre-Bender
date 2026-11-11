/* verify-seeds-e2e.mjs — boots the single-file build in jsdom with a #seed= link,
   checks the tracks + meta card render, then boots again with the same link
   and checks nothing changed (idempotent). Run after `npm run build:single`:
     node build/verify-seeds-e2e.mjs [dist/genre-bender.html] [pack.json] */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { encodeSeedPayload } from '../js/seeds.js';
const html = readFileSync(process.argv[2] || 'dist/genre-bender.html','utf8');
const pack = JSON.parse(readFileSync(process.argv[3] || 'seeds/rnb-neosoul-guitar.pack.json','utf8'));
const link = 'https://gb.test/#seed=' + await encodeSeedPayload(pack);
let storage = {};
async function boot(url){
  const errors=[];
  const vc = new VirtualConsole().on('jsdomError', e=>errors.push(e.message)).on('error', (...a)=>errors.push(a.join(' ')));
  const dom = new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url,virtualConsole:vc,
    beforeParse(w){ for (const [k,v] of Object.entries(storage)) w.localStorage.setItem(k,v);
      w.AudioContext = w.webkitAudioContext = class{ constructor(){this.currentTime=0;this.destination={};} };
      w.HTMLCanvasElement.prototype.getContext=()=>null; w.scrollTo=()=>{}; w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}});
      w.CompressionStream = globalThis.CompressionStream; w.DecompressionStream = globalThis.DecompressionStream; w.Response = globalThis.Response;
    }});
  await new Promise(r=>setTimeout(r,2500));
  const w=dom.window;
  storage = {}; for (let i=0;i<w.localStorage.length;i++){const k=w.localStorage.key(i); storage[k]=w.localStorage.getItem(k);}
  return {w,errors};
}
let {w,errors} = await boot(link);
const t1 = JSON.parse(storage.GenreBenderTrainerTracks_v1);
console.log('tracks after link:', t1.tracks.map(t=>t.name), 'active', t1.activeId);
console.log('hash cleared:', w.location.hash==='' , 'toast:', w.document.getElementById('gb-toast')?.textContent);
const clips = JSON.parse(storage.GenreBenderClips_v1||'null'); console.log('clips:', (clips?.clips||clips||[]).length ?? clips);
w.trainerNav && w.trainerNav('chords');
await new Promise(r=>setTimeout(r,300));
const meta = w.document.querySelector('.trainer-track-meta');
console.log('meta card:', meta ? meta.textContent.replace(/\s+/g,' ').trim().slice(0,220) : 'MISSING');
console.log('chart chips:', w.document.querySelectorAll('.trainer-meta-chart button').length, 'diagrams:', w.document.querySelectorAll('#trainer-custom-diagrams .trainer-custom-chord-block').length);
w.trainerUseTrackKey(); console.log('guitar-key after use key:', w.document.getElementById('guitar-key')?.value);
console.log('errors1:', errors.slice(0,5));
const before = storage.GenreBenderTrainerTracks_v1;
({w,errors} = await boot(link));
const t2 = JSON.parse(storage.GenreBenderTrainerTracks_v1);
console.log('re-apply same link -> track count', t2.tracks.length, 'toast:', w.document.getElementById('gb-toast')?.textContent);
const same = JSON.stringify(t2.tracks)===JSON.stringify(t1.tracks);
console.log('identical tracks:', same);
const pass = same && !errors.length && t1.tracks.filter(t=>t.seed).length===pack.tracks.length;
console.log(pass ? 'PASS seed e2e' : 'FAIL seed e2e');
process.exit(pass ? 0 : 1);
console.log('errors2:', errors.slice(0,5));
process.exit(0);
