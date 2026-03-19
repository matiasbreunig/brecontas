import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf.js-extract", "canvas"],
  turbopack: {},
};

export default nextConfig;
