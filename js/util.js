/* ============================================================
   util.js — small, dependency-free helpers used across modules.
   ============================================================ */

/* Escape a string for safe insertion into HTML text/attribute context.
   Used on every piece of model-generated text before it is rendered. */
export function escHtml(s){
  return String(s ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

/* Pull a JSON object out of a model response that may be wrapped in
   markdown fences or surrounded by stray prose. Throws if nothing
   parseable is found, so callers can show a clean error state. */
export function extractJSON(text){
  const cleaned = String(text || '').replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall back to the first balanced-looking { ... } slice.
    const first = cleaned.indexOf('{');
    const last  = cleaned.lastIndexOf('}');
    if (first !== -1 && last > first) {
      return JSON.parse(cleaned.slice(first, last + 1));
    }
    throw new Error('No JSON object found in model response');
  }
}
