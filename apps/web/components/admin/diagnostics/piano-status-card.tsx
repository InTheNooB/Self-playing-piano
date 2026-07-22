import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/hooks/use-locale";
import { formatDateTime, formatDuration } from "@/lib/format";
import { STATE_DOT_CLASS, STATE_LABEL_KEY } from "@/lib/piano-state-display";
import type { DiagnosticsPiano } from "@/lib/diagnostics-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface PianoStatusCardProps {
  piano: DiagnosticsPiano;
}

interface StatusFieldProps {
  label: string;
  children: ReactNode;
}

const StatusField = ({ label, children }: StatusFieldProps) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="text-sm font-medium">{children}</span>
  </div>
);

export const PianoStatusCard = ({ piano }: PianoStatusCardProps) => {
  const { t } = useLocale();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className={cn("size-2.5 rounded-full", STATE_DOT_CLASS[piano.state])} />
          {piano.name} · {t(STATE_LABEL_KEY[piano.state])}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatusField label={t("diagnostics.status.lastSeen")}>
          {piano.lastSeenAt ? formatDateTime(piano.lastSeenAt) : t("diagnostics.status.lastSeenNever")}
        </StatusField>
        <StatusField label={t("diagnostics.status.firmware")}>{piano.firmwareVersion ?? t("diagnostics.status.firmwareUnknown")}</StatusField>
        <StatusField label={t("diagnostics.status.profile")}>{piano.profileId}</StatusField>
        <StatusField label={t("diagnostics.status.position")}>
          {formatDuration(piano.positionMs)} / {formatDuration(piano.durationMs)}
        </StatusField>
        <StatusField label={t("diagnostics.status.revisions")}>
          {t("diagnostics.status.revisionsValue", {
            applied: piano.lastAppliedRevision,
            handled: piano.lastHandledRevision,
            sent: piano.commandRevision,
          })}
        </StatusField>
      </CardContent>
      {piano.errorCode ? (
        <CardContent className="pt-0">
          <div className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <p className="font-medium">{t("diagnostics.status.currentError")}</p>
            <p className="font-mono text-xs opacity-90">{piano.errorCode}</p>
            {piano.errorMessage && piano.errorMessage !== piano.errorCode && <p className="mt-0.5">{piano.errorMessage}</p>}
          </div>
        </CardContent>
      ) : (
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">{t("diagnostics.status.noError")}</p>
        </CardContent>
      )}
    </Card>
  );
};
