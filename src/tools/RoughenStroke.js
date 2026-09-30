import { SpatialMath } from "./SpatialMath.js";
import { exactHypot, stampRuns } from "./BrushGeometry.js";
import { FILRODENSWMB } from "../config.js";

const SURFACE_TEXTURE = FILRODENSWMB.GENERATION.SURFACE_TEXTURE;
const FULL_ROUGHNESS = SURFACE_TEXTURE.FULL_ROUGHNESS;

/**
 * Extra pixels allowed around the strip a run of stamps can reach (see RoughenStroke#runLine). The
 * strip's edges are worked out a different way from a stamp's own distances, so the margin keeps
 * rounding from ever leaving out a pixel a stamp does reach; the exact test is still made for
 * every pixel inside it.
 */
const REJECT_MARGIN_PX = 1;

/**
 * How far inside the brush's full-strength core (see RoughenStroke.targetAt) a pixel must lie,
 * by a plain distance, to be given the full target without measuring its exact distance: far
 * more than the two distances can ever differ by.
 */
const FULL_ROUGHNESS_MARGIN_PX = 1e-6;

/**
 * The Roughen brush's effect on the ground, worked out so that painting a stroke stamp by stamp
 * and replaying it in one pass give exactly the same terrain.
 *
 * Every stamp asks each pixel it covers for a roughness (its target: full inside, easing out
 * across the brush's outer edge, see targetAt), and a pixel ends the stroke at the highest target
 * any stamp asked of it, never lower than it started. The texture laid is worked out from the
 * pixel's elevation and roughness from before the stroke, and the highest target (see
 * roughened). So a stroke's result depends only on which stamps it placed, not on how many
 * times they overlapped or in which order.
 *
 * That matters for speed. A stroke scrubbed back and forth over the same ground can place tens of
 * thousands of stamps at large sizes, and replaying them one by one (every time the map loads)
 * visited each pixel dozens of times to change nothing. The replay (see replay) instead finds,
 * for each pixel near the stroke, the nearest stamp of each straight run of stamps directly, and
 * writes each pixel once.
 *
 * While a stroke is painted live, the pixels' starting elevation and roughness are kept aside
 * (see beginLive and paintLive), so that each new stamp recomputes a pixel from them rather than
 * adding to what earlier stamps laid.
 */
export class RoughenStroke {
    #width;
    #height;

    // Live painting: each touched pixel's elevation and roughness from before the stroke, and the
    // highest target the stroke has asked of it so far (0 until a stamp touches it). Allocated on
    // the first live Roughen stroke only, since most sessions never use the brush.
    #before = null;
    #beforeRoughness = null;
    #liveTarget = null;
    #liveArea = SpatialMath.getEmptyBounds();

    // Replay: the highest target of the stroke being replayed, over its area; reused and grown.
    #replayTarget = new Uint8Array(0);

    constructor(width, height) {
        this.#width = width;
        this.#height = height;
    }

    /**
     * The roughness one stamp asks of a pixel `distance` from its centre: all of it out to the
     * inner edge of the brush's outer band (SURFACE_TEXTURE.EDGE of the radius wide), then easing
     * out to none at the brush's edge along a smooth curve, so the border of a roughened patch
     * shows no ridge or step. Fixed, rather than following the feather setting, so every Roughen
     * stroke gives ground the same texture.
     *
     * @param {number} distance - Distance from the stamp's centre (at most `size`).
     * @param {number} size - The brush radius.
     * @returns {number} A roughness from 0 to FULL_ROUGHNESS.
     */
    static targetAt(distance, size) {
        const edge = size * (1 - SURFACE_TEXTURE.EDGE);
        if (distance <= edge) return FULL_ROUGHNESS;
        if (size <= edge) return 0;

        const across = (size - distance) / (size - edge);
        return Math.round(FULL_ROUGHNESS * across * across * (3 - 2 * across));
    }

    /**
     * A pixel's elevation after a Roughen stroke raised its roughness from `beforeRoughness` to
     * `target` (which must be higher): the texture that was missing, laid on the elevation it had
     * before the stroke.
     *
     * The texture's height is limited near the coast (never more than SURFACE_TEXTURE.COAST_SHARE
     * of the ground's height above, or depth below, sea level), so it cannot move the coastline.
     * Ground already within 32-bit rounding distance of sea level could still be carried across
     * it by the addition itself, so such a pixel is left where it is.
     *
     * @param {number} before - The pixel's elevation before the stroke.
     * @param {number} beforeRoughness - Its roughness before the stroke.
     * @param {number} target - Its roughness after the stroke.
     * @param {number} texture - The surface texture at the pixel (about -1 to 1).
     * @param {number} maxAmplitude - The texture's full height (see ProceduralEngine.getSurfaceTextureAmplitude).
     * @param {number} seaLevel - The map's sea level.
     * @returns {number} The pixel's new elevation.
     */
    static roughened(before, beforeRoughness, target, texture, maxAmplitude, seaLevel) {
        const amplitude = Math.min(maxAmplitude, SURFACE_TEXTURE.COAST_SHARE * Math.abs(before - seaLevel));
        const next = before + ((target - beforeRoughness) / FULL_ROUGHNESS) * amplitude * texture;
        return Math.fround(next) >= seaLevel === before >= seaLevel ? next : before;
    }

    // --- Live painting ---

    /** Starts a Roughen stroke painted live: forgets what the last one touched. */
    beginLive() {
        if (!this.#liveTarget) return;

        const area = this.#liveArea;
        if (SpatialMath.isValidBounds(area)) {
            for (let y = area.minY; y <= area.maxY; y++) {
                this.#liveTarget.fill(0, y * this.#width + area.minX, y * this.#width + area.maxX + 1);
            }
        }
        this.#liveArea = SpatialMath.getEmptyBounds();
    }

    /**
     * Notes the box a live stamp covers, before its pixels are painted, so the next stroke can
     * clear exactly what this one touched.
     */
    noteLiveStamp(bounds) {
        if (!this.#liveTarget) {
            const total = this.#width * this.#height;
            this.#before = new Float32Array(total);
            this.#beforeRoughness = new Uint8Array(total);
            this.#liveTarget = new Uint8Array(total);
        }
        this.#liveArea = SpatialMath.mergeBounds(this.#liveArea, bounds);
    }

    /**
     * One pixel of a live Roughen stamp, asking it for `target`. Nothing happens unless the target
     * is higher than every earlier stamp of the stroke asked; the pixel is then recomputed from
     * its state before the stroke (see roughened), exactly as a replay of the stroke computes it.
     */
    paintLive(index, target, elevationData, roughnessData, texture, maxAmplitude, seaLevel) {
        const strokeTarget = this.#liveTarget[index];
        if (target <= strokeTarget) return;

        if (strokeTarget === 0) {
            this.#before[index] = elevationData[index];
            this.#beforeRoughness[index] = roughnessData[index];
        }
        this.#liveTarget[index] = target;

        const beforeRoughness = this.#beforeRoughness[index];
        if (target <= beforeRoughness) return;

        elevationData[index] = RoughenStroke.roughened(this.#before[index], beforeRoughness, target, texture, maxAmplitude, seaLevel);
        roughnessData[index] = target;
    }

    // --- Replay ---

    /**
     * Replays a recorded Roughen stroke in one pass, with exactly the result of painting it stamp
     * by stamp (see the class description).
     *
     * @param {object} stroke - The recorded stroke (`size` and `points`).
     * @param {object} target - Where and how to replay it.
     * @param {Float32Array} target.elevationData - Elevation to roughen.
     * @param {Uint8Array} target.roughnessData - Roughness to raise.
     * @param {number} target.seaLevel - The map's sea level.
     * @param {object|null} target.activeBounds - Only pixels inside this box are changed (null for all).
     * @param {function(object): (Float32Array|null)} target.surfaceTexture - Gives the texture for a box of the map.
     * @param {number} target.maxAmplitude - The texture's full height.
     * @param {function(object): void|null} target.onArea - Told the box about to be changed, before any change.
     */
    replay(stroke, { elevationData, roughnessData, seaLevel, activeBounds, surfaceTexture, maxAmplitude, onArea }) {
        const size = stroke.size;
        const path = stampRuns(stroke.points, size);
        const area = this.#replayArea(path, size, activeBounds);
        if (!SpatialMath.isValidBounds(area)) return;

        onArea?.(area);
        const texture = surfaceTexture(area);
        if (!texture) return;

        const targets = this.#replayTargets(area);
        this.#rasteriseStamp(targets, area, path.first.x, path.first.y, size);
        for (const run of path.runs) this.#rasteriseRun(targets, area, run, path.spacing, size);

        this.#applyTargets(targets, area, { elevationData, roughnessData, texture, maxAmplitude, seaLevel });
    }

    /** The box every stamp of the stroke covers, within the map and the active bounds. */
    #replayArea(path, size, activeBounds) {
        let area = RoughenStroke.#boxAround(path.first.x, path.first.y, path.first.x, path.first.y, size);
        for (const run of path.runs) {
            const last = (run.steps * path.spacing) / run.length;
            area = SpatialMath.mergeBounds(area, RoughenStroke.#boxAround(run.fromX, run.fromY, run.fromX + run.dx * last, run.fromY + run.dy * last, size));
        }

        const map = { minX: 0, maxX: this.#width - 1, minY: 0, maxY: this.#height - 1 };
        return SpatialMath.intersectBounds(SpatialMath.intersectBounds(area, map), activeBounds);
    }

    /** The pixel box a brush of radius `size` covers anywhere between two stamp centres. */
    static #boxAround(ax, ay, bx, by, size) {
        return {
            minX: Math.floor(Math.min(ax, bx) - size),
            maxX: Math.ceil(Math.max(ax, bx) + size),
            minY: Math.floor(Math.min(ay, by) - size),
            maxY: Math.ceil(Math.max(ay, by) + size),
        };
    }

    /** The replay's target buffer for `area`, cleared (one byte per pixel, row by row). */
    #replayTargets(area) {
        const count = (area.maxX - area.minX + 1) * (area.maxY - area.minY + 1);
        if (this.#replayTarget.length < count) this.#replayTarget = new Uint8Array(count);
        this.#replayTarget.fill(0, 0, count);
        return this.#replayTarget;
    }

    /** Raises the targets under a single stamp centred on (cx, cy). */
    #rasteriseStamp(targets, area, cx, cy, size) {
        const box = SpatialMath.intersectBounds(RoughenStroke.#boxAround(cx, cy, cx, cy, size), area);
        if (!SpatialMath.isValidBounds(box)) return;

        const cols = area.maxX - area.minX + 1;
        for (let y = box.minY; y <= box.maxY; y++) {
            const row = (y - area.minY) * cols - area.minX;
            for (let x = box.minX; x <= box.maxX; x++) {
                const distance = exactHypot(x - cx, y - cy);
                if (distance > size) continue;
                const target = RoughenStroke.targetAt(distance, size);
                if (target > targets[row + x]) targets[row + x] = target;
            }
        }
    }

    /**
     * Raises the targets under a straight run of stamps (see stampRuns). The stamps of a run lie
     * on a line at equal spacing, so the one nearest a pixel is the one nearest the pixel's
     * position along the line, rounded to a whole stamp; its two neighbours are tested as well, in
     * case the stamps' rounded positions make one of them nearer by a hair. Only that stamp's
     * target matters, since the target falls with distance.
     */
    #rasteriseRun(targets, area, run, spacing, size) {
        const centres = RoughenStroke.#runCentres(run, spacing);
        const last = run.steps - 1;
        const box = SpatialMath.intersectBounds(RoughenStroke.#boxAround(centres.x[0], centres.y[0], centres.x[last], centres.y[last], size), area);
        if (!SpatialMath.isValidBounds(box)) return;

        const cols = area.maxX - area.minX + 1;
        const line = RoughenStroke.#runLine(run, spacing, size);

        for (let y = box.minY; y <= box.maxY; y++) {
            const span = RoughenStroke.#rowSpan(line, y, box);
            if (!span) continue;

            const row = (y - area.minY) * cols - area.minX;
            const ry = y - run.fromY;
            for (let x = span.from; x <= span.to; x++) {
                // Ground an earlier stamp already asked for everything cannot be asked for more
                if (targets[row + x] === FULL_ROUGHNESS) continue;

                const along = ((x - run.fromX) * line.ux + ry * line.uy) / spacing - 1;
                const target = RoughenStroke.#runTargetAt(centres, along, last, x, y, line);
                if (target > targets[row + x]) targets[row + x] = target;
            }
        }
    }

    /**
     * The strip a run's stamps can reach: within `size` (plus REJECT_MARGIN_PX) either side of the
     * run's line, and from `size` before its first stamp to `size` beyond its last, measured along
     * the line. Kept as the line's unit direction and the limits of both distances.
     */
    static #runLine(run, spacing, size) {
        const reach = size + REJECT_MARGIN_PX;
        const core = Math.max(0, size * (1 - SURFACE_TEXTURE.EDGE) - FULL_ROUGHNESS_MARGIN_PX);
        return {
            size,
            coreSq: core * core,
            fromX: run.fromX,
            fromY: run.fromY,
            ux: run.dx / run.length,
            uy: run.dy / run.length,
            reach,
            alongMin: spacing - reach,
            alongMax: run.steps * spacing + reach,
        };
    }

    /**
     * The columns of row `y`, within `box`, that lie inside a run's strip (see #runLine), or null
     * if none do. Both distances change linearly along the row, so each limits the row to one
     * interval; the pixels the stamps can reach lie where the two overlap. Only the pixels in that
     * interval are tested exactly, instead of every pixel of the run's box (most of which, for a
     * diagonal run, lie out of reach).
     */
    static #rowSpan(line, y, box) {
        const ry = y - line.fromY;
        // Across the line: (x - fromX) * uy - ry * ux, which must lie within +-reach
        const across = RoughenStroke.#interval(line.uy, -ry * line.ux, -line.reach, line.reach);
        // Along the line: (x - fromX) * ux + ry * uy, which must lie within [alongMin, alongMax]
        const along = RoughenStroke.#interval(line.ux, ry * line.uy, line.alongMin, line.alongMax);
        if (!across || !along) return null;

        const from = Math.max(box.minX, Math.floor(line.fromX + Math.max(across.low, along.low)));
        const to = Math.min(box.maxX, Math.ceil(line.fromX + Math.min(across.high, along.high)));
        return from <= to ? { from, to } : null;
    }

    /**
     * The values of t for which `slope * t + offset` lies within [low, high], as an interval
     * (unbounded when the slope is 0 and the value always lies within them), or null if none do.
     */
    static #interval(slope, offset, low, high) {
        if (slope === 0) return offset >= low && offset <= high ? { low: -Infinity, high: Infinity } : null;

        const a = (low - offset) / slope;
        const b = (high - offset) / slope;
        return { low: Math.min(a, b), high: Math.max(a, b) };
    }

    /** The centre of every stamp of a run, computed exactly as the brush engine places them. */
    static #runCentres(run, spacing) {
        const x = new Float64Array(run.steps);
        const y = new Float64Array(run.steps);
        for (let i = 1; i <= run.steps; i++) {
            const lerpFactor = (i * spacing) / run.length;
            x[i - 1] = run.fromX + run.dx * lerpFactor;
            y[i - 1] = run.fromY + run.dy * lerpFactor;
        }
        return { x, y };
    }

    /**
     * The highest target any stamp of a run asks of pixel (px, py), given its position along the
     * run in stamps (see #nearestInRun). Most pixels lie well inside the brush's full-strength
     * core, or well beyond its reach, of the stamp nearest their position; for those the answer
     * is certain from a plain distance, which is cheaper than the stamp's own exact one (see
     * exactHypot) and can differ from it only in the last bit, far inside FULL_ROUGHNESS_MARGIN_PX.
     * Only pixels near the core's edge or the brush's edge are measured exactly.
     */
    static #runTargetAt(centres, along, last, px, py, line) {
        const guess = Math.min(last, Math.max(0, Math.round(along)));
        const dx = px - centres.x[guess];
        const dy = py - centres.y[guess];
        if (dx * dx + dy * dy < line.coreSq) return FULL_ROUGHNESS;

        const nearest = RoughenStroke.#nearestInRun(centres, along, last, px, py);
        return nearest > line.size ? 0 : RoughenStroke.targetAt(nearest, line.size);
    }

    /**
     * The distance from (px, py) to the nearest of a run's stamps, given the pixel's position
     * along the run in stamps (0 at the first stamp): the stamp at that position rounded, and
     * its neighbours either side, within the run.
     */
    static #nearestInRun(centres, along, last, px, py) {
        const guess = Math.min(last, Math.max(0, Math.round(along)));
        const from = Math.max(0, guess - 1);
        const to = Math.min(last, guess + 1);

        let nearest = Infinity;
        for (let k = from; k <= to; k++) {
            const distance = exactHypot(px - centres.x[k], py - centres.y[k]);
            if (distance < nearest) nearest = distance;
        }
        return nearest;
    }

    /** Raises every pixel of the area to its target, laying the texture it was missing. */
    #applyTargets(targets, area, { elevationData, roughnessData, texture, maxAmplitude, seaLevel }) {
        const cols = area.maxX - area.minX + 1;
        for (let y = area.minY; y <= area.maxY; y++) {
            const row = (y - area.minY) * cols - area.minX;
            for (let x = area.minX; x <= area.maxX; x++) {
                const target = targets[row + x];
                const index = y * this.#width + x;
                const roughness = roughnessData[index];
                if (target <= roughness) continue;

                elevationData[index] = RoughenStroke.roughened(elevationData[index], roughness, target, texture[index], maxAmplitude, seaLevel);
                roughnessData[index] = target;
            }
        }
    }
}
