/* ============================================================
   ui.js — view switching for the top-level tabs and the
   guitar/piano inner tabs. Pure DOM, no app state.
   ============================================================ */

export function switchTab(id){
  const panel = document.getElementById('panel-' + id);
  if (!panel) return;
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  panel.classList.add('active');
  // nav.js repaints the top bar / sub-nav from whatever is now on screen
  document.dispatchEvent(new CustomEvent('gb:nav', { detail: { tab: id } }));
}

export function switchInnerTab(id, btn){
  document.querySelectorAll('.tab-inner-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.inner-panel').forEach(p => p.style.display = 'none');
  const inner = document.getElementById('inner-' + id);
  if (inner) inner.style.display = 'block';
}
