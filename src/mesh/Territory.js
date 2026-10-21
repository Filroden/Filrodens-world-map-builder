import { FILRODENSWMB } from "../config.js";
import { MinHeap } from "./MinHeap.js";
import { UNCLAIMED } from "./Schema.js";

/**
 * Passes that hand cells to regions by spreading outwards from cells already owned: filling
 * unowned land, relaxing borders onto terrain, and claiming territorial waters. Each spreads every
 * owner at once across a cost surface (a multi-source least-cost flood), so a contested cell goes
 * to whichever owner reaches it most cheaply.
 *
 * Every pass edits an OwnerLayer and returns the patch, so it can be undone like a hand edit.
 */

/**
 * Multi-source least-cost flood. Each source cell starts at cost 0 with its owner; the flood
 * crosses only cells `passable` accepts and stops beyond `limit`. Equal costs are settled in cell
 * order (see MinHeap), so the result does not depend on the order sources are listed in.
 *
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @param {Int32Array|number[]} sourceCells
 * @param {Int32Array|number[]} sourceOwners - Owner of each source cell.
 * @param {object} options
 * @param {function(number): boolean} options.passable - Cells the flood may enter.
 * @param {function(number, number): number} options.cost - Cost of the step from one cell to a neighbour.
 * @param {number} [options.limit]
 * @param {function(number, number): boolean} [options.allow] - Whether an owner may enter a cell
 *     (cell, owner); a cell one owner may not enter stays open to the others (a child region kept
 *     inside its parent region).
 * @returns {{owner: Int32Array, cost: Float64Array}} owner is UNCLAIMED where the flood did not reach.
 */
export function floodOwners(mesh, sourceCells, sourceOwners, { passable, cost, limit = Infinity, allow = null }) {
    const owner = new Int32Array(mesh.cellCount).fill(UNCLAIMED);
    const best = new Float64Array(mesh.cellCount).fill(Infinity);
    const heap = new MinHeap(sourceCells.length + 1024);
    for (let i = 0; i < sourceCells.length; i++) {
        best[sourceCells[i]] = 0;
        owner[sourceCells[i]] = sourceOwners[i];
        heap.push(0, sourceCells[i]);
    }
    while (heap.size) {
        const cell = heap.pop();
        const reached = heap.lastPriority;
        if (reached > best[cell]) continue;
        for (const next of mesh.neighbours(cell)) {
            if (!passable(next) || (allow && !allow(next, owner[cell]))) continue;
            const total = reached + cost(cell, next);
            if (total >= best[next] || total > limit) continue;
            best[next] = total;
            owner[next] = owner[cell];
            heap.push(total, next);
        }
    }
    return { owner, cost: best };
}

/** The owned cells (and their owners) matching a predicate, as parallel arrays. */
export function ownedCells(owners, predicate) {
    const cells = [];
    const values = [];
    owners.forEach((owner, cell) => {
        if (owner !== UNCLAIMED && predicate(cell)) {
            cells.push(cell);
            values.push(owner);
        }
    });
    return { cells, values };
}

/**
 * Gives every unowned land cell to the owner nearest to it overland (by distance between sites),
 * as long as it is connected by land to an owned cell. Used after carrying ownership from a
 * coarser mesh, whose coast is less detailed, so the slivers of land it called sea join a region.
 *
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @param {import("./OwnerLayer.js").OwnerLayer} layer
 * @param {Uint8Array} land - 1 for a land cell.
 * @returns {import("./OwnerLayer.js").OwnerPatch}
 */
export function fillUnclaimedLand(mesh, layer, land) {
    const owners = layer.owners;
    const sources = ownedCells(owners, (cell) => land[cell] === 1);
    const flood = floodOwners(mesh, sources.cells, sources.values, {
        passable: (cell) => land[cell] === 1 && owners[cell] === UNCLAIMED,
        cost: (a, b) => mesh.distance(a, b),
    });
    const filled = ownedCells(flood.owner, (cell) => owners[cell] === UNCLAIMED);
    return layer.assign(filled.cells, filled.values);
}

/**
 * Ring distance (in steps) of every owned land cell from the nearest land cell of another owner,
 * up to `rings`; -1 for cells further away (or unowned, or water).
 */
function borderRings(mesh, owners, land, rings) {
    const ring = new Int32Array(mesh.cellCount).fill(-1);
    const isOwnedLand = (cell) => land[cell] === 1 && owners[cell] !== UNCLAIMED;
    let frontier = [];
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        if (!isOwnedLand(cell)) continue;
        if (mesh.neighbours(cell).some((next) => isOwnedLand(next) && owners[next] !== owners[cell])) {
            ring[cell] = 0;
            frontier.push(cell);
        }
    }
    for (let step = 1; step <= rings; step++) {
        const next = [];
        for (const cell of frontier) {
            for (const neighbour of mesh.neighbours(cell)) {
                if (!isOwnedLand(neighbour) || ring[neighbour] >= 0) continue;
                ring[neighbour] = step;
                next.push(neighbour);
            }
        }
        frontier = next;
    }
    return ring;
}

/**
 * The step cost border relaxation uses: the distance between sites, x (1 + metres climbed or
 * descended / reliefMetresPerStep), x riverCross when the step enters a river cell from a dry one.
 * Rivers and ridges therefore cost more to cross than to follow, which is what pulls borders onto
 * them.
 *
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @param {import("./MeshBuilder.js").CellAggregates} aggregates
 * @param {object} [settings] - Defaults from config MESH.RELAX.
 * @returns {function(number, number): number}
 */
export function reliefRiverCost(mesh, aggregates, settings = {}) {
    const { RELIEF_M_PER_STEP, RIVER_CROSS } = { ...FILRODENSWMB.MESH.RELAX, ...settings };
    const metresPerUnit = FILRODENSWMB.MESH.METRES_PER_UNIT;
    const { meanElevation, riverCount } = aggregates;
    return (a, b) => {
        const climbMetres = Math.abs(meanElevation[a] - meanElevation[b]) * metresPerUnit;
        let factor = 1 + climbMetres / RELIEF_M_PER_STEP;
        if (riverCount[b] > 0 && riverCount[a] === 0) factor *= RIVER_CROSS;
        return mesh.distance(a, b) * factor;
    };
}

/**
 * Moves borders onto the terrain. Land cells more than RINGS steps from another owner's land keep
 * their owner and become the sources of a flood across the band between, costed by
 * reliefRiverCost; each band cell goes to whichever owner reaches it most cheaply. A border drawn
 * on a coarse mesh (or by hand) therefore settles along ridges and rivers nearby, without any
 * region gaining or losing ground far from its border.
 *
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @param {import("./OwnerLayer.js").OwnerLayer} layer
 * @param {import("./MeshBuilder.js").CellAggregates} aggregates
 * A level nested in another relaxes inside it: `allow` (as for floodOwners) keeps each owner to the
 * cells of its parent region, so a border between two children moves only within their parent.
 * A band cell no owner may reach keeps its owner.
 *
 * No region is lost: one too small to have cells beyond the band keeps its deepest cells (those
 * furthest from its border) as its sources, and `anchors` keep their owners whatever the flood
 * does (a generated county's seat, so its town stays inside it).
 *
 * @param {object} [settings] - Overrides of config MESH.RELAX.
 * @param {object} [options]
 * @param {function(number, number): boolean} [options.allow] - Whether an owner may take a cell (cell, owner).
 * @param {Iterable<number>} [options.anchors] - Cells that keep their owner.
 * @returns {import("./OwnerLayer.js").OwnerPatch}
 */
export function relaxBorders(mesh, layer, aggregates, settings = {}, { allow = null, anchors = [] } = {}) {
    const { RINGS } = { ...FILRODENSWMB.MESH.RELAX, ...settings };
    const owners = layer.owners;
    const { land } = aggregates;
    const ring = borderRings(mesh, owners, land, RINGS);
    const sources = relaxSources(owners, land, ring, anchors);
    const flood = floodOwners(mesh, sources.cells, sources.values, {
        passable: (cell) => land[cell] === 1 && ring[cell] >= 0,
        cost: reliefRiverCost(mesh, aggregates, settings),
        allow,
    });
    const moved = ownedCells(flood.owner, (cell) => ring[cell] >= 0);
    return layer.assign(moved.cells, moved.values);
}

/**
 * The cells relaxation floods from: owned land beyond the border band; for an owner with none,
 * its land cells deepest in the band; and the anchors.
 */
function relaxSources(owners, land, ring, anchors) {
    const sources = ownedCells(owners, (cell) => land[cell] === 1 && ring[cell] < 0);
    const inland = new Set(sources.values);
    const deepest = new Map();
    owners.forEach((owner, cell) => {
        if (owner === UNCLAIMED || land[cell] !== 1 || inland.has(owner)) return;
        const best = deepest.get(owner);
        if (!best || ring[cell] > best.ring) deepest.set(owner, { ring: ring[cell], cells: [cell] });
        else if (ring[cell] === best.ring) best.cells.push(cell);
    });
    for (const [owner, { cells }] of deepest) {
        for (const cell of cells) {
            sources.cells.push(cell);
            sources.values.push(owner);
        }
    }
    for (const cell of anchors) {
        if (owners[cell] === UNCLAIMED) continue;
        sources.cells.push(cell);
        sources.values.push(owners[cell]);
    }
    return sources;
}

/**
 * Territorial waters: water cells within `limitPx` (by sea, between sites) of a region's coast go
 * to the nearest such region. Coastal land cells (owned land with a water neighbour) are the
 * sources; the flood crosses water only, so a claim never jumps a headland of another realm.
 * Water cells already owned are re-assigned too, so the pass can be re-run after borders move.
 *
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @param {import("./OwnerLayer.js").OwnerLayer} layer
 * @param {Uint8Array} land
 * @param {number} [limitPx] - Claim distance in pixels; defaults to config CLAIM_KM over the mesh's km per pixel.
 * @returns {import("./OwnerLayer.js").OwnerPatch}
 */
export function claimWaters(mesh, layer, land, limitPx = FILRODENSWMB.MESH.CLAIM_KM / mesh.kmPerPx) {
    const owners = layer.owners;
    const isWater = (cell) => land[cell] === 0;
    const sources = ownedCells(owners, (cell) => land[cell] === 1 && mesh.neighbours(cell).some(isWater));
    const flood = floodOwners(mesh, sources.cells, sources.values, {
        passable: isWater,
        cost: (a, b) => mesh.distance(a, b),
        limit: limitPx,
    });
    const water = [];
    const values = [];
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        if (!isWater(cell)) continue;
        water.push(cell);
        values.push(flood.owner[cell]);
    }
    return layer.assign(water, values);
}
