import {
  ARTIFACT_HEADER_SIZE,
  ARTIFACT_MAGIC,
  ARTIFACT_RECORD_SIZE,
  ARTIFACT_VERSION,
  MAX_ARTIFACT_BYTES,
  type ArtifactDocument,
  type ArtifactNote,
} from "@spp/contracts";

const validateNote = (note: ArtifactNote) => {
  if (!Number.isInteger(note.startMs) || note.startMs < 0) throw new Error("Invalid note start");
  if (!Number.isInteger(note.durationMs) || note.durationMs <= 0) throw new Error("Invalid note duration");
  if (!Number.isInteger(note.keyIndex) || note.keyIndex < 0 || note.keyIndex > 87) throw new Error("Invalid key index");
  if (!Number.isInteger(note.velocity) || note.velocity < 0 || note.velocity > 255) throw new Error("Invalid velocity");
};

export const encodeArtifact = (document: ArtifactDocument): Uint8Array => {
  const byteLength = ARTIFACT_HEADER_SIZE + document.notes.length * ARTIFACT_RECORD_SIZE;
  if (byteLength > MAX_ARTIFACT_BYTES) throw new Error("Processed artifact exceeds 128 KiB");

  const output = new Uint8Array(byteLength);
  const view = new DataView(output.buffer);
  output.set(new TextEncoder().encode(ARTIFACT_MAGIC), 0);
  view.setUint8(4, ARTIFACT_VERSION);
  view.setUint8(5, document.profileVersion);
  view.setUint16(6, ARTIFACT_RECORD_SIZE, true);
  view.setUint32(8, document.notes.length, true);
  view.setUint32(12, document.durationMs, true);

  document.notes.forEach((note, index) => {
    validateNote(note);
    const offset = ARTIFACT_HEADER_SIZE + index * ARTIFACT_RECORD_SIZE;
    view.setUint32(offset, note.startMs, true);
    view.setUint32(offset + 4, note.durationMs, true);
    view.setUint8(offset + 8, note.keyIndex);
    view.setUint8(offset + 9, note.velocity);
    view.setUint8(offset + 10, note.flags);
    view.setUint8(offset + 11, 0);
  });

  return output;
};

export const decodeArtifact = (input: Uint8Array): ArtifactDocument => {
  if (input.byteLength < ARTIFACT_HEADER_SIZE || input.byteLength > MAX_ARTIFACT_BYTES) {
    throw new Error("Invalid artifact size");
  }

  const magic = new TextDecoder().decode(input.subarray(0, 4));
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (magic !== ARTIFACT_MAGIC) throw new Error("Invalid artifact magic");
  if (view.getUint8(4) !== ARTIFACT_VERSION) throw new Error("Unsupported artifact version");
  if (view.getUint16(6, true) !== ARTIFACT_RECORD_SIZE) throw new Error("Unsupported record size");

  const recordCount = view.getUint32(8, true);
  if (ARTIFACT_HEADER_SIZE + recordCount * ARTIFACT_RECORD_SIZE !== input.byteLength) {
    throw new Error("Artifact length does not match record count");
  }

  const notes = Array.from({ length: recordCount }, (_, index): ArtifactNote => {
    const offset = ARTIFACT_HEADER_SIZE + index * ARTIFACT_RECORD_SIZE;
    return {
      startMs: view.getUint32(offset, true),
      durationMs: view.getUint32(offset + 4, true),
      keyIndex: view.getUint8(offset + 8),
      velocity: view.getUint8(offset + 9),
      flags: view.getUint8(offset + 10),
    };
  });
  notes.forEach(validateNote);

  return {
    version: ARTIFACT_VERSION,
    profileVersion: view.getUint8(5),
    durationMs: view.getUint32(12, true),
    notes,
  };
};
