/* ============================================================
   library.js — genre library and selection state.

   Renders the genre catalog as chips, manages the selection
   (capped at MAX_GENRES), keeps the selected-bar / ratio sliders
   in sync, and resets everything on Clear.
   ============================================================ */
import { GENRES, MAX_GENRES } from './config.js';
import { store, clearSelected } from './store.js';
import { stopAllSeqs } from './sequencer.js';
import { stopAllCardLoopers } from './loopers.js';

export function buildLibrary(){
  const lib = document.getElementById('genre-library');
  if (!lib) return;
  lib.innerHTML = '';
  for (const [cat, data] of Object.entries(GENRES)){
    const wrap = document.createElement('div');
    wrap.className = 'genre-category';
    wrap.innerHTML = `<div class="category-name ${data.color}">${cat}</div><div class="genre-chips"></div>`;
    lib.appendChild(wrap);
    const chips = wrap.querySelector('.genre-chips');
    data.genres.forEach(g => {
      const c = document.createElement('button');
      c.className = 'chip'; c.textContent = g; c.dataset.genre = g;
      c.dataset.genreLower = g.toLowerCase();
      c.setAttribute('aria-pressed', 'false');
      c.onclick = () => toggleGenre(g, c);
      chips.appendChild(c);
    });
  }
}

export function toggleGenre(name, chip){
  const idx = store.selected.findIndex(s => s.name === name);
  if (idx !== -1){
    store.selected.splice(idx, 1);
    chip.classList.remove('selected');
    chip.setAttribute('aria-pressed', 'false');
    rebuildIndices();
  } else {
    if (store.selected.length >= MAX_GENRES){
      const w = document.getElementById('limit-warn');
      if (w){ w.classList.add('visible'); setTimeout(() => w.classList.remove('visible'), 2500); }
      return;
    }
    store.selected.push({ name, ratio: 50 });
    chip.classList.add('selected');
    chip.setAttribute('aria-pressed', 'true');
    chip.dataset.idx = store.selected.length;
  }
  syncUI();
}

function rebuildIndices(){
  document.querySelectorAll('.chip.selected').forEach(c => {
    const idx = store.selected.findIndex(s => s.name === c.dataset.genre);
    if (idx !== -1) c.dataset.idx = idx + 1;
  });
}

export function clearAll(){
  clearSelected();
  store.reference = null;
  store.blendData = null;                 // keep persisted session in step
  store.guitarTabData = null;
  store.pianoChordData = null;
  document.querySelectorAll('.chip.selected').forEach(c => {
    c.classList.remove('selected'); c.setAttribute('aria-pressed','false'); delete c.dataset.idx;
  });
  syncUI();
  stopAllSeqs();
  stopAllCardLoopers();
  ['output-body','guitar-output','piano-output'].forEach(id => {
    const el = document.getElementById(id);
    if (el){ el.className = id === 'output-body' ? 'output-body' : 'tab-output'; el.textContent = ''; }
  });
  const dot = document.getElementById('status-dot');
  if (dot) dot.className = 'status-dot';
}

export function syncUI(){
  const count = document.getElementById('sel-count');
  if (count) count.textContent = `${store.selected.length} / ${MAX_GENRES} genres selected`;

  const bar = document.getElementById('selected-bar');
  if (bar){
    bar.innerHTML = store.selected.length === 0
      ? '<span class="placeholder">No genres selected yet</span>'
      : store.selected.map((s, i) => `<div class="sel-chip"><span>${s.name}</span><span class="rm" onclick="removeByIdx(${i})">×</span></div>`).join('');
  }

  const sliders = document.getElementById('sliders');
  if (sliders){
    sliders.innerHTML = store.selected.length === 0
      ? '<div style="color:var(--muted);font-size:12px;font-style:italic">Ratios appear after selecting genres.</div>'
      : store.selected.map((s, i) => `<div class="slider-row"><div class="slider-label" title="${s.name}">${s.name}</div><input type="range" min="0" max="100" step="1" value="${s.ratio}" aria-label="${s.name} blend ratio" oninput="updateRatio(${i},this.value)"><div class="slider-val" id="rv-${i}">${s.ratio}%</div></div>`).join('');
  }

  const gen = document.getElementById('gen-btn');
  if (gen) gen.disabled = store.selected.length < 2;

  renderRail();
}

/* Left-rail "Session" card: compact mirror of the selection + the reference
   clip the mixer was seeded from. Read-only except for the reference's ✕. */
function renderRail(){
  const g = document.getElementById('rail-genres');
  if (g){
    g.innerHTML = store.selected.length === 0
      ? '<span class="rail-empty">no genres yet</span>'
      : store.selected.map(s => `<span class="rail-genre"><span>${s.name}</span><em>${s.ratio}%</em></span>`).join('');
  }
  const r = document.getElementById('rail-reference');
  if (r){
    const ref = store.reference;
    r.style.display = ref ? '' : 'none';
    r.innerHTML = ref
      ? `<span class="rail-ref-label" title="Blending toward this clip">⇢ ${ref.label.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</span>
         <button type="button" class="rail-ref-clear" data-action="clips:clear-ref" title="Stop blending toward this clip">×</button>`
      : '';
  }
}

export function removeByIdx(idx){
  const name = store.selected[idx].name;
  store.selected.splice(idx, 1);
  const chip = document.querySelector(`.chip[data-genre="${CSS.escape(name)}"]`);
  if (chip){ chip.classList.remove('selected'); chip.setAttribute('aria-pressed','false'); delete chip.dataset.idx; }
  rebuildIndices();
  syncUI();
}

export function filterGenres(query){
  const needle = String(query || '').trim().toLowerCase();
  const clearBtn = document.getElementById('genre-clear-btn');
  if (clearBtn) clearBtn.disabled = !needle;
  let anyVisible = false;
  document.querySelectorAll('.genre-category').forEach(category => {
    const chips = category.querySelectorAll('.chip');
    let categoryVisible = false;
    chips.forEach(chip => {
      const match = !needle || chip.dataset.genreLower.includes(needle);
      chip.style.display = match ? '' : 'none';
      if (match) categoryVisible = true;
    });
    category.style.display = categoryVisible ? '' : 'none';
    if (categoryVisible) anyVisible = true;
  });
  const empty = document.getElementById('genre-empty');
  if (empty) empty.style.display = anyVisible ? 'none' : '';
}

export function clearGenreFilter(){
  const input = document.getElementById('genre-filter');
  if (input){ input.value = ''; }
  filterGenres('');
}

export function updateRatio(idx, val){
  store.selected[idx].ratio = parseInt(val);
  const el = document.getElementById(`rv-${idx}`);
  if (el) el.textContent = val + '%';
}

/* Build the "Genre A (50%), Genre B (50%)" descriptor used in prompts. */
export function blendDescriptor(){
  return store.selected.map(s => `${s.name} (${s.ratio}%)`).join(', ');
}
