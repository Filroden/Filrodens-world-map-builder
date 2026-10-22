import { FILRODENSWMB } from "../config.js";

/**
 * The PNG export's scales: what each makes, which the map allows, and which is recommended, so
 * the smallest name shown can be read in the image without zooming in.
 *
 * A scale is allowed while the image stays within EXPORT_PNG.MAX_SIDE on a side and
 * EXPORT_PNG.MAX_PIXELS in all. The recommended scale is the smallest allowed one at which the
 * smallest name shown is at least EXPORT_PNG.MIN_LABEL_PX tall, in whole pixels; when none reaches it, the largest
 * allowed; with no names shown, 1x.
 */
export class ExportScale {
    /**
     * @param {object} options
     * @param {number} options.width - The map's width in pixels (the image's at 1x).
     * @param {number} options.height
     * @param {number|null} options.smallestLabelPx - The smallest name shown, in map pixels (null for none).
     * @returns {{options: {scale: number, width: number, height: number, allowed: boolean, recommended: boolean}[], recommended: number, reason: {kind: string, px?: number, scaledPx?: number, scale?: number}}}
     */
    static plan({ width, height, smallestLabelPx }) {
        const { SCALES, MIN_LABEL_PX, MAX_SIDE, MAX_PIXELS } = FILRODENSWMB.EXPORT_PNG;
        const options = SCALES.map((scale) => {
            const w = Math.round(width * scale);
            const h = Math.round(height * scale);
            return { scale, width: w, height: h, allowed: scale === SCALES[0] || (Math.max(w, h) <= MAX_SIDE && w * h <= MAX_PIXELS), recommended: false };
        });
        const allowed = options.filter((option) => option.allowed);
        let recommended = allowed[0].scale;
        let reason = { kind: "none" };
        if (Number(smallestLabelPx) > 0) {
            const px = smallestLabelPx;
            // Decided on the whole pixels the reason gives, so the two always agree
            const reaching = allowed.find((option) => Math.round(px * option.scale) >= MIN_LABEL_PX);
            if (reaching) {
                recommended = reaching.scale;
                reason = { kind: reaching.scale === SCALES[0] ? "enough" : "reaches", px, scaledPx: px * reaching.scale, scale: reaching.scale };
            } else {
                recommended = allowed.at(-1).scale;
                reason = { kind: "short", px, scaledPx: px * recommended, scale: recommended };
            }
        }
        for (const option of options) option.recommended = option.scale === recommended;
        return { options, recommended, reason };
    }

    /**
     * The tiles an image is drawn in, each at most `tile` pixels on a side, covering it exactly
     * (left to right, then top to bottom).
     * @param {number} width
     * @param {number} height
     * @param {number} [tile]
     * @returns {{x: number, y: number, width: number, height: number}[]}
     */
    static tiles(width, height, tile = FILRODENSWMB.EXPORT_PNG.TILE_PX) {
        const step = Math.max(1, Math.floor(tile));
        const tiles = [];
        for (let y = 0; y < height; y += step) {
            for (let x = 0; x < width; x += step) tiles.push({ x, y, width: Math.min(step, width - x), height: Math.min(step, height - y) });
        }
        return tiles;
    }
}
