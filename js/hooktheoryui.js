/* ============================================================
   hooktheoryui.js — the DOM side of the Hooktheory layer.

   - Header button: opens the connect dialog and always shows the
     current state ("Hooktheory ✓ Grey721", or plain when off). It
     repaints on every auth change, including a silent expiry (a 401
     from the trends endpoint), so it can't claim "connected" while
     calls fail.
   - Connect dialog: a real <input type="password"> instead of
     window.prompt (prompt shows the password on screen, which
     matters during a screen-share). Once connected, the same dialog
     offers disconnect and the live smoke test.
   - Realism mode selects (guitar + piano rows), mirrored.
   ============================================================ */
import {
  hooktheoryAuth, hooktheoryLogout, isHooktheoryAuthed, hooktheoryUser,
  onHooktheoryChange, getRealismMode, setRealismMode, hooktheorySmokeTest, REALISM_MODES
} from './hooktheory.js';
import { registerActions } from './actions.js';
import { escHtml } from './util.js';

const $ = (id) => document.getElementById(id);
const MODE_SELECTS = ['guitar-realism', 'piano-realism'];

function paintButton(){
  const btn = $('hooktheory-btn');
  if (!btn) return;
  const on = isHooktheoryAuthed();
  const user = hooktheoryUser();
  btn.innerHTML = `<span class="hbtn-ico">🎵</span>Hooktheory${on ? ` ✓${user ? ' <span class="hbtn-user">' + escHtml(user) + '</span>' : ''}` : ''}`;
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
  btn.title = on
    ? `Connected as ${user || 'you'} — for this tab only (not saved). Click to disconnect or run the smoke test.`
    : 'Optional: layers real chord-trend data from Hooktheory on top of AI-generated progressions';
  for (const id of ['guitar-hooktheory', 'piano-hooktheory', ...MODE_SELECTS]){
    const el = $(id);
    if (el) el.closest('label, .realism-mode')?.classList.toggle('ht-off', !on);
  }
}

function paintModal(){
  const on = isHooktheoryAuthed();
  const form = $('ht-form'), conn = $('ht-connected');
  if (form) form.style.display = on ? 'none' : '';
  if (conn) conn.style.display = on ? '' : 'none';
  const who = $('ht-who');
  if (who) who.textContent = hooktheoryUser() || '';
}

function setStatus(msg, kind = ''){
  const el = $('ht-status');
  if (!el) return;
  el.className = 'modal-status' + (kind ? ' ' + kind : '');
  el.textContent = msg || '';
}

function openModal(){
  const m = $('hooktheory-modal');
  if (!m) return;
  setStatus('');
  const report = $('ht-report'); if (report) report.innerHTML = '';
  paintModal();
  m.style.display = 'flex';
  setTimeout(() => (isHooktheoryAuthed() ? $('ht-smoke-btn') : $('ht-user'))?.focus(), 0);
}
function closeModal(){
  const m = $('hooktheory-modal');
  if (m) m.style.display = 'none';
  const pw = $('ht-pass'); if (pw) pw.value = '';     // never leave the password sitting in the DOM
}

async function connect(){
  const user = $('ht-user')?.value.trim();
  const pw = $('ht-pass')?.value || '';
  const btn = $('ht-connect-btn');
  if (btn) btn.disabled = true;
  setStatus('Connecting…');
  const { ok, error } = await hooktheoryAuth(user, pw);
  if (btn) btn.disabled = false;
  const pass = $('ht-pass'); if (pass) pass.value = '';
  if (ok){ setStatus('Connected.', 'ok'); paintModal(); }
  else setStatus(error || 'Sign-in failed.', 'err');
}

async function smoke(){
  const out = $('ht-report');
  const btn = $('ht-smoke-btn');
  if (btn) btn.disabled = true;
  if (out) out.innerHTML = '<li>running…</li>';
  const { lines } = await hooktheorySmokeTest();
  if (btn) btn.disabled = false;
  if (out) out.innerHTML = lines.map(l =>
    `<li class="${l.ok ? 'ok' : 'bad'}">${l.ok ? '✓' : '✗'} ${escHtml(l.msg)}</li>`).join('');
}

function paintModeSelects(){
  const mode = getRealismMode();
  for (const id of MODE_SELECTS){ const el = $(id); if (el && el.value !== mode) el.value = mode; }
}

export function initHooktheoryUI(){
  for (const id of MODE_SELECTS){
    const el = $(id);
    if (el && !el.options.length){
      el.innerHTML = Object.entries(REALISM_MODES)
        .map(([k, v]) => `<option value="${k}">${escHtml(v.label)}</option>`).join('');
    }
  }
  paintModeSelects();
  registerActions({
    'hooktheory:open': () => openModal(),
    'hooktheory:close': () => closeModal(),
    'hooktheory:connect': () => connect(),
    'hooktheory:disconnect': () => { hooktheoryLogout(); setStatus('Disconnected.'); paintModal(); },
    'hooktheory:smoke': () => smoke(),
    'hooktheory:mode': (el) => setRealismMode(el.value),
  });
  // Enter in either field submits; Escape closes.
  $('ht-pass')?.addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });
  $('ht-user')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('ht-pass')?.focus(); });
  $('hooktheory-modal')?.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  $('hooktheory-modal')?.addEventListener('click', e => { if (e.target.id === 'hooktheory-modal') closeModal(); });

  onHooktheoryChange(({ reason }) => {
    paintButton();
    paintModal();
    paintModeSelects();
    if (reason === 'expired'){
      setStatus('Session expired — reconnect to keep using Hooktheory.', 'err');
      const btn = $('hooktheory-btn');
      if (btn) btn.title = 'Hooktheory session expired — click to reconnect';
    }
  });
  paintButton();
}
