/**
 * The structure of a map's layer sets: which levels a set holds, in what order, and how they nest.
 *
 * A set's `levels` array is its drawing order (first drawn first, so later levels lie on top) and,
 * read with each level's `parentLevelId`, its tree: a level's parent is always an earlier level of
 * the same set. That rule (which Schema.validateVectorData checks) is what every function here
 * keeps true, and what makes cycles impossible: a level can never be its own ancestor because an
 * ancestor always comes first.
 *
 * Every function works on plain layer set objects and changes them in place; none touches owner
 * arrays (see RegionEdits for operations that change cells too). Nothing here touches PIXI or the
 * DOM.
 */

/** Every level of every set, in drawing order. */
export function allLevels(layerSets) {
    return (layerSets ?? []).flatMap((set) => set.levels ?? []);
}

/** Every region of every level, each with its level and set. */
export function allRegions(layerSets) {
    const found = [];
    for (const set of layerSets ?? []) {
        for (const level of set.levels ?? []) for (const region of level.regions ?? []) found.push({ set, level, region });
    }
    return found;
}

/** The set holding a level, or null. */
export function setOfLevel(layerSets, levelId) {
    return (layerSets ?? []).find((set) => set.levels.some((level) => level.id === levelId)) ?? null;
}

/** A level by id, or null. */
export function findLevel(layerSets, levelId) {
    return allLevels(layerSets).find((level) => level.id === levelId) ?? null;
}

/** A region by id with its level and set, or null. */
export function findRegion(layerSets, regionId) {
    return allRegions(layerSets).find((entry) => entry.region.id === regionId) ?? null;
}

/** The levels of a set whose parent is `levelId` (null for the set's top levels), in order. */
export function childLevels(set, levelId) {
    return set.levels.filter((level) => (level.parentLevelId ?? null) === levelId);
}

/** Every level below `levelId` in its set, in drawing order. */
export function descendantLevels(set, levelId) {
    const below = new Set([levelId]);
    const found = [];
    for (const level of set.levels) {
        if (level.parentLevelId && below.has(level.parentLevelId)) {
            below.add(level.id);
            found.push(level);
        }
    }
    return found;
}

/** How many ancestors a level has (0 for a top level), for indenting the tree. */
export function levelDepth(set, level) {
    let depth = 0;
    let parentId = level.parentLevelId;
    while (parentId) {
        depth++;
        parentId = set.levels.find((candidate) => candidate.id === parentId)?.parentLevelId ?? null;
    }
    return depth;
}

/** The parent level, or null for a top level. */
export function parentLevel(set, level) {
    return level.parentLevelId ? (set.levels.find((candidate) => candidate.id === level.parentLevelId) ?? null) : null;
}

/**
 * The levels a level may take as its parent: any other level of its set that is not below it (a
 * level below it would make it its own ancestor).
 */
export function parentCandidates(set, levelId) {
    const below = new Set(descendantLevels(set, levelId).map((level) => level.id));
    return set.levels.filter((level) => level.id !== levelId && !below.has(level.id));
}

/**
 * The level and every level below it, as they stand in the set's order. They always form one
 * block per branch, but not necessarily one contiguous run, so the whole subtree is returned.
 */
function subtree(set, levelId) {
    const level = set.levels.find((candidate) => candidate.id === levelId);
    return level ? [level, ...descendantLevels(set, levelId)] : [];
}

/**
 * Gives a level a new parent (or none), keeping every parent before its children: when the new
 * parent comes later in the set, the level and everything below it move to just after the new
 * parent's own subtree. Refused (returns false) for a parent that is the level itself, below it,
 * or in another set.
 *
 * @param {object} set
 * @param {string} levelId
 * @param {string|null} parentId
 * @returns {boolean} Whether the parent changed.
 */
export function setParent(set, levelId, parentId) {
    const level = set.levels.find((candidate) => candidate.id === levelId);
    if (!level) return false;
    const target = parentId ?? null;
    if ((level.parentLevelId ?? null) === target) return false;
    if (target !== null && !parentCandidates(set, levelId).some((candidate) => candidate.id === target)) return false;

    level.parentLevelId = target;
    if (target === null) return true;
    const moving = subtree(set, levelId);
    const parentIndex = set.levels.findIndex((candidate) => candidate.id === target);
    if (set.levels.indexOf(level) > parentIndex) return true;

    const movingIds = new Set(moving.map((entry) => entry.id));
    const rest = set.levels.filter((entry) => !movingIds.has(entry.id));
    const parentBlock = subtree({ levels: rest }, target);
    const insertAt = Math.max(...parentBlock.map((entry) => rest.indexOf(entry))) + 1;
    rest.splice(insertAt, 0, ...moving);
    set.levels.splice(0, set.levels.length, ...rest);
    return true;
}

/**
 * Moves a level one place up (step -1) or down (step 1) among its siblings (the levels sharing its
 * parent), taking everything below it along. Order among siblings is drawing order, so this
 * changes which is drawn on top; it never changes a parent.
 *
 * @returns {boolean} Whether anything moved (false at either end).
 */
export function moveLevel(set, levelId, step) {
    const level = set.levels.find((candidate) => candidate.id === levelId);
    if (!level) return false;
    const siblings = childLevels(set, level.parentLevelId ?? null);
    const index = siblings.indexOf(level);
    const swapWith = siblings[index + step];
    if (!swapWith) return false;

    const [first, second] = step < 0 ? [swapWith, level] : [level, swapWith];
    const firstBlock = subtree(set, first.id);
    const secondBlock = subtree(set, second.id);
    const blockIds = new Set([...firstBlock, ...secondBlock].map((entry) => entry.id));
    const start = set.levels.findIndex((entry) => blockIds.has(entry.id));
    const rest = set.levels.filter((entry) => !blockIds.has(entry.id));
    rest.splice(start, 0, ...secondBlock, ...firstBlock);
    set.levels.splice(0, set.levels.length, ...rest);
    return true;
}

/**
 * Takes a level out of its set; its child levels take its parent as theirs, so the tree stays
 * whole. Its regions and owner array are the caller's to deal with (see RegionEdits.deleteLevel).
 *
 * @returns {{set: object, index: number, level: object}|null} Where it was, or null if not found.
 */
export function removeLevel(layerSets, levelId) {
    const set = setOfLevel(layerSets, levelId);
    if (!set) return null;
    const index = set.levels.findIndex((level) => level.id === levelId);
    const [level] = set.levels.splice(index, 1);
    for (const child of set.levels) if (child.parentLevelId === levelId) child.parentLevelId = level.parentLevelId ?? null;
    return { set, index, level };
}

/**
 * Adds a level to a set: at the end for a top level, or at the end of its parent's subtree for a
 * child, so a new child is drawn above its parent and its parent's earlier children.
 */
export function insertLevel(set, level) {
    if (!level.parentLevelId) {
        set.levels.push(level);
        return;
    }
    const block = subtree(set, level.parentLevelId);
    const insertAt = block.length ? Math.max(...block.map((entry) => set.levels.indexOf(entry))) + 1 : set.levels.length;
    set.levels.splice(insertAt, 0, level);
}

/**
 * A name not already used by any of `existing`: the base name, or the base followed by the first
 * free number ("Regions 2").
 * @param {string} base
 * @param {Array<{name: string}>} existing
 */
export function uniqueName(base, existing) {
    const taken = new Set((existing ?? []).map((entry) => entry.name));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}
