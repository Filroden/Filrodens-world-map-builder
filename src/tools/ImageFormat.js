import { FILRODENSWMB } from "../config.js";
import { platform } from "../platform/index.js";

/**
 * The image formats an export is saved in (EXPORT_FORMATS): PNG, WebP lossless and WebP at 90%,
 * which formats this browser can write, each one's estimated size, and encoding a finished export.
 *
 * A browser that cannot encode WebP (Safari) quietly returns a PNG when asked for one, so a
 * format is offered only once the browser has been seen to return the type asked for, and an
 * encode that comes back as another type is saved as what it is (a PNG, named .png) rather than
 * under the wrong name.
 */
export class ImageFormat {
    /** The formats, in the order offered. */
    static get CHOICES() {
        return FILRODENSWMB.EXPORT_FORMATS.CHOICES;
    }

    /** A format by id, or PNG for an unknown one. */
    static byId(id) {
        return this.CHOICES.find((format) => format.id === id) ?? this.CHOICES[0];
    }

    /** The answer of #probe, once asked. */
    static #available = null;

    /**
     * The ids of the formats this browser can write: PNG always, WebP when a small test image
     * asked for as WebP comes back as WebP. Asked once a session.
     * @param {function(): HTMLCanvasElement} [makeCanvas] - For tests.
     * @returns {Promise<string[]>}
     */
    static available(makeCanvas = () => globalThis.document.createElement("canvas")) {
        this.#available ??= this.#probe(makeCanvas);
        return this.#available;
    }

    /** Forgets what the browser was seen to write (for tests). */
    static reset() {
        this.#available = null;
    }

    static async #probe(makeCanvas) {
        const canvas = makeCanvas();
        canvas.width = 2;
        canvas.height = 2;
        const blob = await toBlob(canvas, "image/webp", 1).catch(() => null);
        const webp = blob?.type === "image/webp";
        return this.CHOICES.filter((format) => format.type !== "image/webp" || webp).map((format) => format.id);
    }

    /**
     * Encodes a finished export. A format the browser cannot write falls back to PNG.
     * @param {HTMLCanvasElement} canvas
     * @param {string} id
     * @returns {Promise<{blob: Blob, format: object}>} The blob and the format it really is.
     */
    static async encode(canvas, id) {
        const format = this.byId(id);
        const blob = await toBlob(canvas, format.type, format.quality);
        if (!blob) throw new Error("The image could not be encoded");
        if (blob.type === format.type) return { blob, format };
        const png = this.byId("png");
        return { blob: blob.type === png.type ? blob : await toBlob(canvas, png.type), format: png };
    }

    /**
     * Each format's estimated size for a whole image, from sample tiles of it drawn at the same
     * scale: each tile is encoded in every format, and the bytes per pixel scaled to the whole.
     * @param {HTMLCanvasElement[]} tiles
     * @param {number} pixels - The whole image's width times height.
     * @param {string[]} ids - The formats to estimate.
     * @returns {Promise<Object<string, number>>} Bytes, by format id.
     */
    static async estimate(tiles, pixels, ids) {
        const sampled = tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0);
        const sizes = {};
        for (const id of ids) {
            const format = this.byId(id);
            let bytes = 0;
            for (const tile of tiles) bytes += (await toBlob(tile, format.type, format.quality))?.size ?? 0;
            sizes[id] = sampled > 0 ? Math.round((bytes / sampled) * pixels) : 0;
        }
        return sizes;
    }

    /**
     * A size in bytes as the user reads it: kB below a megabyte, MB with one decimal above.
     * @param {number} bytes
     * @returns {string}
     */
    static sizeText(bytes) {
        const i18n = platform.i18n;
        if (bytes < 1e6) return i18n.format("FILRODENSWMB.UI.SizeKilobytes", { value: Math.max(1, Math.round(bytes / 1e3)).toLocaleString() });
        return i18n.format("FILRODENSWMB.UI.SizeMegabytes", { value: (bytes / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 }) });
    }

    /**
     * The last format chosen for a kind of export ("png" or "scene"), if this browser can still
     * write it; PNG otherwise.
     * @param {"png"|"scene"} kind
     * @param {string[]} available
     */
    static remembered(kind, available) {
        let id;
        try {
            id = platform.settings.get(this.#settingOf(kind));
        } catch {
            // Not registered (a host that has not set the settings up): the default
            id = null;
        }
        return available.includes(id) ? id : FILRODENSWMB.EXPORT_FORMATS.DEFAULT;
    }

    /** Remembers the format chosen for a kind of export. */
    static async remember(kind, id) {
        if (!this.CHOICES.some((format) => format.id === id)) return;
        await platform.settings.set(this.#settingOf(kind), id);
    }

    static #settingOf(kind) {
        const { PNG, SCENE } = FILRODENSWMB.EXPORT_FORMATS.SETTINGS;
        return kind === "scene" ? SCENE : PNG;
    }
}

/**
 * Registers the reader's own last choices of format (client scope, not listed in Foundry's
 * settings sheet: the export dialogues offer them).
 */
export function registerExportFormatSettings() {
    for (const key of Object.values(FILRODENSWMB.EXPORT_FORMATS.SETTINGS)) {
        platform.settings.register(key, { scope: "client", config: false, type: String, default: FILRODENSWMB.EXPORT_FORMATS.DEFAULT });
    }
}

/** canvas.toBlob as a promise (an OffscreenCanvas's convertToBlob too). */
function toBlob(canvas, type, quality) {
    if (typeof canvas.convertToBlob === "function" && typeof canvas.toBlob !== "function") return canvas.convertToBlob({ type, quality });
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
