"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mqtt, { type MqttClient } from "mqtt";
import type { ArtifactNote, CommandType, ReportedState, SongSummary } from "@spp/contracts";
import { PianoRoll } from "./piano-roll";
import { visibleSelection } from "@/lib/song-selection";
import { reconcileRealtimeStatus } from "@/lib/realtime-status";
import { uncertainCommandResolved, type UncertainCommand } from "@/lib/recovery-session";

interface RealtimeConfig {
  pianoId: string;
  pianoName: string;
  url: string;
  username?: string;
  password?: string;
  topic: string;
}

const formatDuration = (milliseconds: number) => {
  const seconds = Math.round(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const uncertainDeliveryMessage = "The broker did not confirm delivery. The session remains locked for safety; use Stop to cancel it.";

const decodeNotes = (buffer: ArrayBuffer): ArtifactNote[] => {
  const view = new DataView(buffer);
  if (buffer.byteLength < 16 || new TextDecoder().decode(buffer.slice(0, 4)) !== "SPP1") return [];
  const count = view.getUint32(8, true);
  if (16 + count * 12 !== buffer.byteLength) return [];
  return Array.from({ length: count }, (_, index) => {
    const offset = 16 + index * 12;
    return {
      startMs: view.getUint32(offset, true),
      durationMs: view.getUint32(offset + 4, true),
      keyIndex: view.getUint8(offset + 8),
      velocity: view.getUint8(offset + 9),
      flags: view.getUint8(offset + 10),
    };
  });
};

const initialStatus: ReportedState = {
  pianoId: "",
  state: "offline",
  online: false,
  positionMs: 0,
  durationMs: 0,
  firmwareVersion: "unknown",
  profileId: "legacy-v1",
  lastAppliedRevision: 0,
  lastHandledRevision: 0,
  reportedAt: new Date(0).toISOString(),
};

export const LibraryApp = () => {
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [query, setQuery] = useState("");
  const [selectedSongId, setSelectedSongId] = useState<string>();
  const [notes, setNotes] = useState<ArtifactNote[]>([]);
  const [status, setStatus] = useState<ReportedState>(initialStatus);
  const [realtime, setRealtime] = useState<RealtimeConfig>();
  const [loading, setLoading] = useState(true);
  const [commandPending, setCommandPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [displayPosition, setDisplayPosition] = useState(0);
  const [uncertainCommand, setUncertainCommand] = useState<UncertainCommand>();
  const mqttRef = useRef<MqttClient | null>(null);
  const statusReceivedAtRef = useRef(0);

  const loadLibrary = useCallback(async () => {
    const [songResponse, realtimeResponse] = await Promise.all([fetch(`/api/songs?q=${encodeURIComponent(query)}`), fetch("/api/realtime-config")]);
    if (!songResponse.ok || !realtimeResponse.ok) throw new Error("The library is temporarily unavailable");
    const songPayload = await songResponse.json() as { songs: SongSummary[] };
    const realtimePayload = await realtimeResponse.json() as RealtimeConfig;
    setSongs(songPayload.songs);
    setRealtime(realtimePayload);
    setSelectedSongId((current) => visibleSelection(songPayload.songs, current));
    const statusResponse = await fetch(`/api/pianos/${realtimePayload.pianoId}/status`);
    if (statusResponse.ok) {
      statusReceivedAtRef.current = performance.now();
      setStatus(await statusResponse.json() as ReportedState);
    }
  }, [query]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setLoading(true);
      loadLibrary().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Unable to load library")).finally(() => setLoading(false));
    }, query ? 250 : 0);
    return () => window.clearTimeout(timeout);
  }, [loadLibrary, query]);

  useEffect(() => {
    if (!realtime?.url) return;
    const client = mqtt.connect(realtime.url, {
      ...(realtime.username ? { username: realtime.username } : {}),
      ...(realtime.password ? { password: realtime.password } : {}),
      reconnectPeriod: 1_000,
      connectTimeout: 5_000,
      clean: true,
    });
    mqttRef.current = client;
    client.on("connect", () => client.subscribe(realtime.topic, { qos: 1 }));
    client.on("message", (_topic, payload) => {
      try {
        const reported = JSON.parse(payload.toString()) as ReportedState;
        statusReceivedAtRef.current = performance.now();
        setStatus((current) => reconcileRealtimeStatus(current, reported));
      } catch {
        setMessage("The piano sent an unreadable status update.");
      }
    });
    return () => {
      mqttRef.current = null;
      void client.endAsync();
    };
  }, [realtime]);

  const activeSongId = status.state !== "idle" && status.state !== "offline" ? status.songId : undefined;
  const effectiveSongId = activeSongId ?? selectedSongId;

  useEffect(() => {
    if (!effectiveSongId) return;
    fetch(`/api/songs/${effectiveSongId}/artifact`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Preview unavailable");
        setNotes(decodeNotes(await response.arrayBuffer()));
      })
      .catch(() => setNotes([]));
  }, [effectiveSongId]);

  useEffect(() => {
    let animationFrame = 0;
    const update = () => {
      const elapsed = status.state === "playing" ? performance.now() - statusReceivedAtRef.current : 0;
      setDisplayPosition(Math.min(status.durationMs || Number.MAX_SAFE_INTEGER, status.positionMs + elapsed));
      animationFrame = requestAnimationFrame(update);
    };
    animationFrame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animationFrame);
  }, [status]);

  const selectedSong = useMemo(() => songs.find((song) => song.id === effectiveSongId), [effectiveSongId, songs]);
  const busy = ["preparing", "ready", "playing", "paused", "stopping", "error"].includes(status.state);
  const recoveryResolved = uncertainCommand ? uncertainCommandResolved(uncertainCommand, status) : false;
  const recoverySessionId = recoveryResolved ? undefined : uncertainCommand?.sessionId;
  const visibleMessage = recoveryResolved && message === uncertainDeliveryMessage ? undefined : message;

  const sendCommand = async (type: CommandType) => {
    if (!realtime) return;
    setCommandPending(true);
    setMessage(undefined);
    try {
      const response = await fetch(`/api/pianos/${realtime.pianoId}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, ...(type === "play" ? { songId: selectedSongId } : { sessionId: status.sessionId ?? recoverySessionId }) }),
      });
      const payload = await response.json() as { error?: string; sessionId?: string; revision?: number; delivery?: "confirmed" | "uncertain" };
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "The command was rejected");
      if (payload.delivery === "uncertain" && payload.sessionId && payload.revision !== undefined) {
        setUncertainCommand({ sessionId: payload.sessionId, revision: payload.revision });
        setMessage(uncertainDeliveryMessage);
      } else if (type === "stop") {
        setUncertainCommand(undefined);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Command failed");
    } finally {
      setCommandPending(false);
    }
  };

  return (
    <main className="library-shell">
      <section className="hero-copy">
        <div><p className="eyebrow">The house instrument</p><h1>Pick a piece.<br />The piano takes it from here.</h1></div>
        <div className={`status-pill status-${status.state}`}><span />{status.online ? status.state : "offline"}</div>
      </section>

      <section className="performance-panel">
        <div className="now-playing-copy">
          <div><p className="eyebrow">{busy ? "Now playing" : "Ready when you are"}</p><h2>{busy ? songs.find((song) => song.id === status.songId)?.title ?? selectedSong?.title ?? "Preparing song" : selectedSong?.title ?? "Choose a song"}</h2><p>{selectedSong?.artist ?? "Self-playing piano"}</p></div>
          <div className="time-readout"><span>{formatDuration(displayPosition)}</span><span>{formatDuration(status.durationMs || selectedSong?.durationMs || 0)}</span></div>
        </div>
        <PianoRoll notes={notes} positionMs={displayPosition} playing={status.state === "playing"} />
        <div className="transport">
          {!busy && !recoverySessionId && <button className="play-button" disabled={!selectedSongId || !status.online || commandPending} onClick={() => void sendCommand("play")}>Play</button>}
          {status.state === "playing" && <button onClick={() => void sendCommand("pause")} disabled={commandPending}>Pause</button>}
          {status.state === "paused" && <button onClick={() => void sendCommand("resume")} disabled={commandPending}>Resume</button>}
          {busy && status.state !== "error" && <button onClick={() => void sendCommand("restart")} disabled={commandPending}>Restart</button>}
          {busy && <button onClick={() => void sendCommand("stop")} disabled={commandPending}>Stop</button>}
          {!busy && recoverySessionId && <button onClick={() => void sendCommand("stop")} disabled={commandPending}>Cancel uncertain session</button>}
          {visibleMessage && <p className="inline-message">{visibleMessage}</p>}
        </div>
      </section>

      <section className="library-section">
        <div className="section-heading"><div><p className="eyebrow">Collection</p><h2>Song library</h2></div><input aria-label="Search songs" placeholder="Search title or artist" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <div className="song-list">
          {loading && <p className="empty-state">Opening the music cabinet…</p>}
          {!loading && songs.map((song, index) => (
            <button className={`song-row ${song.id === selectedSongId ? "selected" : ""}`} key={song.id} onClick={() => setSelectedSongId(song.id)}>
              <span className="track-number">{String(index + 1).padStart(2, "0")}</span>
              <span className="song-title"><strong>{song.title}</strong><small>{song.artist ?? "Unknown artist"}</small></span>
              {song.warnings.length > 0 && <span className="warning-count" title={song.warnings.join("\n")}>{song.warnings.length} warning{song.warnings.length === 1 ? "" : "s"}</span>}
              <span>{formatDuration(song.durationMs)}</span>
            </button>
          ))}
          {!loading && songs.length === 0 && <p className="empty-state">No songs found. An admin can upload the first MIDI from the Admin page.</p>}
        </div>
      </section>
    </main>
  );
};
