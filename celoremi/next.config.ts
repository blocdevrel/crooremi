import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
  serverExternalPackages: ["@prisma/client", "prisma"],
  webpack: (config, { dev }) => {
    // OneDrive on Windows breaks webpack's default filesystem cache (ENOENT on rename).
    if (dev) {
      config.cache = { type: "memory" };
    }

    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      {
        module: /node_modules\/viem/,
        message: /Critical dependency/,
      },
      {
        module: /node_modules\/ox/,
        message: /Critical dependency/,
      },
    ];

    return config;
  },
};

export default nextConfig;
