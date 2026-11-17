import { legTrace } from "./RoutePath.js";
import { UNCLAIMED } from "./Schema.js";

/**
 * Carries regions and routes from one mesh to another: when a map's mesh has to be rebuilt (its
 * size or the mesh algorithm changed), and when a regional map is cut from a parent map, where
 * the child's mesh covers part of the parent at a larger scale.
 *
 * Positions go through a transform from the target map's pixels to the source map's (or back),
 * so the same code serves both: the identity for a rebuild, a crop offset and zoom for a regional
 * map.
 */

/** @typedef {function(number, number): [number, number]} PointTransform */

/** Leaves a point where it is. */
export const IDENTITY = (x, y) => [x, y];

/**
 * The owners a target mesh gets from a source mesh: each target cell takes the owner of the
 * source cell under its own site (moved into the source map by `toSource`). A site that lands
 * outside the source map is left unclaimed.
 *
 * Sampling at the site, rather than voting over the cell's pixels, keeps a region's border within
 * one target cell of where it was, which is the best a different mesh can do; on a finer target
 * mesh (a regional map) the borders follow the source cells' outlines exactly.
 *
 * @param {import("./MeshBuilder.js").Mesh} sourceMesh
 * @param {Int32Array} sourceOwners
 * @param {import("./MeshBuilder.js").Mesh} targetMesh
 * @param {PointTransform} [toSource]
 * @returns {Int32Array}
 */
export function resampleOwners(sourceMesh, sourceOwners, targetMesh, toSource = IDENTITY) {
    const owners = new Int32Array(targetMesh.cellCount).fill(UNCLAIMED);
    const lookup = cellLookup(sourceMesh);
    for (let cell = 0; cell < targetMesh.cellCount; cell++) {
        const [x, y] = toSource(targetMesh.siteX(cell), targetMesh.siteY(cell));
        const source = lookup(x, y);
        if (source >= 0) owners[cell] = sourceOwners[source];
    }
    return owners;
}

/**
 * A function from a point to the cell under it, or -1 off the map: a raster read when the mesh has
 * its raster built, otherwise a walk from the last cell found (points come in a coherent order, so
 * the walk stays short).
 */
export function cellLookup(mesh) {
    const { width, height } = mesh;
    if (mesh.hasCellRaster) {
        const raster = mesh.cellRaster;
        return (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? -1 : raster[Math.floor(y) * width + Math.floor(x)]);
    }
    let hint = 0;
    return (x, y) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return -1;
        hint = mesh.cellAt(x, y, hint);
        return hint;
    };
}

// ------------------------------------------------------------------ routes

/**
 * A route's line as points, each marked when it is a waypoint: the sites of its cells in order
 * (each junction once), waypoints at the start of the first leg and the end of every leg.
 * @param {{waypoints: number[], legs: number[][]}} route
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @returns {Array<{x: number, y: number, waypoint: boolean}>}
 */
export function routeMarkedLine(route, mesh) {
    const points = [];
    const legs = route.legs ?? [];
    if (!legs.length) {
        return (route.waypoints ?? []).slice(0, 1).map((cell) => ({ x: mesh.siteX(cell), y: mesh.siteY(cell), waypoint: true }));
    }
    legs.forEach((leg, k) => {
        leg.forEach((cell, i) => {
            if (k > 0 && i === 0) return;
            points.push({ x: mesh.siteX(cell), y: mesh.siteY(cell), waypoint: i === 0 || i === leg.length - 1 });
        });
    });
    return points;
}

/**
 * A polyline of {x, y} nodes (an old route's points) as a marked line: every node a waypoint.
 * @param {Array<{x: number, y: number}>} nodes
 */
export function nodesMarkedLine(nodes) {
    return (nodes ?? []).filter((node) => Number.isFinite(node?.x) && Number.isFinite(node?.y)).map((node) => ({ x: node.x, y: node.y, waypoint: true }));
}

/**
 * Moves a marked line through a transform and cuts it to the rectangle [0, width) x [0, height),
 * giving the pieces that lie inside. A piece starts and ends with a waypoint: where the line
 * crosses the edge, the crossing point becomes one.
 *
 * @param {Array<{x: number, y: number, waypoint: boolean}>} line
 * @param {PointTransform} transform
 * @param {number} width
 * @param {number} height
 * @returns {Array<Array<{x: number, y: number, waypoint: boolean}>>}
 */
export function clipMarkedLine(line, transform, width, height) {
    const moved = line.map(({ x, y, waypoint }) => {
        const [tx, ty] = transform(x, y);
        return { x: tx, y: ty, waypoint };
    });
    const inside = (p) => p.x >= 0 && p.y >= 0 && p.x < width && p.y < height;
    const pieces = [];
    let current = null;
    const flush = () => {
        if (current?.length) {
            current[0].waypoint = true;
            current.at(-1).waypoint = true;
            pieces.push(current);
        }
        current = null;
    };
    if (moved.length === 1) return inside(moved[0]) ? [[{ ...moved[0], waypoint: true }]] : [];

    for (let i = 0; i + 1 < moved.length; i++) {
        const p = moved[i];
        const q = moved[i + 1];
        const range = clipRange(p, q, width, height);
        if (!range) {
            flush();
            continue;
        }
        const [t0, t1] = range;
        if (!current || t0 > 0) {
            flush();
            current = [t0 > 0 ? { ...lerp(p, q, t0), waypoint: true } : { ...p }];
        }
        if (t1 < 1) {
            current.push({ ...lerp(p, q, t1), waypoint: true });
            flush();
        } else {
            current.push({ ...q });
        }
    }
    flush();
    return pieces;
}

/** Just inside the far edges, so a clipped point still has a cell under it. */
const EDGE_INSET = 1e-6;

function clipRange(p, q, width, height) {
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    let t0 = 0;
    let t1 = 1;
    const limits = [
        [-dx, p.x],
        [dx, width - EDGE_INSET - p.x],
        [-dy, p.y],
        [dy, height - EDGE_INSET - p.y],
    ];
    for (const [step, room] of limits) {
        if (step === 0) {
            if (room < 0) return null;
            continue;
        }
        const t = room / step;
        if (step < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
        if (t0 > t1) return null;
    }
    return [t0, t1];
}

const lerp = (p, q, t) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });

/**
 * A route's waypoints and traced legs on a mesh, from one piece of a marked line already in that
 * mesh's pixels: a waypoint at every marked point, and each leg the cells the line between two
 * waypoints passes through (see RoutePath.legTrace). Consecutive waypoints in the same cell are
 * one waypoint.
 *
 * @param {Array<{x: number, y: number, waypoint: boolean}>} piece
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @returns {{waypoints: number[], legs: number[][]}}
 */
export function traceMarkedPiece(piece, mesh) {
    const lookup = cellLookup(mesh);
    const waypoints = [];
    const legs = [];
    let line = [];
    for (const point of piece) {
        line.push(point.x, point.y);
        if (!point.waypoint) continue;
        const cell = lookup(point.x, point.y);
        if (cell < 0) continue;
        if (!waypoints.length) {
            waypoints.push(cell);
        } else if (cell !== waypoints.at(-1)) {
            legs.push(Array.from(legTrace(mesh, line, waypoints.at(-1), cell)));
            waypoints.push(cell);
        } else {
            continue;
        }
        line = [point.x, point.y];
    }
    return { waypoints, legs };
}

/**
 * Re-paths a route on another mesh: its line (from its legs on the source mesh, or from the given
 * marked line) is moved by `toTarget`, cut to the target map and traced again. A route that
 * leaves and re-enters the target map comes back as several pieces, each a route of its own; one
 * wholly outside comes back as none.
 *
 * @param {Array<{x: number, y: number, waypoint: boolean}>} line - In source pixels.
 * @param {import("./MeshBuilder.js").Mesh} targetMesh
 * @param {PointTransform} [toTarget]
 * @returns {Array<{waypoints: number[], legs: number[][]}>}
 */
export function retraceLine(line, targetMesh, toTarget = IDENTITY) {
    return clipMarkedLine(line, toTarget, targetMesh.width, targetMesh.height)
        .map((piece) => traceMarkedPiece(piece, targetMesh))
        .filter((traced) => traced.waypoints.length > 0);
}
