"use client";

import { useState } from "react";

/** What the panel shows before live data is in hand: loading, a failure with a retry, or the access key form. */
export function LoadScreen({ state, message, onRetry }: { state: "loading" | "error" | "locked"; message?: string; onRetry: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/unlock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }) });
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      onRetry();
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center text-[13px]">
      <div className="text-[15px] font-semibold text-ink">Gleuhr inventory panel</div>
      {state === "loading" ? <div className="text-muted">Loading stock from Zoho and sales from the CRMs…</div> : null}
      {state === "error" ? (
        <>
          <div className="font-medium text-ink">Couldn’t load the panel’s data</div>
          <div className="max-w-md text-ink-2">{(message ?? "").slice(0, 300)}</div>
          <button type="button" className="rounded-lg bg-coral px-3 py-1.5 font-medium text-white" onClick={onRetry}>
            Try again
          </button>
        </>
      ) : null}
      {state === "locked" ? (
        <form onSubmit={unlock} className="flex w-full max-w-xs flex-col gap-2">
          <label htmlFor="panel-key" className="text-ink-2">
            This panel shows live business data. Enter the panel’s access key.
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
            {busy ? "Checking…" : "Open the panel"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
