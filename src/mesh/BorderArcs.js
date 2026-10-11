import { FILRODENSWMB } from "../config.js";
import { clipSegment } from "./Geometry.js";
import { UNCLAIMED } from "./Schema.js";

/**
 * Borders derived from a level's owner array. Nothing about a border is stored: it is the set of
 * Voronoi edges between cells with different owners, chained into arcs.
 *
 * 1. Scan: every Delaunay half-edge e with a twin f > e joins cells triangles[e] and triangles[f];
 *    the Voronoi edge between those cells runs between the circumcentres of the two triangles,
 *    floor(e / 3) and floor(f / 3). Pairs with the same owner, or both unclaimed, are skipped.
 *    Hull half-edges (no twin) are the map edge and never a border, and neither is an edge whose
 *    Voronoi edge lies wholly outside the map (mesh.edgeInside), since those cells never meet.
 * 2. Classify: "land" when both cells are land, "sea" when both are water, "shore" when one of
 *    each. A shore edge with an unclaimed side is a region's own coast against open sea, which is
 *    the coastline, not a border, so it is skipped. Drawn borders have two classes, land (solid)
 *    and sea (dashed, thinner); shore draws as sea.
 * 3. Chain: segments join into arcs at shared circumcentres. An arc ends at a junction: a vertex
 *    where the number of border segments is not two, or where the class or the pair of owners
 *    changes. A ring with no junction (an island region inside one other region) is a closed arc.
 * 4. Clip: circumcentres of thin triangles on the hull can lie outside the map, so each arc is cut
 *    to the map rectangle, which may split it; the pieces end on the map edge.
 * 5. Smooth: Chaikin corner cutting on interior points only, so arcs meeting at a junction still
 *    meet. Every new point lies on the original polyline's corner triangle, which is inside one
 *    convex Voronoi cell, so smoothed arcs cannot cross each other or the cells' other borders.
 *
 * Arcs keep the half-edges they were made from, which is how a child level leaves out the stretches
 * of border its parent level already draws (only the highest coincident level is drawn).
 */

export const ARC_CLASS = Object.freeze({ LAND: "land", SEA: "sea" });
export const SEGMENT_KIND = Object.freeze({ LAND: "land", SEA: "sea", SHORE: "shore" });

const KIND_CODES = Object.freeze([SEGMENT_KIND.LAND, SEGMENT_KIND.SEA, SEGMENT_KIND.SHORE]);
const KIND_LAND = 0;
const KIND_SEA = 1;
const KIND_SHORE = 2;
const CHAIKIN_NEAR = 0.75;
const CHAIKIN_FAR = 0.25;

/**
 * @typedef {object} BorderSegments
 * @property {Int32Array} edges - The half-edge e of each segment (its twin is greater).
 * @property {Int32Array} from - Circumcentre (triangle) at one end.
 * @property {Int32Array} to - Circumcentre at the other end.
 * @property {Uint8Array} kind - 0 land, 1 sea, 2 shore.
 * @property {Int32Array} ownerA - The lower of the two owners.
 * @property {Int32Array} ownerB - The higher.
 * @property {number} length
 */

/**
 * Step 1 and 2: the border segments of a level.
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @param {Int32Array} owners
 * @param {Uint8Array} land
 * @param {Set<number>|null} [exclude] - Half-edges to leave out (see coincidentEdges).
 * @returns {BorderSegments}
 */
export function borderSegments(mesh, owners, land, exclude = null) {
    const { triangles, halfedges } = mesh;
    const out = { edges: [], kind: [], ownerA: [], ownerB: [] };
    for (let edge = 0; edge < halfedges.length; edge++) {
        const twin = halfedges[edge];
        if (twin < edge || !mesh.edgeInside[edge]) continue;
        const left = triangles[edge];
        const right = triangles[twin];
        const kind = segmentKind(owners[left], owners[right], land[left], land[right]);
        if (kind < 0 || exclude?.has(edge)) continue;
        out.edges.push(edge);
        out.kind.push(kind);
        out.ownerA.push(Math.min(owners[left], owners[right]));
        out.ownerB.push(Math.max(owners[left], owners[right]));
    }
    const edges = Int32Array.from(out.edges);
    return {
        edges,
        from: edges.map((edge) => Math.floor(edge / 3)),
        to: edges.map((edge) => Math.floor(halfedges[edge] / 3)),
        kind: Uint8Array.from(out.kind),
        ownerA: Int32Array.from(out.ownerA),
        ownerB: Int32Array.from(out.ownerB),
        length: edges.length,
    };
}

/** The kind code of the edge between two cells, or -1 when it is not a border. */
function segmentKind(ownerLeft, ownerRight, landLeft, landRight) {
    if (ownerLeft === ownerRight) return -1;
    if (landLeft && landRight) return KIND_LAND;
    if (!landLeft && !landRight) return KIND_SEA;
    // A region's own coast against unclaimed water (or unclaimed land against its water) is coastline
    if (ownerLeft === UNCLAIMED || ownerRight === UNCLAIMED) return -1;
    return KIND_SHORE;
}

/** For each circumcentre, the segments touching it, as a CSR list over the triangles. */
function vertexIncidence(segments, vertexCount) {
    const start = new Int32Array(vertexCount + 1);
    for (let s = 0; s < segments.length; s++) {
        start[segments.from[s] + 1]++;
        start[segments.to[s] + 1]++;
    }
    for (let v = 0; v < vertexCount; v++) start[v + 1] += start[v];
    const list = new Int32Array(start[vertexCount]);
    const fill = start.slice(0, vertexCount);
    for (let s = 0; s < segments.length; s++) {
        list[fill[segments.from[s]]++] = s;
        list[fill[segments.to[s]]++] = s;
    }
    return { start, list };
}

/**
 * Step 3: chains segments into arcs of circumcentre ids.
 * @returns {Array<{kind: number, a: number, b: number, vertices: number[], edges: number[], closed: boolean}>}
 */
function chainSegments(segments, vertexCount) {
    const incidence = vertexIncidence(segments, vertexCount);
    const sameRun = (s, t) => segments.kind[s] === segments.kind[t] && segments.ownerA[s] === segments.ownerA[t] && segments.ownerB[s] === segments.ownerB[t];
    const isJunction = (vertex) => {
        const first = incidence.start[vertex];
        if (incidence.start[vertex + 1] - first !== 2) return true;
        return !sameRun(incidence.list[first], incidence.list[first + 1]);
    };
    const used = new Uint8Array(segments.length);
    const arcs = [];
    // Arcs starting at a junction first, so only true rings are left for the second pass
    for (let s = 0; s < segments.length; s++) {
        if (used[s]) continue;
        const startVertex = isJunction(segments.from[s]) ? segments.from[s] : segments.to[s];
        if (!isJunction(startVertex)) continue;
        arcs.push(walkArc(segments, incidence, used, s, startVertex, isJunction));
    }
    for (let s = 0; s < segments.length; s++) {
        if (!used[s]) arcs.push(walkArc(segments, incidence, used, s, segments.from[s], isJunction));
    }
    return arcs;
}

function otherEnd(segments, s, vertex) {
    return segments.from[s] === vertex ? segments.to[s] : segments.from[s];
}

/** Follows segments from `startVertex` through `first` until a junction or back to the start. */
function walkArc(segments, incidence, used, first, startVertex, isJunction) {
    const vertices = [startVertex];
    const edges = [];
    let segment = first;
    let vertex = startVertex;
    for (;;) {
        used[segment] = 1;
        edges.push(segments.edges[segment]);
        vertex = otherEnd(segments, segment, vertex);
        vertices.push(vertex);
        if (vertex === startVertex || isJunction(vertex)) break;
        const at = incidence.start[vertex];
        const next = incidence.list[at] === segment ? incidence.list[at + 1] : incidence.list[at];
        if (used[next]) break;
        segment = next;
    }
    return {
        kind: segments.kind[first],
        a: segments.ownerA[first],
        b: segments.ownerB[first],
        vertices,
        edges,
        closed: vertex === startVertex && !isJunction(startVertex),
    };
}

// ------------------------------------------------------------------ clipping and smoothing

/**
 * Step 4: cuts a polyline (flat [x0, y0, ...]) to the map, returning its inside pieces. Pieces of
 * a closed ring that is cut become open pieces.
 */
function clipPolyline(points, width, height) {
    const pieces = [];
    let current = null;
    for (let i = 0; i + 3 < points.length; i += 2) {
        const [px, py, qx, qy] = [points[i], points[i + 1], points[i + 2], points[i + 3]];
        const range = clipSegment(px, py, qx, qy, width, height);
        if (!range) {
            current = flushPiece(pieces, current);
            continue;
        }
        const [t0, t1] = range;
        if (t0 > 0 || !current) {
            flushPiece(pieces, current);
            current = [px + (qx - px) * t0, py + (qy - py) * t0];
        }
        current.push(px + (qx - px) * t1, py + (qy - py) * t1);
        if (t1 < 1) current = flushPiece(pieces, current);
    }
    flushPiece(pieces, current);
    return pieces;
}

function flushPiece(pieces, piece) {
    if (piece && piece.length >= 4) pieces.push(piece);
    return null;
}

/**
 * Step 5: Chaikin corner cutting. Open polylines keep their two end points; closed ones (first
 * point repeated at the end) are cut all the way round.
 * @param {number[]} points - Flat [x0, y0, x1, y1, ...].
 * @param {boolean} closed
 * @param {number} passes
 * @returns {number[]}
 */
export function chaikin(points, closed, passes = 1) {
    let current = points;
    for (let pass = 0; pass < passes; pass++) current = closed ? chaikinClosed(current) : chaikinOpen(current);
    return current;
}

function cutCorner(out, ax, ay, bx, by) {
    out.push(CHAIKIN_NEAR * ax + CHAIKIN_FAR * bx, CHAIKIN_NEAR * ay + CHAIKIN_FAR * by);
    out.push(CHAIKIN_FAR * ax + CHAIKIN_NEAR * bx, CHAIKIN_FAR * ay + CHAIKIN_NEAR * by);
}

function chaikinOpen(points) {
    if (points.length < 6) return points;
    const out = [points[0], points[1]];
    for (let i = 0; i + 3 < points.length; i += 2) cutCorner(out, points[i], points[i + 1], points[i + 2], points[i + 3]);
    out.push(points[points.length - 2], points[points.length - 1]);
    return out;
}

function chaikinClosed(points) {
    if (points.length < 8) return points;
    const out = [];
    for (let i = 0; i + 3 < points.length; i += 2) cutCorner(out, points[i], points[i + 1], points[i + 2], points[i + 3]);
    out.push(out[0], out[1]);
    return out;
}

// ------------------------------------------------------------------ arcs

/**
 * @typedef {object} BorderArc
 * @property {"land"|"sea"} cls - How it is drawn.
 * @property {"land"|"sea"|"shore"} kind - What it separates.
 * @property {number} a - The lower owner key (may be UNCLAIMED).
 * @property {number} b - The higher owner key.
 * @property {Int32Array} vertices - Circumcentre (triangle) ids along the unclipped arc.
 * @property {Int32Array} edges - The half-edge of each segment, in order.
 * @property {boolean} closed - A ring with no junction (only when unclipped).
 * @property {Float64Array} points - The drawable polyline, clipped and smoothed, flat [x0, y0, ...].
 */

/**
 * The borders of one level.
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @param {Int32Array} owners
 * @param {Uint8Array} land
 * @param {object} [options]
 * @param {number} [options.passes] - Chaikin passes (config MESH.CHAIKIN_PASSES).
 * @param {Set<number>|null} [options.exclude] - Half-edges a higher level already draws (see coincidentEdges).
 * @returns {BorderArc[]}
 */
export function arcsForLevel(mesh, owners, land, { passes = FILRODENSWMB.MESH.CHAIKIN_PASSES, exclude = null } = {}) {
    const segments = borderSegments(mesh, owners, land, exclude);
    const circumcentres = mesh.voronoi.circumcenters;
    const vertexCount = circumcentres.length / 2;
    const arcs = [];
    for (const chain of chainSegments(segments, vertexCount)) {
        const raw = [];
        for (const vertex of chain.vertices) raw.push(circumcentres[2 * vertex], circumcentres[2 * vertex + 1]);
        const pieces = clipPolyline(raw, mesh.width, mesh.height);
        const intact = pieces.length === 1 && pieces[0].length === raw.length;
        for (const piece of pieces) {
            const closed = chain.closed && intact;
            arcs.push({
                cls: chain.kind === KIND_LAND ? ARC_CLASS.LAND : ARC_CLASS.SEA,
                kind: KIND_CODES[chain.kind],
                a: chain.a,
                b: chain.b,
                vertices: Int32Array.from(chain.vertices),
                edges: Int32Array.from(chain.edges),
                closed,
                points: Float64Array.from(chaikin(piece, closed, passes)),
            });
        }
    }
    return arcs;
}

/**
 * The half-edges a set of arcs is made of: pass a parent level's arcs (or the union of every
 * higher level's) as `exclude` to arcsForLevel so a child level does not draw a border twice.
 * @param {BorderArc[]} arcs
 * @returns {Set<number>}
 */
export function coincidentEdges(arcs) {
    const edges = new Set();
    for (const arc of arcs) for (const edge of arc.edges) edges.add(edge);
    return edges;
}

/**
 * For each arc, which of its segments a parent level also draws (1) and which only it draws (0).
 * @param {BorderArc[]} arcs
 * @param {BorderArc[]} parentArcs
 * @returns {Uint8Array[]}
 */
export function coincidentWith(arcs, parentArcs) {
    const parentEdges = coincidentEdges(parentArcs);
    return arcs.map((arc) => Uint8Array.from(arc.edges, (edge) => (parentEdges.has(edge) ? 1 : 0)));
}

// ------------------------------------------------------------------ label anchor

/**
 * Where a region's label goes: the cell deepest inside the largest connected part of the region
 * (its "pole of inaccessibility" measured in steps from the part's edge). Depth comes from a
 * breadth-first search started at once from every edge cell of the part (one with a neighbour
 * outside the region, or on the map's edge). Ties go to the cell nearest the part's centroid, then
 * to the lower id, so the anchor never depends on search order.
 *
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @param {Int32Array} owners
 * @param {number} key
 * @returns {{cell: number, x: number, y: number, depth: number, partCells: number}|null} null when the region owns no cells.
 */
export function labelAnchor(mesh, owners, key) {
    const part = largestPart(mesh, owners, key);
    if (!part) return null;
    const depth = depthFromEdge(mesh, owners, key, part);
    const [cx, cy] = centroid(mesh, part);
    let best = part[0];
    let bestDistance = Infinity;
    for (const cell of part) {
        const distance = (mesh.siteX(cell) - cx) ** 2 + (mesh.siteY(cell) - cy) ** 2;
        const deeper = depth[cell] > depth[best];
        const sameDepthCloser = depth[cell] === depth[best] && (distance < bestDistance || (distance === bestDistance && cell < best));
        if (deeper || sameDepthCloser) {
            best = cell;
            bestDistance = distance;
        }
    }
    return { cell: best, x: mesh.siteX(best), y: mesh.siteY(best), depth: depth[best], partCells: part.length };
}

/** The largest connected set of cells owned by `key` (ties to the part with the lowest cell). */
function largestPart(mesh, owners, key) {
    const seen = new Uint8Array(mesh.cellCount);
    let largest = null;
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        if (owners[cell] !== key || seen[cell]) continue;
        const part = [cell];
        seen[cell] = 1;
        for (let head = 0; head < part.length; head++) {
            for (const next of mesh.neighbours(part[head])) {
                if (owners[next] !== key || seen[next]) continue;
                seen[next] = 1;
                part.push(next);
            }
        }
        if (!largest || part.length > largest.length) largest = part;
    }
    return largest;
}

function depthFromEdge(mesh, owners, key, part) {
    const depth = new Int32Array(mesh.cellCount).fill(-1);
    const onHull = new Uint8Array(mesh.cellCount);
    for (const cell of mesh.delaunay.hull) onHull[cell] = 1;
    const queue = [];
    for (const cell of part) {
        if (onHull[cell] || mesh.neighbours(cell).some((next) => owners[next] !== key)) {
            depth[cell] = 0;
            queue.push(cell);
        }
    }
    for (let head = 0; head < queue.length; head++) {
        const cell = queue[head];
        for (const next of mesh.neighbours(cell)) {
            if (owners[next] !== key || depth[next] >= 0) continue;
            depth[next] = depth[cell] + 1;
            queue.push(next);
        }
    }
    return depth;
}

function centroid(mesh, cells) {
    let x = 0;
    let y = 0;
    for (const cell of cells) {
        x += mesh.siteX(cell);
        y += mesh.siteY(cell);
    }
    return [x / cells.length, y / cells.length];
}
