// One-file preview build: the whole panel as a single self-contained HTML page
// (for the private claude.ai preview link, or to open straight from disk).
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const here = import.meta.dirname;
const projectRoot = path.resolve(here, "..");

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: [
      { find: /^next\/link$/, replacement: path.resolve(here, "shims/next-link.tsx") },
      { find: /^next\/navigation$/, replacement: path.resolve(here, "shims/next-navigation.ts") },
      { find: /^@\/lib\/csv$/, replacement: path.resolve(here, "shims/csv.ts") },
      { find: /^@\//, replacement: `${path.resolve(projectRoot, "src")}/` },
    ],
  },
  build: {
    outDir: path.resolve(projectRoot, "preview-dist"),
    emptyOutDir: true,
  },
  logLevel: "warn",
});
