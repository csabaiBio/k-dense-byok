import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { resolve } from "path";

function readVersionFromPyproject(): string {
  try {
    const content = readFileSync(resolve(__dirname, "..", "pyproject.toml"), "utf-8");
    const match = content.match(/^version\s*=\s*"([^"]+)"/m);
    return match?.[1] ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function normalizePathPrefix(raw?: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "/") return "";
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

function readPrefixFromFrontendUrl(raw?: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    return normalizePathPrefix(parsed.pathname);
  } catch {
    return "";
  }
}

function resolveFrontendUrlPrefix(): string {
  const explicit = normalizePathPrefix(process.env.FRONTEND_URL_PREFIX);
  if (explicit) return explicit;
  return readPrefixFromFrontendUrl(process.env.FRONTEND_URL);
}

const frontendUrlPrefix = resolveFrontendUrlPrefix();
const frontendUrl = process.env.FRONTEND_URL?.trim() || `http://localhost:3000${frontendUrlPrefix}`;

const nextConfig: NextConfig = {
  devIndicators: false,
  ...(frontendUrlPrefix
    ? {
        basePath: frontendUrlPrefix,
        assetPrefix: frontendUrlPrefix,
      }
    : {}),
  env: {
    NEXT_PUBLIC_APP_VERSION: readVersionFromPyproject(),
    NEXT_PUBLIC_FRONTEND_URL: frontendUrl,
    NEXT_PUBLIC_FRONTEND_URL_PREFIX: frontendUrlPrefix,
  },
};

export default nextConfig;
