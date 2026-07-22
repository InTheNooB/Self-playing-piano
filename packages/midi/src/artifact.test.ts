import { describe, expect, it } from "vitest";
import { decodeArtifact, encodeArtifact } from "./artifact.js";

describe("artifact codec", () => {
  it("round-trips the firmware format", () => {
    const encoded = encodeArtifact({
      version: 2,
      profileVersion: 2,
      durationMs: 500,
      notes: [{ startMs: 100, durationMs: 400, keyIndex: 40, velocity: 200, flags: 0, activationLeadMs: 20 }],
    });
    expect(encoded.byteLength).toBe(28);
    expect(decodeArtifact(encoded)).toEqual({
      version: 2,
      profileVersion: 2,
      durationMs: 500,
      notes: [{ startMs: 100, durationMs: 400, keyIndex: 40, velocity: 200, flags: 0, activationLeadMs: 20 }],
    });
  });

  it("rejects a truncated artifact", () => {
    const malformed = new Uint8Array(16);
    malformed.set(new TextEncoder().encode("SPP1"));
    malformed[4] = 2;
    malformed[6] = 12;
    malformed[8] = 1;
    expect(() => decodeArtifact(malformed)).toThrow("record count");
  });
});
