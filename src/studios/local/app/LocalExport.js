/**
 * A settlement map's export (L-surface step 5; the handoff's §1; boards X3a, X2a, X2b): what the
 * kernel's export dialogue is given of a settlement map, and how its image is drawn.
 *
 * - **The map** is the settlement's frame in pixels at 1× (LOCAL.EXPORT.M_PER_PX metres a pixel),
 *   the frame's centre at 0 m, as the engine places it.
 * - **The Area's presets:** Town view (the engine's town framing), Hinterland view (the whole
 *   frame) and What's on screen (the canvas's view, the part of it on the frame).
 * - **The scale** goes from the dialogue's least to **Finest** (the canvas's finest detail), read
 *   in metres a pixel; 1× is recommended (Ken, 2026-11-25).
 * - **The drawing:** the version's worker draws the area in tiles without the labels; the tiles are
 *   joined here, and the map's title, scale bar and north arrow drawn once over the whole image at
 *   its size, as the canvas draws them over its view.
 *
 * Pure but for the drawing, which is handed its worker's and the labels' calls.
 */
import { FILRODENSWMB } from "../../../config.js";
import { platform } from "../../../platform/index.js";
import { ExportScale } from "../../../kernel/export/ExportScale.js";

/** Each preset's label, the image line's key and its part of the file name. */
const PRESETS = Object.freeze({
    town: Object.freeze({ label: "FILRODENSWMB.UI.ExportPresetTown", what: "FILRODENSWMB.UI.ExportOfTheTownView", file: "town-view" }),
    hinterland: Object.freeze({ label: "FILRODENSWMB.UI.ExportPresetHinterland", what: "FILRODENSWMB.UI.ExportOfTheHinterland", file: "hinterland-view" }),
    screen: Object.freeze({ label: "FILRODENSWMB.UI.ExportPresetScreen", what: "FILRODENSWMB.UI.ExportOfTheView", file: "view" }),
});

export const LocalExport = Object.freeze({
    /** The largest scale: Finest, the canvas's finest detail (0.4 m a pixel is 3.125×). */
    ceiling() {
        return FILRODENSWMB.LOCAL.EXPORT.M_PER_PX / FILRODENSWMB.LOCAL.CANVAS.FINEST_M;
    },

    /** The settlement's frame in pixels at 1×. */
    mapOf(frame) {
        const m = FILRODENSWMB.LOCAL.EXPORT.M_PER_PX;
        return { width: frame.width / m, height: frame.height / m };
    },

    /** A rectangle in metres ([x0, y0, x1, y1]) as an area in pixels at 1×, the part of it on the frame. */
    areaOf(rect, frame) {
        const m = FILRODENSWMB.LOCAL.EXPORT.M_PER_PX;
        const x0 = Math.max(rect[0], -frame.width / 2);
        const y0 = Math.max(rect[1], -frame.height / 2);
        const x1 = Math.min(rect[2], frame.width / 2);
        const y1 = Math.min(rect[3], frame.height / 2);
        if (!(x1 > x0 && y1 > y0)) return { x: 0, y: 0, ...this.mapOf(frame) };
        return { x: (x0 + frame.width / 2) / m, y: (y0 + frame.height / 2) / m, width: (x1 - x0) / m, height: (y1 - y0) / m };
    },

    /**
     * The Area's presets (see the file's comment), in the order offered.
     * @param {{width: number, height: number}} frame
     * @param {{town: number[], screen?: number[]|null}} rects - The town view's and the canvas's, in metres.
     */
    presets(frame, { town, screen = null }) {
        const { i18n } = platform;
        const whole = [-frame.width / 2, -frame.height / 2, frame.width / 2, frame.height / 2];
        const areas = { town: this.areaOf(town ?? whole, frame), hinterland: this.areaOf(whole, frame), screen: this.areaOf(screen ?? whole, frame) };
        return FILRODENSWMB.LOCAL.EXPORT.PRESETS.map((id) => ({ id, label: i18n.localize(PRESETS[id].label), what: PRESETS[id].what, area: areas[id] }));
    },

    /** The slider's stops: 0.25×, 1×, 2× and Finest, 0.5× a short tick. */
    stops() {
        const { STOPS, MINOR } = FILRODENSWMB.LOCAL.EXPORT;
        const finest = this.ceiling();
        return [...STOPS.filter((stop) => stop < finest).map((stop) => ({ stop, label: `${stop}×` })), { stop: finest, label: platform.i18n.localize("FILRODENSWMB.UI.ExportFinest") }, ...MINOR.map((stop) => ({ stop, minor: true }))];
    },

    /** Finest's name at the ceiling; null for any other scale (the dialogue writes "2×"). */
    scaleName(scale) {
        return Math.abs(scale - this.ceiling()) < 1e-9 ? platform.i18n.localize("FILRODENSWMB.UI.ExportFinest") : null;
    },

    /** The ground an area and a pixel cover: in km from a kilometre across, in m below; a pixel in m. */
    measure() {
        const { i18n } = platform;
        const m = FILRODENSWMB.LOCAL.EXPORT.M_PER_PX;
        return {
            lengths(width, height) {
                const wide = Math.max(width, height) * m >= 1000;
                const text = (px) => (wide ? (px * m) / 1000 : px * m).toLocaleString(i18n.lang, { maximumFractionDigits: wide ? 1 : 0 });
                return { width: text(width), height: text(height), unit: wide ? "km" : "m" };
            },
            pixel(scale) {
                return { distance: (m / scale).toLocaleString(i18n.lang, { maximumFractionDigits: 2 }), unit: "m" };
            },
        };
    },

    /**
     * The file name (the plan's §2): `fwmb_<settlement>_<preset, or "area">_<scale>`, the scale
     * written 2x, 0-75x or finest. The extension is the format's.
     */
    fileName({ name, preset, scale }) {
        const slug = String(name ?? "").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase() || "settlement";
        const where = PRESETS[preset]?.file ?? "area";
        const times = this.scaleName(scale) ? "finest" : `${String(Math.round(scale * 100) / 100).replace(".", "-")}x`;
        return `fwmb_${slug}_${where}_${times}`;
    },

    /**
     * The image of an area at a scale: its size, and the view in metres each tile draws (and the
     * whole image's, for the labels). The pixels are those StudioCanvas.drawExport would make of
     * the same area and scale.
     * @param {{x: number, y: number, width: number, height: number}} area - In pixels at 1×.
     * @param {number} scale
     * @param {{width: number, height: number}} frame
     * @param {number} [tileLimit]
     */
    views(area, scale, frame, tileLimit = FILRODENSWMB.LOCAL.EXPORT.TILE_PX) {
        const mPerPx = FILRODENSWMB.LOCAL.EXPORT.M_PER_PX / scale;
        const left = Math.round(area.x * scale);
        const top = Math.round(area.y * scale);
        const width = Math.max(1, Math.round(area.width * scale));
        const height = Math.max(1, Math.round(area.height * scale));
        const x0 = -frame.width / 2 + left * mPerPx;
        const y0 = -frame.height / 2 + top * mPerPx;
        const viewOf = (x, y, w, h) => ({ rect: [x0 + x * mPerPx, y0 + y * mPerPx, x0 + (x + w) * mPerPx, y0 + (y + h) * mPerPx], mPerPx, widthPx: w, heightPx: h });
        const tiles = ExportScale.tiles(width, height, tileLimit).map((tile) => ({ ...tile, view: viewOf(tile.x, tile.y, tile.width, tile.height) }));
        return { width, height, whole: viewOf(0, 0, width, height), tiles, viewOf };
    },

    /**
     * The format estimates' sample tiles: as the World studio's, at the middles of the area's four
     * quarters, each EXPORT_FORMATS.ESTIMATE.TILE_PX a side (or the image's size, if less).
     */
    samples(area, scale, frame) {
        const { TILES, TILE_PX } = FILRODENSWMB.EXPORT_FORMATS.ESTIMATE;
        const image = this.views(area, scale, frame);
        const side = Math.min(TILE_PX, image.width, image.height);
        const across = Math.max(1, Math.round(Math.sqrt(TILES)));
        const views = [];
        for (let row = 0; row < across; row++) {
            for (let column = 0; column < across && views.length < TILES; column++) {
                const x = Math.max(0, Math.min(image.width - side, Math.round(((column + 0.5) / across) * image.width - side / 2)));
                const y = Math.max(0, Math.min(image.height - side, Math.round(((row + 0.5) / across) * image.height - side / 2)));
                views.push(image.viewOf(x, y, side, side));
            }
        }
        return { views, pixels: image.width * image.height };
    },

    /**
     * Draws the export: each tile from the worker, joined, then the labels once over the whole.
     * Stops between tiles when the signal is aborted (resolving null).
     * @param {object} options
     * @param {object} options.area - In pixels at 1×.
     * @param {number} options.scale
     * @param {{width: number, height: number}} options.frame
     * @param {(view: object) => Promise<CanvasImageSource>} options.tile - A tile without labels.
     * @param {(ctx: CanvasRenderingContext2D, view: object) => void} options.labels - The labels over the whole.
     * @param {(index: number) => void} [options.onTile]
     * @param {AbortSignal} [options.signal]
     * @param {(width: number, height: number) => HTMLCanvasElement} [options.makeCanvas]
     * @param {number} [options.tileLimit]
     */
    async draw({ area, scale, frame, tile, labels, onTile = null, signal = null, makeCanvas = canvasOfSize, tileLimit }) {
        const image = this.views(area, scale, frame, tileLimit);
        const output = makeCanvas(image.width, image.height);
        const ctx = output.getContext("2d");
        for (const [index, each] of image.tiles.entries()) {
            onTile?.(index);
            if (signal?.aborted) return null;
            const picture = await tile(each.view);
            if (signal?.aborted) {
                picture?.close?.();
                return null;
            }
            ctx.drawImage(picture, each.x, each.y);
            picture?.close?.();
        }
        ctx.save();
        labels(ctx, image.whole);
        ctx.restore();
        onTile?.(image.tiles.length);
        return output;
    },

    /** A picture from the worker (an ImageBitmap or a canvas) as a canvas, for the dialogue's preview and estimates. */
    canvasOf(picture, makeCanvas = canvasOfSize) {
        if (!picture || typeof picture.getContext === "function") return picture ?? null;
        const canvas = makeCanvas(picture.width, picture.height);
        canvas.getContext("2d").drawImage(picture, 0, 0);
        picture.close?.();
        return canvas;
    },
});

function canvasOfSize(width, height) {
    return Object.assign(globalThis.document.createElement("canvas"), { width, height });
}

/** The settlement export's remembered preset and aspect (client scope, not in Foundry's settings sheet). */
export function registerLocalExportSettings() {
    const { PRESETS: ids, SETTINGS } = FILRODENSWMB.LOCAL.EXPORT;
    platform.settings.register(SETTINGS.PRESET, { scope: "client", config: false, type: String, default: ids[0] });
    platform.settings.register(SETTINGS.ASPECT, { scope: "client", config: false, type: String, default: FILRODENSWMB.EXPORT_PNG.ASPECTS[0].id });
}
