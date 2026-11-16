/* ============================================================
   toast.js — one small message at the bottom of the screen.

     toast('✓ Saved to clips')
     toast('Track deleted', { undo: () => restore() })   // 6 s to undo

   Replaces confirm() pop-ups for deletes (do it, offer Undo) and
   gives every save the same quiet confirmation. One toast at a time;
   a new one replaces the old (an un-clicked Undo simply expires).
   ============================================================ */
import { escHtml } from './util.js';

const $ = (id) => document.getElementById(id);
let timer = null;
let undoFn = null;

function el(){
  let e = $('gb-toast');
  if (!e){
    e = document.createElement('div');
    e.id = 'gb-toast';
    e.className = 'gb-toast';
    e.setAttribute('role', 'status');
    e.setAttribute('aria-live', 'polite');
    e.hidden = true;
    e.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-toast-undo]')){
        const fn = undoFn;
        hideToast();
        try { fn?.(); } catch (err) { console.error('undo failed:', err); }
        toast('Restored');
      } else if (ev.target.closest('[data-toast-close]')) hideToast();
    });
    document.body.appendChild(e);
  }
  return e;
}

export function toast(message, { undo = null, ms = null } = {}){
  const e = el();
  clearTimeout(timer);
  undoFn = typeof undo === 'function' ? undo : null;
  e.innerHTML = `<span>${escHtml(message)}</span>${undoFn ? '<button type="button" data-toast-undo>Undo</button>' : ''}<button type="button" class="gb-toast-x" data-toast-close aria-label="Dismiss">✕</button>`;
  e.hidden = false;
  e.classList.remove('show'); void e.offsetWidth; e.classList.add('show');
  timer = setTimeout(hideToast, ms ?? (undoFn ? 6000 : 2200));
}
export function hideToast(){
  clearTimeout(timer);
  undoFn = null;
  const e = $('gb-toast');
  if (e){ e.hidden = true; e.classList.remove('show'); }
}
