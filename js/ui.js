/* ============================================================
   ui.js — view switching for the top-level tabs and the
   guitar/piano inner tabs. Pure DOM, no app state.
   ============================================================ */

export function switchTab(id){
  const ids = ['mixer', 'guided', 'upload', 'practice', 'trainer'];
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', ids[i] === id));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('panel-' + id);
  if (panel) panel.classList.add('active');
}

export function switchInnerTab(id, btn){
  document.querySelectorAll('.tab-inner-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.inner-panel').forEach(p => p.style.display = 'none');
  const inner = document.getElementById('inner-' + id);
  if (inner) inner.style.display = 'block';
}
