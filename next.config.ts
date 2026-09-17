import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hosts allowed to load dev-server resources (HMR, fonts) cross-origin —
  // e.g. opening the dev server from another device on the LAN.
  allowedDevOrigins: ["172.20.20.20"],
  // [B19-D I5c row 02] images may come only from Sirkit itself, data: and blob: URLs — never a remote host a reply or an
  // imported project names. Only the image directive is set; every other resource type keeps its current behaviour.
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: "img-src 'self' data: blob:" }] }];
  },
};

export default nextConfig;
