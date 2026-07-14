// Allow any local dev UI port plus common LAN ranges (Next.js picks 3001+ when
// 3000 is taken). Ported from server.py's CORS allow-list.
const CORS_ALLOW = [
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
  /^http:\/\/\[::1\]:\d+$/,
  /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/,
  /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:\d+$/,
  /^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}:\d+$/,
];

// Extra exact origins allowed behind a reverse proxy (e.g. the public https
// hostname Kady is served under), configured via CORS_ALLOW_ORIGINS as a
// comma-separated list. Read once at module load, same as the rest of config.
const EXTRA_CORS_ALLOW_ORIGINS = (process.env.CORS_ALLOW_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

export function isCorsOriginAllowed(origin: string | undefined): boolean {
  // Non-browser clients (curl, same-origin) send no Origin -> allow.
  if (!origin) return true;
  const normalized = origin.replace(/\/+$/, "");
  if (EXTRA_CORS_ALLOW_ORIGINS.includes(normalized)) return true;
  return CORS_ALLOW.some((re) => re.test(origin));
}

export function corsResponseHeaders(origin: string | undefined): Record<string, string> {
  if (!origin || !isCorsOriginAllowed(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}
