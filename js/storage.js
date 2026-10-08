/* ============================================================
   storage.js — one door to localStorage.

   Every module that persists something used to carry its own
   try/catch + JSON.parse + version check. This collapses that to
   loadJSON / saveJSON / removeKey, and adds a registry so the app
   can back itself up: exportAll() bundles every registered store
   into one JSON document and importAll() restores it.

   Keys are unchanged from before (GenreBender…_v1), so existing
   saved data is picked up as-is. API credentials are deliberately
   NOT registered — a backup file must never carry a key.
   ============================================================ */

const registry = new Map();   // name -> { key, exportable }

/* Register a store so backups know about it. `name` is the label used
   inside the backup document; `key` is the localStorage key. */
export function registerStore(name, key, { exportable = true } = {}){
  registry.set(name, { key, exportable });
  return key;
}

export function loadJSON(key, fallback = null, { version } = {}){
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const val = JSON.parse(raw);
    if (val == null) return fallback;
    if (version != null && val.v !== version) return fallback;
    return val;
  } catch { return fallback; }
}

export function saveJSON(key, value){
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }        // quota / private mode — persistence is best-effort
}

export function removeKey(key){
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export function storageAvailable(){
  try { const k = '__gb_probe__'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; }
  catch { return false; }
}

/* ---- backup ------------------------------------------------------------ */
export const BACKUP_FORMAT = 'genre-bender-backup';

export function exportAll(){
  const stores = {};
  for (const [name, { key, exportable }] of registry){
    if (!exportable) continue;
    const val = loadJSON(key, undefined);
    if (val !== undefined) stores[name] = val;
  }
  return { format: BACKUP_FORMAT, v: 1, exportedAt: new Date().toISOString(), stores };
}

/* Restore a backup document. Returns the names written. Caller decides
   whether to reload (modules cache state at boot, so a reload is the
   honest way to apply everything). */
export function importAll(doc){
  if (!doc || doc.format !== BACKUP_FORMAT || typeof doc.stores !== 'object')
    throw new Error('Not a Genre Bender backup file');
  const written = [];
  for (const [name, val] of Object.entries(doc.stores)){
    const entry = registry.get(name);
    if (!entry || !entry.exportable) continue;
    if (saveJSON(entry.key, val)) written.push(name);
  }
  return written;
}

export function registeredStores(){ return [...registry.keys()]; }

/* Download helper shared by the backup + clips exports. */
export function downloadJSON(obj, filename){
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
