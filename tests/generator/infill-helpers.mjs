// The synthetic island's parent run for the in-fill tests: people on land, two cultures split east
// and west, as a regional map's copy of it (see ParentRun) covering the whole island at no zoom.
import { encodeModelRun } from "../../src/generator/ModelRun.js";
import { resolveSettings } from "../../src/generator/GeneratorSettings.js";
import { cropRun } from "../../src/generator/ParentRun.js";

const PEOPLE_PER_CELL = 20000;

/** A parent run over the synthetic map's model cells: people on land, two cultures split east and west. */
export function parentRunOf(mesh, payload) {
    const count = mesh.modelCount;
    const land = Float64Array.from({ length: count }, (_, cell) => {
        const pixel = Math.floor(mesh.siteY(cell)) * mesh.width + Math.floor(mesh.siteX(cell));
        return payload.elevation[pixel] >= 0.35 ? 1 : 0;
    });
    const result = {
        modelCells: {
            capacity: Float64Array.from(land, (value) => value * PEOPLE_PER_CELL * 2),
            population: Float64Array.from(land, (value) => value * PEOPLE_PER_CELL),
            landArea: Float64Array.from(land, (value) => value * 500),
            security: new Float64Array(count).fill(1),
            cleared: new Float64Array(count).fill(0.2),
            water: Float64Array.from(land, (value) => 1 - value),
            realm: new Float64Array(count),
            duchy: new Float64Array(count),
            county: new Float64Array(count),
            culture: Float64Array.from({ length: count }, (_, cell) => (mesh.siteX(cell) < mesh.width / 2 ? 0 : 1)),
            shareStart: Int32Array.from({ length: count + 1 }, (_, index) => index),
            shareCulture: Int32Array.from({ length: count }, (_, cell) => (mesh.siteX(cell) < mesh.width / 2 ? 0 : 1)),
            shareValue: new Float32Array(count).fill(1),
        },
        settings: resolveSettings({}, "SEED"),
        cellCount: count,
        cultures: [{ id: "westAAAAAAAAAAAA", name: "Westfolk", nameBase: "German", homelands: [] }, { id: "eastAAAAAAAAAAAA", name: "Eastfolk", nameBase: "Japanese", homelands: [] }],
        stats: {},
    };
    const run = JSON.parse(JSON.stringify(encodeModelRun(result, "runAAAAAAAAAAAAA")));
    return cropRun(run, { sites: mesh.sites.subarray(0, 2 * count), spacingPx: mesh.modelSpacing, spacingKm: mesh.modelSpacing * mesh.kmPerPx, crop: { x: 0, y: 0, width: mesh.width, height: mesh.height }, zoomScale: 1 });
}
