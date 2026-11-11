/* Dev server config. The only addition over Vite's defaults: forward
   /.netlify/functions/* to the local Express proxy (server/proxy.js),
   which mounts the same handlers the Netlify Functions use in
   production — so "Look up BPM/key" works under `npm start` too. */
import { readFileSync } from 'node:fs';

function proxyPort(){
  if (process.env.PROXY_PORT) return process.env.PROXY_PORT;
  try {
    const m = readFileSync(new URL('./server/.env', import.meta.url), 'utf8').match(/^\s*PROXY_PORT\s*=\s*(\d+)/m);
    if (m) return m[1];
  } catch { /* no server/.env */ }
  return '3000';   // proxy.js default
}

export default {
  server: {
    proxy: {
      '/.netlify/functions': { target: `http://localhost:${proxyPort()}`, changeOrigin: true },
    },
  },
};
