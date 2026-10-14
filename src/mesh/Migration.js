import { FILRODENSWMB } from "../config.js";
import { MeshBuilder } from "./MeshBuilder.js";
import { cellsInPolygon } from "./OwnerLayer.js";
import { legTrace, toFlatPoints } from "./RoutePath.js";
import { UNCLAIMED, VECTOR_SCHEMA_VERSION, addRegion, createLayerSet, createLevel, createMeshBlock, createRoute, randomId } from "./Schema.js";

/**
 * Converts a map's vector data from the polygon shapes (no vectorSchemaVersion) to the mesh
 * shapes of version 4, once, on the first load by a build that understands version 4.
 *
 * - Region layers become the levels of one "custom" layer set (one level per layer, none nested,
 *   since the old layers were independent). A region owns the cells whose site lies inside its
 *   polygon's raw points (not the smoothed curve, matching how GridDataExporter has always tested
 *   regions). Where polygons overlap, the later region wins, as it was drawn on top. Gaps between
 *   polygons stay unclaimed. A region too small to hold a site gets the cell under its centroid,
 *   so no region disappears. The per-region border style (colour, width, dash, smoothing) has no
 *   equivalent now that borders belong to the level, so the level takes its first region's style
 *   and every region keeps its old fields under `legacy`.
 * - Routes become "direct" (straight-legged) routes: a waypoint at each old node's cell, each leg
 *   following the old straight segment between two nodes. `smoothing` and `outline` are switched on because the old
 *   renderer always drew routes as an outlined spline. The old nodes stay under `legacy.points`.
 * - Pins gain the cell they stand in, and empty `pinStyle` and `generated` fields.
 *
 * Owner arrays are returned beside the converted mapData, not inside it (they are saved under
 * their own flag keys; see Schema.ownersKeyFor).
 */

/** Name given to the layer set migrated region layers are gathered into. */
const DEFAULT_SET_NAME = "Regions";

/**
 * @param {Array} regionLayers - The old `regionLayers`.
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @param {object} [options]
 * @param {Function} [options.idFactory]
 * @param {string} [options.setName]
 * @param {number} [options.levelOpacity] - Opacity of each new level (default: createLevel's).
 * @param {number} [options.setOpacity] - Opacity of the layer set (default: createLayerSet's).
 * @returns {{layerSet: object, owners: Object<string, Int32Array>}}
 */
export function regionsToOwners(regionLayers, mesh, { idFactory = randomId, setName = DEFAULT_SET_NAME, levelOpacity = undefined, setOpacity = undefined } = {}) {
    const layerSet = createLayerSet({ name: setName, kind: "custom", opacity: setOpacity }, idFactory);
    const owners = {};
    for (const layer of regionLayers ?? []) {
        const level = createLevel(
            {
                id: layer.id,
                name: layer.name ?? "",
                visibility: layer.visibility ?? "all",
                opacity: levelOpacity,
                style: levelStyleFrom(layer.regions?.[0]),
            },
            idFactory,
        );
        const levelOwners = new Int32Array(mesh.cellCount).fill(UNCLAIMED);
        for (const old of layer.regions ?? []) {
            const region = addRegion(level, regionFields(old), idFactory);
            for (const cell of regionCells(mesh, old.points ?? [])) levelOwners[cell] = region.key;
        }
        layerSet.levels.push(level);
        owners[level.id] = levelOwners;
    }
    return { layerSet, owners };
}

function levelStyleFrom(region) {
    if (!region) return {};
    const style = {};
    if (region.lineColor) style.lineColor = region.lineColor;
    if (Number.isFinite(region.lineThickness)) style.lineThickness = region.lineThickness;
    if (region.lineStyle) style.lineStyle = region.lineStyle;
    return style;
}

function regionFields(old) {
    return {
        id: old.id,
        name: old.name ?? "",
        description: old.description ?? "",
        fillColor: old.fillColor ?? null,
        fillStyle: old.fillStyle ?? null,
        quickStyle: old.quickStyle ?? null,
        visibility: old.visibility ?? "all",
        label: old.label ?? null,
        journalPageId: old.journalPageId ?? null,
        legacy: {
            points: old.points ?? [],
            fillStyle: old.fillStyle ?? null,
            lineColor: old.lineColor ?? null,
            lineThickness: old.lineThickness ?? null,
            lineStyle: old.lineStyle ?? null,
            smoothing: old.smoothing ?? null,
        },
    };
}

/** The cells a migrated region owns (see the module comment). */
function regionCells(mesh, points) {
    if (!points.length) return new Int32Array(0);
    const inside = cellsInPolygon(mesh, points);
    if (inside.length) return inside;
    const flat = toFlatPoints(points);
    let x = 0;
    let y = 0;
    for (let i = 0; i < flat.length; i += 2) {
        x += flat[i];
        y += flat[i + 1];
    }
    const count = flat.length / 2;
    return Int32Array.of(mesh.cellAt(x / count, y / count));
}

/**
 * @param {Array} routes - The old `mapRoutes`.
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @param {object} [options]
 * @param {Function} [options.idFactory]
 * @returns {Array} Routes in the version 4 shape.
 */
export function routesToWaypoints(routes, mesh, { idFactory = randomId } = {}) {
    return (routes ?? []).map((old) => {
        const { waypoints, legs } = traceOldRoute(mesh, old.points ?? []);
        return createRoute(
            {
                id: old.id,
                name: old.name ?? "",
                description: old.description ?? "",
                visibility: old.visibility ?? "all",
                label: old.label ?? null,
                quickStyle: old.quickStyle ?? null,
                color: old.color,
                thickness: old.thickness,
                style: old.style,
                outline: true,
                smoothing: true,
                mode: "direct",
                waypoints,
                legs,
                legacy: { points: old.points ?? [] },
            },
            idFactory,
        );
    });
}

/**
 * Waypoints at the old nodes and a traced leg along each old segment. Consecutive nodes in the same
 * cell share a waypoint; the segments between them join the next leg's line.
 */
function traceOldRoute(mesh, points) {
    const flat = toFlatPoints(points);
    const count = flat.length / 2;
    if (!count) return { waypoints: [], legs: [] };
    let hint = 0;
    const nodeCells = [];
    for (let i = 0; i < count; i++) {
        hint = mesh.cellAt(flat[2 * i], flat[2 * i + 1], hint);
        nodeCells.push(hint);
    }

    const waypoints = [nodeCells[0]];
    const legs = [];
    let lineStart = 0;
    for (let i = 1; i < count; i++) {
        if (nodeCells[i] === waypoints.at(-1)) continue;
        const line = flat.subarray(2 * lineStart, 2 * i + 2);
        legs.push(Array.from(legTrace(mesh, line, waypoints.at(-1), nodeCells[i])));
        waypoints.push(nodeCells[i]);
        lineStart = i;
    }
    return { waypoints, legs };
}

/**
 * Gives each pin the cell it stands in.
 * @param {Array} pins
 * @param {import("./MeshBuilder.js").Mesh} mesh
 */
export function pinsToCells(pins, mesh) {
    let hint = 0;
    return (pins ?? []).map((pin) => {
        const onMap = Number.isFinite(pin.x) && Number.isFinite(pin.y);
        if (onMap) hint = mesh.cellAt(pin.x, pin.y, hint);
        return { ...pin, cell: onMap ? hint : null, pinStyle: pin.pinStyle ?? null, generated: pin.generated ?? null };
    });
}

/**
 * Converts a map's vector data to version 4. A map already at version 4 or later comes back as it
 * is, with no owner arrays. The input is not modified.
 *
 * @param {object} mapData
 * @param {import("./MeshBuilder.js").Mesh|null} [mesh] - The map's mesh, if already built (it must
 *     match the mesh block this function gives the map: build it with MeshBuilder.fromMapData on a
 *     map that has that block, or let this function build it).
 * @param {object} [options]
 * @param {Function} [options.idFactory]
 * @param {string} [options.setName] - Name of the layer set the old region layers go into.
 * @param {object} [options.meshBlock] - Overrides for the new mesh block (seed, spacing).
 * @param {number} [options.levelOpacity] - Fill opacity of the levels made from region layers
 *     (default: the map's old Region Opacity setting, or its default when the map never saved one).
 * @returns {{mapData: object, owners: Object<string, Int32Array>, mesh: import("./MeshBuilder.js").Mesh|null}}
 */
export function migrateMapData(mapData, mesh = null, { idFactory = randomId, setName = DEFAULT_SET_NAME, meshBlock = {}, levelOpacity = undefined } = {}) {
    if ((mapData.vectorSchemaVersion ?? 0) >= VECTOR_SCHEMA_VERSION) return { mapData, owners: {}, mesh };

    const next = structuredClone(mapData);
    next.mesh = next.mesh ?? createMeshBlock(next, meshBlock);
    const built = mesh ?? MeshBuilder.fromMapData(next);
    next.mesh.cells = built.cellCount;

    // The map's Region Opacity was the fill opacity of every region layer, so it becomes each
    // migrated level's fill opacity, where the level editor shows it. The set starts at 1, a
    // multiplier left for fading the whole set later.
    const fillOpacity = levelOpacity ?? mapData.params?.display?.regionOpacity ?? FILRODENSWMB.DISPLAY.REGION_OPACITY;
    const { layerSet, owners } = regionsToOwners(mapData.regionLayers, built, { idFactory, setName, levelOpacity: fillOpacity, setOpacity: 1 });
    next.layerSets = layerSet.levels.length ? [layerSet] : [];
    delete next.regionLayers;
    next.mapRoutes = routesToWaypoints(mapData.mapRoutes, built, { idFactory });
    next.mapPins = pinsToCells(mapData.mapPins, built);
    next.vectorSchemaVersion = VECTOR_SCHEMA_VERSION;
    return { mapData: next, owners, mesh: built };
}
