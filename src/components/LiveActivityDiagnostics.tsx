import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { liveActivitiesSupported, readLiveActivityDiagnostics } from "../services/liveActivityService";

export function showLiveActivityDiagnostics() {
  return import.meta.env.VITE_ENABLE_LIVE_ACTIVITY_DIAGNOSTICS === "true" && liveActivitiesSupported();
}

export default function LiveActivityDiagnostics() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  return <details className="settings-card settings-card--stack plus-test-diagnostics"
    onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Internal diagnostics · Live Activity</summary>
    {open && <DiagnosticSnapshot key={user?.id} authPresent={Boolean(user?.id)} />}
  </details>;
}

function DiagnosticSnapshot({ authPresent }: { authPresent: boolean }) {
  const [refresh, setRefresh] = useState(0);
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof readLiveActivityDiagnostics>>>();
  const [status, setStatus] = useState("Reading diagnostics…");
  useEffect(() => {
    let current = true;
    void readLiveActivityDiagnostics().then(value => {
      if (current) { setSnapshot(value); setStatus(""); }
    }).catch(() => {
      if (current) { setSnapshot(undefined); setStatus("Could not read diagnostics."); }
    });
    return () => { current = false; };
  }, [refresh]);

  const native = snapshot?.native, registration = snapshot?.registration;
  const fields: [string, string | number | boolean | undefined][] = [
    ["Activity ID", native?.activityId ?? registration?.activityId],
    ["Sleep ID", native?.sleepId ?? registration?.sleepId],
    ["Baby ID", native?.babyId ?? registration?.babyId],
    ["Environment", native?.environment ?? registration?.environment],
    ["Revision", native?.revision ?? registration?.revision],
    ["Created with push token support", native?.requested],
    ["Push token present", native?.tokenPresent],
    ["Last observed token byte length", native?.tokenBytes],
    ["Push token update received", native?.updateReceived],
    ["Native observer active", native?.observerActive],
    ["Native snapshot contains token", native?.snapshotContainsToken],
    ["JS listener installed", snapshot?.listenerInstalled],
    ["JS snapshot read", snapshot?.snapshotStatus],
    ["JS bridge event received", Boolean(registration?.eventReceived)],
    ["Installation ID present", snapshot?.installationPresent],
    ["Installation proof present", snapshot?.proofPresent],
    ["Auth user ID present", authPresent],
    ["Session generation", snapshot?.generation],
    ["Stale callback fenced", Boolean(registration?.staleFenced)],
    ["Duplicate skipped", Boolean(registration?.dedupeSkipped)],
    ["Registration RPC attempted", Boolean(registration?.lastAttempt)],
    ["RPC result", registration?.result],
    ["RPC error code", registration?.errorCode],
    ["RPC error message", registration?.errorMessage],
    ["Already ended", registration?.result === "already_ended"],
    ["Last attempt (UTC)", registration?.lastAttempt],
    ["Last success (UTC)", registration?.lastSuccess],
    ["Retry pending on recovery", Boolean(registration?.retryPending)],
  ];
  return <div lang="en">
    <button type="button" className="secondary-button" onClick={() => {
      setStatus("Reading diagnostics…");
      setRefresh(value => value + 1);
    }}>Refresh diagnostics</button>
    <p role="status">{status || (native === null ? "Native diagnostics unavailable."
      : !native?.activityId && !registration ? "No Live Activity observed yet." : "")}</p>
    {snapshot && <dl className="live-activity-diagnostic-values">
      {fields.map(([label, value]) =>
        <div key={label}><dt>{label}</dt><dd>{typeof value === "boolean" ? (value ? "Yes" : "No") : value ?? "Unknown"}</dd></div>)}
    </dl>}
  </div>;
}
