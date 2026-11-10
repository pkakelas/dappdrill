import type { NextConfig } from "next";

// The marketing site is static: `next build` writes plain files to out/.
const nextConfig: NextConfig = { output: "export" };

export default nextConfig;
