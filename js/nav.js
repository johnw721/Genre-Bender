/* ============================================================
   nav.js — the app shell: four destinations, the sub-nav, the
   overflow menu, transport popovers and the light/dark theme.

   Destinations sit on top of the existing panels, so every old
   entry point (switchTab('upload'), trainerNav('drills'), inline
   onclicks, tests) keeps working and the nav just follows along:

     Songs     → panel-upload
     Play      → panel-trainer  (sub: My chords · Color map)
     Practice  → panel-practice  ·  panel-trainer sub=drills
     Create    → panel-mixer  ·  panel-guided

   ui.switchTab and trainernav fire a 'gb:nav' event after they
   change the view; refresh() reads the DOM and repaints the nav.
   ============================================================ */
import { registerActions } from './actions.js';
import { registerStore, loadJSON, saveJSON } from './storage.js';
import { getAppKey, onAppKeyChange } from './keysync.js';

const $ = (id) => document.getElementById(id);
const NAV_KEY = registerStore('navShell', 'GenreBenderNav_v1');
const THEME_KEY = registerStore('theme', 'GenreBenderTheme_v1');

const call = (fn, ...a) => (typeof window[fn] === 'function' ? window[fn](...a) : undefined);

/* Sub-nav entries per destination: [id, label, go()]. */
const SUBS = {
  songs: [],
  play: [],          // one workspace: video · color map · My chords + library
  practice: [
    ['today',  'Today',  () => call('switchTab', 'practice')],
    ['drills', 'Drills', () => call('trainerNav', 'drills')],
  ],
  create: [
    ['mixer',  'Genre mixer',     () => call('switchTab', 'mixer')],
    ['guided', 'Guided workflow', () => call('switchTab', 'guided')],
  ],
};

let state = Object.assign({ dest: 'songs', play: 'chords' }, loadJSON(NAV_KEY, {}) || {});
function save(){ saveJSON(NAV_KEY, state); }

/* What's on screen right now → { dest, sub }. Pure over the DOM. */
export function currentView(){
  if (document.body.classList.contains('study-open')) return { dest: 'play', sub: '' };
  const panel = document.querySelector('.panel.active');
  const tab = panel ? panel.id.replace(/^panel-/, '') : 'upload';
  const tsub = $('inner-trainer')?.dataset.sub || 'drills';
  if (tab === 'trainer') return tsub === 'drills' ? { dest: 'practice', sub: 'drills' } : { dest: 'play', sub: tsub };
  if (tab === 'practice') return { dest: 'practice', sub: 'today' };
  if (tab === 'mixer' || tab === 'guided') return { dest: 'create', sub: tab };
  return { dest: 'songs', sub: '' };
}

export function go(dest){
  if (dest === 'songs') call('switchTab', 'upload');
  else if (dest === 'play') call('trainerNav', 'chords');
  else if (dest === 'practice') call('switchTab', 'practice');
  else if (dest === 'create') call('switchTab', 'mixer');
  refresh();
  try { window.scrollTo({ top: 0 }); } catch {}
}

export function refresh(){
  const v = currentView();
  state.dest = v.dest;
  save();
  document.querySelectorAll('.dest').forEach(b => {
    const on = b.dataset.dest === v.dest;
    b.classList.toggle('active', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  const sn = $('subnav');
  if (sn){
    const items = SUBS[v.dest] || [];
    sn.innerHTML = items.map(([id, label]) =>
      `<button type="button" class="subnav-item${id === v.sub ? ' active' : ''}" data-action="nav:sub" data-sub="${id}"${id === v.sub ? ' aria-current="true"' : ''}>${label}</button>`).join('');
  }
  document.body.dataset.dest = v.dest;
}

/* ---- overflow menu + popovers -------------------------------------- */
function closeAll(except){
  const menu = $('menu-pop');
  if (menu && except !== menu){ menu.hidden = true; $('menu-btn')?.setAttribute('aria-expanded', 'false'); }
  document.querySelectorAll('.tp-pop').forEach(p => {
    if (p === except) return;
    p.hidden = true;
    document.querySelector(`[data-pop="${p.id}"]`)?.setAttribute('aria-expanded', 'false');
  });
}
function toggleMenu(){
  const menu = $('menu-pop');
  if (!menu) return;
  const open = menu.hidden;
  closeAll(menu);
  menu.hidden = !open;
  $('menu-btn')?.setAttribute('aria-expanded', String(open));
}
function togglePop(el){
  const pop = $(el?.dataset?.pop);
  if (!pop) return;
  const open = pop.hidden;
  closeAll(pop);
  pop.hidden = !open;
  el.setAttribute('aria-expanded', String(open));
}

/* ---- theme ---------------------------------------------------------- */
export function setTheme(t){
  const theme = t === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  saveJSON(THEME_KEY, theme);
  const b = $('theme-btn');
  if (b) b.title = theme === 'light' ? 'Switch to dark' : 'Switch to light';
}
function toggleTheme(){ setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'); }

function paintKey(){
  const k = getAppKey();
  const l = $('tp-key-label');
  if (l && k) l.textContent = String(k).replace('#', '♯').replace(/(?<=[A-G])b/, '♭');
}

export function initNav(){
  registerActions({
    'nav:dest': (el) => go(el.dataset.dest),
    'nav:sub':  (el) => {
      const v = currentView();
      const item = (SUBS[v.dest] || []).find(([id]) => id === el.dataset.sub);
      if (item){ item[2](); refresh(); }
    },
    'ui:menu':  () => toggleMenu(),
    'ui:pop':   (el) => togglePop(el),
    'ui:theme': () => toggleTheme(),
  });
  document.addEventListener('gb:nav', refresh);
  // Close menus/popovers on outside click, Escape, or after picking a menu item.
  document.addEventListener('click', (e) => {
    if (e.target.closest('#menu-pop button')){ setTimeout(() => closeAll(), 0); return; }
    if (e.target.closest('#menu-pop, #menu-btn, .tp-pop, [data-pop]')) return;
    closeAll();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
  onAppKeyChange(paintKey);
  setTheme(loadJSON(THEME_KEY, null) || document.documentElement.dataset.theme || 'dark');
  paintKey();
  // Land where you left off (Songs the first time).
  go(state.dest || 'songs');
}
