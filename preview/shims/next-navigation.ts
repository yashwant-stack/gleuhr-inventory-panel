// Stands in for next/navigation in the one-file preview (the hooks the screens use).
import { useMemo, useSyncExternalStore } from "react";
import { getPath, getSearch, navigate, subscribe } from "../router";

export function usePathname(): string {
  return useSyncExternalStore(subscribe, getPath, getPath);
}

export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, getSearch, getSearch);
  return useMemo(() => new URLSearchParams(search), [search]);
}

const router = {
  push: (href: string) => navigate(href),
  replace: (href: string) => navigate(href),
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  refresh: () => undefined,
  prefetch: () => undefined,
};

export function useRouter() {
  return router;
}
