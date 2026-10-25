// The web studio in headless Chromium, for the tutorial runner: the site served from the working
// copy, a browser at the tutorial's fixed studio size and theme, and the waits and coordinates the
// actions need. Nothing here knows about tutorial pages; see run.mjs.
import { existsSync } from "node:fs";
import { serveWeb } from "../../../scripts/serve-web.mjs";

/** The studio size every tutorial screenshot is taken at (CSS pixels, device scale 1). */
export const STUDIO_SIZE = Object.freeze({ width: 1600, height: 1000 });

/** The theme the screenshots are taken in: dark, teal. */
const THEME = Object.freeze({ themeMode: "dark", themeHue: "teal" });

/**
 * How long the map must stay settled before it counts as settled: longer than the longest
 * debounce between an edit and the refresh it asks for (the canvas refresh's, 2 s), so a refresh
 * still waiting on its timer is not mistaken for none.
 */
const SETTLE_MS = 2500;
/** The shorter wait for a check: longer than the terrain's own debounce, so its refresh has been asked for. */
export const QUICK_SETTLE_MS = 1000;
const POLL_MS = 100;

/** Regions of the studio a screenshot can be cropped to, by name. */
export const REGIONS = Object.freeze({
    rail: '[data-region="toolbar"]',
    panel: '[data-region="context"]',
    bar: '[data-region="editToolbar"]',
    map: ".fwmb-map-preview",
    inspector: "dialog.fwmb-inspector[open]",
    dialog: "dialog.fwmb-overlay-modal[open]",
});

/**
 * Playwright and a Chromium for it: the repository's own Playwright, with its browser, or the
 * executable named by FWMB_CHROMIUM (as the SVG cleaning test does).
 *
 * @returns {Promise<{chromium: object, executablePath: string}|{reason: string}>}
 */
export async function findChromium() {
    let chromium;
    try {
        ({ chromium } = await import("playwright"));
    } catch {
        return { reason: "Playwright is not installed" };
    }
    const executablePath = process.env.FWMB_CHROMIUM || chromium.executablePath();
    if (!executablePath || !existsSync(executablePath)) return { reason: "no Chromium for Playwright here (run npx playwright install chromium, or set FWMB_CHROMIUM)" };
    return { chromium, executablePath };
}

/**
 * A seeded stand-in for the page's random numbers, installed before the studio's own scripts.
 * Map seeds come from the tutorial, but ids (a land mask's, a saved map's) and the odd random
 * choice come from Math.random and crypto; seeding both makes a rerun give the same ids, so the
 * checkpoints and screenshots are rewritten byte for byte where the renderer allows.
 */
function seededRandomScript(seed) {
    return `(() => {
        let state = ${seed >>> 0} || 1;
        const next = () => {
            state = (state + 0x6d2b79f5) >>> 0;
            let t = state;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        Math.random = next;
        crypto.getRandomValues = (array) => {
            for (let i = 0; i < array.length; i++) array[i] = Math.floor(next() * 4294967296);
            return array;
        };
        crypto.randomUUID = () => "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (Math.floor(next() * 256) & (15 >> (c / 4)))).toString(16));
    })();`;
}

/**
 * Starts the site and a browser.
 *
 * @param {{chromium: object, executablePath: string}} found - From findChromium.
 * @returns {Promise<{url: string, browser: object, close: () => Promise<void>}>}
 */
export async function startStudioHost({ chromium, executablePath }) {
    const { server, url } = await serveWeb(0);
    const browser = await chromium.launch({ executablePath, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
    return {
        url,
        browser,
        close: async () => {
            await browser.close();
            await new Promise((done) => server.close(done));
        },
    };
}

/**
 * A fresh page on the studio (its own storage, so no map saved by another page is listed), in
 * the tutorial's theme, with seeded random numbers, and waits until the starting map is ready.
 *
 * @param {{url: string, browser: object}} host
 * @param {{seed?: number, timeout?: number}} [options]
 * @returns {Promise<{context: object, page: object}>}
 */
export async function openStudio(host, { seed = 1, timeout = 180000 } = {}) {
    const context = await host.browser.newContext({ viewport: STUDIO_SIZE, deviceScaleFactor: 1, colorScheme: "dark", reducedMotion: "reduce", acceptDownloads: true });
    await context.addInitScript((theme) => {
        for (const [key, value] of Object.entries(theme)) localStorage.setItem(`fwmb.${key}`, JSON.stringify(value));
    }, THEME);
    await context.addInitScript(seededRandomScript(seed));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.fwmbErrors = errors;
    await page.goto(host.url);
    await page.waitForFunction(() => globalThis.fwmbStudio?.currentElevationData && globalThis.fwmbStudio?.meshSession, null, { timeout });
    await settle(page, { timeout });
    return { context, page };
}

/**
 * Waits until the map has settled: no terrain, climate or feature refresh running or waiting, no
 * work overlay showing, for SETTLE_MS together (or a shorter time, for a check that takes no
 * screenshots and only needs each step to be done before the next).
 */
export async function settle(page, { timeout = 180000, settleMs = SETTLE_MS } = {}) {
    await page.waitForFunction(
        ({ settleMs, pollMs }) =>
            new Promise((resolve) => {
                let quietSince = performance.now();
                const tick = () => {
                    const studio = globalThis.fwmbStudio;
                    const working = !studio || studio.refreshing || !!document.querySelector(".fwmb-processing-overlay:not(.fwmb-hidden)");
                    if (working) quietSince = performance.now();
                    if (performance.now() - quietSince >= settleMs) resolve(true);
                    else setTimeout(tick, pollMs);
                };
                tick();
            }),
        { settleMs, pollMs: POLL_MS },
        { timeout },
    );
}

/**
 * Where a map pixel is on the screen, at its centre (so the studio, which floors a click's map
 * position, reads back exactly this pixel), and whether a click there reaches the map rather than
 * an overlay, a panel or the edge of the window (covering names what is in the way).
 *
 * @returns {Promise<{x: number, y: number, onMap: boolean, covering: string|null, scale: number}>}
 */
export function mapToScreen(page, x, y) {
    return page.evaluate(
        ([mapX, mapY]) => {
            const engine = globalThis.fwmbStudio.canvasEngine;
            const canvas = engine.app.canvas ?? engine.app.view;
            const rect = canvas.getBoundingClientRect();
            const stage = engine.stage;
            const screenX = rect.left + stage.x + (mapX + 0.5) * stage.scale.x;
            const screenY = rect.top + stage.y + (mapY + 0.5) * stage.scale.y;
            const inside = screenX >= 0 && screenY >= 0 && screenX < innerWidth && screenY < innerHeight;
            const hit = inside ? document.elementFromPoint(screenX, screenY) : null;
            const covering = hit && hit !== canvas ? (hit.closest("[class]")?.className ?? hit.tagName) : null;
            return { x: screenX, y: screenY, onMap: hit === canvas, covering, scale: stage.scale.x };
        },
        [x, y],
    );
}
