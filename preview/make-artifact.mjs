// Turns the built page into the two files we publish / open:
//  - gleuhr-inventory-panel.html : the page body for the claude.ai host (it adds its own
//    <!doctype>, <head> and <body>), with <title> first so the host finds it.
//  - gleuhr-inventory-panel-local.html : the same page as a complete document, to open from disk.
import fs from "node:fs";
import path from "node:path";

const dist = path.resolve(import.meta.dirname, "..", "preview-dist");
const built = fs.readFileSync(path.join(dist, "index.html"), "utf8");

const head = built.match(/<head>([\s\S]*?)<\/head>/)?.[1];
const body = built.match(/<body>([\s\S]*?)<\/body>/)?.[1];
if (!head || !body) throw new Error("built index.html has no <head> or <body>");

// Drop the charset meta (the host's skeleton has its own); keep title, the preview flag, styles and scripts in order.
const headInner = head.replace(/<meta charset="utf-8"\s*\/?>/i, "").trim();
if (!headInner.startsWith("<title>")) throw new Error("expected <title> first in <head>");
const fragment = `${headInner}\n${body.trim()}\n`;

const skeleton = (inner) =>
  `<!doctype html>\n<html lang="en-IN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>\n</head>\n<body>\n${inner}</body>\n</html>\n`;

const kb = (n) => `${Math.round(n / 1024)} KB`;
fs.writeFileSync(path.join(dist, "gleuhr-inventory-panel.html"), fragment);
fs.writeFileSync(path.join(dist, "gleuhr-inventory-panel-local.html"), skeleton(fragment));
console.log(`preview page: ${kb(Buffer.byteLength(fragment))} (limit 16 MB)`);

// The live-snapshot page (SNAPSHOT_FILE = the encrypted blob from encrypt-snapshot.mjs): the same page with the
// live data inside, locked by the access key, under its own title.
if (process.env.SNAPSHOT_FILE) {
  const blob = JSON.parse(fs.readFileSync(process.env.SNAPSHOT_FILE, "utf8"));
  if (blob.v !== 1 || !blob.data || !blob.salt || !blob.iv) throw new Error("SNAPSHOT_FILE is not an encrypted snapshot");
  const live = fragment
    .replace(/^<title>[^<]*<\/title>/, `<title>Gleuhr Inventory Live</title>\n<script>window.__GLEUHR_SNAPSHOT__=${JSON.stringify(blob)};</script>`);
  if (!live.includes("__GLEUHR_SNAPSHOT__")) throw new Error("could not place the snapshot");
  fs.writeFileSync(path.join(dist, "gleuhr-inventory-panel-live.html"), live);
  fs.writeFileSync(path.join(dist, "gleuhr-inventory-panel-live-local.html"), skeleton(live));
  console.log(`live snapshot page: ${kb(Buffer.byteLength(live))} (limit 16 MB)`);
}
