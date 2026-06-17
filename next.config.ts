import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hosts allowed to load dev-server resources (HMR, fonts) cross-origin —
  // e.g. opening the dev server from another device on the LAN.
  allowedDevOrigins: ["172.20.20.20"],
};

export default nextConfig;
