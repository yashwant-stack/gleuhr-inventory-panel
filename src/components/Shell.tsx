"use client";

import clsx from "clsx";
import {
  Bell,
  Boxes,
  CalendarCheck,
  ClipboardList,
  FileBarChart,
  HeartPulse,
  LayoutDashboard,
  Lock,
  Megaphone,
  Menu,
  Package,
  RefreshCw,
  Settings,
  ShoppingBag,
  Store,
  TrendingUp,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { IS_SNAPSHOT } from "@/lib/platform";
import { Tooltips } from "./Tooltips";
import { FRESH_FLAG, useDataset, useMetrics, useRole, useSubmissions } from "@/lib/data/hooks";
import { cycleState } from "@/lib/data/plans";
import { CYCLES } from "@/lib/mock/plans";
import { canOpen, inNav, PLAN_PARTS, ROLES, type RoleId } from "@/lib/roles";
import { usePanel } from "@/lib/state/store";
import { ProductDrawer } from "./ProductDrawer";
import { Select } from "./Select";
import { toast } from "./Toast";
import { Button } from "./ui";
import { Toaster } from "./Toast";

const NAV = [
  { href: "/", label: "Home", Icon: LayoutDashboard },
  { href: "/sales", label: "Sales", Icon: ShoppingBag },
  { href: "/channels", label: "Channels", Icon: Store },
  { href: "/projections", label: "Projections", Icon: TrendingUp },
  { href: "/stock", label: "Stock health", Icon: Boxes },
  { href: "/bottles", label: "Bottles", Icon: Package },
  { href: "/indent", label: "Auto indent", Icon: ClipboardList },
  { href: "/marketing-impact", label: "Marketing impact", Icon: Megaphone },
  { href: "/plans", label: "Plans", Icon: CalendarCheck },
  { href: "/reports", label: "Reports", Icon: FileBarChart },
  { href: "/alerts", label: "Alerts", Icon: Bell },
  { href: "/health", label: "Data health", Icon: HeartPulse },
  { href: "/settings", label: "Settings", Icon: Settings },
];

/** "Sync from Zoho now" is hidden for now (21–23 Nov 2026); the 9:00 AM daily sync still runs. Set true to show it. */
const SHOW_SYNC_BUTTON = false;

const SYNC_FMT = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

const noopSubscribe = () => () => {};

function useBadges(): Record<string, number> {
  const ds = useDataset();
  const metrics = useMetrics();
  const subs = useSubmissions();
  return useMemo(() => {
    const urgent = metrics.filter((m) => m.status === "critical" || m.status === "low").length;
    const toOrder = metrics.filter((m) => m.indentQty > 0 && (m.status === "critical" || m.status === "low")).length;
    let pending = 0;
    for (const c of CYCLES) {
      if (cycleState(c, ds.today) !== "open") continue;
      for (const part of PLAN_PARTS) if (!subs[`${c.id}:${part.id}`]) pending++;
    }
    const h = ds.health;
    const issues = h.unmappedClinics.length + h.unreadableLocations.length + h.failedPushes.filter((f) => f.failed > 0).length + ds.channels.filter((c) => !c.connected).length;
    return { "/stock": urgent, "/indent": toOrder, "/plans": pending, "/health": issues };
  }, [metrics, subs, ds]);
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  const role = useRole();
  const badges = useBadges();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 p-2">
      {NAV.filter(({ href }) => inNav(href, role.id)).map(({ href, label, Icon }) => {
        const allowed = canOpen(href, role.access, role.id);
        const active = href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
        if (!allowed) {
          return (
            <span key={href} title={`${role.person} does not have access to ${label}`} className="flex h-9 cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] text-muted/70">
              <Icon size={17} aria-hidden />
              {label}
              <Lock size={12} className="ml-auto" aria-label="No access" />
            </span>
          );
        }
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors",
              active ? "bg-coral-soft text-coral-dark" : "text-ink-2 hover:bg-sunken hover:text-ink",
            )}
          >
            <Icon size={17} aria-hidden />
            {label}
            {badges[href] ? <span className="ml-auto rounded-full bg-confirm-soft px-1.5 text-[11px] font-semibold text-confirm tabular">{badges[href]}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2 px-3 py-3.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-coral text-[15px] font-bold text-white">G</div>
      <div className="leading-tight">
        <div className="text-[14px] font-bold text-ink">Gleuhr</div>
        <div className="text-[11.5px] text-muted">Inventory planning</div>
      </div>
    </div>
  );
}

function RoleSwitch() {
  const role = usePanel((s) => s.role);
  const setRole = usePanel((s) => s.setRole);
  return (
    <Select<RoleId>
      label="Viewing as"
      value={role}
      onChange={setRole}
      width={250}
      options={ROLES.map((r) => ({ value: r.id, label: r.person, hint: r.title }))}
    />
  );
}

function SidebarFoot() {
  const ds = useDataset();
  return (
    <div className="mt-auto border-t border-line p-3 text-[11.5px] leading-snug text-muted">
      {ds.products.length} products · {ds.locations.length} Zoho locations
      <br />
      {ds.origin === "sample" ? "Sample data in Zoho’s shape" : "Stock from Zoho · sales from the CRMs"}
    </div>
  );
}

function DataBadge() {
  const ds = useDataset();
  const at = SYNC_FMT.format(new Date(ds.lastSyncedAt));
  return ds.origin === "sample" ? (
    <>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-st-low-soft px-2.5 py-1 text-[12px] font-semibold text-[#7a4f00]" title="Every number is sample data in the real shape. The backend switches this to live data.">
        <span className="h-1.5 w-1.5 rounded-full bg-st-low" aria-hidden />
        Sample data · not live yet
      </span>
      <span className="hidden text-[12px] text-muted sm:inline">Sample as of {at}</span>
    </>
  ) : (
    <>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-st-healthy-soft px-2.5 py-1 text-[12px] font-semibold text-st-healthy">
        <span className="h-1.5 w-1.5 rounded-full bg-st-healthy" aria-hidden />
        {IS_SNAPSHOT ? "Live data · snapshot" : "Live"}
      </span>
      <span className="hidden text-[12px] text-muted sm:inline">Synced {at}</span>
      {SHOW_SYNC_BUTTON && !IS_SNAPSHOT ? <SyncButton /> : null}
    </>
  );
}

/**
 * "Sync from Zoho now" (decided 20 Nov 2026): the full sync the 9:00 AM schedule runs, by hand. Management and
 * Purchase only; the server refuses a second one within 15 minutes, to protect the Zoho call limit.
 */
function SyncButton() {
  const role = useRole();
  const [busy, setBusy] = useState(false);
  const [part, setPart] = useState(1);
  const allowed = role.id === "management" || role.id === "purchase";
  const run = async () => {
    setBusy(true);
    setPart(1);
    try {
      type Answer = { ok?: boolean; more?: boolean; startedAt?: string; zohoCalls?: number; error?: string };
      const call = async (url: string) => {
        const r = await fetch(url, { method: "POST" });
        return { status: r.status, body: (await r.json().catch(() => ({}))) as Answer };
      };
      let { status, body } = await call("/api/sync");
      if (status !== 200) {
        toast(body.error ?? `The sync did not run (the server answered ${status}).`);
        return;
      }
      // a run that ran out of time is continued: only the locations it did not reach are read (at most 3 more times)
      let calls = body.zohoCalls ?? 0;
      let ok = body.ok ?? false;
      for (let i = 0; body.more && body.startedAt && i < 3; i++) {
        setPart(i + 2);
        ({ status, body } = await call(`/api/sync?continue=${encodeURIComponent(body.startedAt)}`));
        if (status !== 200) {
          ok = false;
          break;
        }
        calls += body.zohoCalls ?? 0;
        ok = ok && (body.ok ?? false);
      }
      toast(`${ok ? "Synced" : "Synced with some problems (see Data health)"} · ${calls} Zoho calls. Loading the new data…`);
      try {
        sessionStorage.setItem(FRESH_FLAG, "1");
      } catch {
        // storage blocked: the page still reloads, with data at most 15 minutes old
      }
      window.setTimeout(() => window.location.reload(), 1200);
    } catch {
      toast("The sync could not be reached. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      size="sm"
      icon={<RefreshCw size={13} className={busy ? "animate-spin" : undefined} aria-hidden />}
      disabled={busy || !allowed}
      disabledReason={busy ? "Syncing: this takes 2–4 minutes. Keep this page open." : "Management and Purchase can start a Zoho sync."}
      onClick={run}
    >
      {busy ? (part > 1 ? `Syncing… part ${part}` : "Syncing…") : "Sync from Zoho now"}
    </Button>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  // The panel's state lives in this browser, so it renders on the client only (server HTML is a loading line).
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const [menu, setMenu] = useState(false);
  const path = usePathname();
  const role = useRole();

  if (!mounted) {
    return <div className="flex min-h-screen items-center justify-center text-[13px] text-muted">Loading the panel…</div>;
  }

  const allowed = canOpen(path, role.access, role.id);
  return (
    <div className="flex min-h-screen">
      <Tooltips />
      <aside className="no-print sticky top-0 hidden h-screen w-[220px] shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <Brand />
        <Nav />
        <SidebarFoot />
      </aside>

      {menu ? (
        <div className="no-print fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal aria-label="Menu">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setMenu(false)} />
          <div className="anim-slide absolute top-0 left-0 h-full w-[250px] bg-surface shadow-xl">
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <button onClick={() => setMenu(false)} aria-label="Close menu" className="rounded-md p-1.5 hover:bg-sunken">
                <X size={18} />
              </button>
            </div>
            <Nav onNavigate={() => setMenu(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-line bg-bone/95 px-4 py-2 backdrop-blur">
          <button onClick={() => setMenu(true)} aria-label="Open menu" className="rounded-md p-1.5 hover:bg-sunken lg:hidden">
            <Menu size={19} />
          </button>
          <DataBadge />
          <div className="ml-auto">
            <RoleSwitch />
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 py-4 sm:px-5 lg:px-6">
          {allowed ? (
            children
          ) : (
            <div className="mx-auto mt-16 max-w-md rounded-xl border border-line bg-surface p-6 text-center">
              <Lock className="mx-auto mb-2 text-muted" aria-hidden />
              <div className="text-[15px] font-semibold">{role.person} can’t open this page</div>
              <p className="mt-1 text-[13px] text-ink-2">Planners see trends, stock health and their own plan. Switch “Viewing as” in the top bar to see it as Management.</p>
              <Link href="/" className="mt-3 inline-block rounded-lg bg-coral px-3 py-1.5 text-[13px] font-medium text-white">
                Go to Home
              </Link>
            </div>
          )}
        </main>
      </div>
      <ProductDrawer />
      <Toaster />
    </div>
  );
}
