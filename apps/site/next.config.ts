import type { NextConfig } from "next";

// The marketing site is static: `next build` writes plain files to out/,
// each page as a folder with an index.html so /about/ works on any static host.
const nextConfig: NextConfig = { output: "export", trailingSlash: true };

export default nextConfig;
