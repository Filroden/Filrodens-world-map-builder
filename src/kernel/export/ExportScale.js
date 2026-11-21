import { FILRODENSWMB } from "../../config.js";

/**
 * The PNG export's scales: what each makes, which the map allows, and which is recommended, so
 * the smallest name shown can be read in the image without zooming in.
 *
 * A scale is allowed while the image stays within EXPORT_PNG.MAX_SIDE on a side (or a smaller
 * limit given, such as the graphics card's largest texture for a scene's background) and
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
     * @param {number} [options.maxSide] - The longest side allowed, if less than EXPORT_PNG.MAX_SIDE.
     * @returns {{options: {scale: number, width: number, height: number, allowed: boolean, recommended: boolean}[], recommended: number, reason: {kind: string, px?: number, scaledPx?: number, scale?: number}}}
     */
    static plan({ width, height, smallestLabelPx, maxSide = Infinity }) {
        const { SCALES, MIN_LABEL_PX, MAX_PIXELS } = FILRODENSWMB.EXPORT_PNG;
        const MAX_SIDE = Math.min(FILRODENSWMB.EXPORT_PNG.MAX_SIDE, maxSide);
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

/**
 * The export dialogue's arithmetic (S0 step 7; the decision record's §9): an **area** of the map
 * (map pixels) at a continuous **scale**, with the presets and aspects that choose the area, and
 * what fits when a choice is too large. Pure, so the dialogue and its tests share it.
 */
export const ExportArea = Object.freeze({
    /** The scale's slider: a value in steps of SCALE.STEP, from SCALE.MIN to the ceiling. */
    snapScale(value, ceiling = FILRODENSWMB.EXPORT_PNG.SCALE.CEILING) {
        const { MIN, STEP } = FILRODENSWMB.EXPORT_PNG.SCALE;
        const number = Number(value);
        if (!Number.isFinite(number)) return 1;
        const stepped = Math.round(number / STEP) * STEP;
        return Math.round(Math.min(Math.max(stepped, MIN), ceiling) * 100) / 100;
    },

    /** The image's size for an area at a scale, in whole pixels (one at least). */
    size(area, scale) {
        return { width: Math.max(1, Math.round(area.width * scale)), height: Math.max(1, Math.round(area.height * scale)) };
    },

    /**
     * Whether an image of a size can be drawn: no side past MAX_SIDE (or a smaller limit, the
     * graphics card's texture size for a scene) and no more than MAX_PIXELS in all.
     */
    fits({ width, height }, maxSide = Infinity) {
        const { MAX_SIDE, MAX_PIXELS } = FILRODENSWMB.EXPORT_PNG;
        return Math.max(width, height) <= Math.min(MAX_SIDE, maxSide) && width * height <= MAX_PIXELS;
    },

    /**
     * The recommended scale, from the smallest name shown (in map pixels): the smallest whole
     * stop (EXPORT_PNG.SCALES, up to the ceiling) at which it is at least MIN_LABEL_PX tall, in
     * whole pixels; the ceiling when none reaches it; 1× with no names shown. It does not depend on
     * the area (DE), and it is flagged on the slider, never chosen for the reader.
     * @returns {{scale: number, kind: "none"|"enough"|"reaches"|"short", px?: number, scaledPx?: number}}
     */
    recommend(smallestLabelPx, ceiling = FILRODENSWMB.EXPORT_PNG.SCALE.CEILING) {
        const { MIN_LABEL_PX, SCALES } = FILRODENSWMB.EXPORT_PNG;
        const px = Number(smallestLabelPx);
        if (!(px > 0)) return { scale: 1, kind: "none" };
        if (Math.round(px) >= MIN_LABEL_PX) return { scale: 1, kind: "enough", px, scaledPx: px };
        const reaching = SCALES.find((scale) => scale <= ceiling && Math.round(px * scale) >= MIN_LABEL_PX);
        if (reaching) return { scale: reaching, kind: "reaches", px, scaledPx: px * reaching };
        return { scale: ceiling, kind: "short", px, scaledPx: px * ceiling };
    },

    /**
     * An area at a scale: the image's size, whether it fits, and when it does not the two nearest
     * fits (DE, board X2a): the largest step at which the area fits, and the largest area of the
     * same aspect, centred on the one chosen and kept on the map, that fits at the scale chosen.
     * @param {{width: number, height: number}} map - The map's size in pixels.
     * @param {{x: number, y: number, width: number, height: number}} area
     * @param {number} scale
     * @param {{maxSide?: number}} [options]
     */
    plan(map, area, scale, { maxSide = Infinity } = {}) {
        const { MIN, STEP } = FILRODENSWMB.EXPORT_PNG.SCALE;
        const size = this.size(area, scale);
        const fits = this.fits(size, maxSide);
        let fitScale = null;
        let fitArea = null;
        if (!fits) {
            // The largest step below the scale chosen at which the whole area fits
            for (let steps = Math.floor(scale / STEP + 1e-9); steps * STEP >= MIN - 1e-9; steps--) {
                const candidate = Math.round(steps * STEP * 100) / 100;
                if (this.fits(this.size(area, candidate), maxSide)) {
                    fitScale = candidate;
                    break;
                }
            }
            // The largest area of the same aspect that fits at the scale chosen, centred on it
            const { MAX_SIDE, MAX_PIXELS } = FILRODENSWMB.EXPORT_PNG;
            const side = Math.min(MAX_SIDE, maxSide) / scale;
            const shrink = Math.min(1, side / Math.max(area.width, area.height), Math.sqrt(MAX_PIXELS / (area.width * area.height * scale * scale)));
            let width = Math.floor(area.width * shrink);
            let height = Math.floor(area.height * shrink);
            while ((width > 1 || height > 1) && !this.fits(this.size({ width, height }, scale), maxSide)) {
                width = Math.max(1, width - 1);
                height = Math.max(1, Math.round((width * area.height) / area.width));
            }
            fitArea = this.clip({ x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height }, map);
        }
        return { ...size, fits, fitScale, fitArea };
    },

    /** An area kept on the map: whole pixels, at least one wide and high, moved (not cut) inside it. */
    clip(area, map) {
        const width = Math.max(1, Math.min(Math.round(area.width), map.width));
        const height = Math.max(1, Math.min(Math.round(area.height), map.height));
        const x = Math.min(Math.max(Math.round(area.x), 0), map.width - width);
        const y = Math.min(Math.max(Math.round(area.y), 0), map.height - height);
        return { x, y, width, height };
    },

    /**
     * A preset's area: the whole map, or what is on screen (the camera's view, in map pixels,
     * clipped to the map, the part of it on the map).
     */
    preset(id, map, view = null) {
        if (id === "screen" && view) {
            const x0 = Math.max(0, view.x);
            const y0 = Math.max(0, view.y);
            const x1 = Math.min(map.width, view.x + view.width);
            const y1 = Math.min(map.height, view.y + view.height);
            if (x1 - x0 >= 1 && y1 - y0 >= 1) return this.clip({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, map);
        }
        return { x: 0, y: 0, width: map.width, height: map.height };
    },

    /** An aspect's ratio (width over height): null for Free, the map's own for "map". */
    ratio(aspectId, map) {
        const aspect = FILRODENSWMB.EXPORT_PNG.ASPECTS.find((each) => each.id === aspectId);
        if (!aspect || aspect.ratio === null) return null;
        return aspect.ratio === "map" ? map.width / map.height : aspect.ratio;
    },

    /**
     * An area given an aspect, about its centre: as much of the area's size as the ratio allows
     * (its area kept where the map has room), then kept on the map.
     */
    withAspect(area, ratio, map) {
        if (!ratio) return this.clip(area, map);
        const cx = area.x + area.width / 2;
        const cy = area.y + area.height / 2;
        let width = Math.sqrt(area.width * area.height * ratio);
        let height = width / ratio;
        const fit = Math.min(1, map.width / width, map.height / height);
        width *= fit;
        height *= fit;
        return this.clip({ x: cx - width / 2, y: cy - height / 2, width, height }, map);
    },

    /**
     * The export's file name (DE): the map's (or the age's, the journey's) name, the area when it
     * is not the whole map ("area" for one drawn, "view" for what is on screen), and the scale
     * ("2x", "0-75x"); `fwmb_` first, as today's files are named. The extension is the format's.
     */
    fileName({ name, preset, scale }) {
        const slug = String(name ?? "").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase() || "map";
        const where = preset === "drawn" ? "_area" : preset === "screen" ? "_view" : "";
        const times = `${String(Math.round(scale * 100) / 100).replace(".", "-")}x`;
        return `fwmb_${slug}${where}_${times}`;
    },
});
