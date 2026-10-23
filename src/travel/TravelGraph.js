import { buildModelCells } from "../generator/CellValues.js";
import { CellGraph, portCost, reliefTerm } from "../generator/CellGraph.js";
import { modelBiomeRaster } from "../generator/ModelBiomes.js";

/**
 * The generator's travel network, for the Travel tool: the model cells and their graph built from
 * the generator's payload as a run builds them (see Pipeline), reduced to what travel times need.
 * It runs in the worker, since building the model cells reads the whole terrain.
 *
 * Shape: { count, edgeA, edgeB, edgeKm, edgeKind, adjStart, adjCell, adjEdge, water, landCost,
 *          reliefTerm, riverKm, heightM, portKm }, every array typed. `portKm` is each cell's
 * loading cost at a harbour with no town (a town's harbour is cheaper; see TravelTime).
 *
 * @param {import("../generator/GeneratorInput.js").GeneratorPayload} payload
 * @returns {object}
 */
export function buildTravelGraph(payload) {
    const cells = buildModelCells({ ...payload, biome: modelBiomeRaster(payload) }, payload.settings?.world ?? {});
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

/** The buffers of a travel graph, to move from the worker rather than copy. */
export function travelGraphTransfer(graph) {
    const arrays = Object.values(graph).filter((value) => ArrayBuffer.isView(value));
    return [...new Set(arrays.map((array) => array.buffer))];
}
