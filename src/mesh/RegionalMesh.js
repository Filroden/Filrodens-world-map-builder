import { MeshBuilder } from "./MeshBuilder.js";
import { pinsToCells } from "./Migration.js";
import { UNCLAIMED, VECTOR_SCHEMA_VERSION, createMeshBlock, randomId } from "./Schema.js";
import { encodeOwners } from "./OwnerLayer.js";
import { resampleOwners, retraceLine, routeMarkedLine } from "./Resample.js";

/**
 * The regions and routes of a regional map cut from a parent map on the display mesh.
 *
 * The regional map gets its own mesh (at the same display spacing, so over a smaller area of the
 * parent it is finer), and each of its cells takes the owner of the parent cell under its site.
 * A region crossing the edge of the crop keeps the part inside, however few of its cells that is
 * (polygon regions used to be dropped when none of their corners lay inside). Regions with no cell
 * inside, and levels left with no region, are not carried over.
 *
 * Routes are cut to the crop and traced again on the regional mesh along their old line; a route
 * that leaves the crop and comes back becomes one route per stretch inside.
 *
 * Positions on the regional map are (parent - crop corner) x zoom.
 */

/**
 * @param {object} options
 * @param {import("./MeshSession.js").MeshSession} options.session - The parent's mesh session.
 * @param {Array} options.layerSets - The parent's layer sets.
 * @param {Array} options.routes - The parent's routes.
 * @param {Array} options.pins - The regional map's pins (already moved into its pixels).
 * @param {object} options.childMapData - The regional map's data so far: mapWidth, mapHeight,
 *     seed, params.latTop/latBottom and world.
 * @param {{x: number, y: number}} options.crop - The crop's top-left corner in parent pixels.
 * @param {number} options.zoom
 * @param {Function} [options.idFactory]
 * @returns {{fields: {vectorSchemaVersion: number, mesh: object, layerSets: Array, mapRoutes: Array, mapPins: Array}, owners: Object<string, string>, mesh: import("./MeshBuilder.js").Mesh}}
 */
export function extractRegionalVectors({ session, layerSets, routes, pins, childMapData, crop, zoom, idFactory = randomId }) {
    const block = createMeshBlock(childMapData);
    const mesh = MeshBuilder.fromMapData({ ...childMapData, mesh: block });
    block.cells = mesh.cellCount;

    const toParent = (x, y) => [x / zoom + crop.x, y / zoom + crop.y];
    const toChild = (x, y) => [(x - crop.x) * zoom, (y - crop.y) * zoom];

    const owners = {};
    const sets = [];
    for (const set of layerSets ?? []) {
        const levels = set.levels.map((level) => carryLevel(level, session, mesh, toParent, toChild, owners)).filter(Boolean);
        if (levels.length) sets.push({ ...structuredClone({ ...set, levels: [] }), levels });
    }
    dropMissingParents(sets);

    const mapRoutes = (routes ?? []).flatMap((route) => carryRoute(route, session.mesh, mesh, toChild, idFactory));
    return {
        fields: { vectorSchemaVersion: VECTOR_SCHEMA_VERSION, mesh: block, layerSets: sets, mapRoutes, mapPins: pinsToCells(pins, mesh) },
        owners,
        mesh,
    };
}

/** A level on the regional mesh, or null when none of its regions reaches into the crop. */
function carryLevel(level, session, mesh, toParent, toChild, owners) {
    const levelOwners = resampleOwners(session.mesh, session.layer(level.id).owners, mesh, toParent);
    const present = new Set(levelOwners);
    present.delete(UNCLAIMED);
    const regions = level.regions.filter((region) => present.has(region.key)).map((region) => moveLabel(structuredClone(region), toChild));
    if (!regions.length) return null;

    // Cells of a deleted region (still in the parent's live array) are left unclaimed
    const keys = new Set(regions.map((region) => region.key));
    for (let cell = 0; cell < levelOwners.length; cell++) if (!keys.has(levelOwners[cell])) levelOwners[cell] = UNCLAIMED;
    owners[level.id] = encodeOwners(levelOwners);
    return { ...structuredClone({ ...level, regions: [] }), regions };
}

/** A level whose parent level was not carried over has no parent on the regional map. */
function dropMissingParents(sets) {
    const ids = new Set(sets.flatMap((set) => set.levels.map((level) => level.id)));
    for (const set of sets) for (const level of set.levels) if (level.parentLevelId && !ids.has(level.parentLevelId)) level.parentLevelId = null;
}

function carryRoute(route, parentMesh, mesh, toChild, idFactory) {
    const pieces = retraceLine(routeMarkedLine(route, parentMesh), mesh, toChild);
    return pieces.map((piece, i) => {
        const carried = moveLabel(structuredClone(route), toChild);
        if (i > 0) carried.id = idFactory();
        carried.waypoints = piece.waypoints;
        carried.legs = piece.legs;
        return carried;
    });
}

function moveLabel(item, toChild) {
    if (Number.isFinite(item.label?.x) && Number.isFinite(item.label?.y)) Object.assign(item.label, moveXY(item.label, toChild));
    if (item.legacy?.points) item.legacy.points = item.legacy.points.map((point) => moveXY(point, toChild));
    return item;
}

function moveXY(point, transform) {
    const [x, y] = transform(point.x, point.y);
    return { ...point, x, y };
}
