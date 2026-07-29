import type { NextConfig } from "next";

const isNetlifyStaticExport =
  process.env.FLOWCRAFT_NETLIFY_STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  output: isNetlifyStaticExport ? "export" : undefined,
  images: isNetlifyStaticExport ? { unoptimized: true } : undefined,
};

export default nextConfig;
