"use client";

import { useEffect, useRef } from "react";
import type { ArtifactNote } from "@spp/contracts";

interface PianoRollProps {
  notes: ArtifactNote[];
  positionMs: number;
  playing: boolean;
}

const isBlack = (keyIndex: number) => [1, 4, 6, 9, 11].includes((keyIndex + 9) % 12);

export const PianoRoll = ({ notes, positionMs, playing }: PianoRollProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
      canvas.width = width * ratio;
      canvas.height = height * ratio;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const keyboardHeight = 54;
    const rollHeight = height - keyboardHeight;
    const keyWidth = width / 88;
    const lookAheadMs = 6_000;
    const pixelsPerMs = rollHeight / lookAheadMs;

    context.fillStyle = "#101111";
    context.fillRect(0, 0, width, rollHeight);
    context.strokeStyle = "rgba(255,255,255,.05)";
    for (let key = 0; key <= 88; key += 1) {
      context.beginPath();
      context.moveTo(key * keyWidth, 0);
      context.lineTo(key * keyWidth, rollHeight);
      context.stroke();
    }

    const active = new Set<number>();
    for (const note of notes) {
      const endMs = note.startMs + note.durationMs;
      if (note.startMs <= positionMs && endMs > positionMs) active.add(note.keyIndex);
      if (endMs < positionMs || note.startMs > positionMs + lookAheadMs) continue;
      const x = note.keyIndex * keyWidth + 1;
      const y = rollHeight - (note.startMs - positionMs) * pixelsPerMs;
      const noteHeight = Math.max(3, note.durationMs * pixelsPerMs);
      context.fillStyle = isBlack(note.keyIndex) ? "#78a6ff" : "#efb05d";
      context.fillRect(x, y - noteHeight, Math.max(2, keyWidth - 2), noteHeight);
    }

    context.fillStyle = playing ? "#e8d9c2" : "#d7d3ca";
    context.fillRect(0, rollHeight, width, keyboardHeight);
    for (let key = 0; key < 88; key += 1) {
      const x = key * keyWidth;
      if (active.has(key)) {
        context.fillStyle = "#efb05d";
        context.fillRect(x, rollHeight, keyWidth, keyboardHeight);
      }
      context.strokeStyle = "rgba(16,17,17,.35)";
      context.strokeRect(x, rollHeight, keyWidth, keyboardHeight);
      if (isBlack(key)) {
        context.fillStyle = active.has(key) ? "#78a6ff" : "#1a1b1b";
        context.fillRect(x - keyWidth * 0.35, rollHeight, keyWidth * 0.7, keyboardHeight * 0.62);
      }
    }
  }, [notes, playing, positionMs]);

  return <canvas aria-label="Animated piano roll" className="piano-roll" ref={canvasRef} />;
};
