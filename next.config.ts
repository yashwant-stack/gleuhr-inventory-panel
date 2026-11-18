import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Server-only database drivers load their own files (PGlite's WebAssembly): keep them out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  // The embedded panel database applies this migration on first use.
  outputFileTracingIncludes: { "/api/**": ["./supabase/migrations/*.sql"] },
};

export default nextConfig;
