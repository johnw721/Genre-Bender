/* ============================================================
   guided.js — "02 — Guided Workflow".

   A stepper over the actions the app already has, in the order a
   session actually goes: reference → tag → seed → blend → notate →
   play along. Nothing here owns state; each step derives its
   done/ready status from store + the clips list and its button
   just calls the existing action. Re-evaluated whenever the panel
   is shown, on clip changes, and on a light poll while visible.
   ============================================================ */
import { store } from './store.js';
import { getClips, getActiveClip, clipsSeedMixer, clipsToggleDock } from './clips.js';
import { generateBlend } from './blend.js';
import { generateGuitar } from './guitar.js';
import { switchTab, switchInnerTab } from './ui.js';
import { guitarSeq, pianoSeq, toggleSeq } from './sequencer.js';
import { toggleMetronome } from './metronome.js';
import { registerActions } from './actions.js';
import { escHtml } from './util.js';

const $ = (id) => document.getElementById(id);

/* The clip the workflow is "about": the one open in the player, else the
   one the mixer was seeded from, else the newest saved. */
function focusClip(){
  return getActiveClip()
    || (store.reference && getClips().find(c => c.id === store.reference.clipId))
    || getClips()[0] || null;
}
const tagged = (c) => !!c && !!(c.genres && c.genres.trim()) && !!c.bpm;

function metroPlaying(){ return $('metro-play-btn')?.classList.contains('playing'); }

/* Each step: title, hint(state), done(state), ready(state), action name + label. */
const STEPS = [
  {
    id: 'clip', title: 'Drop in a reference',
    hint: s => s.clip ? `Playing with “${s.clip.label}”.` : 'Paste an X / Instagram / TikTok / YouTube link into the player — or Ctrl/Cmd+V anywhere.',
    done: s => !!s.clip, ready: () => true,
    action: 'guided:clip', label: s => s.clip ? 'Add another' : 'Open the player',
    alt: 'No clip? Skip to step 3 and pick genres by hand.',
  },
  {
    id: 'tag', title: 'Tag what you hear',
    hint: s => !s.clip ? 'Needs a clip first.'
      : tagged(s.clip) ? `${s.clip.genres}${s.clip.key ? ' · ' + s.clip.key : ''} · ${s.clip.bpm} bpm`
      : 'Give it genre tags and a BPM — tap tempo along and hit ↓ bpm, or let Analyze propose tags from the caption.',
    done: s => tagged(s.clip), ready: s => !!s.clip,
    action: 'guided:analyze', label: () => 'Analyze it ↗',
  },
  {
    id: 'seed', title: 'Seed the mixer',
    hint: s => s.ref ? `Blending toward “${s.ref.label}” — ${s.selected.length} genre${s.selected.length === 1 ? '' : 's'} selected.`
      : s.selected.length >= 2 ? `${s.selected.length} genres picked by hand.`
      : 'Turn the clip’s tags into a genre selection, key and tempo — or pick 2–4 genres in the mixer yourself.',
    done: s => !!s.ref || s.selected.length >= 2, ready: s => tagged(s.clip) || s.selected.length >= 2,
    action: 'guided:seed', label: s => s.ref ? 'Re-seed' : (tagged(s.clip) ? 'Seed mixer ⇢' : 'Pick genres'),
  },
  {
    id: 'blend', title: 'Generate the blend',
    hint: s => s.blend ? 'Creative direction is in — read it in the mixer output.' : 'Ask for creative direction, techniques and a chord/rhythm guide grounded in your reference.',
    done: s => !!s.blend, ready: s => s.selected.length >= 2,
    action: 'guided:blend', label: s => s.blend ? 'Regenerate' : 'Generate blend ↗',
  },
  {
    id: 'notate', title: 'Get something to play',
    hint: s => s.notation ? 'Tab / chart generated — cards are ready to loop and reorder.' : 'Generate a guitar tab in the current key; piano chart and phrase composer are one tab over.',
    done: s => !!s.notation, ready: s => s.selected.length >= 2,
    action: 'guided:notate', label: s => s.notation ? 'Regenerate tab' : 'Generate tab ↗',
  },
  {
    id: 'play', title: 'Play along',
    hint: s => s.playing ? 'Rolling. Loop cards, tweak swing, export MIDI when it feels right.' : 'Start the tab sequencer (or the click) against the clip and jam.',
    done: s => s.playing, ready: s => !!s.notation || true,
    action: 'guided:play', label: s => s.playing ? 'Stop' : (s.notation ? 'Play tab ▶' : 'Start click ▶'),
  },
];

function state(){
  const clip = focusClip();
  return {
    clip, ref: store.reference, selected: store.selected,
    blend: store.blendData, notation: store.guitarTabData || store.pianoChordData,
    playing: guitarSeq.playing || pianoSeq.playing || metroPlaying(),
  };
}

export function renderGuided(){
  const el = $('guided-steps');
  if (!el) return;
  const s = state();
  let currentSet = false;
  el.innerHTML = STEPS.map((st, i) => {
    const done = !!st.done(s), ready = !!st.ready(s);
    const current = !done && ready && !currentSet;
    if (current) currentSet = true;
    const cls = done ? 'done' : current ? 'current' : ready ? 'ready' : 'locked';
    return `<li class="gstep ${cls}">
      <div class="gstep-num">${done ? '✓' : i + 1}</div>
      <div class="gstep-body">
        <div class="gstep-title">${escHtml(st.title)}</div>
        <div class="gstep-hint">${escHtml(st.hint(s))}</div>
        ${st.alt && !done ? `<div class="gstep-alt">${escHtml(st.alt)}</div>` : ''}
      </div>
      <button class="btn ${current ? 'btn-primary' : 'btn-ghost'} gstep-btn" type="button" data-action="${st.action}" ${ready ? '' : 'disabled'}>${escHtml(st.label(s))}</button>
    </li>`;
  }).join('');
  const done = STEPS.filter(st => st.done(s)).length;
  const prog = $('guided-progress');
  if (prog){
    prog.style.setProperty('--p', `${Math.round(done / STEPS.length * 100)}%`);
    prog.setAttribute('aria-valuenow', String(done));
    const lbl = $('guided-progress-label');
    if (lbl) lbl.textContent = done === STEPS.length ? 'all steps done — go make the thing' : `${done} / ${STEPS.length}`;
  }
}

let pollTimer = null;
function visible(){ return $('panel-guided')?.classList.contains('active'); }
function startPoll(){
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (visible()) renderGuided(); else { clearInterval(pollTimer); pollTimer = null; } }, 1200);
}

/* Called by main.js's switchTab wrapper. */
export function guidedOnTab(id){
  if (id !== 'guided') return;
  renderGuided();
  if (!pollTimer) startPoll();
}

export function initGuided(){
  registerActions({
    'guided:clip':    () => { switchTab('mixer'); clipsToggleDock(); setTimeout(() => $('clip-url')?.focus(), 80); },
    'guided:analyze': () => { switchTab('upload'); syncTabs('upload'); },
    'guided:seed':    () => {
      const c = focusClip();
      if (tagged(c)) clipsSeedMixer(c.id);
      else { switchTab('mixer'); syncTabs('mixer'); $('genre-filter')?.focus(); }
    },
    'guided:blend':   async () => { switchTab('mixer'); syncTabs('mixer'); await generateBlend(); renderGuided(); },
    'guided:notate':  async () => {
      switchTab('mixer'); syncTabs('mixer');
      const btn = [...document.querySelectorAll('.tab-inner-tab')].find(b => /guitar/i.test(b.textContent));
      switchInnerTab('guitar', btn);
      await generateGuitar(); renderGuided();
    },
    'guided:play':    () => {
      if (guitarSeq.playing || pianoSeq.playing){ if (guitarSeq.playing) toggleSeq('guitar'); if (pianoSeq.playing) toggleSeq('piano'); }
      else if (metroPlaying()) toggleMetronome();
      else if (store.guitarTabData) toggleSeq('guitar');
      else if (store.pianoChordData) toggleSeq('piano');
      else toggleMetronome();
      renderGuided();
    },
  });
  renderGuided();
}

/* switchTab() toggles panels by index but the tab buttons by the same
   index — calling it directly keeps both in step. */
function syncTabs(id){ switchTab(id); }
