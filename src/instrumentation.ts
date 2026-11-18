// Runs once when the server starts: in live mode, start building the panel data so the first visitor
// does not wait for it (src/server/dataset-cache.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PUBLIC_DATA_SOURCE !== "live") return;
  const [{ panelDb }, { cachedDataset }] = await Promise.all([import("./server/db"), import("./server/dataset-cache")]);
  try {
    cachedDataset(panelDb()).catch(() => {});
  } catch {
    // not set up: the first request says what is missing
  }
}
