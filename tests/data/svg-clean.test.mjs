// SVG cleaning (ImageCheck.cleanSvg, through DOMPurify) in a real browser: DOMPurify relies on the
// browser's own parser, which no Node DOM reproduces faithfully, so this runs the module in headless
// Chromium through Playwright. It is skipped, saying so, where no Chromium is available (as on the
// CI runner); set FWMB_CHROMIUM to a Chromium executable if Playwright's own is not installed.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".html": "text/html" };

let chromium = null;
try {
    ({ chromium } = await import("playwright"));
} catch {
    chromium = null;
}
const executable = process.env.FWMB_CHROMIUM || (chromium ? chromium.executablePath() : "");
const skip = !chromium || !executable || !existsSync(executable) ? "no Chromium for Playwright here (set FWMB_CHROMIUM to run it)" : false;

let server;
let browser;
let page;

before(async () => {
    if (skip) return;
    server = createServer(async (request, response) => {
        const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
        try {
            const body = await readFile(join(ROOT, path));
            response.writeHead(200, { "content-type": TYPES[extname(path)] ?? "text/plain" });
            response.end(body);
        } catch {
            response.writeHead(404);
            response.end();
        }
    }).listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    browser = await chromium.launch({ executablePath: executable });
    page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/README.md`);
});

after(async () => {
    await browser?.close();
    server?.close();
});

const HOSTILE = `<?xml version="1.0"?><!-- an icon --><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" onload="alert(1)">
<script>alert(2)</script>
<path d="M2 2h20v20H2z" fill="#fff" style="fill:url(https://example.com/x)" onclick="alert(3)"/>
<use href="https://example.com/x.svg#y"/><image href="https://example.com/x.png"/>
<foreignObject><div>html</div></foreignObject><a href="javascript:alert(4)"><circle r="2"/></a>
<style>@import url(https://example.com/x.css);</style><animate attributeName="href" to="javascript:alert(5)"/>
<linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient><rect fill="url(#g)" width="4" height="4"/></svg>`;

test("an SVG is cleaned of script, handlers, outside links and embedded HTML, and still draws", { skip }, async () => {
    const result = await page.evaluate(async (svg) => {
        const { ImageCheck } = await import("/src/data/ImageCheck.js");
        const cleaned = ImageCheck.cleanSvg(svg);
        const image = new Image();
        image.src = ImageCheck.toDataUrl(new TextEncoder().encode(cleaned), "svg");
        await image.decode();
        return { cleaned, width: image.naturalWidth };
    }, HOSTILE);
    for (const banned of ["script", "onload", "onclick", "foreignObject", "<image", "<a ", "javascript:", "https://example.com", "<style", "style=", "<animate"]) {
        assert.ok(!result.cleaned.includes(banned), `${banned} in ${result.cleaned}`);
    }
    assert.ok(result.cleaned.includes("<path") && result.cleaned.includes('fill="url(#g)"'), result.cleaned);
    assert.ok(result.width > 0, "the cleaned SVG still draws as an image");
});

test("an SVG named and typed as a PNG is checked as the SVG it is, and kept as a cleaned SVG", { skip }, async () => {
    const url = await page.evaluate(async (svg) => {
        const { ImageCheck } = await import("/src/data/ImageCheck.js");
        return ImageCheck.checkFile(new File([svg], "icon.png", { type: "image/png" }));
    }, HOSTILE);
    assert.ok(url.startsWith("data:image/svg+xml;base64,"), url.slice(0, 40));
    const text = Buffer.from(url.split(",")[1], "base64").toString("utf8");
    assert.ok(!text.includes("script") && !text.includes("javascript:"), text);
});

test("a real PNG is decoded and kept; a file of no image type is refused", { skip }, async () => {
    const outcome = await page.evaluate(async () => {
        const { ImageCheck } = await import("/src/data/ImageCheck.js");
        const canvas = new OffscreenCanvas(3, 2);
        canvas.getContext("2d").fillRect(0, 0, 3, 2);
        const png = await canvas.convertToBlob({ type: "image/png" });
        const kept = await ImageCheck.checkFile(new File([png], "x.webp", { type: "image/webp" }));
        let refused = null;
        try {
            await ImageCheck.checkFile(new File(["<html><script>alert(1)</script></html>"], "x.png", { type: "image/png" }));
        } catch (error) {
            refused = error.reason;
        }
        return { kept: kept.slice(0, 22), refused };
    });
    assert.deepEqual(outcome, { kept: "data:image/png;base64,", refused: "image" });
});
