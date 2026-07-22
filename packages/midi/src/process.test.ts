import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Midi } from "@tonejs/midi";
import { processMidi } from "./process.js";

const fixturesDirectory = resolve(import.meta.dirname, "../../../firmware/esp32/midi_files");

const maximumPolyphony = (notes: ReturnType<typeof processMidi>["notes"]) => {
  const events = notes.flatMap((note) => [[note.startMs, 1] as const, [note.startMs + note.durationMs, -1] as const]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0;
  return events.reduce((maximum, event) => {
    active += event[1];
    return Math.max(maximum, active);
  }, 0);
};

describe("MIDI processing", () => {
  it("processes every committed library fixture deterministically", () => {
    const fixtures = readdirSync(fixturesDirectory).filter((name) => /\.midi?$/i.test(name));
    expect(fixtures.length).toBeGreaterThanOrEqual(11);
    for (const fixture of fixtures) {
      const source = readFileSync(resolve(fixturesDirectory, fixture));
      const first = processMidi(source);
      const second = processMidi(source);
      expect(first.sha256, fixture).toBe(second.sha256);
      expect(first.noteCount, fixture).toBeGreaterThan(0);
      expect(maximumPolyphony(first.notes), fixture).toBeLessThanOrEqual(10);
      expect(first.artifact.byteLength, fixture).toBeLessThanOrEqual(128 * 1024);
    }
  });

  it("warns about the currently unmapped top key", () => {
    const source = readFileSync(resolve(fixturesDirectory, "piano_88_notes_1s_each.mid"));
    const result = processMidi(source);
    expect(result.noteCount).toBe(87);
    expect(result.warnings).toContain("1 note(s) target currently unmapped piano keys and were ignored.");
  });

  it("reduces dense source files to ten notes", () => {
    const dense = new Midi();
    const track = dense.addTrack();
    for (let index = 0; index < 12; index += 1) {
      track.addNote({ midi: 40 + index, time: 0, duration: 1, velocity: (index + 1) / 12 });
    }
    const result = processMidi(dense.toArray());
    expect(maximumPolyphony(result.notes)).toBeLessThanOrEqual(10);
    expect(result.warnings.some((warning) => warning.includes("polyphony"))).toBe(true);
  });
});
