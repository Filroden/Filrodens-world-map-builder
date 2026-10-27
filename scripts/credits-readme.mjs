/**
 * Writes the README's third-party table from src/data/credits.js (and the font registry), between
 * its credits markers. `node scripts/credits-readme.mjs` rewrites it; `--check` only says whether
 * it is current (tests/ui/credits.test.mjs checks the same).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CREDITS_MARKERS, creditsTable } from "../src/data/credits.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const README = join(ROOT, "README.md");

/** The README with its table written from the credits. */
export function writtenReadme(readme, strings) {
    const start = readme.indexOf(CREDITS_MARKERS.start);
    const end = readme.indexOf(CREDITS_MARKERS.end);
    if (start === -1 || end === -1) throw new Error("The README has no credits markers");
    const table = creditsTable((key) => strings[key] ?? key);
    return `${readme.slice(0, start + CREDITS_MARKERS.start.length)}\n${table}\n${readme.slice(end)}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const strings = JSON.parse(readFileSync(join(ROOT, "languages/en.json"), "utf8"));
    const readme = readFileSync(README, "utf8");
    const written = writtenReadme(readme, strings);
    if (process.argv.includes("--check")) {
        console.log(written === readme ? "The README's credits are current." : "The README's credits are out of date: run node scripts/credits-readme.mjs");
        process.exitCode = written === readme ? 0 : 1;
    } else {
        writeFileSync(README, written);
        console.log("Wrote the README's credits.");
    }
}
