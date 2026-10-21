import { FILRODENSWMB } from "../config.js";
import { portCost, travelCost } from "./CellGraph.js";
import { SearchSpace, searchAll } from "./Search.js";

/**
 * Cultures: where each people lives, how they mix, and how they meet.
 *
 * Each culture has a homeland (where it fits best, spaced from the others, unless one is given) and
 * spreads outwards over the travel graph, cheaply through land that suits it and slowly through
 * land that does not. The culture that arrives first holds a cell; others blend in by how much
 * later they arrive, over a width that depends on how open both cultures are, so open cultures mix
 * widely and a closed culture keeps sharp edges and keeps others out of its land. Each cell then
 * gets a population multiplier: how well the cultures living there fit it, times their density.
 *
 * With the single default culture (open 0.5, density 1, no habitat) every effect here is neutral:
 * it fits everywhere at 1, the multiplier is 1, barriers and hostility are 1 and affinity is 1. A
 * run with no cultures therefore gives exactly the model's culture-free output.
 */

/**
 * @typedef {object} Culture
 * @property {string} name
 * @property {string} nameBase - A name base of the name generator.
 * @property {number} openness - 0 closed to 1 open.
 * @property {number} density - Population multiplier.
 * @property {object} habitat - Soft ranges: temperature and moisture [lo, hi] (0 to 1), heightM
 *     and reliefM [lo, hi] (metres), coast and river affinity (-1 avoids to 1 seeks).
 * @property {number} [homelandCell] - A model cell, or undefined to place it automatically.
 */

/**
 * @typedef {object} CultureData
 * @property {Culture[]} cultures
 * @property {Int32Array} shareStart - Each cell's shares are entries shareStart[c] to shareStart[c + 1].
 * @property {Int32Array} shareCulture
 * @property {Float64Array} shareValue - Largest first within a cell.
 * @property {Int32Array} dominant - The culture holding each land cell, or -1.
 * @property {Float64Array} popMult
 * @property {Int32Array} homelands - The homeland cell of each culture.
 */

/** The cultures a run uses: the given ones, or the single default culture. */
export function resolveCultures(list) {
    const fallback = FILRODENSWMB.GENERATOR.CULTURES.DEFAULT;
    const source = list?.length ? list : [fallback];
    return source.map((culture) => ({ ...fallback, ...culture, habitat: culture.habitat ?? {} }));
}

/** Soft band: 1 inside [lo, hi], easing to 0 over `soft` outside it; 1 with no range or value. */
function band(value, range, soft) {
    if (!range || Number.isNaN(value)) return 1;
    const [lo, hi] = range;
    let out = 0;
    if (value < lo) out = lo - value;
    else if (value > hi) out = value - hi;
    if (out <= 0) return 1;
    const t = Math.min(1, out / soft);
    return 1 - t * t * (3 - 2 * t);
}

/** Raises the fit where a sought feature is present, and lowers it (when sought) where it is missing. */
function affinityFactor(affinity, present) {
    if (!affinity) return 1;
    const { AFFINITY_RAISE, AFFINITY_LOWER } = FILRODENSWMB.GENERATOR.CULTURES;
    return present ? 1 + AFFINITY_RAISE * affinity : 1 - AFFINITY_LOWER * Math.max(0, affinity);
}

/** How well a land cell suits a culture, FIT_FLOOR to 1 (1 everywhere for a generalist). */
export function habitatFit(culture, cells, cell) {
    const { FIT_FLOOR, SOFT } = FILRODENSWMB.GENERATOR.CULTURES;
    const habitat = culture.habitat;
    let fit = band(cells.temperature[cell], habitat.temperature, SOFT.temperature)
        * band(cells.moisture[cell], habitat.moisture, SOFT.moisture)
        * band(cells.heightM[cell], habitat.heightM, SOFT.heightM)
        * band(cells.reliefM[cell], habitat.reliefM, SOFT.reliefM);
    fit *= affinityFactor(habitat.coast, cells.coastal[cell] === 1);
    fit *= affinityFactor(habitat.river, cells.riverKm[cell] > 0);
    return Math.min(1, Math.max(FIT_FLOOR, fit));
}

/** Closedness of two cultures meeting: 0 for the same culture or two fully open ones, 1 when either is fully closed. */
export function closedness(cultures, a, b) {
    if (a === b || a < 0 || b < 0) return 0;
    return 1 - Math.sqrt(cultures[a].openness * cultures[b].openness);
}

/** Trade affinity of two culture mixes ([[culture, share], ...]): 1 for one identical culture. */
export function affinity(cultures, mixA, mixB) {
    const floor = FILRODENSWMB.GENERATOR.CULTURES.AFFINITY_FLOOR;
    let total = 0;
    for (const [a, shareA] of mixA) {
        for (const [b, shareB] of mixB) total += shareA * shareB * (a === b ? 1 : Math.max(floor, 1 - closedness(cultures, a, b)));
    }
    return total;
}

/** The shares of one cell as [[culture, share], ...]. */
export function sharesOf(data, cell) {
    const shares = [];
    for (let entry = data.shareStart[cell]; entry < data.shareStart[cell + 1]; entry++) shares.push([data.shareCulture[entry], data.shareValue[entry]]);
    return shares;
}

/**
 * The culture mix of a town: the people of the cells within `hops` steps (more for bigger places),
 * nearer cells counting more and open cultures drawn in from further (cities as melting pots).
 * @returns {[number, number][]} [[culture, share], ...] largest first.
 */
export function townMix(data, cells, cellPop, cell, hops) {
    const { URBAN_PULL, MIX_MIN_SHARE } = FILRODENSWMB.GENERATOR.CULTURES;
    const totals = new Map();
    const seen = new Set([cell]);
    let frontier = [cell];
    for (let ring = 0; ring <= hops; ring++) {
        const weight = 1 / (1 + ring);
        for (const at of frontier) {
            for (let entry = data.shareStart[at]; entry < data.shareStart[at + 1]; entry++) {
                const culture = data.shareCulture[entry];
                const pull = 1 + URBAN_PULL * data.cultures[culture].openness * (ring / Math.max(1, hops));
                totals.set(culture, (totals.get(culture) ?? 0) + (cellPop[at] || 1) * data.shareValue[entry] * weight * pull);
            }
        }
        frontier = nextRing(cells, frontier, seen);
    }
    const sum = [...totals.values()].reduce((total, value) => total + value, 0) || 1;
    const mix = [...totals.entries()].map(([culture, value]) => [culture, value / sum]).filter(([, share]) => share >= MIX_MIN_SHARE).sort(byShare);
    return mix.length ? mix : [[Math.max(0, data.dominant[cell]), 1]];
}

function nextRing(cells, frontier, seen) {
    const next = [];
    for (const at of frontier) {
        for (let slot = cells.neighbourStart[at]; slot < cells.neighbourStart[at + 1]; slot++) {
            const neighbour = cells.neighbourList[slot];
            if (seen.has(neighbour)) continue;
            seen.add(neighbour);
            next.push(neighbour);
        }
    }
    return next;
}

/** Largest share first; the lower culture index first on a tie. */
function byShare(a, b) {
    return b[1] - a[1] || a[0] - b[0];
}

/**
 * Stage 1b: spreads the cultures and works out each cell's shares.
 * @param {import("./CellGraph.js").CellGraph} graph
 * @param {Culture[]} cultures
 * @returns {CultureData}
 */
export function spreadCultures(graph, cultures) {
    const cells = graph.cells;
    const base = graph.costs(travelCost(graph, { portKm: portCost(cells) }));
    const land = landCells(cells);
    const fits = cultures.map((culture) => fitTable(culture, cells, land));
    const meanFits = fits.map((fit) => meanFit(fit, cells, land));
    const homelands = placeHomelands(graph, cultures, fits, land, base);
    const distances = cultures.map((_, index) => spreadCost(graph, base, fits[index], meanFits[index], homelands[index]));
    return { cultures, homelands, ...shareCells(cells, cultures, fits, distances, land) };
}

function landCells(cells) {
    const land = [];
    for (let cell = 0; cell < cells.count; cell++) if (!cells.water[cell] && cells.landKm2[cell] > 0) land.push(cell);
    return land;
}

/** A culture's fit per cell (water 1: anyone can sail). */
function fitTable(culture, cells, land) {
    const fit = new Float64Array(cells.count).fill(1);
    for (const cell of land) fit[cell] = habitatFit(culture, cells, cell);
    return fit;
}

function meanFit(fit, cells, land) {
    let weighted = 0;
    let area = 0;
    for (const cell of land) {
        weighted += fit[cell] * cells.landKm2[cell];
        area += cells.landKm2[cell];
    }
    return area ? weighted / area : 1;
}

/**
 * Each culture's homeland: the given cell, or the best fit x food land not within
 * HOMELAND_SPACING_KM of an earlier homeland.
 */
function placeHomelands(graph, cultures, fits, land, base) {
    const taken = new Uint8Array(graph.count);
    const space = new SearchSpace(graph);
    const spacing = FILRODENSWMB.GENERATOR.CULTURES.HOMELAND_SPACING_KM;
    return Int32Array.from(cultures.map((culture, index) => {
        const cell = Number.isInteger(culture.homelandCell) && land.includes(culture.homelandCell) ? culture.homelandCell : bestHomeland(graph.cells, fits[index], land, taken);
        space.run([cell], base, { limit: spacing, visit: (reached) => (taken[reached] = 1) });
        return cell;
    }));
}

function bestHomeland(cells, fit, land, taken) {
    let best = -Infinity;
    let chosen = -1;
    for (const cell of land) {
        if (taken[cell]) continue;
        const score = fit[cell] * (cells.density[cell] + 1);
        if (score > best) {
            best = score;
            chosen = cell;
        }
    }
    return chosen >= 0 ? chosen : land[0];
}

/** A culture's arrival cost at every cell, spreading from its homeland. */
function spreadCost(graph, base, fit, mean, homeland) {
    const { FIT_COST, SPECIALIST_BONUS } = FILRODENSWMB.GENERATOR.CULTURES;
    const bonus = 1 - SPECIALIST_BONUS * (1 - mean);
    const cost = graph.costs((edge) => base[edge] * (1 + FIT_COST * (1 - 0.5 * (fit[graph.edgeA[edge]] + fit[graph.edgeB[edge]]))) * bonus);
    return searchAll(graph, [homeland], cost).best;
}

/** Shares, dominant culture and population multiplier of every land cell. */
function shareCells(cells, cultures, fits, distances, land) {
    const start = new Int32Array(cells.count + 1);
    const cultureList = [];
    const valueList = [];
    const dominant = new Int32Array(cells.count).fill(-1);
    const popMult = new Float64Array(cells.count).fill(1);
    const isLand = new Uint8Array(cells.count);
    for (const cell of land) isLand[cell] = 1;
    for (let cell = 0; cell < cells.count; cell++) {
        if (isLand[cell]) {
            const shares = cellShares(cultures, fits, distances, cell);
            for (const [culture, share] of shares) {
                cultureList.push(culture);
                valueList.push(share);
            }
            dominant[cell] = shares[0][0];
            popMult[cell] = populationMultiplier(cultures, fits, shares, cell);
        }
        start[cell + 1] = cultureList.length;
    }
    return { shareStart: start, shareCulture: Int32Array.from(cultureList), shareValue: Float64Array.from(valueList), dominant, popMult };
}

/** One land cell's shares: the first to arrive holds it, the others blend in by how late they come. */
function cellShares(cultures, fits, distances, cell) {
    const { BLEND_KM, MIN_SHARE } = FILRODENSWMB.GENERATOR.CULTURES;
    let holder = 0;
    let first = Infinity;
    distances.forEach((distance, index) => {
        if (distance[cell] < first) {
            first = distance[cell];
            holder = index;
        }
    });
    const weights = cultures.map((culture, index) => {
        if (index === holder) return fits[index][cell];
        const width = BLEND_KM * culture.openness * cultures[holder].openness;
        if (width <= 0 || !Number.isFinite(distances[index][cell])) return 0;
        return fits[index][cell] * Math.exp(-(distances[index][cell] - first) / width);
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    const kept = weights.map((weight, index) => [index, weight / total]).filter(([index, share]) => share >= MIN_SHARE || index === holder);
    const keptTotal = kept.reduce((sum, [, share]) => sum + share, 0);
    return kept.map(([index, share]) => [index, share / keptTotal]).sort(byShare);
}

function populationMultiplier(cultures, fits, shares, cell) {
    const floor = FILRODENSWMB.GENERATOR.CULTURES.POP_FLOOR;
    return shares.reduce((sum, [index, share]) => sum + share * (floor + (1 - floor) * fits[index][cell]) * (cultures[index].density ?? 1), 0);
}
