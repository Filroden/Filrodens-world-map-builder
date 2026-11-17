import { buildModelCells } from "./CellValues.js";
import { modelBiomeRaster } from "./ModelBiomes.js";

/**
 * The food the land can feed in each model cell, worked out from the terrain, biomes and climate
 * alone, as a run's first stage does (see CellValues), without the rest of a run. The Influences
 * tool shows it under the brush on a map with no run (or one not of its mesh), so where the land
 * is rich or poor can be seen before painting (see InfluenceView).
 *
 * @param {import("./GeneratorInput.js").GeneratorPayload} payload - Without influences: the layer
 *     shows what the land feeds before the painting, which is drawn over it.
 * @returns {{capacity: Float32Array, landArea: Float32Array, water: Uint8Array}} One value per model cell.
 */
export function landCapacity(payload) {
    const cells = buildModelCells({ ...payload, biome: modelBiomeRaster(payload) }, payload.settings?.world ?? {});
    return { capacity: Float32Array.from(cells.food), landArea: Float32Array.from(cells.landKm2), water: Uint8Array.from(cells.water) };
}

/** The buffers of a landCapacity result, to move from the worker rather than copy. */
export function landCapacityTransfer(result) {
    return [result.capacity.buffer, result.landArea.buffer, result.water.buffer];
}
