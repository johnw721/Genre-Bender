/* ============================================================
   trainersrs.js — Leitner-box spaced repetition for the trainer.

   Each drill question is a "card" identified by a stable string id
   (e.g. "s2n|C|3"). Cards move up a box when answered correctly and
   drop back to box 0 when missed. Each box has a review interval;
   a card is "due" once its interval has elapsed. Box 0 is due
   immediately, so misses resurface within the same session.

   Persisted to localStorage. No DOM, no audio — unit-testable.
   ============================================================ */

import { registerStore, loadJSON, saveJSON, removeKey } from './storage.js';
const STORE_KEY = registerStore('trainerSrs', 'GenreBenderTrainerSRS_v1');
/* Per-day answer tally (for the practice stepper): { date, answered,
   right, byKind: { s2n: n, … } }. Resets itself when the date changes. */
const TODAY_KEY = registerStore('trainerToday', 'GenreBenderTrainerToday_v1');

/* Review intervals per box. Box 0/1 keep cards inside the current
   session; boxes 2+ push them out across days. */
const INTERVALS_MS = [
  0,                    // box 0 — due immediately (just missed / brand new)
  10 * 60e3,            // box 1 — 10 minutes
  24 * 36e5,            // box 2 — 1 day
  3 * 24 * 36e5,        // box 3 — 3 days
  7 * 24 * 36e5,        // box 4 — 1 week
];
export const MAX_BOX = INTERVALS_MS.length - 1;

let cache = null;

function load(){
  if (cache) return cache;
  cache = loadJSON(STORE_KEY, {});
  return cache;
}
function save(){
  saveJSON(STORE_KEY, cache);
}

export function localDay(ts = Date.now()){
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
let today = null;
function loadToday(){
  const day = localDay();
  if (today && today.date === day) return today;
  const s = loadJSON(TODAY_KEY, null);
  today = (s && s.date === day) ? s : { date: day, answered: 0, right: 0, byKind: {} };
  return today;
}
/* Today's quiz tally. `byKind` is keyed by the card-id prefix
   (s2n / n2s / mv / prog / sc), which is the drill mode. */
export function srsToday(){
  const t = loadToday();
  return { date: t.date, answered: t.answered, right: t.right, byKind: { ...t.byKind } };
}

/* Record an answer for a card. Returns the updated card record. */
export function srsRecord(id, correct){
  const t = loadToday();
  t.answered++; if (correct) t.right++;
  const kind = String(id).split('|')[0];
  t.byKind[kind] = (t.byKind[kind] || 0) + 1;
  saveJSON(TODAY_KEY, t);
  const db = load();
  const c = db[id] || { box: 0, due: 0, seen: 0, right: 0, wrong: 0 };
  c.seen++;
  if (correct){ c.right++; c.box = Math.min(c.box + 1, MAX_BOX); }
  else        { c.wrong++; c.box = 0; }
  c.due = Date.now() + INTERVALS_MS[c.box];
  db[id] = c;
  save();
  return c;
}

/* Pick the next card from a candidate id list.
   Priority: due cards (lowest box first, light shuffle) → unseen
   cards → soonest-due cards. `excludeId` avoids immediate repeats. */
export function srsPick(candidates, { excludeId = null } = {}){
  const db = load();
  const now = Date.now();
  let pool = candidates.filter(id => id !== excludeId);
  if (!pool.length) pool = candidates;
  if (!pool.length) return null;

  const due = [], unseen = [], later = [];
  for (const id of pool){
    const c = db[id];
    if (!c) unseen.push(id);
    else if (c.due <= now) due.push(id);
    else later.push(id);
  }
  due.sort((a, b) => (db[a].box - db[b].box) || (db[a].due - db[b].due));

  /* Mostly review what's due, but mix in unseen cards so the deck
     keeps growing instead of grinding one weak card forever. */
  if (due.length && (Math.random() < 0.65 || !unseen.length)){
    return due[Math.floor(Math.random() * Math.min(due.length, 5))];
  }
  if (unseen.length) return unseen[Math.floor(Math.random() * unseen.length)];
  if (later.length){
    later.sort((a, b) => db[a].due - db[b].due);
    return later[Math.floor(Math.random() * Math.min(later.length, 5))];
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

/* Aggregate stats over a candidate deck (for the stats readout). */
export function srsStats(candidates){
  const db = load();
  const now = Date.now();
  let seen = 0, due = 0, mastered = 0, right = 0, answered = 0;
  for (const id of candidates){
    const c = db[id];
    if (!c) continue;
    seen++;
    if (c.due <= now) due++;
    if (c.box >= 3) mastered++;
    right += c.right;
    answered += c.right + c.wrong;
  }
  return {
    total: candidates.length,
    seen,
    unseen: candidates.length - seen,
    due,
    mastered,
    accuracy: answered ? right / answered : null,
  };
}

/* Wipe all trainer progress. */
export function srsResetAll(){
  cache = {};
  removeKey(STORE_KEY);
}
