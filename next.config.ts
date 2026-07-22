import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow both loopback hostnames during local/dev Playwright runs.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
