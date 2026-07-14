/**
 * K-Dense BYOK backend (TypeScript, Pi SDK).
 *
 * Replaces the Python FastAPI + Google ADK server. Boots Fastify, applies the
 * same project-scoping contract the frontend expects (X-Project-Id header /
 * ?project query / kady-project cookie), and registers the route plugins.
 */
import "./env.ts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyCors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { BACKEND_URL_PREFIX, DEFAULT_PROJECT_ID, HOST, PORT, modalConfigured } from "./config.ts";
import { isCorsOriginAllowed } from "./cors.ts";
import { ensureProjectExists, getProject } from "./projects.ts";
import { withActiveProject } from "./scope.ts";
import { registerProjectRoutes } from "./api/projects.ts";
import { registerSessionRoutes } from "./api/sessions.ts";
import { registerSandboxRoutes } from "./api/sandbox.ts";
import { registerSystemRoutes } from "./api/system.ts";
import { registerMcpRoutes } from "./api/mcp.ts";
import { registerCredentialRoutes } from "./api/credentials.ts";
import { registerAgentRoutes } from "./api/agents.ts";
import { syncHelperVenv } from "./helpers-env.ts";

function readCookie(req: FastifyRequest, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}

function resolveProjectId(req: FastifyRequest): string {
  const header = req.headers["x-project-id"];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  const q = (req.query as Record<string, unknown> | undefined)?.project;
  const candidates: (string | undefined)[] = [
    fromHeader != null ? String(fromHeader) : undefined,
    q != null ? String(q) : undefined,
    readCookie(req, "kady-project"),
  ];
  for (const c of candidates) {
    if (c && c.trim()) return c.trim();
  }
  return DEFAULT_PROJECT_ID;
}

export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    // Inline image attachments ride the JSON run body as base64 (up to 12 ×
    // 5MB, see agent/prompt-images.ts); Fastify's default 1MB limit would
    // reject them.
    bodyLimit: 96 * 1024 * 1024,
  });

  await app.register(fastifyCors, {
    origin: (origin, cb) => {
      cb(null, isCorsOriginAllowed(origin));
    },
    credentials: true,
  });

  await app.register(multipart, { limits: { fileSize: 1024 * 1024 * 1024 } });

  // Binary/unknown request bodies (e.g. PUT /sandbox/file) → raw Buffer.
  // JSON and text/plain keep their built-in parsers; multipart is handled above.
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  // Project scope: resolve the active project and run the rest of the request
  // lifecycle inside its AsyncLocalStorage context. Calling `done` inside
  // withActiveProject keeps the store active for downstream hooks + handler.
  app.addHook("onRequest", (req, _reply, done) => {
    let projectId = resolveProjectId(req);
    try {
      // Only the default project is created on demand. An unknown id here is
      // a stale header (e.g. an in-flight poll for a just-deleted project) —
      // creating it would silently resurrect the deleted project.
      if (projectId !== DEFAULT_PROJECT_ID && !getProject(projectId)) {
        projectId = DEFAULT_PROJECT_ID;
      }
      ensureProjectExists(projectId);
    } catch {
      projectId = DEFAULT_PROJECT_ID;
      ensureProjectExists(projectId);
    }
    withActiveProject(projectId, () => done());
  });

  app.get("/health", async () => ({ status: "ok" }));

  const registerRoutes = async (instance: FastifyInstance) => {
    instance.get("/config", async () => ({ modal_configured: modalConfigured() }));
    await registerProjectRoutes(instance);
    await registerSessionRoutes(instance);
    await registerSandboxRoutes(instance);
    await registerSystemRoutes(instance);
    await registerMcpRoutes(instance);
    await registerCredentialRoutes(instance);
    await registerAgentRoutes(instance);
  };

  if (BACKEND_URL_PREFIX) {
    // Behind a reverse proxy that forwards the full request path unstripped
    // (the same role `--root-path` played for the old uvicorn/FastAPI
    // backend), mount every route under the configured prefix via a scoped
    // Fastify instance. `/health` also stays reachable unprefixed for local
    // liveness probes.
    await app.register(registerRoutes, { prefix: BACKEND_URL_PREFIX });
    app.get(`${BACKEND_URL_PREFIX}/health`, async () => ({ status: "ok" }));
  } else {
    await registerRoutes(app);
  }

  return app;
}

// Boot when run directly (tsx src/index.ts), not when imported by tests.
// Compare real paths, not URL strings: import.meta.url percent-encodes (and on
// macOS resolves /tmp → /private/tmp), so a naive compare fails for repo paths
// with spaces or symlinks and the server would silently never listen.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return (
      fs.realpathSync(fileURLToPath(import.meta.url)) ===
      fs.realpathSync(path.resolve(process.argv[1]))
    );
  } catch {
    return false;
  }
})();
if (isMain) {
  syncHelperVenv(); // best-effort; previews degrade gracefully if it fails
  const app = await buildApp();
  app
    .listen({ port: PORT, host: HOST })
    .then((addr) => app.log.info(`kady-server listening on ${addr}`))
    .catch((err) => {
      app.log.error(err);
      process.exit(1);
    });
}
