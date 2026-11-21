import { FILRODENSWMB } from "../../config.js";

/**
 * How an export is drawn: in tiles no larger than EXPORT_PNG.TILE_PX (or the graphics card's
 * texture limit). The area, the scale and what fits are ExportArea's; a scene's grid is SceneArea's.
 */
export class ExportScale {
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

/**
 * Export to scene with an area (S0 step 7b; the decision record's §9, DE; board X4): the area in
 * whole grid cells with its corner where the grid's pattern starts again, so the scene's own grid
 * (which Foundry draws from the scene's corner) falls on the map's; a scale that makes each cell a
 * whole number of pixels, no smaller than Foundry allows; and the offsets by which the grid cell
 * data's keys move, so its first cell is the scene's. Pure, as ExportArea.
 */
export const SceneArea = Object.freeze({
    /**
     * A grid's cell steps (how far apart cells are across and down) and its period (how far apart
     * the points are where its pattern starts again), in map pixels; null for a gridless map. A hex
     * grid's size is the distance between its flat sides (see RegionalExtractor.planCrop): pointed-
     * top rows ("hexR") are size × √3 / 2 apart and repeat every two rows; flat-topped columns
     * ("hexC") likewise across.
     * @param {{type: string, size: number}} grid
     */
    geometry({ type, size }) {
        const s = Number(size);
        if (!(s > 0)) return null;
        const offset = (s * Math.sqrt(3)) / 2;
        if (type === "square") return { step: { x: s, y: s }, period: { x: s, y: s } };
        if (type === "hexR") return { step: { x: s, y: offset }, period: { x: s, y: offset * 2 } };
        if (type === "hexC") return { step: { x: offset, y: s }, period: { x: offset * 2, y: s } };
        return null;
    },

    /**
     * An area snapped to the grid (DE): its corner at the nearest start of the grid's pattern, then
     * as many whole cells across and down as fit nearest what was drawn, kept on the map (the corner
     * moving back a period where the map's edge leaves no room). A gridless map keeps the area as
     * drawn. With `fit`, the cells are as many as fit inside what was given (a nearest fit for Too
     * large must stay as small as it was worked out to be).
     * @returns {{area: {x: number, y: number, width: number, height: number}, cells: {across: number, down: number}|null}}
     */
    snap(area, grid, map, { fit = false } = {}) {
        const geometry = this.geometry(grid);
        if (!geometry) return { area: ExportArea.clip(area, map), cells: null };
        const { step, period } = geometry;
        const axis = (start, length, stepSize, periodSize, limit) => {
            let corner = Math.max(0, Math.round(start / periodSize)) * periodSize;
            while (corner > 0 && limit - corner < stepSize - 1e-9) corner -= periodSize;
            corner = Math.max(0, corner);
            const room = Math.max(1, Math.floor((limit - corner) / stepSize + 1e-9));
            const count = Math.min(room, Math.max(1, (fit ? Math.floor : Math.round)(length / stepSize + (fit ? 1e-9 : 0))));
            return { corner, count };
        };
        const across = axis(area.x, area.width, step.x, period.x, map.width);
        const down = axis(area.y, area.height, step.y, period.y, map.height);
        return {
            area: { x: across.corner, y: down.corner, width: across.count * step.x, height: down.count * step.y },
            cells: { across: across.count, down: down.count },
        };
    },

    /**
     * The scene's scale for a chosen one: the scale at which a cell is a whole number of pixels,
     * the nearest to it, and never smaller than `minCell` pixels (Foundry's least grid size). A
     * gridless map takes the scale as chosen. With `fit`, the largest such scale not above it.
     * @returns {{scale: number, cell: number|null, floor: number}} The scale, the cell in the
     *     scene's pixels, and the lowest scale the grid allows.
     */
    scale(chosen, grid, minCell, { fit = false } = {}) {
        const size = Number(grid?.size);
        if (!this.geometry(grid)) return { scale: chosen, cell: null, floor: 0 };
        const cell = Math.max(minCell, (fit ? Math.floor : Math.round)(size * chosen + (fit ? 1e-9 : 0)));
        return { scale: cell / size, cell, floor: minCell / size };
    },

    /**
     * How far the grid cell data's offsets move for an area snapped to the grid, so the cell at the
     * area's corner is the scene's first: in Foundry's offsets, `i` rows down and `j` columns
     * across. Whole periods, so a hex grid's row (or column) parity is kept.
     * @returns {{i: number, j: number}}
     */
    offset(area, grid) {
        const geometry = this.geometry(grid);
        if (!geometry) return { i: 0, j: 0 };
        return { i: Math.round(area.y / geometry.step.y), j: Math.round(area.x / geometry.step.x) };
    },

    /** Whether two choices of area and scale make the same scene (to a pixel, and the scale to 0.001). */
    same(a, b) {
        if (!a || !b) return false;
        const close = (p, q, tolerance) => Math.abs(Number(p) - Number(q)) <= tolerance;
        return close(a.x, b.x, 0.5) && close(a.y, b.y, 0.5) && close(a.width, b.width, 0.5) && close(a.height, b.height, 0.5) && close(a.scale, b.scale, 0.001);
    },
});
