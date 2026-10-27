import { Delaunay } from "../../vendor/d3-delaunay/d3-delaunay.js";
import { FILRODENSWMB } from "../config.js";
import { biomeProperties } from "./ModelBiomes.js";

/**
 * Stage 1, the base layer: what each model cell holds. The model cells are the display mesh's
 * model sites (display cells 0 to modelCount - 1); each pixel belongs to the model cell its display
 * cell belongs to (Mesh.parentOf), so the model needs no mesh of its own. Every pixel of the map's
 * rasters is read once and summed into its cell: land, sea and lake area, temperature, moisture,
 * height and relief, the food the land can grow, the biggest river, and the biome mix.
 *
 * Food: crops follow temperature and moisture (smooth ramps, with losses on the hottest and
 * wettest ground), times the biome's farming factor and cover; pasture feeds a share of the peak
 * where crops fail; land near a river or lake is watered; relief halves a cell's farmland at
 * RELIEF_HALF_M; a coastal cell adds fishing.
 */

/**
 * @typedef {object} ModelCells
 * @property {number} count
 * @property {number} kmPerPx - Effective km per map pixel.
 * @property {Float64Array} x - Site position (map pixels).
 * @property {Float64Array} y
 * @property {Uint8Array} kind - CELL_KIND.
 * @property {Uint8Array} water - 1 for a sea or lake cell.
 * @property {Float64Array} landKm2
 * @property {Float64Array} temperature - Mean over the cell's land (NaN for water).
 * @property {Float64Array} moisture
 * @property {Float64Array} heightM - Mean land height above sea level, in metres.
 * @property {Float64Array} reliefM - Highest minus lowest land, in metres.
 * @property {Uint8Array} biome - The built-in biome id most of the land behaves as (0 for water).
 * @property {Float64Array} food - People the cell can feed.
 * @property {Float64Array} density - Food per km² of land.
 * @property {Uint8Array} coastal
 * @property {Float64Array} shelter - Share of land around a coastal cell (0 elsewhere).
 * @property {Float64Array} riverKm - Upstream length of the biggest river in the cell.
 * @property {Uint8Array} navigable
 * @property {Float64Array} mouthKm - Upstream length of a river reaching the sea here, or 0.
 * @property {Float64Array} landCost - Off-road travel cost per km (cover and relief).
 * @property {Int32Array} neighbourStart - Compressed neighbour rows.
 * @property {Int32Array} neighbourList
 */

/** What a model cell mostly is. */
export const CELL_KIND = Object.freeze({ LAND: 0, LAKE: 1, SEA: 2 });

const DIAGONAL = Math.SQRT2;
const FAR = 1e9;

/** Smooth step from 0 at a to 1 at b. */
export function smooth(a, b, value) {
    const t = Math.min(1, Math.max(0, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

/**
 * Builds the model cells.
 * @param {import("./GeneratorInput.js").GeneratorInput} input
 * @param {{density?: number}} [world] - The world settings (density scales the peak density).
 * @returns {ModelCells}
 */
export function buildModelCells(input, world = {}) {
    const raster = rasterContext(input);
    const neighbours = modelNeighbours(input.modelSites);
    const sums = sumPixels(input, raster, (world.density ?? 1) * FILRODENSWMB.GENERATOR.VALUES.PEAK_DENSITY);
    return finishCells(input, raster, sums, neighbours);
}

/** Per-pixel helpers shared by the passes: scale, the pixel classes, rivers and shelter. */
function rasterContext(input) {
    const { width, height, seaLevel, elevation, waterMask, kmPerPx } = input;
    const isLake = (pixel) => waterMask[pixel] > 0;
    const isSea = (pixel) => elevation[pixel] < seaLevel && !isLake(pixel);
    const rivers = riverRaster(input, isSea);
    return {
        width,
        height,
        kmPerPx,
        pixelKm2: kmPerPx * kmPerPx,
        isLake,
        isSea,
        metres: (value) => (value - seaLevel) * input.metresPerUnit,
        riverKm: rivers.riverKm,
        mouths: rivers.mouths,
        riverDistance: distanceToWater(width, height, rivers.riverKm, isLake),
        landShare: landShareTable(width, height, isSea),
    };
}

/** The model sites' Delaunay neighbours as compressed rows. */
function modelNeighbours(sites) {
    const delaunay = new Delaunay(sites);
    const count = sites.length / 2;
    const start = new Int32Array(count + 1);
    const list = [];
    for (let cell = 0; cell < count; cell++) {
        for (const next of delaunay.neighbors(cell)) list.push(next);
        start[cell + 1] = list.length;
    }
    return { start, list: Int32Array.from(list) };
}

/**
 * Upstream river length per pixel (effective km, the largest where rivers overlap) and the river
 * mouths: the last point of each river that ends in the sea rather than in another river.
 */
function riverRaster(input, isSea) {
    const { width, height, rivers, kmPerPx } = input;
    const riverKm = new Float32Array(width * height);
    const mouths = [];
    const perFlow = (rivers?.pixelsPerBaseline || 1) * kmPerPx;
    for (const river of rivers?.list ?? []) {
        if (!river.flow) continue;
        const last = markRiver(river, riverKm, width, perFlow);
        if (!river.merges && last >= 0 && isSea(last)) mouths.push({ pixel: last, km: river.flow[river.flow.length - 1] * perFlow });
    }
    return { riverKm, mouths };
}

/** Writes one river's upstream length along its path; returns its last pixel (or -1). */
function markRiver(river, riverKm, width, perFlow) {
    const points = river.x.length;
    for (let point = 0; point < points; point++) {
        if (river.lake[point]) continue;
        const pixel = river.y[point] * width + river.x[point];
        const km = river.flow[point] * perFlow;
        if (km > riverKm[pixel]) riverKm[pixel] = km;
    }
    return points ? river.y[points - 1] * width + river.x[points - 1] : -1;
}

/**
 * Distance in pixels from every pixel to the nearest river or lake pixel, by a two-pass chamfer
 * (steps of 1 and √2), for irrigation.
 */
function distanceToWater(width, height, riverKm, isLake) {
    const distance = new Float32Array(width * height).fill(FAR);
    for (let pixel = 0; pixel < distance.length; pixel++) if (riverKm[pixel] > 0 || isLake(pixel)) distance[pixel] = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) chamferForward(distance, width, x, y);
    for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) chamferBackward(distance, width, x, y);
    return distance;
}

function chamferForward(distance, width, x, y) {
    const pixel = y * width + x;
    let best = distance[pixel];
    if (x > 0) best = Math.min(best, distance[pixel - 1] + 1);
    if (y > 0) {
        best = Math.min(best, distance[pixel - width] + 1);
        if (x > 0) best = Math.min(best, distance[pixel - width - 1] + DIAGONAL);
        if (x < width - 1) best = Math.min(best, distance[pixel - width + 1] + DIAGONAL);
    }
    distance[pixel] = best;
}

function chamferBackward(distance, width, x, y) {
    const pixel = y * width + x;
    const rows = distance.length / width;
    let best = distance[pixel];
    if (x < width - 1) best = Math.min(best, distance[pixel + 1] + 1);
    if (y < rows - 1) {
        best = Math.min(best, distance[pixel + width] + 1);
        if (x < width - 1) best = Math.min(best, distance[pixel + width + 1] + DIAGONAL);
        if (x > 0) best = Math.min(best, distance[pixel + width - 1] + DIAGONAL);
    }
    distance[pixel] = best;
}

/**
 * A summed-area table of land (lakes count as land: they do not expose a coast), and the share of
 * land in a square around a point read from it.
 */
function landShareTable(width, height, isSea) {
    const stride = width + 1;
    const table = new Float64Array(stride * (height + 1));
    for (let y = 0; y < height; y++) {
        let row = 0;
        for (let x = 0; x < width; x++) {
            row += isSea(y * width + x) ? 0 : 1;
            table[(y + 1) * stride + x + 1] = table[y * stride + x + 1] + row;
        }
    }
    return (cx, cy, radius) => {
        const x0 = Math.max(0, Math.round(cx - radius));
        const x1 = Math.min(width, Math.round(cx + radius));
        const y0 = Math.max(0, Math.round(cy - radius));
        const y1 = Math.min(height, Math.round(cy + radius));
        const area = (x1 - x0) * (y1 - y0);
        if (area <= 0) return 0;
        return (table[y1 * stride + x1] - table[y0 * stride + x1] - table[y1 * stride + x0] + table[y0 * stride + x0]) / area;
    };
}

/** The food one land pixel grows, in people per km² (relief is applied per cell). */
function pixelDensity(input, raster, pixel, properties, peakDensity) {
    const V = FILRODENSWMB.GENERATOR.VALUES;
    const temperature = input.temperature[pixel];
    let moisture = input.moisture[pixel];
    if (raster.riverDistance[pixel] * raster.kmPerPx <= V.IRRIGATION_KM) moisture = Math.max(moisture, V.IRRIGATED_MOISTURE);
    const cropT = smooth(V.CROP_TEMPERATURE[0], V.CROP_TEMPERATURE[1], temperature) * (1 - V.HOT_LOSS * smooth(V.CROP_HOT[0], V.CROP_HOT[1], temperature));
    const cropM = smooth(V.CROP_MOISTURE[0], V.CROP_MOISTURE[1], moisture) * (1 - V.WET_LOSS * smooth(V.CROP_WET[0], V.CROP_WET[1], moisture));
    const pasture = V.PASTURE_SHARE * smooth(V.PASTURE_TEMPERATURE[0], V.PASTURE_TEMPERATURE[1], temperature) * smooth(V.PASTURE_MOISTURE[0], V.PASTURE_MOISTURE[1], moisture);
    const biome = input.biome[pixel];
    const crop = cropT * cropM * properties.cover[biome] * properties.farming[biome];
    return peakDensity * Math.max(crop, pasture);
}

/** One pass over every pixel, summing into its model cell. */
function sumPixels(input, raster, peakDensity) {
    const count = input.modelSites.length / 2;
    const properties = biomeProperties();
    const biomeSlots = properties.slots;
    const sums = {
        pixels: new Float64Array(count),
        land: new Float64Array(count),
        sea: new Float64Array(count),
        lake: new Float64Array(count),
        temperature: new Float64Array(count),
        moisture: new Float64Array(count),
        height: new Float64Array(count),
        food: new Float64Array(count),
        river: new Float64Array(count),
        low: new Float64Array(count).fill(Infinity),
        high: new Float64Array(count).fill(-Infinity),
        biomes: new Float64Array(count * biomeSlots),
        biomeSlots,
    };
    const context = { input, raster, properties, peakDensity };
    const { modelOf } = input;
    for (let pixel = 0; pixel < modelOf.length; pixel++) {
        const cell = modelOf[pixel];
        sums.pixels[cell]++;
        if (raster.isSea(pixel)) sums.sea[cell]++;
        else if (raster.isLake(pixel)) sums.lake[cell]++;
        else addLandPixel(sums, cell, pixel, context);
    }
    return sums;
}

function addLandPixel(sums, cell, pixel, { input, raster, properties, peakDensity }) {
    const metres = raster.metres(input.elevation[pixel]);
    sums.land[cell]++;
    sums.temperature[cell] += input.temperature[pixel];
    sums.moisture[cell] += input.moisture[pixel];
    sums.height[cell] += metres;
    sums.food[cell] += pixelDensity(input, raster, pixel, properties, peakDensity) * raster.pixelKm2;
    if (metres < sums.low[cell]) sums.low[cell] = metres;
    if (metres > sums.high[cell]) sums.high[cell] = metres;
    sums.biomes[cell * sums.biomeSlots + input.biome[pixel]]++;
    if (raster.riverKm[pixel] > sums.river[cell]) sums.river[cell] = raster.riverKm[pixel];
}

/** Turns the sums into the per-cell values. */
function finishCells(input, raster, sums, neighbours) {
    const count = input.modelSites.length / 2;
    const cells = allocateCells(count, input, neighbours);
    for (let cell = 0; cell < count; cell++) classifyCell(cells, sums, cell);
    const mouthAt = mouthsByCell(input, raster);
    const properties = biomeProperties();
    for (let cell = 0; cell < count; cell++) finishCell(cells, sums, cell, raster, mouthAt, properties);
    return cells;
}

function allocateCells(count, input, neighbours) {
    const real = () => new Float64Array(count);
    const flag = () => new Uint8Array(count);
    const x = real();
    const y = real();
    for (let cell = 0; cell < count; cell++) {
        x[cell] = input.modelSites[2 * cell];
        y[cell] = input.modelSites[2 * cell + 1];
    }
    return {
        count,
        kmPerPx: input.kmPerPx,
        x,
        y,
        kind: flag(),
        water: flag(),
        landKm2: real(),
        temperature: real().fill(Number.NaN),
        moisture: real().fill(Number.NaN),
        heightM: real().fill(Number.NaN),
        reliefM: real(),
        biome: flag(),
        food: real(),
        density: real(),
        coastal: flag(),
        shelter: real(),
        riverKm: real(),
        navigable: flag(),
        mouthKm: real(),
        landCost: real().fill(1),
        neighbourStart: neighbours.start,
        neighbourList: neighbours.list,
    };
}

/** Land, lake or sea, by the share of the cell's pixels. */
function classifyCell(cells, sums, cell) {
    const V = FILRODENSWMB.GENERATOR.VALUES;
    let kind = CELL_KIND.SEA;
    if (sums.land[cell] / sums.pixels[cell] >= V.LAND_SHARE) kind = CELL_KIND.LAND;
    else if (sums.lake[cell] > sums.sea[cell]) kind = CELL_KIND.LAKE;
    cells.kind[cell] = kind;
    cells.water[cell] = kind === CELL_KIND.LAND ? 0 : 1;
}

/** The largest river mouth in each cell (upstream km), as a Map cell -> km. */
function mouthsByCell(input, raster) {
    const at = new Map();
    for (const mouth of raster.mouths) {
        const cell = input.modelOf[mouth.pixel];
        at.set(cell, Math.max(at.get(cell) ?? 0, mouth.km));
    }
    return at;
}

function finishCell(cells, sums, cell, raster, mouthAt, properties) {
    const V = FILRODENSWMB.GENERATOR.VALUES;
    const land = sums.land[cell];
    cells.riverKm[cell] = sums.river[cell];
    cells.navigable[cell] = sums.river[cell] >= V.NAVIGABLE_KM ? 1 : 0;
    cells.mouthKm[cell] = mouthAt.get(cell) ?? 0;
    if (!land) return;
    const coastal = isCoastal(cells, sums, cell);
    const relief = sums.high[cell] - sums.low[cell];
    const landKm2 = land * raster.pixelKm2;
    const biome = dominantBiome(sums, cell, properties);
    const fishing = coastal ? V.FISHING_DENSITY * landKm2 : 0;
    const food = sums.food[cell] / (1 + (relief / V.RELIEF_HALF_M) ** 2) + fishing;
    cells.landKm2[cell] = landKm2;
    cells.temperature[cell] = sums.temperature[cell] / land;
    cells.moisture[cell] = sums.moisture[cell] / land;
    cells.heightM[cell] = sums.height[cell] / land;
    cells.reliefM[cell] = relief;
    cells.biome[cell] = biome;
    cells.food[cell] = food;
    cells.density[cell] = food / landKm2;
    cells.coastal[cell] = coastal ? 1 : 0;
    cells.shelter[cell] = coastal ? raster.landShare(cells.x[cell], cells.y[cell], V.SHELTER_KM / raster.kmPerPx) : 0;
    cells.landCost[cell] = properties.travel[biome] * (1 + (relief / V.RELIEF_COST_M) ** 1.5);
}

/** A land cell with sea pixels of its own, or a neighbour that is mostly sea. */
function isCoastal(cells, sums, cell) {
    if (sums.sea[cell] > 0) return true;
    const share = FILRODENSWMB.GENERATOR.VALUES.COASTAL_SEA_SHARE;
    for (let slot = cells.neighbourStart[cell]; slot < cells.neighbourStart[cell + 1]; slot++) {
        const next = cells.neighbourList[slot];
        if (sums.sea[next] > sums.pixels[next] * share) return true;
    }
    return false;
}

/** The biome id with the most land pixels in a cell (the lowest id on a tie). */
function dominantBiome(sums, cell, properties) {
    let best = properties.ids[0];
    let most = -1;
    for (const id of properties.ids) {
        const pixels = sums.biomes[cell * sums.biomeSlots + id];
        if (pixels > most) {
            most = pixels;
            best = id;
        }
    }
    return best;
}
