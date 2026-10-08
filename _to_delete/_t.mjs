import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
const t0=Date.now();
const html = readFileSync('dist/genre-bender.html','utf8');
const vc = new VirtualConsole().on('jsdomError', e=>console.log('ERR', (e.stack||e.message).slice(0,300))).on('error',(...a)=>console.log('CERR',a.join(' ').slice(0,300)));
const dom = new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'file:///tmp/x.html',virtualConsole:vc,
 beforeParse(w){ w.AudioContext = class { constructor(){this.currentTime=0;this.destination={};this.state='running'} createOscillator(){return {connect(){return this},start(){},stop(){},frequency:{setValueAtTime(){}},gain:{}}} createGain(){return {connect(){return this},gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}}}} }; w.webkitAudioContext=w.AudioContext; }});
console.log('parsed', Date.now()-t0, 'ms');
setTimeout(()=>{ const w=dom.window; console.log('tabs', w.document.querySelectorAll('.tab').length, 'practice steps', w.document.querySelectorAll('#practice-steps .pstep').length); process.exit(0); }, 3000);
