// The wiki's screenshots outside the tutorial. Each wiki page marks where a picture goes with a
// comment, `<!-- screenshot: <slug> | <what it shows> -->`; each has an entry in a shots file
// (tests/tutorial/shots/<Wiki-page>.mjs) saying which map it starts from, what to do in the studio
// and what to capture. This plays them, as the tutorial's runner plays its pages:
//
//   wiki/images/<page>/<slug>.png    the screenshot (<page> is the wiki page's name in lower case)
//   wiki/<Wiki-page>.md              the image and its caption, put in under the comment
//
//   node tests/tutorial/shots.mjs                  # every page's shots (npm run tutorial:shots)
//   node tests/tutorial/shots.mjs Biomes Labels    # only these pages' shots
//
// A page's shots are played in order, in one studio, while each starts from the same map as the
// one before (so a shot can carry on from the last); a shot with another start, or `fresh: true`,
// opens a new studio. The comment stays in the page, so a rerun replaces the image block under it.
// A shot marked `provided` is a picture from Foundry (which the runner cannot open), saved by hand
// at its path; only its image block is written.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runActions } from "./lib/actions.mjs";
import { takeScreenshot } from "./lib/capture.mjs";
import { findChromium, settle, startStudioHost } from "./lib/studio.mjs";
import { openMap, PATHS } from "./run.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
export const SHOTS_DIR = join(HERE, "shots");

/** The comment that marks a screenshot's place in a wiki page. */
export const SHOT_COMMENT = /^<!-- screenshot: ([a-z0-9-]+) \|.*-->$/;

/** Every shots file, by wiki page: { page, file, shots }. */
export async function loadShotPages() {
    const files = readdirSync(SHOTS_DIR).filter((name) => name.endsWith(".mjs") && !name.startsWith("_")).sort();
    const pages = [];
    for (const name of files) {
        const { default: shots } = await import(pathToFileURL(join(SHOTS_DIR, name)));
        pages.push({ page: name.replace(/\.mjs$/, ""), shots });
    }
    return pages;
}

/** A page's images folder, under wiki/images: its name in lower case ("map-canvas"). */
export const imageDir = (page) => page.toLowerCase();

/** The slugs a wiki page's comments ask for, in order. */
export function commentSlugs(markdown) {
    return markdown.split(/\r?\n/).map((line) => line.trim().match(SHOT_COMMENT)?.[1]).filter(Boolean);
}

/**
 * The page's text with each shot's image and caption under its comment, replacing the image
 * block a run before put there (the image line, a blank line and the caption line).
 */
export function placeImages(markdown, page, shots) {
    const lines = markdown.split(/\r?\n/);
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        out.push(lines[i]);
        const slug = lines[i].trim().match(SHOT_COMMENT)?.[1];
        const shot = slug && shots.find((each) => each.slug === slug);
        if (!shot) continue;
        // An image block from an earlier run: a blank line, the image, a blank line, the caption
        let next = i + 1;
        if (lines[next] === "" && lines[next + 1]?.startsWith("![") && lines[next + 2] === "" && /^\*.*\*$/.test(lines[next + 3] ?? "")) next += 4;
        out.push("", `![${shot.caption}](images/${imageDir(page)}/${shot.slug}.png)`, "", `*${shot.caption}*`);
        i = next - 1;
    }
    return out.join("\n");
}

async function playPage(host, { page, shots }, log) {
    let open = null;
    try {
        for (const [index, shot] of shots.entries()) {
            // A picture from Foundry, which the runner cannot open, is supplied as a file
            if (shot.provided) continue;
            const start = shot.start ?? null;
            if (!open || shot.fresh || open.start !== start) {
                await open?.context.close();
                const { context, browserPage } = await openMap(host, { start, seed: 9000 + index });
                open = { context, page: browserPage, start };
            }
            const started = performance.now();
            try {
                if (shot.action) await runActions(open.page, { id: shot.slug, action: shot.action });
            } catch (error) {
                const failed = join(tmpdir(), `fwmb-shot-${shot.slug}.png`);
                await open.page.screenshot({ path: failed }).catch(() => {});
                throw new Error(`${error.message}\n  (the studio at the failure: ${failed})`, { cause: error });
            }
            if (shot.settle !== false) await settle(open.page);
            const dir = join(PATHS.wiki, "images", imageDir(page));
            mkdirSync(dir, { recursive: true });
            // A map exported through the studio's own Export to PNG (downloaded by the shot's
            // actions) is the picture itself, at the map's size, rather than a screenshot
            if (shot.exported) copyFileSync(join(tmpdir(), shot.exported), join(dir, `${shot.slug}.png`));
            else await takeScreenshot(open.page, { name: shot.slug, ...shot.screenshot }, join(dir, `${shot.slug}.png`));
            if (shot.after) await runActions(open.page, { id: `${shot.slug}-after`, action: shot.after });
            log(`  ${shot.slug} (${((performance.now() - started) / 1000).toFixed(1)} s)`);
        }
    } finally {
        await open?.context.close();
    }
    const file = join(PATHS.wiki, `${page}.md`);
    writeFileSync(file, placeImages(readFileSync(file, "utf8"), page, shots));
}

async function main(args) {
    const pages = (await loadShotPages()).filter((each) => !args.length || args.includes(each.page));
    const found = await findChromium();
    if (found.reason) throw new Error(found.reason);
    const host = await startStudioHost(found);
    try {
        // A page whose shots fail is reported and the rest carry on, so one run shows every failure
        const failed = [];
        for (const page of pages) {
            const started = performance.now();
            console.log(`${page.page}: ${page.shots.length} shots`);
            try {
                await playPage(host, page, (text) => console.log(text));
                console.log(`  done in ${((performance.now() - started) / 1000).toFixed(0)} s`);
            } catch (error) {
                failed.push(page.page);
                console.error(`  failed: ${error.message}`);
            }
        }
        if (failed.length) throw new Error(`these pages' shots failed: ${failed.join(", ")}`);
    } finally {
        await host.close();
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main(process.argv.slice(2)).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
