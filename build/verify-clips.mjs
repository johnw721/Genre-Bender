/* verify-clips.mjs — unit checks for the clip URL parser.
   Run:  node build/verify-clips.mjs */
import { parseClipUrl } from '../js/clips.js';

const cases = [
  ['https://x.com/someone/status/1234567890123456789', 'x', '1234567890123456789', true],
  ['https://twitter.com/someone/status/98765?s=20', 'x', '98765', true],
  ['https://x.com/someone', 'x', null, false],
  ['https://www.instagram.com/reel/C9AbCdEfGhI/?igsh=abc', 'instagram', 'C9AbCdEfGhI', true],
  ['https://www.instagram.com/p/C9AbCdEfGhI/', 'instagram', 'C9AbCdEfGhI', true],
  ['https://www.instagram.com/someuser/reels/', 'instagram', null, false],
  ['https://www.tiktok.com/@user.name/video/7301234567890123456?is_from_webapp=1', 'tiktok', '7301234567890123456', true],
  ['https://vm.tiktok.com/ZMabc123/', 'tiktok', null, false],
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'youtube', 'dQw4w9WgXcQ', true],
  ['https://youtu.be/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ', true],
  ['https://youtube.com/shorts/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ', true],
  ['https://example.com/some/page', 'other', null, false],
  ['not a url', null, null, false],
  ['javascript:alert(1)', null, null, false],
];

let fail = 0;
for (const [url, platform, id, embeddable] of cases){
  const r = parseClipUrl(url);
  const ok = platform === null ? r === null
    : r && r.platform === platform && r.id === id && (!!r.embedUrl) === embeddable;
  if (!ok){ fail++; console.error('FAIL', url, '→', r); }
  else console.log('ok  ', platform ?? 'null', id ?? '-', r?.embedUrl ?? r?.note ?? '');
}
const y = parseClipUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s');
if (!/start=42/.test(y.embedUrl)){ fail++; console.error('FAIL timestamp carry-over', y.embedUrl); }
console.log(fail ? `\n${fail} failing` : '\nall parser checks pass');
process.exit(fail ? 1 : 0);
