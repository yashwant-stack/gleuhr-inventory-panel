import type { Metadata } from "next";
import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import "@fontsource/hanken-grotesk/700.css";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { DatasetProvider } from "@/lib/data/hooks";

export const metadata: Metadata = {
  title: "Gleuhr · Inventory Planning",
  description: "Sales, stock, projections, auto indent and the marketing & sales plan cycle — read from Zoho Inventory.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <DatasetProvider>
          <Shell>{children}</Shell>
        </DatasetProvider>
      </body>
    </html>
  );
}
