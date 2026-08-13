/* ============================================================
   store.js — the single source of truth for cross-module state.

   Modules import this object and read/write its properties so that
   selection and generated data stay in sync without relying on
   globals or module load order.
   ============================================================ */
export const store = {
  /* genres chosen in the mixer: [{ name, ratio }] */
  selected: [],
  /* most recent generated guitar tab result (or null) */
  guitarTabData: null,
  /* most recent generated piano chart result (or null) */
  pianoChordData: null,
  /* most recent composed phrase timeline (or null) */
  phraseData: null,
  /* most recent blend creative-direction result (or null) */
  blendData: null,
};

/* Empty the selection in place so imported references stay valid. */
export function clearSelected(){
  store.selected.length = 0;
}
