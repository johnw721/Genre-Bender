/* ============================================================
   seedimport.js — the three doors a seed pack comes in by:
     1. ⤓ seed pack button (My chords)  → pick a .pack.json file
     2. a link ending  #seed=<payload>  → applied on load, address tidied
     3. window.GenreBender.applySeedPack(pack) → devtools / scripts
   Every door goes through trainerApplySeedPack (idempotent) and also
   merges the pack's song links into the clips list (clipsImport is
   merge-by-URL, so that's idempotent too).
   ============================================================ */
import { SEED_PARAM, decodeSeedPayload, encodeSeedPayload, packToClips, validatePack } from './seeds.js';
import { trainerApplySeedPack } from './trainer.js';
import { clipsImport } from './clips.js';
import { parseChordName } from './chordbook.js';

export function applySeedPack(pack, opts = {}){
  const errs = validatePack(pack, { parseChord: parseChordName });
  if (errs.length) throw new Error(errs.slice(0, 3).join('; '));
  const r = trainerApplySeedPack(pack, opts);
  let clipsAdded = 0;
  try { clipsAdded = clipsImport(packToClips(pack)); } catch (e){ console.warn('seed clips:', e); }
  const parts = [];
  if (r.added.length) parts.push(`${r.added.length} added`);
  if (r.updated.length) parts.push(`${r.updated.length} updated`);
  if (r.kept.length) parts.push(`${r.kept.length} kept your edits`);
  if (r.unchanged.length) parts.push(`${r.unchanged.length} already up to date`);
  if (opts.open !== false && (r.added.length || r.updated.length || r.kept.length) && typeof window.trainerNav === 'function'){
    try { window.trainerNav('chords'); } catch { /* trainer not mounted */ }
  }
  toast(`Seed pack "${pack.title || pack.id}": ${parts.join(', ') || 'nothing to do'}${clipsAdded ? ` · ${clipsAdded} clip link${clipsAdded === 1 ? '' : 's'} added` : ''}. Find them in 05 → My chords.`);
  return { ...r, clipsAdded };
}

export function seedImportFile(){
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,application/json';
  input.onchange = async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    try { applySeedPack(JSON.parse(await f.text())); }
    catch (e){ toast(`That seed pack couldn't be loaded: ${e.message || e}`); }
  };
  input.click();
}

export async function seedLinkFor(pack, base){
  const b = base || (() => { try { return location.href.split('#')[0]; } catch { return ''; } })();
  return `${b}#${SEED_PARAM}${await encodeSeedPayload(pack)}`;
}

async function importFromHash(){
  let h = '';
  try { h = location.hash || ''; } catch { return; }
  const i = h.indexOf(SEED_PARAM);
  if (i < 0) return;
  try { applySeedPack(await decodeSeedPayload(h.slice(i + SEED_PARAM.length))); }
  catch (e){ toast(`That seed link couldn't be read: ${e.message || e}`); }
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* file:// */ }
}

function toast(msg){
  let el = document.getElementById('gb-toast');
  if (!el){
    el = document.createElement('div');
    el.id = 'gb-toast'; el.className = 'gb-toast'; el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 6000);
}

export function initSeedImport(){
  if (window.GenreBender) Object.assign(window.GenreBender, { applySeedPack, seedLinkFor });
  importFromHash();
  window.addEventListener('hashchange', importFromHash);
}
