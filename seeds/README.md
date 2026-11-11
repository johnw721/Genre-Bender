# Seed packs — pre-filled "My chords" tracks

A seed pack is one JSON file that adds pre-filled tracks to **05 → My chords**.
Each track gets its chords plus a meta card: song link, key (with a **use key**
button), BPM, a color chart you can tap to add chords, and a note on where the
progression came from. The song links also go into the clip list, tagged with
key and BPM, so you can pick them in the color map.

## It's idempotent

- Every seeded track has a stable id, `seed_<pack id>_<sid>`. Applying a pack
  again never creates duplicates.
- Same `rev` → nothing changes.
- Higher `rev` → meta is refreshed. Chords are refreshed only if you haven't
  edited them; if you have, your edits are kept and reported as "kept your edits".
- Your own tracks are never touched, and a pack never deletes anything.
- Clip links are merged by URL, so they never duplicate either.

## Three ways to load a pack (any copy of the app)

| How | Where it works |
|---|---|
| **⤓ seed pack** button in My chords → pick the `.pack.json` | any copy built from this repo or later (dev server, Netlify, `dist/genre-bender.html`) |
| **Link** — `npm run seed:link -- https://YOUR-SITE/` (or any base URL) → open it on any device | same; handy for the iPhone |
| **Console snippet** — `npm run seed:snippet` → paste `seeds/*.snippet.js` into devtools on a Genre Bender tab | **any** copy, including old builds without seeds.js (it writes the tracks store directly) |

From devtools on a current build you can also run: `GenreBender.applySeedPack(pack)`.

## Making a new pack (the repeatable part)

1. Copy `rnb-neosoul-guitar.pack.json` and change `id` (lowercase slug), `title`, and `tracks`.
2. For each track give a `sid` (slug, unique inside the pack), a `name`, and `chords`.
   A chord is a name (`"Cmaj9"`) or `{ "name": "Cmaj9", "frets": [null,3,2,4,3,null] }`
   to pin a voicing (low E → high e, `null` = muted).
3. `meta` is optional: `artist, title, link (https), key (e.g. "Eb", "G#m"), bpm,
   bpmNote, keyNote, colorChart[], progression ("chart" | "analysis" | "closest-fit"),
   progressionNote, confidence ("high" | "medium" | "low"), sources[]`.
4. Editing a pack you've already applied? Bump `rev`.
5. Check it: `node build/seed-pack.mjs seeds/<file>.pack.json`. This checks the
   schema and that every chord name parses with the app's chord book.
6. Tests: `npm run verify:seeds` (merge rules + snippet). After `npm run build:single`,
   `npm run verify:seeds:e2e` boots the built file with a seed link twice.
