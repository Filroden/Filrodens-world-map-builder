// Every tutorial page still runs: each page's steps are played in the web studio from the map it
// starts from (the page before's checkpoint in samples/tutorial), with no screenshots and nothing
// written. A change to the interface that breaks a step fails here, naming the step.
//
// Needs Chromium for Playwright (npx playwright install chromium, or FWMB_CHROMIUM); skipped,
// saying so, without it. The pages are slow (a few minutes each, up to twenty for the generated
// ones, since every step waits for the map to settle as a reader would), so FWMB_TUTORIAL=0 skips
// them for a quick run of the rest; FWMB_TUTORIAL_CONCURRENCY plays several at once.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { pageStem } from "./lib/emit.mjs";
import { findChromium, startStudioHost } from "./lib/studio.mjs";
import { loadPages, PATHS, ROOT, runPage } from "./run.mjs";

const pages = await loadPages();
const found = process.env.FWMB_TUTORIAL === "0" ? { reason: "FWMB_TUTORIAL=0" } : await findChromium();
const skip = found.reason ?? false;

let host;
before(async () => {
    if (!skip) host = await startStudioHost(found);
});
after(async () => {
    await host?.close();
});

test("the tutorial's pages are numbered from 1 with no gaps, each starting from the page before", () => {
    pages.forEach((page, index) => {
        assert.equal(page.number, index + 1, `${page.source} is page ${page.number}`);
        if (index === 0) assert.equal(page.start ?? null, null, "page 1 makes its map");
        else assert.equal(page.start, pageStem(pages[index - 1]), `${page.source} starts from the page before`);
        assert.ok(page.steps.length > 0 && page.steps.every((step) => step.id), `${page.source}: every step has an id`);
    });
});

test("a page whose map is a test fixture has copied it there: the tests' P0JBVA is the tutorial's", () => {
    for (const page of pages.filter((each) => each.fixture)) {
        const checkpoint = readFileSync(join(PATHS.checkpoints, `${pageStem(page)}.json`));
        assert.ok(checkpoint.equals(readFileSync(join(ROOT, page.fixture))), `${page.fixture} is not ${pageStem(page)}.json: run npm run tutorial:build -- ${page.number}`);
    }
});

// One page at a time by default: the generated pages keep the browser's main thread busy for
// long stretches, and two at once on a small machine can starve each other past their waits
const concurrency = Math.max(1, Number(process.env.FWMB_TUTORIAL_CONCURRENCY) || 1);

describe("each tutorial page runs", { skip, concurrency }, () => {
    for (const page of pages) {
        test(`${pageStem(page)}: ${page.title}`, { timeout: 60 * 60 * 1000 }, async () => {
            if (page.start) assert.ok(existsSync(join(PATHS.checkpoints, `${page.start}.json`)), `its start, samples/tutorial/${page.start}.json, is missing: run npm run tutorial:build`);
            await runPage(host, page);
        });
    }
});
