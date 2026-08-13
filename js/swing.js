/* ============================================================
   swing.js — swing/groove engine.

   swingAmount: 0 (straight) -> 100 (full triplet feel).
   Triplet swing pushes the "and" of each beat from 1/2 to 2/3
   of the beat. The offset is applied to odd sub-beats.
   swingOffsetSec encapsulates the amount, so audio modules only
   import the function and never touch the raw state.
   ============================================================ */

let swingAmount = 0;

export function getSwing(){ return swingAmount; }

export function setSwing(val){
  swingAmount = parseInt(val);
  const pct = swingAmount;
  let label;
  if (pct === 0)      label = 'straight';
  else if (pct <= 20) label = `${pct}% light`;
  else if (pct <= 45) label = `${pct}% med`;
  else if (pct <= 65) label = `${pct}% jazz`;
  else                label = `${pct}% hard`;
  const display = document.getElementById('swing-display');
  if (display) display.textContent = label;
  document.querySelectorAll('.swing-preset').forEach(b => b.classList.remove('active'));
}

export function applySwingPreset(val, btn){
  swingAmount = val;
  const slider = document.getElementById('swing-slider');
  if (slider) slider.value = val;
  setSwing(val);
  document.querySelectorAll('.swing-preset').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

/* Swing offset in seconds for a note at subdivision index subIdx.
   spb = seconds per beat. subIdx 0 = on-beat (no offset),
   1 = "and" (offset), etc. Full triplet (amount 100) = spb/6. */
export function swingOffsetSec(spb, subIdx){
  if (swingAmount === 0 || subIdx % 2 === 0) return 0;
  return (swingAmount / 100) * (spb / 6);
}
