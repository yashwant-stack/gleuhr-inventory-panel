import "server-only";
// The built panel data, kept in this server's memory: it only changes when a sync runs, and building it
// takes many database round trips (through the gateway, ~25 s). Rebuilt right after each sync, and at
// the latest after 15 minutes, so a sync made by another server instance still shows up.
import { encodeDataset, type DatasetWire } from "../lib/data/model";
import { buildDataset } from "./dataset";
import type { Db } from "./db";

const MAX_AGE_MS = 15 * 60_000;
// kept on globalThis: Next.js loads the start-up hook and the routes as separate module copies in one process
const g = globalThis as unknown as { __panelDataset?: { at: number; wire: Promise<DatasetWire> } | null };

export function cachedDataset(db: Db, now = Date.now()): Promise<DatasetWire> {
  const cached = g.__panelDataset;
  if (cached && now - cached.at < MAX_AGE_MS) return cached.wire;
  const wire = buildDataset(db).then(encodeDataset);
  g.__panelDataset = { at: now, wire };
  // a failed build is not kept: the next request tries again
  wire.catch(() => {
    if (g.__panelDataset?.wire === wire) g.__panelDataset = null;
  });
  return wire;
}

/** After a sync: forget the old data and start building the new one, so the next visitor gets it at once. */
export function refreshDataset(db: Db): void {
  g.__panelDataset = null;
  cachedDataset(db).catch(() => {});
}
