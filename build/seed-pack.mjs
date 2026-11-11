/* seed-pack.mjs — check a seed pack and turn it into something you can
   carry to any copy of Genre Bender (laptop dev server, Netlify, the
   single-file dist/genre-bender.html, your phone).

   Usage:
     node build/seed-pack.mjs seeds/rnb-neosoul-guitar.pack.json            # validate
     node build/seed-pack.mjs <pack> --link https://your-site.netlify.app/  # #seed= link (needs a copy with seeds.js)
     node build/seed-pack.mjs <pack> --snippet [--out file.js]              # devtools-console snippet (works on ANY copy, old or new)

   All three paths are idempotent: re-running never duplicates tracks. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePack, encodeSeedPayload, SEED_PARAM } from '../js/seeds.js';
import { parseChordName } from '../js/chordbook.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/* The snippet embeds seeds.js's merge logic (codec + exports stripped),
   so it doesn't depend on the target copy having seeds.js at all. */
export function buildSnippet(p){
  const src = fs.readFileSync(path.join(here, '../js/seeds.js'), 'utf8')
    .split('/* ---- link codec')[0]
    .replace(/^export\s+/gm, '');
  return `/* Genre Bender seed pack "${p.id}" rev ${p.rev} — paste into the devtools console on any Genre Bender tab. Safe to re-run. */
(() => {
${src}
  const pack = ${JSON.stringify(p)};
  const KEY = 'GenreBenderTrainerTracks_v1';
  let doc = null; try { doc = JSON.parse(localStorage.getItem(KEY)); } catch {}
  const r = mergeSeedPack(doc && Array.isArray(doc.tracks) ? doc.tracks : [], pack);
  const activeId = r.firstId || (doc && doc.activeId) || (r.tracks[0] && r.tracks[0].id);
  localStorage.setItem(KEY, JSON.stringify({ tracks: r.tracks, activeId }));
  console.log('[seed]', pack.id, { added: r.added, updated: r.updated, kept: r.kept, unchanged: r.unchanged });
  if (typeof location !== 'undefined' && location.reload && (r.added.length || r.updated.length || r.kept.length)) location.reload();
  return r;
})();
`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();

async function main(){
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
if (!file){ console.error('usage: node build/seed-pack.mjs <pack.json> [--link <baseUrl>] [--snippet] [--out file]'); process.exit(2); }

const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
const errs = validatePack(pack, { parseChord: parseChordName });
if (errs.length){ console.error('✗ invalid seed pack:\n  ' + errs.join('\n  ')); process.exit(1); }
console.error(`✓ ${pack.id} rev ${pack.rev}: ${pack.tracks.length} tracks (${pack.tracks.map(t => t.sid).join(', ')})`);

if (flag('--snippet')){
  const s = buildSnippet(pack);
  const out = opt('--out');
  if (out){ fs.writeFileSync(out, s); console.error(`→ wrote ${out}`); } else process.stdout.write(s);
}
if (flag('--link')){
  const base = (opt('--link') || '').split('#')[0];
  if (!/^https?:\/\/|^file:\/\//.test(base)){ console.error('--link needs a base URL, e.g. https://genre-bender.netlify.app/'); process.exit(2); }
  console.log(`${base}#${SEED_PARAM}${await encodeSeedPayload(pack)}`);
}
}
