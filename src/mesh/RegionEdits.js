import { MinHeap } from "./MinHeap.js";
import { nestingViolations, parentAssignments } from "./OwnerLayer.js";
import { floodOwners, ownedCells } from "./Territory.js";
import { UNCLAIMED } from "./Schema.js";
import { allLevels, descendantLevels, removeLevel, setOfLevel } from "./LayerTree.js";

/**
 * Edits to regions and levels that change cells as well as the layer sets: deleting and merging
 * regions, deleting levels and sets, keeping a level's regions inside their parent regions while
 * it is painted, and filling or repairing a child level.
 *
 * Every function edits the session's owner layers directly and reports what it changed (patches
 * by level, encoded owner arrays of removed levels), so the caller can record an undo step; the
 * layer sets are changed in place, and the caller snapshots them before calling when the change
 * must be undoable. The session is told about every owner change, so derived geometry is rebuilt.
 */

/** A cell whose site lies within this many spacings of the map's edge counts as touching it (see claimWaters). */
const EDGE_MARGIN_SPACINGS = 2;

/** Unclaimed cells handed out between two checks for cancellation (see autoAssign). */
const AUTO_ASSIGN_CHUNK = 8192;

// ------------------------------------------------------------------ regions

/**
 * Deletes a region: its cells become unclaimed at its level; cells of child levels under them are
 * left as they are (they still belong to their own regions, which can be reassigned or deleted).
 *
 * @param {import("./MeshSession.js").MeshSession} session
 * @param {string} levelId
 * @param {string} regionId
 * @returns {{levelId: string, patch: import("./OwnerLayer.js").OwnerPatch}|null} null when not found.
 */
export function deleteRegion(session, levelId, regionId) {
    const level = session.level(levelId);
    const index = level?.regions.findIndex((region) => region.id === regionId) ?? -1;
    if (index < 0) return null;
    const [region] = level.regions.splice(index, 1);
    const patch = session.layer(levelId).reassign(region.key, UNCLAIMED);
    session.ownersChanged(levelId, patch);
    return { levelId, patch };
}

/**
 * Merges one region into another of the same level: the first one's cells go to the second, and
 * the first is removed. Child levels are unaffected (a child region of the merged region keeps
 * its cells, now inside the region it was merged into).
 *
 * @returns {{levelId: string, patch: import("./OwnerLayer.js").OwnerPatch}|null} null when either is not found or they are the same.
 */
export function mergeRegion(session, levelId, fromId, intoId) {
    const level = session.level(levelId);
    if (!level || fromId === intoId) return null;
    const from = level.regions.find((region) => region.id === fromId);
    const into = level.regions.find((region) => region.id === intoId);
    if (!from || !into) return null;
    level.regions.splice(level.regions.indexOf(from), 1);
    const patch = session.layer(levelId).reassign(from.key, into.key);
    session.ownersChanged(levelId, patch);
    // Child regions that belonged to the merged region now belong to the one it went into
    for (const child of childLevelsOf(session, levelId)) {
        for (const region of child.regions) if (region.parentKey === from.key) region.parentKey = into.key;
    }
    return { levelId, patch };
}

function childLevelsOf(session, levelId) {
    return [...session.levels()].filter((level) => level.parentLevelId === levelId);
}

// ------------------------------------------------------------------ levels and sets

/**
 * Deletes a level: it leaves its set (its child levels take its parent as theirs; see
 * LayerTree.removeLevel) and its owner array leaves the session, encoded, so undo can restore it.
 *
 * @param {import("./MeshSession.js").MeshSession} session
 * @param {Array} layerSets
 * @param {string} levelId
 * @returns {{levelId: string, owners: string|null}|null}
 */
export function deleteLevel(session, layerSets, levelId) {
    const removed = removeLevel(layerSets, levelId);
    if (!removed) return null;
    const owners = session.removeLevelOwners(levelId);
    session.setLayerSets(layerSets);
    return { levelId, owners };
}

/**
 * Deletes a layer set and every level in it (see deleteLevel).
 * @returns {{setId: string, levels: Array<{levelId: string, owners: string|null}>}|null}
 */
export function deleteSet(session, layerSets, setId) {
    const index = layerSets.findIndex((set) => set.id === setId);
    if (index < 0) return null;
    const [set] = layerSets.splice(index, 1);
    const levels = set.levels.map((level) => ({ levelId: level.id, owners: session.removeLevelOwners(level.id) }));
    session.setLayerSets(layerSets);
    return { setId, levels };
}

/** How many regions and owned cells a level holds, and how many levels lie below it (for a deletion's confirmation). */
export function levelCounts(session, layerSets, levelId) {
    const set = setOfLevel(layerSets, levelId);
    const level = session.level(levelId);
    if (!set || !level) return { regions: 0, cells: 0, childLevels: 0 };
    let cells = 0;
    for (const owner of session.layer(levelId).owners) if (owner !== UNCLAIMED) cells++;
    return { regions: level.regions.length, cells, childLevels: descendantLevels(set, levelId).length };
}

// ------------------------------------------------------------------ nesting

/** The parent level of a level, or null for a top level (or a parent that no longer exists). */
export function parentLevelOf(session, level) {
    return level?.parentLevelId ? session.level(level.parentLevelId) : null;
}

/** Whether a key belongs to one of a level's regions. */
function hasKey(level, key) {
    return Number.isInteger(key) && level.regions.some((region) => region.key === key);
}

/**
 * Makes sure a region of a constrained child level knows which parent region it belongs to,
 * fixing it from the parent region under `cell` the first time the region is painted (or when the
 * parent region it had has since gone). On a top level, or a free level, there is nothing to fix.
 *
 * @param {import("./MeshSession.js").MeshSession} session
 * @param {object} level
 * @param {object} region - Its parentKey may be set.
 * @param {number} cell - The cell the paint starts in.
 * @returns {{allowed: boolean, changed: boolean}} allowed is false when the region has no parent
 *     region and the cell lies outside every parent region, so nothing can be painted there.
 */
export function settleParentKey(session, level, region, cell) {
    const parent = parentLevelOf(session, level);
    if (!parent || level.nestingMode === "free") return { allowed: true, changed: false };
    if (hasKey(parent, region.parentKey)) return { allowed: true, changed: false };
    const under = cell >= 0 ? session.layer(parent.id).owners[cell] : UNCLAIMED;
    if (under === UNCLAIMED) return { allowed: false, changed: false };
    region.parentKey = under;
    return { allowed: true, changed: true };
}

/**
 * The cells a paint of `region` may change, as a predicate (null when anything goes): on a
 * constrained child level, only cells of the region's parent region; on a top or free level,
 * every cell. A region not yet given a parent region takes the one under `startCell` for the
 * purpose, as settleParentKey will when it is first painted there, so a preview of a paint
 * matches the paint; without a start cell such a region may change nothing.
 */
export function paintAllow(session, level, region, startCell = -1) {
    const parent = parentLevelOf(session, level);
    if (!parent || level.nestingMode === "free" || !region) return null;
    const parentOwners = session.layer(parent.id).owners;
    const key = hasKey(parent, region.parentKey) ? region.parentKey : startCell >= 0 ? parentOwners[startCell] : UNCLAIMED;
    if (key === UNCLAIMED) return () => false;
    return (cell) => parentOwners[cell] === key;
}

/**
 * After cells of a level changed owner, clears those cells at every constrained level below it,
 * since a child region there belonged to the cell's old owner and would now lie outside its
 * parent. A cleared cell is a changed cell in turn, so the clearing carries on down the tree; a
 * free level keeps its cells, and so stops the clearing below it.
 *
 * Each level's clear is recorded through `record(levelId, patch)` (MeshSession.strokeEdit while
 * a stroke is under way), so it joins the same undo step as the edit that caused it.
 *
 * @param {import("./MeshSession.js").MeshSession} session
 * @param {Array} layerSets
 * @param {string} levelId - The level whose cells changed.
 * @param {ArrayLike<number>} cells - The cells that changed owner there.
 * @param {function(string, import("./OwnerLayer.js").OwnerPatch): void} record
 * @returns {number} How many child cells were cleared, over all levels.
 */
export function clearBelow(session, layerSets, levelId, cells, record) {
    const set = setOfLevel(layerSets, levelId);
    if (!set || !cells.length) return 0;
    const changedBy = new Map([[levelId, cells]]);
    let cleared = 0;
    for (const child of descendantLevels(set, levelId)) {
        const changed = changedBy.get(child.parentLevelId);
        if (!changed?.length || child.nestingMode === "free") continue;
        const patch = session.layer(child.id).erase(changed);
        if (!patch.cells.length) continue;
        record(child.id, patch);
        changedBy.set(child.id, patch.cells);
        cleared += patch.cells.length;
    }
    return cleared;
}

/**
 * The parent region each region of a level belongs to: the region's own parentKey when
 * it still names a parent region, otherwise the parent region holding most of its cells.
 * @returns {Map<number, number>}
 */
export function regionParents(session, level) {
    const parent = parentLevelOf(session, level);
    if (!parent) return new Map();
    const majority = parentAssignments(session.layer(level.id).owners, session.layer(parent.id).owners);
    const assignments = new Map();
    for (const region of level.regions) {
        const key = hasKey(parent, region.parentKey) ? region.parentKey : (majority.get(region.key) ?? UNCLAIMED);
        assignments.set(region.key, key);
    }
    return assignments;
}

/**
 * The cells of a level lying outside the parent region their region belongs to (see
 * regionParents), including cells over unclaimed parent ground. Empty for a top level.
 * @returns {Int32Array}
 */
export function nestingProblems(session, level) {
    const parent = parentLevelOf(session, level);
    if (!parent) return new Int32Array(0);
    return nestingViolations(session.layer(level.id).owners, session.layer(parent.id).owners, regionParents(session, level));
}

/**
 * Repairs a level's nesting: every region is given the parent region it belongs to (see
 * regionParents) and loses the cells it has outside that parent region.
 *
 * @returns {{levelId: string, patch: import("./OwnerLayer.js").OwnerPatch}|null} null for a top level.
 */
export function assignToParents(session, level) {
    if (!parentLevelOf(session, level)) return null;
    const assignments = regionParents(session, level);
    for (const region of level.regions) {
        const key = assignments.get(region.key);
        region.parentKey = key === UNCLAIMED ? null : key;
    }
    const patch = session.layer(level.id).erase(nestingProblems(session, level));
    session.ownersChanged(level.id, patch);
    return { levelId: level.id, patch };
}

/**
 * Gives the unclaimed land cells of a child level to the nearest of its regions inside the same
 * parent region: a least-cost flood (distance between sites) from every claimed land cell of the
 * level, which may only enter an unclaimed land cell whose parent cell belongs to the parent
 * region of the region spreading into it. Cells that no region of their parent region can reach
 * over land stay unclaimed.
 *
 * The flood runs in chunks, yielding to the browser between them, so a long one can be cancelled:
 * when `signal` is aborted it stops and changes nothing (the result is worked out apart from the
 * owner array and only applied at the end).
 *
 * @param {import("./MeshSession.js").MeshSession} session
 * @param {object} level - A child level.
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {function(): Promise<void>} [options.pause] - Awaited between chunks (default: a zero timeout).
 * @returns {Promise<{levelId: string, patch: import("./OwnerLayer.js").OwnerPatch}|null>} null when cancelled, or for a top level.
 */
export async function autoAssign(session, level, { signal = null, pause = defaultPause } = {}) {
    const parent = parentLevelOf(session, level);
    if (!parent || !session.aggregates) return null;
    const { mesh } = session;
    const land = session.aggregates.land;
    const owners = session.layer(level.id).owners;
    const parentOwners = session.layer(parent.id).owners;
    const parentOf = regionParents(session, level);

    const best = new Float64Array(mesh.cellCount).fill(Infinity);
    const result = new Int32Array(mesh.cellCount).fill(UNCLAIMED);
    const heap = new MinHeap();
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        const owner = owners[cell];
        if (owner === UNCLAIMED || land[cell] !== 1) continue;
        best[cell] = 0;
        result[cell] = owner;
        heap.push(0, cell);
    }

    let steps = 0;
    while (heap.size) {
        if (++steps % AUTO_ASSIGN_CHUNK === 0) {
            await pause();
            if (signal?.aborted) return null;
        }
        const cell = heap.pop();
        const reached = heap.lastPriority;
        if (reached > best[cell]) continue;
        const wantedParent = parentOf.get(result[cell]) ?? UNCLAIMED;
        if (wantedParent === UNCLAIMED) continue;
        for (const next of mesh.neighbours(cell)) {
            if (land[next] !== 1 || owners[next] !== UNCLAIMED || parentOwners[next] !== wantedParent) continue;
            const total = reached + mesh.distance(cell, next);
            if (total >= best[next]) continue;
            best[next] = total;
            result[next] = result[cell];
            heap.push(total, next);
        }
    }
    if (signal?.aborted) return null;

    const cells = [];
    const values = [];
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        if (owners[cell] === UNCLAIMED && result[cell] !== UNCLAIMED) {
            cells.push(cell);
            values.push(result[cell]);
        }
    }
    const patch = session.layer(level.id).assign(cells, values);
    session.ownersChanged(level.id, patch);
    return { levelId: level.id, patch };
}

const defaultPause = () => new Promise((resolve) => setTimeout(resolve, 0));

// ------------------------------------------------------------------ territorial waters

/**
 * Gives a level's water cells to its regions by the level's territorial waters rule, and takes
 * back any it no longer claims: every water cell goes to the nearest region by sea distance (a
 * least-cost flood over water from each region's coastal land cells, in map pixels between
 * sites), up to the level's `watersPx`; water beyond the limit, and all water when the limit is
 * 0, is unclaimed. An enclosed water body (one that does not reach the map's edge) whose every shore
 * cell belongs to one region is that region's whole, however large: a lake inside a realm is the
 * realm's.
 *
 * On a constrained child level a region claims only water inside its parent region, as it is
 * painted (see paintAllow). Run after any change to a level's land (a stroke, a fill, a region
 * deleted or merged) and when the limit changes, so the waters always follow the coasts.
 *
 * @param {import("./MeshSession.js").MeshSession} session
 * @param {object} level
 * @returns {{levelId: string, patch: import("./OwnerLayer.js").OwnerPatch}|null} null without terrain.
 */
export function claimWaters(session, level) {
    if (!session.aggregates) return null;
    const { mesh } = session;
    const land = session.aggregates.land;
    const owners = session.layer(level.id).owners;
    const limitPx = Math.max(0, Number(level.watersPx) || 0);
    const parent = parentLevelOf(session, level);
    const nested = parent && level.nestingMode !== "free" ? { owners: session.layer(parent.id).owners, parents: regionParents(session, level) } : null;

    const wanted = limitPx > 0 ? waterClaims(mesh, land, owners, limitPx, nested) : new Int32Array(mesh.cellCount).fill(UNCLAIMED);
    const cells = [];
    const values = [];
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        if (land[cell] === 1 || owners[cell] === wanted[cell]) continue;
        cells.push(cell);
        values.push(wanted[cell]);
    }
    const patch = session.layer(level.id).assign(cells, values);
    session.ownersChanged(level.id, patch);
    return { levelId: level.id, patch };
}

/**
 * The owner each water cell should have (see claimWaters): the generator's flood from the coasts
 * (Territory.floodOwners, kept inside parent regions on a nested level), then whole enclosed bodies.
 */
function waterClaims(mesh, land, owners, limitPx, nested) {
    const isWater = (cell) => land[cell] !== 1;
    const mayClaim = (cell, owner) => !nested || nested.owners[cell] === (nested.parents.get(owner) ?? UNCLAIMED);
    const sources = ownedCells(owners, (cell) => land[cell] === 1 && mesh.neighbours(cell).some(isWater));
    const result = floodOwners(mesh, sources.cells, sources.values, { passable: isWater, cost: (a, b) => mesh.distance(a, b), limit: limitPx, allow: mayClaim }).owner;
    claimEnclosedBodies(mesh, land, owners, result, mayClaim);
    for (let cell = 0; cell < mesh.cellCount; cell++) if (land[cell] === 1) result[cell] = UNCLAIMED;
    return result;
}

/**
 * Gives each enclosed water body with a single shore owner to that owner (see claimWaters). A body
 * is a connected set of water cells; it is open sea when any of its cells touches the map's edge.
 */
function claimEnclosedBodies(mesh, land, owners, result, mayClaim) {
    const seen = new Uint8Array(mesh.cellCount);
    for (let start = 0; start < mesh.cellCount; start++) {
        if (seen[start] || land[start] === 1) continue;
        const body = [];
        const queue = [start];
        seen[start] = 1;
        let open = false;
        let shoreOwner = null;
        for (let head = 0; head < queue.length; head++) {
            const cell = queue[head];
            body.push(cell);
            if (touchesEdge(mesh, cell)) open = true;
            for (const next of mesh.neighbours(cell)) {
                if (land[next] === 1) {
                    if (shoreOwner === null) shoreOwner = owners[next];
                    else if (shoreOwner !== owners[next]) shoreOwner = UNCLAIMED;
                    continue;
                }
                if (seen[next]) continue;
                seen[next] = 1;
                queue.push(next);
            }
        }
        if (open || shoreOwner === null || shoreOwner === UNCLAIMED) continue;
        for (const cell of body) if (mayClaim(cell, shoreOwner)) result[cell] = shoreOwner;
    }
}

/** Whether a cell lies against the map's edge (a cell whose site is within a spacing of it). */
function touchesEdge(mesh, cell) {
    const x = mesh.siteX(cell);
    const y = mesh.siteY(cell);
    const margin = mesh.spacing * EDGE_MARGIN_SPACINGS;
    return x < margin || y < margin || x >= mesh.width - margin || y >= mesh.height - margin;
}

/** How many cells of a child level are unclaimed land inside a claimed parent region (what autoAssign could fill). */
export function unassignedCount(session, level) {
    const parent = parentLevelOf(session, level);
    if (!parent || !session.aggregates) return 0;
    const owners = session.layer(level.id).owners;
    const parentOwners = session.layer(parent.id).owners;
    const land = session.aggregates.land;
    let count = 0;
    for (let cell = 0; cell < owners.length; cell++) {
        if (owners[cell] === UNCLAIMED && land[cell] === 1 && parentOwners[cell] !== UNCLAIMED) count++;
    }
    return count;
}

/** Every level id of the layer sets (for checks that owners and levels agree). */
export function levelIds(layerSets) {
    return new Set(allLevels(layerSets).map((level) => level.id));
}
