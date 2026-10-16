/* ============================================================
   keypicker.js — split key input: letter · accidental · mode.

   Every key <select> in the app is marked with data-keypick. This
   module "enhances" each one: it fills the select with every key
   (ALL_KEYS — 17 roots × major/minor), hides it, and puts a small
   three-part picker in its place:

       [ C D E F G A B ▾ ]  [ ♮ | ♯ | ♭ ]  [ maj | min ]

   The hidden select stays the source of truth, so everything that
   already talks to it — keysync mirroring, persistence, the explore
   shuffle, inline onchange / data-on-change handlers — keeps
   working untouched. A picker change writes the composed key into
   the select and dispatches a real 'change' event; any programmatic
   write to the select (select.value = … / selectedIndex = …) is
   intercepted so the picker repaints itself.

   Selects rendered later (chord table, color map, trainer explore)
   are picked up by a MutationObserver.
   ============================================================ */
import { ALL_KEYS, KEY_LETTERS, splitKey, joinKey, keyLabel, prettyRoot } from './theorydata.js';
import { escHtml } from './util.js';

const SELECTOR = 'select[data-keypick]';
const ACCS = [['', '♮', 'natural'], ['#', '♯', 'sharp'], ['b', '♭', 'flat']];
/* E♯, F♭, B♯, C♭ aren't offered: those accidental buttons disable. */
const INVALID = new Set(['E#', 'Fb', 'B#', 'Cb']);
const VALUE = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
const INDEX = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');

function ensureOptions(sel){
  const have = new Set([...sel.options].map(o => o.value));
  if (ALL_KEYS.every(k => have.has(k)) && sel.options.length === ALL_KEYS.length) return;
  const cur = VALUE.get.call(sel);
  sel.innerHTML = ALL_KEYS.map(k => `<option value="${k}">${escHtml(keyLabel(k))}</option>`).join('');
  VALUE.set.call(sel, ALL_KEYS.includes(cur) ? cur : 'C');
}

function pickerHTML(sel){
  const label = sel.getAttribute('aria-label') || 'Key';
  const letters = KEY_LETTERS.map(l => `<option value="${l}">${l}</option>`).join('');
  const accs = ACCS.map(([v, sym, name]) =>
    `<button type="button" class="kp-seg kp-acc" data-acc="${v}" aria-pressed="false" aria-label="${name}" title="${name}">${sym}</button>`).join('');
  return `<select class="kp-letter tab-key-select" aria-label="${escHtml(label)} — letter">${letters}</select>
    <span class="kp-group" role="group" aria-label="${escHtml(label)} — accidental">${accs}</span>
    <span class="kp-group" role="group" aria-label="${escHtml(label)} — major or minor">
      <button type="button" class="kp-seg kp-mode" data-minor="0" aria-pressed="false" title="major">maj</button>
      <button type="button" class="kp-seg kp-mode" data-minor="1" aria-pressed="false" title="minor">min</button>
    </span>`;
}

function paint(sel){
  const box = sel.__keypick;
  if (!box) return;
  const key = VALUE.get.call(sel);
  const { letter, acc, minor } = splitKey(key);
  const l = box.querySelector('.kp-letter');
  if (l.value !== letter) l.value = letter;
  box.querySelectorAll('.kp-acc').forEach(b => {
    const on = b.dataset.acc === acc;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    b.disabled = INVALID.has(letter + b.dataset.acc);
  });
  box.querySelectorAll('.kp-mode').forEach(b => {
    const on = (b.dataset.minor === '1') === minor;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
  });
  box.title = keyLabel(key);
  box.dataset.key = key;
}

/* Compose from the picker's parts and hand it to the real select. */
function commit(sel, parts){
  const cur = splitKey(VALUE.get.call(sel));
  const next = { ...cur, ...parts };
  // a new letter that can't take the current accidental drops to ♮
  if ('letter' in parts && INVALID.has(next.letter + next.acc)) next.acc = '';
  if ('acc' in parts && INVALID.has(next.letter + next.acc)) return;
  const key = joinKey(next.letter, next.acc, next.minor);
  if (key === VALUE.get.call(sel)){ paint(sel); return; }
  VALUE.set.call(sel, key);
  paint(sel);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

export function enhanceKeySelect(sel){
  if (!sel || sel.__keypick) return;
  ensureOptions(sel);
  const box = document.createElement('span');
  box.className = 'keypick';
  box.innerHTML = pickerHTML(sel);
  sel.after(box);
  sel.classList.add('kp-hidden');
  sel.setAttribute('tabindex', '-1');
  sel.setAttribute('aria-hidden', 'true');
  sel.__keypick = box;

  // Programmatic writes (keysync, persistence, explore shuffle) repaint.
  Object.defineProperty(sel, 'value', {
    configurable: true,
    get(){ return VALUE.get.call(this); },
    set(v){ VALUE.set.call(this, v); paint(this); },
  });
  Object.defineProperty(sel, 'selectedIndex', {
    configurable: true,
    get(){ return INDEX.get.call(this); },
    set(v){ INDEX.set.call(this, v); paint(this); },
  });

  box.querySelector('.kp-letter').addEventListener('change', e => {
    e.stopPropagation();                      // only the real select's change should bubble
    commit(sel, { letter: e.target.value });
  });
  box.addEventListener('click', e => {
    const acc = e.target.closest('.kp-acc');
    if (acc){ commit(sel, { acc: acc.dataset.acc }); return; }
    const mode = e.target.closest('.kp-mode');
    if (mode) commit(sel, { minor: mode.dataset.minor === '1' });
  });
  paint(sel);
}

export function enhanceKeySelects(root = document){
  root.querySelectorAll(SELECTOR).forEach(enhanceKeySelect);
}

let observer = null;
export function initKeyPickers(){
  enhanceKeySelects();
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver(muts => {
    for (const m of muts){
      for (const n of m.addedNodes){
        if (n.nodeType !== 1) continue;
        if (n.matches && n.matches(SELECTOR)) enhanceKeySelect(n);
        else if (n.querySelectorAll) n.querySelectorAll(SELECTOR).forEach(enhanceKeySelect);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export { prettyRoot };
