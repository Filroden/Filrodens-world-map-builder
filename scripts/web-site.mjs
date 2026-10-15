// What the web version's site is made of, shared by the web pack (pack.mjs --web) and the
// development server (serve-web.mjs), so both serve the same files.
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Folders of the repository the site is built from, kept at the same paths. */
export const SITE_FOLDERS = ["src", "templates", "styles", "languages", "assets", "vendor", "web"];

/** Files of the repository the site needs beside those folders. */
export const SITE_FILES = ["module.json", "LICENSE.md"];

/** Folders inside the site folders that the site leaves out (large images only the wiki shows). */
export const SITE_EXCLUDED_FOLDERS = ["screenshots"];

/** The file types the site carries. */
export const SITE_EXTENSIONS = ["js", "mjs", "json", "css", "hbs", "svg", "md", "html", "woff2", "txt"];

/** The page itself is web/index.html, served at the site's root. */
export const PAGE = "web/index.html";

/**
 * Every template's path inside templates/ ("toolbar.hbs", "parts/shared-range.hbs"), with forward
 * slashes, sorted. The page loads them all at start-up from this list (written as templates.json).
 *
 * @param {string} root - The repository's root.
 * @returns {string[]}
 */
export function listTemplates(root) {
    const folder = join(root, "templates");
    const walk = (dir) =>
        readdirSync(dir).flatMap((name) => {
            const path = join(dir, name);
            if (statSync(path).isDirectory()) return walk(path);
            return name.endsWith(".hbs") ? [relative(folder, path).replaceAll("\\", "/")] : [];
        });
    return walk(folder).sort();
}
