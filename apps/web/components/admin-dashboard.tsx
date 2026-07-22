"use client";

import { useEffect, useState } from "react";
import type { SongSummary } from "@spp/contracts";

interface UploadResult { file: string; state: "waiting" | "uploading" | "complete" | "error"; message?: string }

export const AdminDashboard = () => {
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [uploads, setUploads] = useState<UploadResult[]>([]);

  const refresh = () => fetch("/api/songs").then((response) => response.json()).then((payload: { songs: SongSummary[] }) => setSongs(payload.songs));
  useEffect(() => { void refresh(); }, []);

  const uploadFiles = async (files: FileList | null) => {
    if (!files) return;
    const selected = Array.from(files);
    setUploads(selected.map((file) => ({ file: file.name, state: "waiting" })));
    for (const file of selected) {
      setUploads((current) => current.map((item) => item.file === file.name ? { ...item, state: "uploading" } : item));
      const formData = new FormData();
      formData.set("file", file);
      try {
        const response = await fetch("/api/admin/songs", { method: "POST", body: formData });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Upload failed");
        setUploads((current) => current.map((item) => item.file === file.name ? { ...item, state: "complete" } : item));
      } catch (error) {
        setUploads((current) => current.map((item) => item.file === file.name ? { ...item, state: "error", message: error instanceof Error ? error.message : "Upload failed" } : item));
      }
    }
    await refresh();
  };

  const deleteSong = async (id: string) => {
    if (!window.confirm("Delete this song and its stored files?")) return;
    const response = await fetch(`/api/admin/songs/${id}`, { method: "DELETE" });
    if (response.ok) await refresh();
  };

  const editSong = async (song: SongSummary) => {
    const title = window.prompt("Song title", song.title)?.trim();
    if (!title) return;
    const artist = window.prompt("Artist (optional)", song.artist ?? "")?.trim() ?? "";
    const response = await fetch(`/api/admin/songs/${song.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, artist: artist || null }) });
    if (response.ok) await refresh();
  };

  const reprocessSong = async (id: string) => {
    const response = await fetch(`/api/admin/songs/${id}`, { method: "POST" });
    if (response.ok) await refresh();
  };

  return (
    <main className="admin-shell">
      <section className="admin-heading"><div><p className="eyebrow">Administration</p><h1>Music cabinet</h1><p>Upload MIDI files individually or as a batch. Every piece is checked against the current piano profile.</p></div><label className="upload-button">Add MIDI files<input type="file" accept=".mid,.midi,audio/midi,audio/x-midi" multiple onChange={(event) => void uploadFiles(event.target.files)} /></label></section>
      {uploads.length > 0 && <section className="upload-queue">{uploads.map((upload) => <div key={upload.file}><strong>{upload.file}</strong><span className={`upload-${upload.state}`}>{upload.message ?? upload.state}</span></div>)}</section>}
      <section className="admin-list">
        {songs.map((song) => <article key={song.id}><div><h2>{song.title}</h2><p>{song.noteCount} notes · {Math.round(song.durationMs / 1000)} seconds</p>{song.warnings.map((warning) => <small key={warning}>{warning}</small>)}</div><div className="admin-actions"><button onClick={() => void editSong(song)}>Edit</button><button onClick={() => void reprocessSong(song.id)}>Reprocess</button><button className="danger-button" onClick={() => void deleteSong(song.id)}>Delete</button></div></article>)}
        {songs.length === 0 && <p className="empty-state">No songs have been uploaded yet.</p>}
      </section>
    </main>
  );
};
