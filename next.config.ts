import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Add this to disable type checking during build
  typescript: {
    ignoreBuildErrors: true,
  },

  // Also ignore ESLint errors if needed
  // eslint: {
  //   ignoreDuringBuilds: true,
  // },
};

export default nextConfig;
