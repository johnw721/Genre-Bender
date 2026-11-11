/* Netlify Function: GET /.netlify/functions/songmeta?title=…&artist=…
   Returns BPM / key / time signature for a song (GetSongBPM), keeping
   the API key server-side. Set GETSONGBPM_API_KEY in
   Netlify → Site configuration → Environment variables. */
import { handleSongMeta } from '../../shared/songmeta-core.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'GET') return json(405, { error: 'GET only' });
  const params = new URL(req.url).searchParams;
  const { status, body } = await handleSongMeta(params, process.env.GETSONGBPM_API_KEY);
  return json(status, body, status === 200 ? { 'Cache-Control': 'public, max-age=86400' } : {});
};

function cors(){
  return {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}
function json(status, body, extra = {}){
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(), ...extra },
  });
}
