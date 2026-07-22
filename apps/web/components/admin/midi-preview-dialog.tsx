"use client";

import { useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon } from "lucide-react";
import type { ArtifactNote, SongSummary } from "@spp/contracts";
import { fetchArtifactNotes } from "@/lib/artifact";
import { formatDuration } from "@/lib/format";
import { useLocale } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PianoRoll } from "@/components/piano-roll";

interface MidiPreviewDialogProps {
  song: SongSummary | undefined;
  onOpenChange: (open: boolean) => void;
}

/** Animates a local playhead across the decoded notes; never talks to the piano hardware. */
const usePreviewPlayback = (durationMs: number) => {
  const [positionMs, setPositionMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const startedAtRef = useRef(0);
  const startPositionRef = useRef(0);

  useEffect(() => {
    if (!playing) return;
    let animationFrame = 0;
    startedAtRef.current = performance.now();
    startPositionRef.current = positionMs;
    const tick = () => {
      const elapsed = performance.now() - startedAtRef.current;
      const next = startPositionRef.current + elapsed;
      if (next >= durationMs) {
        setPositionMs(durationMs);
        setPlaying(false);
        return;
      }
      setPositionMs(next);
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, durationMs]);

  const toggle = () => {
    if (!playing && positionMs >= durationMs) setPositionMs(0);
    setPlaying((current) => !current);
  };

  /** Jumps the playhead to an arbitrary position, e.g. from dragging the timeline scrubber. */
  const seek = (ms: number) => {
    const clamped = Math.min(Math.max(0, ms), durationMs);
    startedAtRef.current = performance.now();
    startPositionRef.current = clamped;
    setPositionMs(clamped);
  };

  return { positionMs, playing, toggle, seek };
};

/**
 * Keyed by song id at the call site so this component remounts (and resets its playback state)
 * whenever a different song is opened for preview, instead of syncing props via an effect.
 */
export const MidiPreviewDialog = ({ song, onOpenChange }: MidiPreviewDialogProps) => {
  const [notes, setNotes] = useState<ArtifactNote[]>();
  const durationMs = song?.durationMs ?? 0;
  const { positionMs, playing, toggle, seek } = usePreviewPlayback(durationMs);
  const { t } = useLocale();

  useEffect(() => {
    if (!song) return;
    let cancelled = false;
    fetchArtifactNotes(song.id)
      .then((decoded) => {
        if (!cancelled) setNotes(decoded);
      })
      .catch(() => {
        if (!cancelled) setNotes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [song]);

  return (
    <Dialog open={Boolean(song)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{song?.title}</DialogTitle>
          <DialogDescription>{t("preview.description")}</DialogDescription>
        </DialogHeader>
        <div className="h-72 overflow-hidden rounded-lg">
          {notes ? (
            <PianoRoll notes={notes} positionMs={positionMs} playing={playing} />
          ) : (
            <Skeleton className="h-full w-full" />
          )}
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={toggle}
            disabled={!notes}
            aria-label={t(playing ? "preview.pause" : "preview.play")}
          >
            {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
          </Button>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">{formatDuration(positionMs)}</span>
          <Slider
            aria-label={t("preview.seek")}
            value={[positionMs]}
            min={0}
            max={Math.max(durationMs, 1)}
            step={100}
            disabled={!notes}
            onValueChange={([next]) => seek(next ?? 0)}
            className="flex-1"
          />
          <span className="font-mono text-xs text-muted-foreground tabular-nums">{formatDuration(durationMs)}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
};
