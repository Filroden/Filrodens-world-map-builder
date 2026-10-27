// Screenshots of the studio for the tutorial: the whole studio or a part of it, with the pointer
// parked and no stray focus ring, so a rerun takes the same picture.
import { mapToScreen, REGIONS, STUDIO_SIZE } from "./studio.mjs";

/** How long a tooltip takes to go once the pointer leaves its control. */
const TOOLTIP_CLEAR_MS = 400;

/** The box of the first visible element a selector names. */
async function elementBox(page, selector) {
    const element = page.locator(selector).filter({ visible: true }).first();
    if (!(await element.count())) throw new Error(`screenshot region "${selector}" is not on the screen`);
    // A section further down a panel is scrolled into view, as a reader scrolls to it
    await element.scrollIntoViewIfNeeded();
    return element.boundingBox();
}

/** The screen box of a rectangle of the map, in map pixels [x0, y0, x1, y1]. */
async function mapBox(page, [x0, y0, x1, y1]) {
    const a = await mapToScreen(page, x0, y0);
    const b = await mapToScreen(page, x1, y1);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** The part of one box inside another: a map rectangle is never pictured beyond the map's own view. */
function intersect(a, b) {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}

/** A region (a name, { selector }, { map }, or { union: [regions] }) as a screen box, or null for the whole studio. */
async function regionBox(page, region) {
    if (!region || region === "studio") return null;
    if (typeof region === "string") {
        const selector = REGIONS[region];
        if (!selector) throw new Error(`unknown screenshot region "${region}" (known: studio, ${Object.keys(REGIONS).join(", ")})`);
        return elementBox(page, selector);
    }
    if (region.selector) return elementBox(page, region.selector);
    if (region.map) return intersect(await mapBox(page, region.map), await elementBox(page, REGIONS.map));
    if (region.union) {
        const boxes = (await Promise.all(region.union.map((part) => regionBox(page, part)))).filter(Boolean);
        const x = Math.min(...boxes.map((box) => box.x));
        const y = Math.min(...boxes.map((box) => box.y));
        return { x, y, width: Math.max(...boxes.map((box) => box.x + box.width)) - x, height: Math.max(...boxes.map((box) => box.y + box.height)) - y };
    }
    throw new Error(`cannot read screenshot region ${JSON.stringify(region)}`);
}

/** A box grown by a margin, in whole pixels, kept inside the studio. */
function clipOf(box, pad = 0) {
    const x = Math.max(0, Math.floor(box.x - pad));
    const y = Math.max(0, Math.floor(box.y - pad));
    const right = Math.min(STUDIO_SIZE.width, Math.ceil(box.x + box.width + pad));
    const bottom = Math.min(STUDIO_SIZE.height, Math.ceil(box.y + box.height + pad));
    return { x, y, width: right - x, height: bottom - y };
}

/**
 * Takes a step's screenshot.
 *
 * @param {object} page - Playwright's page.
 * @param {{name: string, region?: string|object, pad?: number, pointer?: number[]|"keep", keepFocus?: boolean, mapOnly?: boolean}} shot
 *     mapOnly: hides the map's overlays, for a picture of the map rather than the studio.
 *     pointer: a map pixel to rest the pointer on (so the information bar reads it), or "keep" to
 *     leave it where the step left it (holding an item); otherwise the pointer is parked on the
 *     panel's header, where nothing shows a tooltip.
 * @param {string} path - Where the PNG is written.
 */
export async function takeScreenshot(page, shot, path) {
    if (shot.pointer === "keep") {
        // The pointer stays where the step left it (holding an item, say)
    } else if (shot.pointer) {
        const at = await mapToScreen(page, shot.pointer[0], shot.pointer[1]);
        await page.mouse.move(at.x, at.y);
    } else {
        const header = await elementBox(page, `${REGIONS.panel} .fwmb-panel-header`);
        await page.mouse.move(header.x + header.width - 8, header.y + header.height / 2);
    }
    if (!shot.keepFocus) await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(TOOLTIP_CLEAR_MS);
    const box = await regionBox(page, shot.region);
    // A picture of the map alone leaves out the map's overlays (the information bar, hints and
    // controls), which would otherwise cover its corners
    const style = shot.mapOnly ? ".fwmb-map-overlay { visibility: hidden !important; }" : undefined;
    await page.screenshot({ path, clip: box ? clipOf(box, shot.pad ?? 0) : undefined, animations: "disabled", caret: "hide", style });
}
