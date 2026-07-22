"use client";

import { AudioLinesIcon, MusicIcon, TriangleAlertIcon } from "lucide-react";
import type { SongSummary } from "@spp/contracts";
import { formatDuration } from "@/lib/format";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface SongCardProps {
  song: SongSummary;
  isSelected: boolean;
  isNowPlaying: boolean;
  onSelect: () => void;
}

export const SongCard = ({ song, isSelected, isNowPlaying, onSelect }: SongCardProps) => {
  const { t } = useLocale();

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full min-w-0 cursor-pointer flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors",
        "hover:bg-muted/60",
        isSelected && "border-primary/60 bg-muted ring-1 ring-primary/30",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground",
            isNowPlaying && "bg-primary/15 text-primary",
          )}
        >
          {isNowPlaying ? <AudioLinesIcon className="size-4.5" /> : <MusicIcon className="size-4.5" />}
        </span>
        {song.warnings.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1 text-xs text-warning">
                <TriangleAlertIcon className="size-3.5" />
                {song.warnings.length}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <ul className="list-disc pl-3">
                {song.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{song.title}</p>
        <p className="truncate text-xs text-muted-foreground">{song.artist ?? t("library.unknownArtist")}</p>
      </div>
      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground tabular-nums">
        <span>{t("library.notes", { count: song.noteCount })}</span>
        <span aria-hidden>·</span>
        <span>{formatDuration(song.durationMs)}</span>
      </div>
    </button>
  );
};
