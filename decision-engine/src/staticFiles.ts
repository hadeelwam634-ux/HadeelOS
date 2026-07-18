import { IncomingMessage, ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Optional single-process deployment support (MVP Hardening item #11):
 * if STATIC_DIR points at the frontend's built `dist/` directory, one
 * Node process can serve both the API (every /api/* route, unchanged)
 * and the built React app — no separate static file host, CDN, or
 * second process required for a simple personal deployment.
 *
 * Deliberately minimal: no caching headers, no compression, no range
 * requests — appropriate for a single low-traffic personal deployment,
 * not a public CDN-fronted app. A real multi-user production service
 * would put a CDN or reverse proxy in front of this instead.
 *
 * Returns true if the request was handled (response already sent),
 * false if the caller (server.ts's handleRequest) should fall through
 * to normal API routing — this is what lets /api/* requests always
 * skip static serving entirely regardless of STATIC_DIR.
 */
export function createStaticFileHandler(staticDir: string) {
  return async function tryServeStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    if (pathname.startsWith("/api")) return false;

    const resolvedRoot = path.resolve(staticDir);
    const requested = path.resolve(resolvedRoot, "." + pathname);

    // Prevent path traversal outside staticDir (e.g. "/../../etc/passwd").
    if (!requested.startsWith(resolvedRoot)) return false;

    const candidate = pathname === "/" || pathname === "" ? path.join(resolvedRoot, "index.html") : requested;

    let filePath = candidate;
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }
    } catch {
      // Not a real file on disk — for a client-side-routed SPA, fall
      // back to index.html rather than 404ing (e.g. a deep link like
      // /some/client/route should still load the app shell).
      filePath = path.join(resolvedRoot, "index.html");
    }

    try {
      const content = await readFile(filePath);
      const ext = path.extname(filePath);
      res.setHeader("content-type", CONTENT_TYPES[ext] ?? "application/octet-stream");
      res.statusCode = 200;
      res.end(content);
      return true;
    } catch {
      return false;
    }
  };
}
