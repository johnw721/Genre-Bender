import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
const html = readFileSync('dist/genre-bender.html','utf8');
const errors=[];
const vc = new VirtualConsole().on('jsdomError', e=>errors.push(String(e.stack||e.message))).on('error',(...a)=>errors.push(a.join(' ')));
const dom = new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'file:///tmp/x.html',virtualConsole:vc,
 beforeParse(w){ class P{constructor(){this.value=0}setValueAtTime(){return this}linearRampToValueAtTime(){return this}exponentialRampToValueAtTime(){return this}setTargetAtTime(){return this}cancelScheduledValues(){return this}}
  const n=()=>({connect(){return n()},disconnect(){},start(){},stop(){},frequency:new P(),gain:new P(),detune:new P(),Q:new P(),type:'sine',buffer:null,loop:false,playbackRate:new P()});
  class AC{constructor(){this.currentTime=0;this.sampleRate=44100;this.destination=n();this.state='running'}createOscillator(){return n()}createGain(){return n()}createBiquadFilter(){return n()}createBufferSource(){return n()}createDynamicsCompressor(){return n()}createStereoPanner(){return n()}createConvolver(){return n()}createDelay(){return n()}createWaveShaper(){return n()}createAnalyser(){return n()}createBuffer(c,l){return{getChannelData:()=>new Float32Array(l),length:l}}resume(){return Promise.resolve()}}
  w.AudioContext=AC; w.webkitAudioContext=AC; w.requestAnimationFrame=cb=>setTimeout(()=>cb(Date.now()),16); w.scrollTo=()=>{};
  w.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){},clearRect(){},beginPath(){},arc(){},fill(){},stroke(){},moveTo(){},lineTo(){},fillText(){},measureText:()=>({width:10}),save(){},restore(){},translate(){},setLineDash(){}});
  w.confirm=()=>true; w.prompt=()=>'T';
 }});
await new Promise(r=>setTimeout(r,800));
const w=dom.window, d=w.document;
const $=id=>d.getElementById(id);
let pass=0, fail=0; const ok=(c,m)=>{ c?pass++:fail++; console.log((c?'PASS ':'FAIL ')+m); };

w.trainerSetMode('custom');
ok($('chord-palette'), 'chord table renders in My chords');
const cards=d.querySelectorAll('.palette-card');
ok(cards.length===12, 'seed palette has 12 cards ('+cards.length+')');
ok($('trainer-custom-diagrams') && $('trainer-custom-diagrams').classList.contains('empty'), 'empty track shows drop zone');

// add by name
$('palette-name').value='f#m7'; w.paletteAddByName();
ok(d.querySelectorAll('.palette-card').length===13, 'add by name → 13 cards');
$('palette-name').value='f#m7'; w.paletteAddByName();
ok(d.querySelectorAll('.palette-card').length===13 && /already/.test($('palette-err').textContent), 'duplicate rejected with message');
w.paletteFillFromControls('sevenths');
ok(d.querySelectorAll('.palette-card').length>13, 'fill 7ths adds cards ('+d.querySelectorAll('.palette-card').length+')');

// simulate drag from palette card → drop on empty track zone
function fire(el,type,init={}){ const ev=new w.Event(type,{bubbles:true,cancelable:true}); Object.assign(ev,{clientX:init.clientX||0,relatedTarget:null}); ev.dataTransfer={setData(){},getData(){return ''},types:[],effectAllowed:'',dropEffect:''}; el.dispatchEvent(ev); return ev; }
const first=d.querySelector('.palette-card'); const firstName=first.querySelector('.palette-card-label').textContent.trim();
fire(first,'dragstart');
let zone=$('trainer-custom-diagrams'); fire(zone,'dragover'); fire(zone,'drop'); fire(first,'dragend');
let blocks=d.querySelectorAll('.trainer-custom-chord-block');
ok(blocks.length===1, 'palette → empty track inserts 1 chord');
ok(blocks[0].textContent.includes(firstName.replace('pinned','').trim()), 'inserted chord is '+firstName);

// second drop, before the first block (clientX left of midpoint; jsdom rects are 0 → clientX -1 < 0 → before)
const second=d.querySelectorAll('.palette-card')[1]; const secondName=second.querySelector('.palette-card-label').textContent.replace('pinned','').trim();
fire(second,'dragstart'); blocks=d.querySelectorAll('.trainer-custom-chord-block');
fire(blocks[0].querySelector('.trainer-diagram'),'dragover',{clientX:-1});
ok(blocks[0].classList.contains('drop-before'), 'drop-before indicator shows');
fire(blocks[0].querySelector('.trainer-diagram'),'drop',{clientX:-1}); fire(second,'dragend');
blocks=d.querySelectorAll('.trainer-custom-chord-block');
ok(blocks.length===2 && blocks[0].querySelector('.trainer-diagram-label').textContent.includes(secondName), 'insert before works → order ['+[...blocks].map(b=>b.querySelector('.trainer-diagram-label').textContent).join(', ')+']');

// reorder: drag block 0 after block 1
const h0=blocks[0].querySelector('.trainer-track-handle');
fire(h0,'dragstart'); fire(blocks[1].querySelector('.trainer-diagram'),'dragover',{clientX:5}); fire(blocks[1].querySelector('.trainer-diagram'),'drop',{clientX:5}); fire(h0,'dragend');
blocks=d.querySelectorAll('.trainer-custom-chord-block');
ok(blocks[1].querySelector('.trainer-diagram-label').textContent.includes(secondName), 'reorder by drag works → ['+[...blocks].map(b=>b.querySelector('.trainer-diagram-label').textContent).join(', ')+']');

// track chord → palette (exact voicing) after clearing palette
w.paletteClear(); ok(d.querySelectorAll('.palette-card').length===0, 'clear table');
const h=blocks[0].querySelector('.trainer-track-handle'); fire(h,'dragstart'); fire($('palette-grid'),'dragover'); fire($('palette-grid'),'drop'); fire(h,'dragend');
ok(d.querySelectorAll('.palette-card').length===1 && d.querySelector('.palette-pin'), 'track → table saves a pinned shape');

// persistence
const saved=JSON.parse(w.localStorage.getItem('GenreBenderChordPalette_v1'));
ok(saved && saved.shapes.length===1 && Array.isArray(saved.shapes[0].frets), 'palette persisted with frets');
const tr=JSON.parse(w.localStorage.getItem('GenreBenderTrainerTracks_v1'));
ok(tr.tracks[0].chords.length===2 && tr.tracks[0].chords.every(c=>Array.isArray(c.frets)), 'track chords carry exact voicings');

// label toggle repaints palette without error
w.toggleFretLabels(); ok(d.querySelectorAll('.palette-card').length===1, 'label toggle keeps table');
ok(errors.length===0, 'no runtime errors'+(errors.length?'\n'+errors.join('\n'):''));
console.log(`${pass} passed, ${fail} failed`);
