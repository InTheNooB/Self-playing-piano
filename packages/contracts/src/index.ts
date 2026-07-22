export const PIANO_MIDI_START = 21;
export const PIANO_KEY_COUNT = 88;
export const ARTIFACT_MAGIC = "SPP1";
export const ARTIFACT_VERSION = 1;
export const ARTIFACT_HEADER_SIZE = 16;
export const ARTIFACT_RECORD_SIZE = 12;
export const MAX_ARTIFACT_BYTES = 128 * 1024;

export const pianoStates = [
  "booting",
  "provisioning",
  "connecting",
  "idle",
  "preparing",
  "ready",
  "playing",
  "paused",
  "stopping",
  "error",
  "offline",
] as const;

export type PianoState = (typeof pianoStates)[number];

export const commandTypes = [
  "play",
  "pause",
  "resume",
  "restart",
  "stop",
  "emergency_recover",
  "restart_controller",
  "enter_provisioning",
] as const;
export type CommandType = (typeof commandTypes)[number];

export interface PianoProfile {
  id: string;
  version: number;
  name: string;
  midiStart: number;
  keyCount: number;
  maxPolyphony: number;
  retriggerGapMs: number;
  keyMap: readonly number[];
}

export const LEGACY_V1_KEY_MAP: readonly number[] = Object.freeze([
  ...Array.from({ length: 73 }, (_, index) => index + 8),
  ...Array.from({ length: 14 }, (_, index) => index + 82),
  -1,
]);

export const LEGACY_V1_PROFILE: PianoProfile = {
  id: "legacy-v1",
  version: 1,
  name: "Legacy six-board wiring",
  midiStart: PIANO_MIDI_START,
  keyCount: PIANO_KEY_COUNT,
  maxPolyphony: 10,
  retriggerGapMs: 100,
  keyMap: LEGACY_V1_KEY_MAP,
};

export interface ArtifactNote {
  startMs: number;
  durationMs: number;
  keyIndex: number;
  velocity: number;
  flags: number;
}

export interface ArtifactDocument {
  version: number;
  profileVersion: number;
  durationMs: number;
  notes: ArtifactNote[];
}

export interface DesiredCommand {
  commandId: string;
  revision: number;
  sessionId: string;
  type: CommandType;
  pianoId: string;
  songId?: string;
  artifactId?: string;
  artifactSha256?: string;
  artifactBytes?: number;
  expiresAt: string;
  expiresAtEpochSeconds: number;
}

export interface ReportedError {
  code: string;
  message: string;
}

export const commandResults = ["accepted", "rejected"] as const;
export type CommandResult = (typeof commandResults)[number];

export const sessionOutcomes = ["completed", "stopped", "failed"] as const;
export type SessionOutcome = (typeof sessionOutcomes)[number];

export interface CommandAcknowledgement {
  commandId: string;
  revision: number;
  result: CommandResult;
  error?: ReportedError;
}

export interface ReportedState {
  pianoId: string;
  state: PianoState;
  online: boolean;
  sessionId?: string;
  songId?: string;
  positionMs: number;
  durationMs: number;
  firmwareVersion: string;
  profileId: string;
  lastAppliedRevision: number;
  lastHandledRevision: number;
  acknowledgement?: CommandAcknowledgement;
  sessionOutcome?: SessionOutcome;
  reportedAt: string;
  error?: ReportedError;
  statusDelivery?: {
    state: "healthy" | "retrying" | "backpressure";
    pendingReports: number;
  };
}

export interface SongSummary {
  id: string;
  title: string;
  artist: string | null;
  durationMs: number;
  noteCount: number;
  warnings: string[];
  status: "processing" | "ready" | "invalid";
  createdAt: string;
}
