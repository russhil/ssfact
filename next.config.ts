import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,

  experimental: {
    // Turbopack is the default bundler in Next 16, but it keeps no on-disk
    // cache for `next build` unless asked. Without this every deploy rebuilds
    // the whole app from cold on the box. The cache lives in `.next/cache`,
    // which the deploy rsync deliberately leaves alone.
    turbopackFileSystemCacheForBuild: true,
  },
};

export default nextConfig;
