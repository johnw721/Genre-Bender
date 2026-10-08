import { JSDOM } from 'jsdom';
const t0=Date.now();
const dom = new JSDOM('<html><body><script>document.body.textContent="hi"</script></body></html>',{runScripts:'dangerously',pretendToBeVisual:true});
console.log('trivial', Date.now()-t0, dom.window.document.body.textContent);
process.exit(0);
