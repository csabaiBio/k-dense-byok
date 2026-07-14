import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { resolve } from "path";

function readAppVersion(): string {
  // The server package is the source of truth for the app version (it's what
  // the README badge and release tags track). Reading it here keeps the
  // frontend's update check honest — a stale fallback makes every published
  // GitHub release look "newer" and shows a false "update available" banner.
  try {
    const pkg = readFileSync(resolve(__dirname, "..", "server", "package.json"), "utf-8");
    const version = (JSON.parse(pkg) as { version?: string }).version;
    if (version) return version;
  } catch {
    // fall through to default
  }
  return "0.0.0";
}

/**
 * Path prefix the frontend is mounted under behind a reverse proxy (e.g. a
 * JupyterHub-style service proxy that forwards the full request path
 * unstripped). Normalized to start with "/" and never end with "/"; empty
 * means "no prefix" (unchanged local-dev behavior). Mirrors
 * BACKEND_URL_PREFIX in server/src/config.ts.
 */
function normalizedBasePath(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "/") return undefined;
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, "") || undefined;
}

const basePath = normalizedBasePath(process.env.FRONTEND_URL_PREFIX);

const nextConfig: NextConfig = {
  devIndicators: false,
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  env: {
    NEXT_PUBLIC_APP_VERSION: readAppVersion(),
  },
};

export default nextConfig;
