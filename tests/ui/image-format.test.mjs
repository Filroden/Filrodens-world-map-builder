// Image formats on exports (src/tools/ImageFormat.js): WebP is offered only where the browser
// really writes it, an encode that comes back as another type is saved as what it is, sizes are
// estimated from sample tiles, the last choice is remembered per kind of export, and a scene's
// earlier GM overlay is found in either format. Canvases are stand-ins whose toBlob answers as a
// browser would.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

const { installPlatform, platform } = await import("../../src/platform/index.js");
const stored = new Map();
installPlatform({
    ...platform,
    i18n: { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" },
    settings: {
        register: () => {},
        get: (key) => stored.get(key) ?? "png",
        set: async (key, value) => stored.set(key, value),
    },
});
const { FILRODENSWMB } = await import("../../src/config.js");
const { ImageFormat } = await import("../../src/tools/ImageFormat.js");
const { SceneExporter } = await import("../../src/platform/foundry/SceneExporter.js");

/**
 * A canvas whose toBlob writes `bytesPerPixel[type]` bytes a pixel, and returns PNG for WebP when
 * the browser cannot write WebP (as Safari does).
 */
function canvas({ width = 100, height = 100, webp = true, bytesPerPixel = { "image/png": 2, "image/webp": 1 } } = {}) {
    return {
        width,
        height,
        asked: [],
        toBlob(callback, type, quality) {
            this.asked.push([type, quality]);
            const written = type === "image/webp" && !webp ? "image/png" : type;
            const perPixel = written === "image/webp" && quality < 1 ? 0.25 : bytesPerPixel[written];
            callback({ type: written, size: Math.round(this.width * this.height * perPixel) });
        },
    };
}

beforeEach(() => {
    ImageFormat.reset();
    stored.clear();
});

test("WebP is offered only when the browser returns WebP when asked for it; PNG always", async () => {
    assert.deepEqual(await ImageFormat.available(() => canvas()), ["png", "webp", "webp90"]);
    ImageFormat.reset();
    assert.deepEqual(await ImageFormat.available(() => canvas({ webp: false })), ["png"], "a browser that quietly writes PNG is offered PNG only");
});

test("an export is encoded in the format asked for at its quality, and one that comes back as PNG is saved as a PNG", async () => {
    const image = canvas();
    const lossless = await ImageFormat.encode(image, "webp");
    assert.deepEqual([lossless.blob.type, lossless.format.extension], ["image/webp", "webp"]);
    assert.deepEqual(image.asked.at(-1), ["image/webp", 1], "lossless WebP is quality 1");
    await ImageFormat.encode(image, "webp90");
    assert.deepEqual(image.asked.at(-1), ["image/webp", 0.9]);

    const safari = await ImageFormat.encode(canvas({ webp: false }), "webp90");
    assert.deepEqual([safari.blob.type, safari.format.id, safari.format.extension], ["image/png", "png", "png"]);
    assert.equal(ImageFormat.byId("gif").id, "png", "an unknown format is PNG");
});

test("sizes are estimated from sample tiles, scaled from their bytes a pixel to the whole image", async () => {
    const tiles = [canvas({ width: 10, height: 10 }), canvas({ width: 10, height: 10 })];
    const sizes = await ImageFormat.estimate(tiles, 1000 * 1000, ["png", "webp", "webp90"]);
    assert.deepEqual(sizes, { png: 2_000_000, webp: 1_000_000, webp90: 250_000 });
    assert.equal(ImageFormat.sizeText(250_000), 'FILRODENSWMB.UI.SizeKilobytes {"value":"250"}');
    assert.match(ImageFormat.sizeText(21_270_499), /SizeMegabytes \{"value":"21\.3"\}/);
});

test("the last format chosen is remembered for each kind of export, and only offered back if the browser can still write it", async () => {
    assert.equal(ImageFormat.remembered("png", ["png", "webp", "webp90"]), "png", "PNG until something else is chosen");
    await ImageFormat.remember("png", "webp90");
    await ImageFormat.remember("scene", "webp");
    assert.equal(ImageFormat.remembered("png", ["png", "webp", "webp90"]), "webp90");
    assert.equal(ImageFormat.remembered("scene", ["png", "webp", "webp90"]), "webp");
    assert.equal(ImageFormat.remembered("png", ["png"]), "png", "a WebP choice falls back to PNG in a browser without WebP");
    await ImageFormat.remember("png", "<script>");
    assert.equal(stored.get(FILRODENSWMB.EXPORT_FORMATS.SETTINGS.PNG), "webp90", "an unknown format is never stored");
});

test("a re-exported scene finds its earlier GM overlay in either format", () => {
    for (const src of ["fwmb-exports/harbour_gm.png", "fwmb-exports/harbour_gm.webp", "fwmb-exports/harbour_gm.webp?1730000000"]) assert.ok(SceneExporter.isOverlayTile(src), src);
    for (const src of ["fwmb-exports/harbour_player.webp", "tiles/gm.png", null, undefined]) assert.ok(!SceneExporter.isOverlayTile(src), String(src));
});
