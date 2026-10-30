import type { NextConfig } from "next";

const config: NextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  poweredByHeader: false,
};

export default config;
