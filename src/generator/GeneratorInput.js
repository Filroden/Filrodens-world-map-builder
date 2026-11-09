import { FILRODENSWMB } from "../config.js";

/**
 * The generator's input, gathered on the main thread from the open map: plain data and typed
 * arrays only, so it can be handed to the generation worker (its buffers transferred, not copied).
 * Every array is a fresh copy, so transferring it leaves the map's own buffers untouched.
 */

/**
 * @typedef {object} GeneratorPayload
 * @property {number} width
 * @property {number} height
 * @property {number} seaLevel
 * @property {number} kmPerPx - Effective km per map pixel (see Schema.effectiveKmPerPx).
 * @property {number} metresPerUnit - Metres per unit of elevation (MESH.METRES_PER_UNIT).
 * @property {Float64Array} modelSites - The model sites (x, y pairs): display sites 0 to modelCount - 1.
 * @property {Int32Array} modelOf - The model cell under each pixel.
 * @property {Float32Array} elevation
 * @property {Float32Array} moisture
 * @property {Float32Array} temperature
 * @property {Float32Array} waterMask - Above 0 where a pixel is lake.
 * @property {Uint8Array|Uint16Array|null} biomeOverrides - Painted biome ids.
 * @property {object} biomeParams - { customBiomeRules, biomePalette, biomeSides } (see ModelBiomes).
 * @property {object[]} customBiomes - Each { id, behavesLike?, properties? } (see ModelBiomes).
 * @property {{pixelsPerBaseline: number, list: {merges: boolean, x: Int32Array, y: Int32Array, lake: Uint8Array, flow: Float32Array|null}[]}} rivers
 * @property {string} mapSeed
 * @property {object} settings - The user's settings (see GeneratorSettings).
 * @property {{cell: number, kind: string, pin: string, x: number|null, y: number|null, land: boolean|null}[]} seats -
 *   The map's settlement pins the run must build on, each by its model cell and its style's tier,
 *   with the pin's map point and whether it stands on land (see Pipeline.seatsOf).
 * @property {number} revision - The generator rules to follow (see GeneratorRevision): the current
 *   ones for a run, the map's own for what is worked out live from the map (Travel, Fill in).
 * @property {{realms: object[], duchies: object[], counties: object[]}|null} userRegions - The map's
 *   own realms, duchies and counties a run builds round (see Generation.userRegions and
 *   UserRealms), each `{ key, cells, independent? }` by model cell; null for none.
 */

/**
 * @param {object} source
 * @param {import("../mesh/MeshBuilder.js").Mesh} source.mesh - The map's display mesh.
 * @param {{elevation: Float32Array, moisture: Float32Array, temperature: Float32Array, waterMask: Float32Array, biomeOverrides?: ArrayLike<number>}} source.buffers
 * @param {number} source.seaLevel
 * @param {number} source.kmPerPx
 * @param {object} [source.riverData] - The map's traced rivers (app.currentRiverData).
 * @param {object} [source.biomeParams]
 * @param {object[]} [source.customBiomes]
 * @param {string} source.mapSeed
 * @param {object} [source.settings]
 * @param {{cell: number, kind: string, pin: string, x?: number, y?: number, land?: boolean}[]} [source.seats] - Settlement pins as seats.
 * @param {number} [source.revision] - The generator rules to follow; the current ones when left out.
 * @param {object|null} [source.userRegions] - The map's own realms, duchies and counties (see GeneratorPayload).
 * @returns {GeneratorPayload}
 */
export function buildGeneratorPayload({ mesh, buffers, seaLevel, kmPerPx, riverData = null, biomeParams = null, customBiomes = [], mapSeed, settings = {}, seats = [], revision = FILRODENSWMB.GENERATOR.REVISION, userRegions = null }) {
    return {
        width: mesh.width,
        height: mesh.height,
        seaLevel,
        kmPerPx,
        metresPerUnit: FILRODENSWMB.MESH.METRES_PER_UNIT,
        modelSites: Float64Array.from(mesh.sites.subarray(0, 2 * mesh.modelCount)),
        modelOf: modelOfPixels(mesh),
        elevation: Float32Array.from(buffers.elevation),
        moisture: Float32Array.from(buffers.moisture),
        temperature: Float32Array.from(buffers.temperature),
        waterMask: buffers.waterMask ? Float32Array.from(buffers.waterMask) : new Float32Array(mesh.width * mesh.height),
        biomeOverrides: buffers.biomeOverrides ? buffers.biomeOverrides.slice() : null,
        biomeParams: biomeParams ?? {},
        customBiomes: customBiomes.map((biome) => ({ id: biome.id, behavesLike: biome.behavesLike ?? null, properties: biome.properties ?? null })),
        rivers: riverList(riverData),
        mapSeed: String(mapSeed ?? ""),
        settings: structuredClone(settings ?? {}),
        seats: seats.map(({ cell, kind, pin, x = null, y = null, land = null }) => ({ cell, kind, pin, x, y, land })),
        revision,
        userRegions: userRegions ? structuredClone(userRegions) : null,
    };
}

/** The model cell under every pixel: the parent of the display cell there. */
function modelOfPixels(mesh) {
    const raster = mesh.cellRaster;
    const parentOf = mesh.parentOf;
    const out = new Int32Array(raster.length);
    for (let pixel = 0; pixel < raster.length; pixel++) out[pixel] = parentOf[raster[pixel]];
    return out;
}

/**
 * The traced rivers as compact arrays: each river's path (pixel x, y, and whether the point is in
 * a lake), its flow at each point (upstream length in baseline pixels), and whether it ends by
 * joining another river.
 */
function riverList(riverData) {
    const flows = riverData?.network?.flows;
    const list = (riverData?.vectors ?? []).map((river) => {
        const path = river.path ?? [];
        const flow = flows?.get?.(river.id);
        return {
            merges: !!river.mergeInto,
            x: Int32Array.from(path, (point) => Math.round(point.x)),
            y: Int32Array.from(path, (point) => Math.round(point.y)),
            lake: Uint8Array.from(path, (point) => (point.isLake ? 1 : 0)),
            flow: flow ? Float32Array.from(flow) : null,
        };
    });
    return { pixelsPerBaseline: riverData?.network?.pixelsPerBaseline || 1, list };
}

/** The buffers of a payload, to transfer rather than copy. */
export function payloadTransfer(payload) {
    const buffers = [payload.modelSites, payload.modelOf, payload.elevation, payload.moisture, payload.temperature, payload.waterMask, payload.biomeOverrides];
    for (const river of payload.rivers.list) buffers.push(river.x, river.y, river.lake, river.flow);
    return [...new Set(buffers.filter(Boolean).map((array) => array.buffer))];
}

/** The buffers of a result, to transfer rather than copy. */
export function resultTransfer(result) {
    const arrays = [...Object.values(result.modelCells), ...Object.values(result.modelGraph)];
    return [...new Set(arrays.map((array) => array.buffer))];
}
