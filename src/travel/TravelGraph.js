import { buildModelCells } from "../generator/CellValues.js";
import { CellGraph, portCost, reliefTerm } from "../generator/CellGraph.js";
import { modelBiomeRaster } from "../generator/ModelBiomes.js";
import { FILRODENSWMB } from "../config.js";

/**
 * The generator's travel network, for the Travel tool: the model cells and their graph built from
 * the generator's payload as a run builds them (see Pipeline), reduced to what travel times need.
 * It runs in the worker, since building the model cells reads the whole terrain.
 *
 * The cells may be finer than the generator's (see TravelGrid: the payload's modelSites and
 * modelOf are then the travel cells'). A cell's relief is the height range inside it, which shrinks
 * with the cell, so `reliefScale` (the generator's cell size over these cells') scales it back to
 * the generator's measure: the same slope then costs the same.
 *
 * Shape: { count, edgeA, edgeB, edgeKm, edgeKind, adjStart, adjCell, adjEdge, water, landCost,
 *          reliefTerm, riverKm, heightM, portKm, siteX, siteY, temperature, latitude, windX },
 * every array typed. `portKm` is each cell's loading cost at a harbour with no town (the
 * generator's; travel waits instead, see TravelTime). The climate's figures (see climateShape)
 * serve the seasons and winds of revision 2 (see TravelTime.travelConditions).
 *
 * @param {import("../generator/GeneratorInput.js").GeneratorPayload & {reliefScale?: number, travelClimate?: {latTop?: number, latBottom?: number, windDistance?: number}}} payload
 * @returns {object}
 */
export function buildTravelGraph(payload) {
    const [cells, graph] = travelCells(payload);
    return Object.assign(travelShape(cells, graph), climateShape(payload, graph.count));
}

/**
 * The model cells and their graph as a travel network builds them (see buildTravelGraph), for
 * whatever needs the cells' other figures too (see Infill).
 * @returns {[import("../generator/CellValues.js").ModelCells, CellGraph]}
 */
export function travelCells(payload) {
    const cells = buildModelCells({ ...payload, biome: modelBiomeRaster(payload) }, payload.settings?.world ?? {});
    scaleRelief(cells, payload.reliefScale ?? 1);
    return [cells, new CellGraph(cells)];
}

/** The travel network's shape (see buildTravelGraph) of built cells and their graph. */
export function travelShape(cells, graph) {
    const count = graph.count;
    const port = portCost(cells);
    return {
        count,
        edgeA: graph.edgeA,
        edgeB: graph.edgeB,
        edgeKm: graph.edgeKm,
        edgeKind: graph.edgeKind,
        adjStart: Int32Array.from(graph.adjStart),
        adjCell: Int32Array.from(graph.adjCell),
        adjEdge: graph.adjEdge,
        water: Uint8Array.from(cells.water),
        landCost: Float32Array.from(cells.landCost),
        reliefTerm: Float32Array.from({ length: count }, (_, cell) => reliefTerm(cells, cell)),
        riverKm: Float32Array.from(cells.riverKm),
        heightM: Float32Array.from(cells.heightM),
        portKm: Float32Array.from({ length: count }, (_, cell) => port(cell)),
    };
}

/**
 * The climate at each travel cell, as the map's climate pass made it (see
 * ProceduralEngine.prepareClimate): its site, its mean temperature over all its pixels, land and
 * water (0..1, as the map's), its latitude in degrees (by its site's row), and the prevailing
 * wind's push along the map's x axis: +1 blowing full strength towards the east, -1 towards the
 * west, 0 calm. The climate looks upwind by `windDistance` times cos(|latitude| × 4), so the wind
 * blows the other way; a wind distance of 0 is no wind.
 * @param {object} payload - The generator's payload, with `travelClimate` (the map's latitudes
 *     and wind distance; without it, the defaults).
 * @param {number} count - The travel cells.
 * @returns {{siteX: Float32Array, siteY: Float32Array, temperature: Float32Array, latitude: Float32Array, windX: Float32Array}}
 */
export function climateShape(payload, count) {
    const climate = payload.travelClimate ?? {};
    const latTop = Number.isFinite(climate.latTop) ? climate.latTop : FILRODENSWMB.DEFAULTS.LAT_TOP;
    const latBottom = Number.isFinite(climate.latBottom) ? climate.latBottom : FILRODENSWMB.DEFAULTS.LAT_BOTTOM;
    const latRange = Math.max(0.1, Math.abs(latTop - latBottom));
    const windDistance = Number.isFinite(climate.windDistance) ? climate.windDistance : FILRODENSWMB.CLIMATE.WIND_DISTANCE;
    const siteX = new Float32Array(count);
    const siteY = new Float32Array(count);
    const latitude = new Float32Array(count);
    const windX = new Float32Array(count);
    for (let cell = 0; cell < count; cell++) {
        siteX[cell] = payload.modelSites[cell * 2];
        siteY[cell] = payload.modelSites[cell * 2 + 1];
        latitude[cell] = latTop - (siteY[cell] / payload.height) * latRange;
        windX[cell] = -Math.sign(windDistance) * Math.cos(Math.abs(latitude[cell]) * (Math.PI / 45));
    }
    const sum = new Float64Array(count);
    const pixels = new Uint32Array(count);
    for (let pixel = 0; pixel < payload.modelOf.length; pixel++) {
        const cell = payload.modelOf[pixel];
        if (!(cell >= 0 && cell < count)) continue;
        sum[cell] += payload.temperature[pixel];
        pixels[cell] += 1;
    }
    const temperature = Float32Array.from(sum, (total, cell) => (pixels[cell] ? total / pixels[cell] : Number.NaN));
    return { siteX, siteY, temperature, latitude, windX };
}

/** Relief (and the land cost it adds to) as the generator would measure it on its own cells. */
function scaleRelief(cells, scale) {
    if (!(scale > 1)) return;
    const costM = FILRODENSWMB.GENERATOR.VALUES.RELIEF_COST_M;
    for (let cell = 0; cell < cells.reliefM.length; cell++) {
        const relief = cells.reliefM[cell];
        const scaled = relief * scale;
        cells.landCost[cell] *= (1 + (scaled / costM) ** 1.5) / (1 + (relief / costM) ** 1.5);
        cells.reliefM[cell] = scaled;
    }
}

/** The buffers of a travel graph, to move from the worker rather than copy. */
export function travelGraphTransfer(graph) {
    const arrays = Object.values(graph).filter((value) => ArrayBuffer.isView(value));
    return [...new Set(arrays.map((array) => array.buffer))];
}
