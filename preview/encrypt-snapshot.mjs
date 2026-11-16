// Encrypts a live dataset (the JSON /api/dataset returns) for the public snapshot page.
//   PANEL_ACCESS_KEY=… node preview/encrypt-snapshot.mjs <dataset.json> <out.json>
// Same parameters as src/lib/snapshot.ts (which opens it in the browser). The output holds no readable data;
// keep it out of git all the same (.data/ is ignored).
import fs from "node:fs";
import { webcrypto as crypto } from "node:crypto";
import zlib from "node:zlib";

const [inFile, outFile] = process.argv.slice(2);
const key = (process.env.PANEL_ACCESS_KEY ?? "").trim();
if (!inFile || !outFile) throw new Error("usage: node preview/encrypt-snapshot.mjs <dataset.json> <out.json>");
if (key.length < 12) throw new Error("PANEL_ACCESS_KEY must be set (12+ characters)");

const json = fs.readFileSync(inFile);
const parsed = JSON.parse(json.toString("utf8"));
if (parsed.origin !== "live" || !Array.isArray(parsed.products)) throw new Error("not a live dataset");

const b64 = (u8) => Buffer.from(u8).toString("base64");
const iter = 600_000;
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), "PBKDF2", false, ["deriveKey"]);
const aes = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, zlib.gzipSync(json, { level: 9 })));
fs.writeFileSync(outFile, JSON.stringify({ v: 1, iter, salt: b64(salt), iv: b64(iv), data: b64(data) }));
console.log(`snapshot: ${parsed.products.length} products, synced ${parsed.lastSyncedAt}, ${Math.round(data.length / 1024)} KB encrypted`);
