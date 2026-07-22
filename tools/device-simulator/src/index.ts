import { readFile, writeFile } from "node:fs/promises";
import mqtt from "mqtt";
import type { CommandAcknowledgement, DesiredCommand, PianoState, ReportedState, SessionOutcome } from "@spp/contracts";
import { completedPosition, guardCommand } from "./command-guard";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

interface PersistedState {
  lastAppliedRevision: number;
  lastHandledRevision: number;
}

const pianoId = required("PIANO_ID");
const mqttUrl = required("MQTT_URL");
const apiBaseUrl = required("API_BASE_URL");
const deviceToken = required("PIANO_DEVICE_TOKEN");
const stateFile = process.env.SIMULATOR_STATE_FILE ?? ".device-simulator-state.json";
const prefix = process.env.MQTT_TOPIC_PREFIX ?? "pianos";
const desiredTopic = `${prefix}/${pianoId}/v1/desired`;
const reportedTopic = `${prefix}/${pianoId}/v1/reported`;
const persisted = await readFile(stateFile, "utf8").then((value) => JSON.parse(value) as PersistedState).catch(() => ({ lastAppliedRevision: 0, lastHandledRevision: 0 }));

let state: PianoState = "idle";
let sessionId: string | undefined;
let songId: string | undefined;
let positionMs = 0;
let durationMs = 0;
let startedAt = Date.now();
let lastAppliedRevision = persisted.lastAppliedRevision;
let lastHandledRevision = persisted.lastHandledRevision;
let acknowledgement: CommandAcknowledgement | undefined;
let sessionOutcome: SessionOutcome | undefined;

const currentPosition = () => state === "playing"
  ? Math.min(durationMs, positionMs + Date.now() - startedAt)
  : positionMs;

const snapshot = (online = true): ReportedState => ({
  pianoId,
  state: online ? state : "offline",
  online,
  ...(sessionId ? { sessionId } : {}),
  ...(songId ? { songId } : {}),
  positionMs: currentPosition(),
  durationMs,
  firmwareVersion: "simulator-2.1.0",
  profileId: "legacy-v1",
  lastAppliedRevision,
  lastHandledRevision,
  ...(acknowledgement ? { acknowledgement } : {}),
  ...(sessionOutcome ? { sessionOutcome } : {}),
  statusDelivery: { state: "healthy", pendingReports: 0 },
  reportedAt: new Date().toISOString(),
});

const persist = () => writeFile(stateFile, JSON.stringify({ lastAppliedRevision, lastHandledRevision } satisfies PersistedState));

const client = mqtt.connect(mqttUrl, {
  clientId: pianoId,
  ...(process.env.MQTT_DEVICE_USERNAME ? { username: process.env.MQTT_DEVICE_USERNAME } : {}),
  ...(process.env.MQTT_DEVICE_PASSWORD ? { password: process.env.MQTT_DEVICE_PASSWORD } : {}),
  will: { topic: reportedTopic, payload: JSON.stringify(snapshot(false)), qos: 1, retain: true },
});

const report = async () => {
  const payload = JSON.stringify(snapshot());
  await client.publishAsync(reportedTopic, payload, { qos: 1, retain: true });
  await fetch(`${apiBaseUrl}/api/device/status`, {
    method: "POST",
    headers: { authorization: `Bearer ${deviceToken}`, "content-type": "application/json" },
    body: payload,
  }).catch(() => undefined);
};

const reject = async (command: DesiredCommand, code: string, message: string) => {
  lastHandledRevision = command.revision;
  acknowledgement = { commandId: command.commandId, revision: command.revision, result: "rejected", error: { code, message } };
  await persist();
  await report();
};

const accept = async (command: DesiredCommand) => {
  lastHandledRevision = command.revision;
  lastAppliedRevision = command.revision;
  acknowledgement = { commandId: command.commandId, revision: command.revision, result: "accepted" };
  await persist();
};

const apply = async (command: DesiredCommand) => {
  const guard = guardCommand(lastHandledRevision, command.revision, command.expiresAtEpochSeconds);
  if (guard === "duplicate") return;
  if (guard === "expired") {
    await reject(command, "command_expired", "The retained command has expired");
    return;
  }
  if (!["play", "stop", "emergency_recover", "restart_controller", "enter_provisioning"].includes(command.type) &&
      command.sessionId !== sessionId) {
    await reject(command, "session_mismatch", "The active session does not match");
    return;
  }

  if (command.type === "play") {
    if (state !== "idle") {
      await reject(command, "piano_busy", "The piano is not idle");
      return;
    }
    await accept(command);
    state = "preparing";
    sessionId = command.sessionId;
    songId = command.songId;
    sessionOutcome = undefined;
    await report();
    const response = await fetch(`${apiBaseUrl}/api/device/sessions/${command.sessionId}/artifact`, { headers: { authorization: `Bearer ${deviceToken}` } });
    if (!response.ok) {
      state = "error";
      sessionOutcome = "failed";
      await report();
      return;
    }
    const artifact = await response.arrayBuffer();
    durationMs = new DataView(artifact).getUint32(12, true);
    positionMs = 0;
    startedAt = Date.now();
    state = "playing";
  } else if (command.type === "pause" && state === "playing") {
    positionMs = currentPosition();
    state = "paused";
    await accept(command);
  } else if (command.type === "resume" && state === "paused") {
    startedAt = Date.now();
    state = "playing";
    await accept(command);
  } else if (command.type === "restart" && (state === "playing" || state === "paused")) {
    positionMs = 0;
    startedAt = Date.now();
    state = "playing";
    await accept(command);
  } else if (command.type === "stop") {
    if (!sessionId) sessionId = command.sessionId;
    positionMs = currentPosition();
    state = "idle";
    sessionOutcome = "stopped";
    await accept(command);
  } else if (command.type === "emergency_recover" || command.type === "restart_controller") {
    sessionId = command.sessionId;
    songId = command.songId;
    positionMs = currentPosition();
    state = "idle";
    sessionOutcome = "stopped";
    await accept(command);
  } else if (command.type === "enter_provisioning" && state === "idle") {
    await accept(command);
    state = "provisioning";
  } else {
    await reject(command, "invalid_state", "The command is not valid in the current state");
    return;
  }
  await report();
};

client.on("connect", async () => {
  await client.subscribeAsync(desiredTopic, { qos: 1 });
  await report();
});
client.on("message", (_topic, payload) => void apply(JSON.parse(payload.toString()) as DesiredCommand));
setInterval(() => {
  if (state === "playing" && currentPosition() >= durationMs) {
    positionMs = completedPosition(durationMs);
    state = "idle";
    sessionOutcome = "completed";
  }
  void report();
}, 1000);
