/* ============================================================
   actions.js — event delegation in place of window globals.

   Markup declares intent with data attributes instead of inline
   handlers:

     <button data-action="clips:open" data-id="c123">
     <input  data-on-change="clips:update" data-id="c123" data-field="bpm">
     <input  data-on-input="…">      (fires on every keystroke)
     <input  data-on-enter="…">      (Enter key in a text field)

   One listener per event type on document looks up the name in a
   registry and calls handler(el, event). Modules register their
   own handlers at init, so nothing needs to be exported onto
   window and two modules can't silently overwrite each other.

   The legacy Object.assign(window, …) bridge in main.js still
   serves the older inline on* markup; modules migrate to this one
   at a time. hasAction() lets the build verifier confirm every
   data-action in the markup resolves.
   ============================================================ */

const handlers = new Map();

export function registerActions(map){
  for (const [name, fn] of Object.entries(map)){
    if (handlers.has(name)) console.warn(`actions: "${name}" registered twice — later wins`);
    handlers.set(name, fn);
  }
}

export function hasAction(name){ return handlers.has(name); }
export function actionNames(){ return [...handlers.keys()]; }

function dispatch(evt, attr){
  const target = evt.target;
  if (!target || typeof target.closest !== 'function') return;
  const el = target.closest(`[${attr}]`);
  if (!el) return;
  const name = el.getAttribute(attr);
  const fn = handlers.get(name);
  if (!fn){ console.warn(`actions: no handler for "${name}"`); return; }
  try { fn(el, evt); }
  catch (e) { console.error(`actions: "${name}" threw`, e); }
}

let booted = false;
export function initActions(root = document){
  if (booted) return;
  booted = true;
  root.addEventListener('click',  e => dispatch(e, 'data-action'));
  root.addEventListener('change', e => dispatch(e, 'data-on-change'));
  root.addEventListener('input',  e => dispatch(e, 'data-on-input'));
  root.addEventListener('keydown', e => { if (e.key === 'Enter') dispatch(e, 'data-on-enter'); });
}
