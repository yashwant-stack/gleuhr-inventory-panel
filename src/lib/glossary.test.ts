import fs from "node:fs";
import path from "node:path";
import { describe as suite, expect, it } from "vitest";
import { describe } from "./glossary";

// Every column header, sortable header and tile label written in the screens has a hover description.
function labels(): string[] {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".tsx")) files.push(p);
    }
  };
  walk(path.resolve(__dirname, ".."));
  const out = new Set<string>();
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8");
    for (const m of s.matchAll(/<th[^>]*>([^<{]+)</g)) out.add(m[1]!.trim());
    for (const m of s.matchAll(/<SortTh\s+label="([^"]+)"/g)) out.add(m[1]!);
    for (const m of s.matchAll(/<StatTile\s+label=\{?[`"]([^`"$]+)/g)) out.add(m[1]!.trim());
  }
  return [...out].filter((l) => l && l !== "#" && !/^\d/.test(l));
}

suite("hover descriptions", () => {
  it("cover every column and tile label in the screens", () => {
    const missing = labels().filter((l) => !describe(l));
    expect(missing).toEqual([]);
  });

  it("match labels with dates or numbers after them", () => {
    expect(describe("Sales · 18 Oct – 16 Nov")).toMatch(/Sales value/);
    expect(describe("Gaps over ±20%")).toMatch(/gap limit/);
    expect(describe("Stock health", "nav")).toMatch(/days of cover/);
    expect(describe("Something unknown")).toBeNull();
  });
});
