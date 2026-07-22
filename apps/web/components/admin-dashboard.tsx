"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIcon, LibraryBigIcon, SearchIcon, UploadCloudIcon } from "lucide-react";
import { toast } from "sonner";
import type { SongSummary } from "@spp/contracts";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { UploadDialog } from "@/components/admin/upload-dialog";
import { EditSongDialog } from "@/components/admin/edit-song-dialog";
import { MidiPreviewDialog } from "@/components/admin/midi-preview-dialog";
import { SongTable } from "@/components/admin/song-table";
import { DiagnosticsPanel } from "@/components/admin/diagnostics-panel";

const SEARCH_DEBOUNCE_MS = 250;

type AdminSection = "library" | "diagnostics";

interface AdminSectionButtonProps {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

const AdminSectionButton = ({ active, icon, label, onClick }: AdminSectionButtonProps) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={onClick}
    className={cn(
      "flex items-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors",
      active ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/10" : "text-muted-foreground hover:text-foreground",
    )}
  >
    {icon}
    {label}
  </button>
);

const AdminSectionSwitcher = ({ section, onChange }: { section: AdminSection; onChange: (section: AdminSection) => void }) => {
  const { t } = useLocale();
  return (
    <div className="inline-flex w-fit items-center gap-1 rounded-lg bg-muted p-1">
      <AdminSectionButton
        active={section === "library"}
        icon={<LibraryBigIcon className="size-4" />}
        label={t("admin.tab.library")}
        onClick={() => onChange("library")}
      />
      <AdminSectionButton
        active={section === "diagnostics"}
        icon={<ActivityIcon className="size-4" />}
        label={t("admin.tab.diagnostics")}
        onClick={() => onChange("diagnostics")}
      />
    </div>
  );
};

export const AdminDashboard = () => {
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SongSummary>();
  const [previewTarget, setPreviewTarget] = useState<SongSummary>();
  const [archiveTarget, setArchiveTarget] = useState<SongSummary>();
  const [reprocessingId, setReprocessingId] = useState<string>();
  const [section, setSection] = useState<AdminSection>("library");
  const { t } = useLocale();

  const refresh = useCallback(
    async (searchTerm: string) => {
      const response = await fetch(`/api/songs?q=${encodeURIComponent(searchTerm)}`);
      if (!response.ok) throw new Error(t("toast.loadLibraryFailed"));
      const payload = (await response.json()) as { songs: SongSummary[] };
      setSongs(payload.songs);
    },
    [t],
  );

  useEffect(() => {
    const timeout = window.setTimeout(
      () => {
        setLoading(true);
        refresh(query)
          .catch(() => toast.error(t("toast.loadLibraryFailed")))
          .finally(() => setLoading(false));
      },
      query ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => window.clearTimeout(timeout);
  }, [refresh, query, t]);

  const reprocessSong = async (song: SongSummary) => {
    setReprocessingId(song.id);
    try {
      const response = await fetch(`/api/admin/songs/${song.id}`, { method: "POST" });
      if (!response.ok) throw new Error(t("toast.reprocessFailed"));
      toast.success(t("toast.reprocessed", { title: song.title }));
      await refresh(query);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.reprocessFailed"));
    } finally {
      setReprocessingId(undefined);
    }
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    try {
      const response = await fetch(`/api/admin/songs/${archiveTarget.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(t("toast.archiveFailed"));
      toast.success(t("toast.archived", { title: archiveTarget.title }));
      await refresh(query);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.archiveFailed"));
    } finally {
      setArchiveTarget(undefined);
    }
  };

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold">{t("admin.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("admin.subtitle")}</p>
        </div>
        <AdminSectionSwitcher section={section} onChange={setSection} />
      </div>

      {section === "library" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative">
              <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label={t("library.searchAria")}
                placeholder={t("admin.searchPlaceholder")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-56 pl-8"
              />
            </div>
            <Button onClick={() => setUploadOpen(true)}>
              <UploadCloudIcon className="size-4" />
              {t("admin.uploadButton")}
            </Button>
          </div>

          <SongTable
            songs={songs}
            loading={loading}
            reprocessingId={reprocessingId}
            onPreview={setPreviewTarget}
            onEdit={setEditTarget}
            onReprocess={(song) => void reprocessSong(song)}
            onRequestArchive={setArchiveTarget}
          />
        </div>
      )}

      {section === "diagnostics" && <DiagnosticsPanel />}

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onUploaded={() => refresh(query)} />
      <EditSongDialog
        key={editTarget?.id}
        song={editTarget}
        onOpenChange={(open) => !open && setEditTarget(undefined)}
        onSaved={() => refresh(query)}
      />
      <MidiPreviewDialog
        key={previewTarget?.id}
        song={previewTarget}
        onOpenChange={(open) => !open && setPreviewTarget(undefined)}
      />

      <AlertDialog open={Boolean(archiveTarget)} onOpenChange={(open) => !open && setArchiveTarget(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.archive.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.archive.description", { title: archiveTarget?.title ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("admin.archive.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmArchive()}>
              {t("admin.archive.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
};
