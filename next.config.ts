import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pdf.js-extract", "canvas"],
  turbopack: {},
};

export default nextConfig;
