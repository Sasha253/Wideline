import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Dev server is reached through Caddy on this host.
  allowedDevOrigins: ["wideline.localhost"],
  serverExternalPackages: ["pg-boss", "pino", "pg"],
};

export default nextConfig;
