/* ============================================================
   shortcuts.js — keyboard shortcuts (press ? for the list).

   Ignored while typing in a field. Single keys, no modifiers:

     T / C / M   Shape Trainer → Drills / My chords / Color map
     1 – 7       play the degree chord in the current key
                 (Shift + 1–7: its first colour, e.g. Imaj7)
                 — in a drill with answer buttons up, 1–4 answer instead
     N           next drill question
     Space       play the melody (Play, when there is one) — otherwise
                 loop / stop the active track's progression
     ← / →       step through the progression
     H           play melody + harmony
     ?           show / hide this list        Esc  close it
   ============================================================ */
import { trainerNav, getTrainerSub } from './trainernav.js';
import { trainerNext, trainerAnswer } from './trainer.js';
import { playDegree, playMelodyNow, playHarmony, hasMelody } from './colormap.js';
import { progPlay, progStep } from './progtab.js';

const $ = (id) => document.getElementById(id);
const ROWS = [
  ['Space', 'loop / stop your progression (plays the melody instead when Play has one)'],
  ['← / →', 'step through the progression'],
  ['/', 'find a chord — or type a command: "new track", "color map in E", "practice"'],
  ['T', 'Practice → Drills'],
  ['C', 'Play → My chords'],
  ['M', 'Play → Color map'],
  ['1 – 7', 'play the degree chord in the current key'],
  ['Shift + 1 – 7', 'play its first colour (Imaj7, ii m7 …)'],
  ['1 – 4', 'in a drill: pick that answer'],
  ['N', 'next drill question'],
  ['H', 'play the melody with its harmony'],
  ['?', 'show / hide shortcuts'],
  ['Esc', 'close this list'],
];

function typing(e){
  const t = e.target;
  if (!t) return false;
  const tag = (t.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
}
function trainerOpen(){ return !!$('panel-trainer')?.classList.contains('active'); }

export function toggleShortcutHelp(force){
  let el = $('gb-shortcuts');
  if (!el){
    el = document.createElement('div');
    el.id = 'gb-shortcuts';
    el.className = 'gb-shortcuts';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Keyboard shortcuts');
    el.innerHTML = `<div class="gb-sc-card">
      <div class="gb-sc-head"><span class="section-label">Keyboard shortcuts</span>
        <button type="button" class="pb-btn" data-sc-close aria-label="Close">✕</button></div>
      <table class="gb-sc-table">${ROWS.map(([k, d]) => `<tr><td><kbd>${k}</kbd></td><td>${d}</td></tr>`).join('')}</table>
      <p class="trainer-hint">Shortcuts pause while you're typing in a box.</p>
    </div>`;
    el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-sc-close]')) toggleShortcutHelp(false); });
    document.body.appendChild(el);
  }
  const show = typeof force === 'boolean' ? force : !el.classList.contains('show');
  el.classList.toggle('show', show);
  if (show) el.querySelector('[data-sc-close]')?.focus();
}

function onKey(e){
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape'){ if ($('gb-shortcuts')?.classList.contains('show')){ toggleShortcutHelp(false); e.preventDefault(); } return; }
  if (typing(e)) return;
  const k = e.key;
  if (k === '?'){ toggleShortcutHelp(); e.preventDefault(); return; }
  const sub = trainerOpen() ? getTrainerSub() : null;

  // digits: answer in a drill, otherwise play a degree
  const dm = (e.code || '').match(/^Digit([1-7])$/);
  if (dm){
    const n = +dm[1];
    if (sub === 'drills' && !e.shiftKey){
      const opt = $('trainer-opt-' + (n - 1));
      if (opt && !opt.disabled){ trainerAnswer(n - 1); e.preventDefault(); return; }
    }
    playDegree(n - 1, e.shiftKey);
    e.preventDefault();
    return;
  }
  switch (k.toLowerCase()){
    case 't': trainerNav('drills'); break;
    case 'c': trainerNav('chords'); break;
    case 'm': trainerNav('colormap'); break;
    case 'n': if (sub === 'drills') trainerNext(); else return; break;
    case 'h': if (hasMelody()) playHarmony(); else return; break;
    case ' ':
      if (e.target?.closest?.('button, a, summary, [role="button"]')) return;   // Space on a focused button = click it
      if ((sub === 'colormap' || sub === 'chords') && hasMelody()){ playMelodyNow(); break; }
      if (progPlay()) break;
      return;
    case 'arrowleft':  if (sub === 'drills' || !progStep(-1)) return; break;
    case 'arrowright': if (sub === 'drills' || !progStep(1)) return; break;
    default: return;
  }
  e.preventDefault();
}

export function initShortcuts(){
  document.addEventListener('keydown', onKey);
}
