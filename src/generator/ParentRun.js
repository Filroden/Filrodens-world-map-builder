import { FILRODENSWMB } from "../config.js";
import { CELL_FIELDS, TRADE_FIELDS, decodeModelRun, packArray, unpackArray } from "./ModelRun.js";

/**
 * A regional map's copy of the run it inherited its generated content from (its `parentRun`): the
 * cells of its parent's run that lie on it (and a margin round it), with their sites moved into
 * its own pixels. A regional map has generated content but no run of its own, so this is what its
 * thematic layers, the Travel tool's farmland and in-fill read until it is generated itself.
 *
 * The cells are kept as a saved run keeps them (see ModelRun: the same packed arrays, the culture
 * shares and the trade among them, the run's cultures), so whatever reads a run reads this one;
 * the history is left behind, since the History tool shows a map's own run. Its own fields:
 *   - `sites`: each cell's site in the regional map's pixels (`x` and `y`, packed at a tenth of
 *     a pixel, offset so a site in the margin off the map's top or left edge fits);
 *   - `spacingKm` and `spacingPx`: how far apart the cells are, in effective km and in the
 *     regional map's pixels.
 * A regional map cut from a regional map is given the cells of its parent's own run when it has
 * one, else those of its parent's copy.
 *
 * Shape: { version, origin: "parent", run, revision, cellCount, cultures, cells, sites: {x, y},
 *          spacingKm, spacingPx }
 */

export const PARENT_RUN_VERSION = 1;

/** Sites at a tenth of a pixel; the offset lets a site up to SITE_OFFSET / 10 px off the map's top or left edge fit. */
const SITE_SCALE = 10;
const SITE_OFFSET = 1e6;
const SITE = Object.freeze({ type: "u32", scale: SITE_SCALE, offset: SITE_OFFSET });

/** Culture shares and security are kept to 1/255, as ModelRun keeps them. */
const UNIT = 255;

/**
 * The cells of a run on a regional map cut from its map.
 * @param {object} run - The source map's own saved run (see ModelRun), or its copy of its parent's.
 * @param {object} frame
 * @param {ArrayLike<number>} frame.sites - Each of the run's cells' sites in the source map's pixels (x, y pairs).
 * @param {number} frame.spacingKm - How far apart the cells are, in effective km.
 * @param {number} frame.spacingPx - The same in the source map's pixels.
 * @param {{x: number, y: number, width: number, height: number}} frame.crop - The regional map's area in the source map's pixels.
 * @param {number} frame.zoomScale - Regional map pixels per source map pixel.
 * @param {number} [frame.marginCells] - The margin round the crop, in cells, so a cell at the
 *     regional map's edge keeps its neighbours.
 * @returns {object|null} The regional map's parentRun, or null when no cell lies on it.
 */
export function cropRun(run, { sites, spacingKm, spacingPx, crop, zoomScale, marginCells = FILRODENSWMB.PARENT_RUN.MARGIN_CELLS }) {
    const arrays = decodeModelRun(run);
    const count = run?.cellCount ?? 0;
    if (!(count > 0) || sites.length < count * 2) return null;
    const margin = marginCells * spacingPx;
    const kept = [];
    for (let cell = 0; cell < count; cell++) {
        const x = sites[cell * 2];
        const y = sites[cell * 2 + 1];
        if (x >= crop.x - margin && x <= crop.x + crop.width + margin && y >= crop.y - margin && y <= crop.y + crop.height + margin) kept.push(cell);
    }
    if (!kept.length) return null;
    const newIndex = new Int32Array(count).fill(-1);
    kept.forEach((cell, index) => (newIndex[cell] = index));

    const cells = {};
    for (const [name, field] of Object.entries(CELL_FIELDS)) {
        if (arrays[name]) cells[name] = packArray(kept.map((cell) => arrays[name][cell]), field);
    }
    Object.assign(cells, keptShares(arrays, kept));
    Object.assign(cells, keptTrade(arrays, newIndex));
    return {
        version: PARENT_RUN_VERSION,
        origin: "parent",
        run: run.run,
        revision: run.revision ?? FILRODENSWMB.GENERATOR.REVISION,
        cellCount: kept.length,
        cultures: structuredClone(run.cultures ?? []),
        cells,
        sites: {
            x: packArray(kept.map((cell) => (sites[cell * 2] - crop.x) * zoomScale), SITE),
            y: packArray(kept.map((cell) => (sites[cell * 2 + 1] - crop.y) * zoomScale), SITE),
        },
        spacingKm,
        spacingPx: spacingPx * zoomScale,
    };
}

/**
 * A parentRun's sites as x, y pairs in its map's pixels.
 * @param {object} parentRun
 * @returns {Float64Array}
 */
export function parentRunSites(parentRun) {
    const xs = unpackArray(parentRun.sites.x);
    const ys = unpackArray(parentRun.sites.y);
    const sites = new Float64Array(xs.length * 2);
    for (let cell = 0; cell < xs.length; cell++) {
        sites[cell * 2] = xs[cell];
        sites[cell * 2 + 1] = ys[cell];
    }
    return sites;
}

/** The kept cells' culture shares, in the kept cells' order. */
function keptShares({ shareStart, shareCulture, shareValue }, kept) {
    if (!shareStart || !shareCulture || !shareValue) return {};
    const start = [0];
    const culture = [];
    const value = [];
    for (const cell of kept) {
        for (let index = shareStart[cell]; index < shareStart[cell + 1]; index++) {
            culture.push(shareCulture[index]);
            value.push(shareValue[index]);
        }
        start.push(culture.length);
    }
    return {
        shareStart: packArray(start, { type: "index" }),
        shareCulture: packArray(culture, { type: "index", offset: 1 }),
        shareValue: packArray(value, { type: "u8", scale: UNIT }),
    };
}

/** The trade edges with both ends kept, renumbered. */
function keptTrade(arrays, newIndex) {
    if (!arrays.tradeFrom || !arrays.tradeTo || !arrays.tradeKind || !arrays.tradeValue) return {};
    const kept = { from: [], to: [], kind: [], value: [] };
    for (let edge = 0; edge < arrays.tradeFrom.length; edge++) {
        const a = newIndex[arrays.tradeFrom[edge]];
        const b = newIndex[arrays.tradeTo[edge]];
        if (!(a >= 0 && b >= 0)) continue;
        kept.from.push(a);
        kept.to.push(b);
        kept.kind.push(arrays.tradeKind[edge]);
        kept.value.push(arrays.tradeValue[edge]);
    }
    return Object.fromEntries(Object.entries(TRADE_FIELDS).map(([name, field]) => [name, packArray(kept[field.source], field)]));
}

/**
 * Whether a parentRun holds together (for MapImport): a site per cell, besides what a run must hold.
 * @param {object} parentRun
 * @param {function(object): boolean} runHoldsTogether - MapImport's check of a run's arrays.
 */
export function parentRunHoldsTogether(parentRun, runHoldsTogether) {
    if (!parentRun || parentRun.origin !== "parent" || !(parentRun.spacingPx > 0) || !(parentRun.spacingKm > 0)) return false;
    try {
        const sites = parentRunSites(parentRun);
        if (sites.length !== parentRun.cellCount * 2) return false;
    } catch {
        return false;
    }
    return runHoldsTogether(parentRun);
}
