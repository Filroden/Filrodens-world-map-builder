// The tutorial runner: plays each tutorial page's steps in the web studio (headless Chromium),
// from the map the page starts from, and fails loudly if a step cannot be done. With --build it
// also writes what the page produces:
//
//   wiki/images/tutorial/<nn>-<slug>-<shot>.png   the step screenshots
//   samples/tutorial/<nn>-<slug>.json             the map at the end of the page (the next page's start)
//   tests/mesh/fixtures/p0jbva.json               page 4's map again, as the tests' P0JBVA
//   wiki/Tutorial-<nn>-<Title>.md                 every page's wiki page
//   tests/tutorial/scripts/<nn>-<slug>.md         every page's video shooting script
//
//   node tests/tutorial/run.mjs                    # play every page, write nothing (what npm test checks)
//   node tests/tutorial/run.mjs --build            # play and write everything (npm run tutorial:build)
//   node tests/tutorial/run.mjs --build 01 03      # only these pages
//
// The wiki folder is the wiki's own repository inside the working copy (git-ignored here); the
// checkpoints are tracked, since each page's check starts from the one before.
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runActions } from "./lib/actions.mjs";
import { takeScreenshot } from "./lib/capture.mjs";
import { pageStem, shotFile, videoScript, wikiFile, wikiMarkdown } from "./lib/emit.mjs";
import { findChromium, openStudio, QUICK_SETTLE_MS, settle, startStudioHost } from "./lib/studio.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..");
export const PATHS = Object.freeze({
    pages: join(HERE, "pages"),
    scripts: join(HERE, "scripts"),
    checkpoints: join(ROOT, "samples", "tutorial"),
    wiki: join(ROOT, "wiki"),
    images: join(ROOT, "wiki", "images", "tutorial"),
});

/** Every tutorial page's step file, in order. */
export async function loadPages() {
    const files = readdirSync(PATHS.pages)
        .filter((name) => /^\d\d-.+\.mjs$/.test(name))
        .sort();
    const pages = [];
    for (const name of files) {
        const page = (await import(pathToFileURL(join(PATHS.pages, name)))).default;
        page.source = relative(ROOT, join(PATHS.pages, name)).replaceAll("\\", "/");
        if (pageStem(page) !== name.replace(/\.mjs$/, "")) throw new Error(`${name}: its number and slug make "${pageStem(page)}", not the file's name`);
        pages.push(page);
    }
    return pages;
}

/** Opens the map a page starts from: the default map for a new one, or the page before's checkpoint, imported and loaded as a reader would. */
async function openStart(host, page) {
    const { context, page: browserPage } = await openStudio(host, { seed: page.number * 1000 + 1 });
    if (page.start) {
        await runActions(browserPage, { id: "start", action: { do: "importMap", file: join(PATHS.checkpoints, `${page.start}.json`) } });
        await browserPage.locator('.fwmb-map-card [data-action="manageMap"][data-action-type="load"]').first().click();
        await browserPage.waitForFunction(() => !!globalThis.fwmbStudio?.currentSaveId, null, { timeout: 60000 });
        await settle(browserPage);
    }
    return { context, browserPage };
}

/** Exports the saved map through Maps › Export and writes the file as the page's checkpoint. */
async function writeCheckpoint(browserPage, page) {
    const id = await browserPage.evaluate(() => globalThis.fwmbStudio.currentSaveId);
    if (!id) throw new Error(`page ${pageStem(page)} ends with the map unsaved; its last step should save it`);
    if (await browserPage.evaluate(() => globalThis.fwmbStudio.isDirty)) throw new Error(`page ${pageStem(page)} ends with unsaved changes; save after the last edit`);
    await runActions(browserPage, { id: "checkpoint", action: { do: "tool", tool: "manage" } });
    const card = browserPage.locator(`.fwmb-map-card[data-id="${id}"]`);
    await card.locator(".fwmb-dropdown > button").click();
    const download = browserPage.waitForEvent("download", { timeout: 60000 });
    await card.locator('[data-action-type="export"]').click();
    const path = join(PATHS.checkpoints, `${pageStem(page)}.json`);
    mkdirSync(PATHS.checkpoints, { recursive: true });
    await (await download).saveAs(path);
    return path;
}

/**
 * Plays one page.
 *
 * @param {object} host - From startStudioHost.
 * @param {object} page - The step file's page.
 * @param {{build?: boolean, log?: (text: string) => void}} [options] - build writes the screenshots and checkpoint.
 */
export async function runPage(host, page, { build = false, log = () => {} } = {}) {
    const { context, browserPage } = await openStart(host, page);
    try {
        for (const step of page.steps) {
            const started = performance.now();
            try {
                await runActions(browserPage, step, { page });
            } catch (error) {
                // What the studio showed when the step failed, to see what was in the way
                const shot = join(tmpdir(), `fwmb-tutorial-${pageStem(page)}-${step.id}.png`);
                await browserPage.screenshot({ path: shot }).catch(() => {});
                throw new Error(`${error.message}\n  (the studio at the failure: ${shot})`, { cause: error });
            }
            if (step.settle !== false) await settle(browserPage, build ? {} : { settleMs: QUICK_SETTLE_MS });
            if (browserPage.fwmbErrors.length) throw new Error(`step "${step.id}": the page threw: ${browserPage.fwmbErrors.join("; ")}`);
            if (build && step.screenshot) {
                mkdirSync(PATHS.images, { recursive: true });
                await takeScreenshot(browserPage, step.screenshot, join(PATHS.images, shotFile(page, step.screenshot)));
            }
            log(`  ${step.id} (${((performance.now() - started) / 1000).toFixed(1)} s)`);
        }
        if (build && page.checkpoint !== false) {
            const checkpoint = await writeCheckpoint(browserPage, page);
            log(`  checkpoint ${relative(ROOT, checkpoint)}`);
            // The page whose map is a test fixture (P0JBVA, at the end of the terrain pages) copies
            // it there too, so the tests always run on the map the tutorial makes
            if (page.fixture) {
                copyFileSync(checkpoint, join(ROOT, page.fixture));
                log(`  fixture ${page.fixture} (run npm run fixtures to rebuild its rasters)`);
            }
        }
    } finally {
        await context.close();
    }
}

/** Writes a page's wiki page and video script. */
export function writeTexts(page, pages) {
    mkdirSync(PATHS.wiki, { recursive: true });
    mkdirSync(PATHS.scripts, { recursive: true });
    writeFileSync(join(PATHS.wiki, wikiFile(page)), wikiMarkdown(page, pages, page.source));
    writeFileSync(join(PATHS.scripts, `${pageStem(page)}.md`), videoScript(page, page.source));
}

async function main(args) {
    const build = args.includes("--build");
    const only = args.filter((arg) => /^\d+$/.test(arg)).map(Number);
    const pages = await loadPages();
    const chosen = only.length ? pages.filter((page) => only.includes(page.number)) : pages;
    const found = await findChromium();
    if (found.reason) throw new Error(found.reason);
    const host = await startStudioHost(found);
    try {
        for (const page of chosen) {
            const started = performance.now();
            console.log(`${pageStem(page)}: ${page.title}`);
            await runPage(host, page, { build, log: (text) => console.log(text) });
            console.log(`  done in ${((performance.now() - started) / 1000).toFixed(0)} s`);
        }
        // Every page's texts, not only the pages played: a new page changes the one before's Next
        // link, and every page's count
        if (build) for (const page of pages) writeTexts(page, pages);
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
