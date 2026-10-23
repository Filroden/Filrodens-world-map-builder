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
 *          reliefTerm, riverKm, heightM, portKm }, every array typed. `portKm` is each cell's
 * loading cost at a harbour with no town (the generator's; travel waits instead, see TravelTime).
 *
 * @param {import("../generator/GeneratorInput.js").GeneratorPayload & {reliefScale?: number}} payload
 * @returns {object}
 */
export function buildTravelGraph(payload) {
    const cells = buildModelCells({ ...payload, biome: modelBiomeRaster(payload) }, payload.settings?.world ?? {});
    scaleRelief(cells, payload.reliefScale ?? 1);
    const graph = new CellGraph(cells);
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
