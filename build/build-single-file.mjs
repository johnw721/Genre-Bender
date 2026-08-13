/* ============================================================
   build-single-file.mjs — packs Genre Bender into ONE portable
   .html file with zero external requests.

   What it does:
     1. Bundles js/main.js (and its 40-odd module imports) into a
        single IIFE with esbuild, minified.
     2. Inlines every css/*.css file in the order index.html loads them.
     3. Inlines Tonal.js (normally a CDN <script>).
     4. Embeds DM Mono + Syne as base64 woff2 @font-face rules,
        replacing the Google Fonts <link>s.
     5. Rewrites the default AI endpoint to Anthropic's public API,
        so a recipient only needs to paste their own key in ⚙ AI.

   Run:  node build/build-single-file.mjs
   Out:  dist/genre-bender.html
   ============================================================ */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => resolve(ROOT, ...s);

/* Where the shared build points its AI calls. The dev tree keeps
   localhost:8787 (server/proxy.js); the portable file cannot. */
const SHARE_ENDPOINT = 'https://api.anthropic.com/v1/messages';

/* Fonts to embed. Sourced from the @fontsource packages so the build
   never reaches out to fonts.googleapis.com. */
const FONTS = [
  { family: 'DM Mono', pkg: 'dm-mono', file: 'dm-mono-latin-300-normal.woff2', weight: 300, style: 'normal' },
  { family: 'DM Mono', pkg: 'dm-mono', file: 'dm-mono-latin-300-italic.woff2', weight: 300, style: 'italic' },
  { family: 'DM Mono', pkg: 'dm-mono', file: 'dm-mono-latin-400-normal.woff2', weight: 400, style: 'normal' },
  { family: 'DM Mono', pkg: 'dm-mono', file: 'dm-mono-latin-500-normal.woff2', weight: 500, style: 'normal' },
  { family: 'Syne',    pkg: 'syne',    file: 'syne-latin-400-normal.woff2',    weight: 400, style: 'normal' },
  { family: 'Syne',    pkg: 'syne',    file: 'syne-latin-600-normal.woff2',    weight: 600, style: 'normal' },
  { family: 'Syne',    pkg: 'syne',    file: 'syne-latin-700-normal.woff2',    weight: 700, style: 'normal' },
  { family: 'Syne',    pkg: 'syne',    file: 'syne-latin-800-normal.woff2',    weight: 800, style: 'normal' },
];

function fontFaceCss(){
  const rules = [];
  for (const f of FONTS) {
    const path = p('node_modules', '@fontsource', f.pkg, 'files', f.file);
    if (!existsSync(path)) {
      console.warn(`  ! missing font ${f.file} — skipping (falls back to system font)`);
      continue;
    }
    const b64 = readFileSync(path).toString('base64');
    rules.push(
      `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};` +
      `font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2')}`
    );
  }
  return rules.join('\n');
}

function tonalSource(){
  const candidates = [
    p('node_modules', 'tonal', 'browser', 'tonal.min.js'),
    p('node_modules', 'tonal', 'dist', 'index.js'),
  ];
  for (const c of candidates) if (existsSync(c)) return readFileSync(c, 'utf8');
  console.warn('  ! tonal not found in node_modules — chord naming uses the built-in fallback');
  return '';
}

/* Pull the css/*.css hrefs out of index.html so the build stays in sync
   if you add a stylesheet later. */
function collectCss(html){
  const hrefs = [...html.matchAll(/<link[^>]+href="(css\/[^"]+)"[^>]*>/g)].map(m => m[1]);
  return hrefs.map(h => `/* ${h} */\n${readFileSync(p(h), 'utf8')}`).join('\n');
}

async function bundleJs(){
  const result = await esbuild.build({
    entryPoints: [p('js/main.js')],
    bundle: true,
    format: 'iife',
    minify: true,
    target: ['es2020'],
    write: false,
    logLevel: 'warning',
  });
  return result.outputFiles[0].text;
}

async function main(){
  let html = readFileSync(p('index.html'), 'utf8');

  console.log('· bundling modules');
  let js = await bundleJs();
  // config.js hardcodes the proxy default; swap it for the shared build.
  const before = js;
  js = js.replace(/"http:\/\/localhost:8787\/v1\/messages"|'http:\/\/localhost:8787\/v1\/messages'/g,
                  () => JSON.stringify(SHARE_ENDPOINT));
  if (js === before) console.warn('  ! default endpoint string not found — check config.js');

  console.log('· inlining styles + fonts');
  const css = collectCss(html);
  const fonts = fontFaceCss();

  console.log('· inlining tonal');
  const tonal = tonalSource();

  // Strip everything that would hit the network.
  html = html
    .replace(/<link rel="preconnect"[^>]*>\s*/g, '')
    .replace(/<link[^>]+fonts\.googleapis\.com[^>]*>\s*/g, '')
    .replace(/<!--[^>]*Tonal\.js[^>]*-->\s*/g, '')
    .replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>\s*/g, '')
    .replace(/<!--\s*Styles, split by concern\s*-->\s*/g, '')
    .replace(/<link rel="stylesheet" href="css\/[^"]+">\s*/g, '');

  // Check for leftover local references *before* inlining, so strings that
  // merely look like paths inside the bundled JS don't trip the guard.
  const leftovers = [...html.matchAll(/<(?:link|script|img)[^>]+(?:src|href)="(?!https?:|data:|#)([^"]+)"/g)]
    .map(m => m[1])
    .filter(f => f !== 'js/main.js');
  if (leftovers.length) {
    throw new Error(`build left local file references in the output: ${leftovers.join(', ')}`);
  }

  const head =
    `<style>\n${fonts}\n</style>\n` +
    `<style>\n${css}\n</style>\n` +
    (tonal ? `<script>\n${tonal}\n</script>\n` : '');

  // Function replacers throughout: the minified bundle contains "$&"/"$'"
  // sequences that String.replace would otherwise expand as substitutions.
  html = html.replace('</head>', () => `${head}</head>`);
  html = html.replace(
    /<script type="module" src="js\/main\.js"><\/script>/,
    () => `<script>\n${js}\n</script>`
  );

  // A literal "</script>" inside the inlined JS would close the tag early.
  if (/<\/script/i.test(js)) throw new Error('bundle contains a literal </script>');

  mkdirSync(p('dist'), { recursive: true });
  const out = p('dist/genre-bender.html');
  writeFileSync(out, html, 'utf8');
  console.log(`\n✓ ${out}  (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch(err => { console.error(err); process.exit(1); });
