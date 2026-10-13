import { MinHeap } from "./MinHeap.js";
import { nestingViolations, parentAssignments } from "./OwnerLayer.js";
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
 * every cell.
 */
export function paintAllow(session, level, region) {
    const parent = parentLevelOf(session, level);
    if (!parent || level.nestingMode === "free" || !region) return null;
    const parentOwners = session.layer(parent.id).owners;
    const key = region.parentKey;
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
