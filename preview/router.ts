// A tiny router for the one-file preview. The claude.ai page host only passes plain
// "#name" links (never "#/path" or query strings), so each page gets a plain name and any
// "?cycle=…&part=…" detail is kept in memory while the page is open.

export const ROUTES: { path: string; hash: string }[] = [
  { path: "/", hash: "" },
  { path: "/sales", hash: "sales" },
  { path: "/channels", hash: "channels" },
  { path: "/projections", hash: "projections" },
  { path: "/stock", hash: "stock" },
  { path: "/indent", hash: "indent" },
  { path: "/plans", hash: "plans" },
  { path: "/plans/form", hash: "plan-form" },
  { path: "/reports", hash: "reports" },
  { path: "/alerts", hash: "alerts" },
  { path: "/health", hash: "data-health" },
  // "settings" is reserved by claude.ai, so the Settings page uses another name.
  { path: "/settings", hash: "panel-settings" },
];

export function hashFor(path: string): string {
  return ROUTES.find((r) => r.path === path)?.hash ?? "";
}

function pathForHash(hash: string): string {
  const name = hash.replace(/^#/, "");
  return ROUTES.find((r) => r.hash === name)?.path ?? "/";
}

interface Loc {
  path: string;
  search: string;
}

let current: Loc = { path: typeof window === "undefined" ? "/" : pathForHash(window.location.hash), search: "" };
let expectedHash: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getPath(): string {
  return current.path;
}

export function getSearch(): string {
  return current.search;
}

/** Go to "/plans/form?cycle=…&part=…": the page name goes in the hash, the detail stays in memory. */
export function navigate(href: string): void {
  const [rawPath = "/", search = ""] = href.split("?");
  const path = rawPath || "/";
  current = { path, search };
  const hash = hashFor(path);
  if (window.location.hash.replace(/^#/, "") !== hash) {
    expectedHash = hash;
    window.location.hash = hash;
  }
  emit();
  window.scrollTo(0, 0);
}

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    const name = window.location.hash.replace(/^#/, "");
    if (expectedHash !== null && name === expectedHash) {
      expectedHash = null;
      return;
    }
    expectedHash = null;
    const path = pathForHash(name);
    // Back / forward / a pasted link: keep the in-memory detail only when it is the same page.
    current = { path, search: path === current.path ? current.search : "" };
    emit();
    window.scrollTo(0, 0);
  });
}
