// Entry for the one-file preview build (npm run build:preview). Same screens, same code as the
// Next.js app; only links and page paths go through the small adapter in ./shims.
import "@fontsource/hanken-grotesk/latin-400.css";
import "@fontsource/hanken-grotesk/latin-500.css";
import "@fontsource/hanken-grotesk/latin-600.css";
import "@fontsource/hanken-grotesk/latin-700.css";
import "./styles.css";
import "./preview.css";
import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import AlertsPage from "@/app/alerts/page";
import ChannelsPage from "@/app/channels/page";
import HealthPage from "@/app/health/page";
import IndentPage from "@/app/indent/page";
import HomePage from "@/app/page";
import PlanFormPage from "@/app/plans/form/page";
import PlansPage from "@/app/plans/page";
import ProjectionsPage from "@/app/projections/page";
import ReportsPage from "@/app/reports/page";
import SalesPage from "@/app/sales/page";
import SettingsPage from "@/app/settings/page";
import StockPage from "@/app/stock/page";
import { Shell } from "@/components/Shell";
import { DatasetProvider } from "@/lib/data/hooks";
import type { SnapshotBlob } from "@/lib/snapshot";
import { usePathname } from "./shims/next-navigation";
import { SnapshotGate } from "./snapshot";

const PAGES: Record<string, ComponentType> = {
  "/": HomePage,
  "/sales": SalesPage,
  "/channels": ChannelsPage,
  "/projections": ProjectionsPage,
  "/stock": StockPage,
  "/indent": IndentPage,
  "/plans": PlansPage,
  "/plans/form": PlanFormPage,
  "/reports": ReportsPage,
  "/alerts": AlertsPage,
  "/settings": SettingsPage,
  "/health": HealthPage,
};

function RouteView() {
  const path = usePathname();
  const Page = PAGES[path] ?? HomePage;
  return <Page key={path} />;
}

// The live-snapshot build carries the live data encrypted (see make-artifact.mjs); the plain build shows sample data.
const SNAPSHOT = (window as Window & { __GLEUHR_SNAPSHOT__?: SnapshotBlob }).__GLEUHR_SNAPSHOT__;

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      {SNAPSHOT ? (
        <SnapshotGate blob={SNAPSHOT}>
          {(ds) => (
            <DatasetProvider initial={ds}>
              <Shell>
                <RouteView />
              </Shell>
            </DatasetProvider>
          )}
        </SnapshotGate>
      ) : (
        <DatasetProvider>
          <Shell>
            <RouteView />
          </Shell>
        </DatasetProvider>
      )}
    </StrictMode>,
  );
}
