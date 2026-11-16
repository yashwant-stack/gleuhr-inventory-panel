import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decryptSnapshot, type SnapshotBlob, WrongKey } from "./snapshot";

describe("the public snapshot's lock", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "snap-"));
  const input = path.join(dir, "ds.json");
  const output = path.join(dir, "blob.json");
  const dataset = { origin: "live", today: "2026-11-16", lastSyncedAt: "2026-11-16T05:29:13Z", products: [{ id: "x", name: "Hair Serum" }], cells: {} };
  fs.writeFileSync(input, JSON.stringify(dataset));
  execFileSync("node", [path.resolve(__dirname, "../../preview/encrypt-snapshot.mjs"), input, output], {
    env: { ...process.env, PANEL_ACCESS_KEY: "gleuhr-test-key-123" },
  });
  const blob = JSON.parse(fs.readFileSync(output, "utf8")) as SnapshotBlob;

  it("hides the data: nothing readable in the published blob", () => {
    const text = fs.readFileSync(output, "utf8");
    expect(text).not.toContain("Hair Serum");
    expect(blob.iter).toBe(600_000);
  });

  it("opens with the right key (the page's decrypt matches the encrypt script)", async () => {
    expect(JSON.parse(await decryptSnapshot(blob, " gleuhr-test-key-123 "))).toEqual(dataset);
  });

  it("refuses any other key", async () => {
    await expect(decryptSnapshot(blob, "gleuhr-test-key-124")).rejects.toBeInstanceOf(WrongKey);
  });
});
