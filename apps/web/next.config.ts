import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// One .env at the repo root is shared by web, worker and CLI.
const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  transpilePackages: ["@dappdrill/core", "@dappdrill/db"],
  serverExternalPackages: ["pg-boss", "nodemailer"],
  // Workspace packages are TypeScript source with "./x.js" imports. Turbopack (16.4) cannot
  // map those to .ts, so dev and build run on webpack (see package.json scripts).
  experimental: { extensionAlias: { ".js": [".ts", ".tsx", ".js"] } },
};

export default nextConfig;
