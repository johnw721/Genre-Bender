/* ============================================================
   midi.js — export a generated tab/chart as a Standard MIDI File.

   Pure JS (no deps): writes a type-1 SMF with a tempo track and a
   single note track, downloading it at the current master BPM.
   ============================================================ */
import { noteToMidi } from './theory.js';
import { getBPM } from './metronome.js';
import { store } from './store.js';
import { eventActive } from './phraselayers.js';

export function exportMidi(instrument){
  const data = instrument === 'guitar' ? store.guitarTabData : store.pianoChordData;
  if (!data || !data.chords || !data.chords.length) return;

  const bpm = getBPM(), tpb = 480;
  const uspb = Math.round(60000000 / bpm);

  const vlq = (n) => { const b = []; b.push(n & 0x7F); n >>= 7; while (n > 0){ b.unshift((n & 0x7F) | 0x80); n >>= 7; } return b; };
  const u32 = (n) => [(n >> 24) & 0xFF, (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF];
  const u16 = (n) => [(n >> 8) & 0xFF, n & 0xFF];

  const tempoTrk = [...vlq(0), 0xFF, 0x51, 0x03, (uspb >> 16) & 0xFF, (uspb >> 8) & 0xFF, uspb & 0xFF, ...vlq(0), 0xFF, 0x2F, 0x00];

  const noteTrk = [];
  const ch = 0, vel = 80;
  data.chords.forEach(c => {
    const dur = (c.duration_beats || 4) * tpb;
    let midis;
    if (instrument === 'piano'){
      midis = [...(c.left || '').split(/\s+/), ...(c.right || '').split(/\s+/)].filter(Boolean).map(noteToMidi).filter(n => n !== null);
    } else {
      midis = (c.notes || '').split(/\s+/).filter(Boolean).map(noteToMidi).filter(n => n !== null);
    }
    if (!midis.length) return;
    midis.forEach(m => { noteTrk.push(...vlq(0), 0x90 | ch, m & 0x7F, vel); });
    midis.forEach((m, i) => { noteTrk.push(...vlq(i === 0 ? dur : 0), 0x80 | ch, m & 0x7F, 0); });
  });
  noteTrk.push(...vlq(0), 0xFF, 0x2F, 0x00);

  const track = (evts) => [0x4D, 0x54, 0x72, 0x6B, ...u32(evts.length), ...evts];
  const bytes = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, ...u16(2), ...u16(tpb), ...track(tempoTrk), ...track(noteTrk)];

  const blob = new Blob([new Uint8Array(bytes)], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(data.title || instrument).replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${bpm}bpm.mid`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ============================================================
   exportPhraseMidi — export a composer phrase timeline (chords +
   lead line with techniques) as a type-1 SMF. Lead techniques are
   flattened to discrete notes (slide/hammer/pull/bend land on their
   target pitch); the audio engine handles the expressive playback.
   ============================================================ */
export function exportPhraseMidi(timeline){
  if (!timeline || !timeline.bars || !timeline.bars.length) return;
  const bpm = getBPM(), tpb = 480;
  const uspb = Math.round(60000000 / bpm);
  const beats = (b) => Math.round(b * tpb);

  const vlq = (n) => { const b = []; b.push(n & 0x7F); n >>= 7; while (n > 0){ b.unshift((n & 0x7F) | 0x80); n >>= 7; } return b; };
  const u32 = (n) => [(n >> 24) & 0xFF, (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF];
  const u16 = (n) => [(n >> 8) & 0xFF, n & 0xFF];

  const tempoTrk = [...vlq(0), 0xFF, 0x51, 0x03, (uspb >> 16) & 0xFF, (uspb >> 8) & 0xFF, uspb & 0xFF, ...vlq(0), 0xFF, 0x2F, 0x00];

  // Flatten to absolute-tick note on/off pairs, then sort into a delta stream.
  const notes = []; // { on, off, midi, vel }
  const barTicks = 4 * tpb; // 4/4
  timeline.bars.forEach((bar, bi) => {
    const base = bi * barTicks;
    const layer = bar.layer || 'both';
    bar.events.forEach(ev => {
      if (!eventActive(ev, layer)) return;   // export only the bar's active layer(s)
      if (ev.type === 'chord'){
        (ev.midis || []).forEach(m => notes.push({ on: base, off: base + beats(ev.beats || 4), midi: m, vel: 70 }));
      } else if (ev.type === 'note'){
        const start = base + beats(ev.at || 0);
        const m = (ev.to && (ev.technique === 'hammer' || ev.technique === 'pull' || ev.technique === 'slide')) ? ev.to.midi : ev.midi;
        notes.push({ on: start, off: start + beats(ev.beats || 0.5), midi: m, vel: 90 });
      }
    });
  });

  const evts = [];
  notes.forEach(n => { evts.push({ t: n.on, on: true, midi: n.midi, vel: n.vel }); evts.push({ t: n.off, on: false, midi: n.midi, vel: 0 }); });
  evts.sort((a, b) => a.t - b.t || (a.on === b.on ? 0 : a.on ? 1 : -1));

  const trk = []; let last = 0; const ch = 0;
  evts.forEach(e => {
    trk.push(...vlq(e.t - last));
    trk.push((e.on ? 0x90 : 0x80) | ch, e.midi & 0x7F, e.vel);
    last = e.t;
  });
  trk.push(...vlq(0), 0xFF, 0x2F, 0x00);

  const track = (e) => [0x4D, 0x54, 0x72, 0x6B, ...u32(e.length), ...e];
  const bytes = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, ...u16(2), ...u16(tpb), ...track(tempoTrk), ...track(trk)];
  const blob = new Blob([new Uint8Array(bytes)], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `phrase-${(timeline.key || 'key')}-${bpm}bpm.mid`.replace(/[^a-z0-9.\-]/gi, '-');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
