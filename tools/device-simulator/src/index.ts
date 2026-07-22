import mqtt from "mqtt";
import type { DesiredCommand, PianoState, ReportedState } from "@spp/contracts";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const pianoId = required("PIANO_ID");
const mqttUrl = required("MQTT_URL");
const apiBaseUrl = required("API_BASE_URL");
const deviceToken = required("PIANO_DEVICE_TOKEN");
const prefix = process.env.MQTT_TOPIC_PREFIX ?? "pianos";
const desiredTopic = `${prefix}/${pianoId}/v1/desired`;
const reportedTopic = `${prefix}/${pianoId}/v1/reported`;
let state: PianoState = "idle";
let sessionId: string | undefined;
let songId: string | undefined;
let positionMs = 0;
let durationMs = 0;
let startedAt = Date.now();
let lastAppliedRevision = 0;
let lastCommandId: string | undefined;

const snapshot = (online = true): ReportedState => ({
  pianoId,
  state: online ? state : "offline",
  online,
  ...(sessionId ? { sessionId } : {}),
  ...(songId ? { songId } : {}),
  positionMs: state === "playing" ? Math.min(durationMs, positionMs + Date.now() - startedAt) : positionMs,
  durationMs,
  firmwareVersion: "simulator-1.0.0",
  profileId: "legacy-v1",
  lastAppliedRevision,
  ...(lastCommandId ? { lastCommandId } : {}),
  reportedAt: new Date().toISOString(),
});

const client = mqtt.connect(mqttUrl, {
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

const apply = async (command: DesiredCommand) => {
  if (command.revision <= lastAppliedRevision) return;
  if (command.type !== "play" && command.type !== "enter_provisioning" && command.sessionId !== sessionId) return;
  lastAppliedRevision = command.revision;
  lastCommandId = command.commandId;

  if (command.type === "play") {
    state = "preparing";
    sessionId = command.sessionId;
    songId = command.songId;
    await report();
    const response = await fetch(`${apiBaseUrl}/api/device/sessions/${command.sessionId}/artifact`, { headers: { authorization: `Bearer ${deviceToken}` } });
    if (!response.ok) { state = "error"; await report(); return; }
    const artifact = await response.arrayBuffer();
    durationMs = new DataView(artifact).getUint32(12, true);
    positionMs = 0;
    startedAt = Date.now();
    state = "playing";
  } else if (command.type === "pause" && state === "playing") {
    positionMs = snapshot().positionMs;
    state = "paused";
  } else if (command.type === "resume" && state === "paused") {
    startedAt = Date.now();
    state = "playing";
  } else if (command.type === "restart") {
    positionMs = 0;
    startedAt = Date.now();
    state = "playing";
  } else if (command.type === "stop") {
    positionMs = snapshot().positionMs;
    state = "idle";
  }
  await report();
};

client.on("connect", async () => {
  await client.subscribeAsync(desiredTopic, { qos: 1 });
  await report();
});
client.on("message", (_topic, payload) => void apply(JSON.parse(payload.toString()) as DesiredCommand));
setInterval(() => {
  if (state === "playing" && snapshot().positionMs >= durationMs) state = "idle";
  void report();
}, 1000);
