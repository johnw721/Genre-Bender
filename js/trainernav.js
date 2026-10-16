/* ============================================================
   trainernav.js — getting to the Shape Trainer.

   The trainer is a top-level tab ("05 — Shape Trainer") with three
   sub-tabs, remembered per browser (GenreBenderTrainerNav_v1):

     drills    the five SRS drill modes + Mixed (mode row, stats,
               quiz card)
     chords    "My chords": track builder + chord table, with the
               color map underneath so chips can be dragged onto
               the track
     colormap  the color map on its own (in / out of scale / parallel,
               melody lens, edit mode); + still appends to the track

   The sidebar "Shape trainer" card is the always-visible shortcut:
   cards due + answered today, "▶ Today: <drill>" (the practice
   plan's weekday rotation), My chords (with the active track's
   chord count), and Color map.

   trainerNav(sub, mode?) is the single entry point — the sidebar,
   the Practice tab and the old "open color map" bridge all use it.
   ============================================================ */
import { switchTab } from './ui.js';
import { trainerSetMode, trainerState, trainerDueSummary, onTrainerStats } from './trainer.js';
import { todaysMode } from './practice.js';
import { mountColorMap } from './colormap.js';
import { registerStore, loadJSON, saveJSON } from './storage.js';

const NAV_KEY = registerStore('trainerNav', 'GenreBenderTrainerNav_v1');
const SUBS = ['drills', 'chords', 'colormap'];
const DRILLS = ['mixed', 'sc', 's2n', 'n2s', 'mv', 'prog', 'cm'];
const MODE_LABEL = { mixed: 'Mixed', sc: 'Scale shapes', s2n: 'Shape → Number', n2s: 'Number → Shape', mv: 'Moving shapes', prog: 'Progression ID', cm: 'Color map' };

const $ = (id) => document.getElementById(id);
let sub = 'drills';
let lastDrill = 'mixed';

export function getTrainerSub(){ return sub; }

function save(){ saveJSON(NAV_KEY, { sub, lastDrill }); }

function paintSubtabs(){
  const panel = $('inner-trainer');
  if (panel) panel.dataset.sub = sub;
  document.querySelectorAll('.trainer-subtab').forEach(b => {
    const on = b.dataset.sub === sub;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('.rail-tbtn[data-sub-target]').forEach(b =>
    b.classList.toggle('here', isTrainerTabActive() && b.dataset.subTarget === sub));
}
function isTrainerTabActive(){ return !!$('panel-trainer')?.classList.contains('active'); }

/* Apply a sub-tab: set the trainer mode it needs, then repaint. */
function applySub(next, mode){
  const cur = trainerState().mode;
  if (DRILLS.includes(cur)) lastDrill = cur;
  sub = SUBS.includes(next) ? next : 'drills';
  if (sub === 'drills'){
    const m = DRILLS.includes(mode) ? mode : lastDrill;
    if (cur !== m || !DRILLS.includes(cur)) trainerSetMode(m);
    lastDrill = m;
  } else if (cur !== 'custom'){
    trainerSetMode('custom');          // chords + colormap both sit on the track view
  }
  save();
  paintSubtabs();
  refreshRail();
}

/* Entry point (window-bridged). mode: a drill id, 'today', or null. */
export function trainerNav(next = sub, mode = null){
  if (typeof window !== 'undefined' && typeof window.switchTab === 'function') window.switchTab('trainer');
  else switchTab('trainer');
  applySub(next, mode === 'today' ? todaysMode() : mode);
  const panel = $('panel-trainer');
  if (panel && typeof panel.scrollIntoView === 'function'){
    try { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { panel.scrollIntoView(); }
  }
}

/* Old bridge name, kept so existing markup / muscle memory still works. */
export function trainerOpenColorMap(){ trainerNav('colormap'); }

/* Called by main.js's switchTab wrapper: keep the sub-tab honest when the
   tab is reached from the tab bar, and repaint the sidebar card. */
export function trainerOnTab(id){
  if (id === 'trainer') applySub(sub);
  else paintSubtabs();
}

/* ---- sidebar card -------------------------------------------------------- */
export function refreshRail(){
  const stat = $('rail-trainer-stat');
  if (!stat) return;
  let s;
  try { s = trainerDueSummary(); } catch { return; }
  const answered = s.today && s.today.answered ? s.today.answered : 0;
  stat.textContent = `${s.due} due · ${answered} today`;
  stat.title = `${s.due} cards due across every drill deck · ${s.unseen} never seen · ${s.mastered} mastered · ${answered} answered today`;
  stat.classList.toggle('has-due', s.due > 0);
  const today = todaysMode();
  const drill = $('rail-trainer-drill');
  if (drill){
    drill.textContent = `▶ Today: ${MODE_LABEL[today] || 'Mixed'}`;
    drill.title = `Open today's drill (${MODE_LABEL[today] || 'Mixed'}) — the Practice plan's weekday rotation`;
  }
  const chords = $('rail-trainer-chords');
  const st = trainerState();
  if (chords){
    const n = st.track ? st.track.chords : 0;
    chords.innerHTML = `My chords${n ? ` <span class="rail-tcount">${n}</span>` : ''}`;
    chords.title = st.track ? `Open "${st.track.name}" (${n} chord${n === 1 ? '' : 's'})` : 'Open My chords';
  }
  paintSubtabs();
}

export function initTrainerNav(){
  const s = loadJSON(NAV_KEY);
  if (s && typeof s === 'object'){
    if (SUBS.includes(s.sub)) sub = s.sub;
    if (DRILLS.includes(s.lastDrill)) lastDrill = s.lastDrill;
  }
  mountColorMap($('colormap-host'));
  // tag the sidebar buttons with the sub-tab they open (for the "here" state)
  [['rail-trainer-drill', 'drills'], ['rail-trainer-chords', 'chords'], ['rail-trainer-map', 'colormap']]
    .forEach(([id, t]) => { const b = $(id); if (b) b.dataset.subTarget = t; });
  // keyboard: arrow keys move between sub-tabs
  document.querySelector('.trainer-subtabs')?.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = SUBS.indexOf(sub) + (e.key === 'ArrowRight' ? 1 : -1);
    applySub(SUBS[(i + SUBS.length) % SUBS.length]);
    document.querySelector(`.trainer-subtab[data-sub="${sub}"]`)?.focus();
  });
  onTrainerStats(refreshRail);
  applySub(sub);          // put the trainer in the remembered sub-tab (tab itself stays where it is)
}
