// Serves the web version from the working copy, for development: the page at the root, every
// other file from the repository by its own path, and templates.json made from the templates
// folder on each request (the web pack writes it as a file instead). With --dist it serves the
// packed site in dist-web/ exactly as it would be deployed.
//   npm run serve:web [-- port] [-- --dist]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { listTemplates, PAGE } from "./web-site.mjs";

const DEFAULT_PORT = 8790;
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".hbs": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
};

/** What a request is answered with, from the working copy or (dist) from the packed site. */
async function respond(pathname, dist) {
    const root = dist ? join(ROOT, "dist-web") : ROOT;
    if (!dist && pathname === "/templates.json") return { type: TYPES[".json"], body: JSON.stringify(listTemplates(ROOT)) };
    const index = dist ? "index.html" : PAGE;
    const file = join(root, normalize(pathname === "/" ? index : pathname));
    if (!file.startsWith(root + sep)) return null;
    return { type: TYPES[extname(file)] ?? "application/octet-stream", body: await readFile(file) };
}

/**
 * Starts the server.
 *
 * @param {number} [port] - 0 picks a free port.
 * @param {{dist?: boolean}} [options] - dist serves the packed site (dist-web/).
 * @returns {Promise<{server: import("node:http").Server, url: string}>}
 */
export function serveWeb(port = DEFAULT_PORT, { dist = false } = {}) {
    const server = createServer(async (request, response) => {
        try {
            const found = await respond(decodeURIComponent(new URL(request.url, "http://localhost").pathname), dist);
            if (!found) throw new Error("outside the site");
            response.writeHead(200, { "content-type": found.type, "cache-control": "no-store" });
            response.end(found.body);
        } catch {
            response.writeHead(404);
            response.end();
        }
    });
    return new Promise((done) => server.listen(port, () => done({ server, url: `http://localhost:${server.address().port}/` })));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const port = Number(process.argv.slice(2).find((arg) => /^\d+$/.test(arg))) || DEFAULT_PORT;
    const { url } = await serveWeb(port, { dist: process.argv.includes("--dist") });
    console.log(`The web version is at ${url}`);
}
