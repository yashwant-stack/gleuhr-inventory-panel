// The public live-snapshot page: holds the panel's live data encrypted (src/lib/snapshot.ts) and opens it
// in the browser with the panel's access key. Without the key, the page shows nothing but this prompt.
import { useState, type ReactNode } from "react";
import { decodeDataset, type Dataset, type DatasetWire } from "@/lib/data/model";
import { decryptSnapshot, type SnapshotBlob, WrongKey } from "@/lib/snapshot";
import { setPanelToday, usePanel } from "@/lib/state/store";

export function SnapshotGate({ blob, children }: { blob: SnapshotBlob; children: (ds: Dataset) => ReactNode }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ds, setDs] = useState<Dataset | null>(null);

  async function open(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const data = decodeDataset(JSON.parse(await decryptSnapshot(blob, key)) as DatasetWire);
      setPanelToday(data.today);
      const st = usePanel.getState();
      if (st.preset !== "custom") st.setPreset(st.preset);
      setDs(data);
    } catch (x) {
      setErr(x instanceof WrongKey ? x.message : "This page could not be opened in this browser.");
      setBusy(false);
    }
  }

  if (ds) return <>{children(ds)}</>;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center text-[13px]">
      <div className="text-[15px] font-semibold text-ink">Gleuhr inventory panel</div>
      <form onSubmit={open} className="flex w-full max-w-xs flex-col gap-2">
        <label htmlFor="panel-key" className="text-ink-2">
          This page holds live business data, locked. Enter the panel’s access key to open it.
        </label>
        <input
          id="panel-key"
          type="password"
          autoComplete="current-password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="h-9 rounded-lg border border-line bg-surface px-3 text-[13px] text-ink outline-none focus:border-coral"
        />
        {err ? <div className="text-st-critical">{err}</div> : null}
        <button type="submit" disabled={busy || key.trim().length === 0} className="h-9 rounded-lg bg-coral font-medium text-white disabled:opacity-50">
          {busy ? "Opening…" : "Open the panel"}
        </button>
      </form>
    </div>
  );
}
