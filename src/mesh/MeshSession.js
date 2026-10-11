import { FILRODENSWMB } from "../config.js";
import { arcsForLevel, coincidentEdges, labelAnchor } from "./BorderArcs.js";
import { Mesh, MeshBuilder, accumulateRows, finishAggregates } from "./MeshBuilder.js";
import { migrateMapData, pinsToCells, regionsToOwners } from "./Migration.js";
import { OwnerLayer, decodeOwners, encodeOwners } from "./OwnerLayer.js";
import { nodesMarkedLine, resampleOwners, retraceLine, routeMarkedLine } from "./Resample.js";
import { routePolyline } from "./RoutePath.js";
import { UNCLAIMED, VECTOR_SCHEMA_VERSION, createMeshBlock, normaliseAreaFactor, randomId, validateOwners, validateVectorData } from "./Schema.js";

/**
 * The mesh of the map that is open, and everything derived from it that drawing and hit-testing
 * read: one OwnerLayer per level, the terrain summaries per cell, and caches of border arcs,
 * label anchors, region bounds and route lines.
 *
 * MeshSession.open brings a saved map into this shape: it builds (or loads) the mesh, migrates a
 * map saved before vector schema version 4, decodes the owner arrays saved beside a newer one,
 * and rebuilds the mesh when the stored one no longer fits the map.
 *
 * Caches are dropped when what they are made from changes: a level's arcs, anchors and bounds
 * when its owners change (see ownersChanged), every level's arcs when cells change between land
 * and water (see refreshAggregates), a route's line when its legs or smoothing change. Nothing
 * here touches PIXI or the DOM, so it runs (and is tested) under Node.
 */

/** Messages MeshSession.open can return, by key, for the caller to localise. */
export const SESSION_WARNINGS = Object.freeze({
    REBUILT: "rebuilt",
    OWNERS_LOST: "ownersLost",
    OWNERS_MISSING: "ownersMissing",
    INVALID: "invalid",
});

/** Rows above and below a refreshed area that are summed again, in spacings: a cell reaches at most about two spacings from its site. */
const BAND_MARGIN_SPACINGS = 4;

/** Region bounds reach this many spacings beyond the outermost sites (a cell's own extent). */
const BOUNDS_MARGIN_SPACINGS = 1.5;

export class MeshSession {
    #arcs = new Map();
    #anchors = new Map();
    #bounds = new Map();
    #routeLines = new Map();
    #ownerChanges = new Map();
    #hint = 0;

    /**
     * @param {object} params
     * @param {Mesh} params.mesh
     * @param {object} params.meshBlock - The map's mesh block (seed, spacing...).
     * @param {Array} params.layerSets
     * @param {Object<string, Int32Array>} params.owners - By level id.
     * @param {import("./MeshBuilder.js").CellAggregates|null} [params.aggregates]
     */
    constructor({ mesh, meshBlock, layerSets, owners, aggregates = null }) {
        this.mesh = mesh;
        this.meshBlock = { ...meshBlock, cells: mesh.cellCount };
        this.aggregates = aggregates;
        this.layers = new Map();
        this.layerSets = [];
        for (const [levelId, array] of Object.entries(owners)) this.layers.set(levelId, new OwnerLayer(array));
        this.setLayerSets(layerSets);
    }

    // ------------------------------------------------------------------ opening a map

    /**
     * Opens a saved map: builds its mesh (through `loadMeshData` when given, so the caller can use
     * a worker and a cache), migrates it if it predates vector schema version 4, or decodes its
     * owner arrays, and rebuilds the mesh if the stored one does not fit.
     *
     * The input is not modified. The map data that comes back is what the map now is (migrated,
     * or with a new mesh block); `changed` says whether it differs from what was saved, so the
     * caller can mark the map unsaved.
     *
     * @param {object} mapData - The saved map (any vector schema version).
     * @param {object} [options]
     * @param {Object<string, string>} [options.owners] - Encoded owner arrays by level id, as saved.
     * @param {object} [options.buffers] - Terrain buffers for the per-cell summaries (see Mesh.aggregate).
     * @param {function(object): Promise<import("./MeshBuilder.js").MeshData|null>} [options.loadMeshData] - Mesh data for constructor parameters.
     * @param {function({stage: string, pct?: number}): void} [options.onProgress]
     * @param {Function} [options.idFactory]
     * @param {string} [options.setName] - Name of the layer set migrated region layers go into.
     * @param {number} [options.levelOpacity] - Opacity of migrated levels.
     * @returns {Promise<{session: MeshSession, mapData: object, migrated: boolean, rebuilt: boolean, changed: boolean, warnings: Array<{key: string, detail?: string}>}>}
     */
    static async open(mapData, { owners = {}, buffers = null, loadMeshData = null, onProgress = null, idFactory = randomId, setName, levelOpacity } = {}) {
        const meshFor = async (params) => {
            const data = loadMeshData ? await loadMeshData(params) : null;
            return new Mesh(params, data);
        };
        const input = structuredClone(mapData);
        normaliseAreaFactor(input);

        const result = (input.vectorSchemaVersion ?? 0) < VECTOR_SCHEMA_VERSION ? await openLegacy(input, meshFor, { onProgress, idFactory, setName, levelOpacity }) : await openCurrent(input, owners, meshFor, { onProgress });

        onProgress?.({ stage: "aggregates" });
        const aggregates = buffers ? result.mesh.aggregate(buffers) : null;
        const session = new MeshSession({ mesh: result.mesh, meshBlock: result.mapData.mesh, layerSets: result.mapData.layerSets ?? [], owners: result.owners, aggregates });
        result.mapData.mesh = session.meshBlock;
        session.#checkData(result.mapData, result.warnings);
        return { session, mapData: result.mapData, migrated: result.migrated, rebuilt: result.rebuilt, changed: result.migrated || result.rebuilt, warnings: result.warnings };
    }

    /**
     * A session for a new, empty map: a fresh mesh block, no layer sets.
     * @param {object} mapData - Needs mapWidth, mapHeight, seed; params for the km scale.
     * @param {object} [options]
     * @param {object} [options.buffers]
     * @param {function(object): Promise<object|null>} [options.loadMeshData]
     */
    static async create(mapData, { buffers = null, loadMeshData = null } = {}) {
        const block = createMeshBlock(mapData);
        const params = MeshBuilder.paramsFor({ ...mapData, mesh: block });
        const mesh = new Mesh(params, loadMeshData ? await loadMeshData(params) : null);
        return new MeshSession({ mesh, meshBlock: block, layerSets: [], owners: {}, aggregates: buffers ? mesh.aggregate(buffers) : null });
    }

    #checkData(mapData, warnings) {
        const problems = validateVectorData(mapData);
        for (const level of this.levels()) problems.push(...validateOwners(this.layer(level.id).owners, level, this.mesh.cellCount));
        if (problems.length) warnings.push({ key: SESSION_WARNINGS.INVALID, detail: problems.join("; ") });
    }

    // ------------------------------------------------------------------ structure

    /**
     * Adopts the map's layer sets: a level without an owner array gets an unclaimed one. Cheap when
     * nothing changed, so it can run before every draw.
     *
     * The owner array of a level that no longer exists is kept (only its cached geometry goes):
     * undoing the level's deletion brings the level back from a snapshot, and its cells must come
     * back with it. Only the levels that exist are saved (see encodeOwners).
     * @param {Array} layerSets
     */
    setLayerSets(layerSets) {
        this.layerSets = layerSets ?? [];
        const ids = new Set();
        for (const level of this.levels()) {
            ids.add(level.id);
            if (!this.layers.has(level.id)) this.layers.set(level.id, new OwnerLayer(this.mesh.cellCount));
        }
        for (const id of [...this.#arcs.keys()]) if (!ids.has(id)) this.#forgetLevel(id);
    }

    /** Every level of every layer set, in drawing order. */
    *levels() {
        for (const set of this.layerSets) yield* set.levels;
    }

    level(levelId) {
        for (const level of this.levels()) if (level.id === levelId) return level;
        return null;
    }

    /** The layer set a level belongs to. */
    setOf(levelId) {
        return this.layerSets.find((set) => set.levels.some((level) => level.id === levelId)) ?? null;
    }

    /** The owner layer of a level (created unclaimed if the level is new). */
    layer(levelId) {
        if (!this.layers.has(levelId)) this.layers.set(levelId, new OwnerLayer(this.mesh.cellCount));
        return this.layers.get(levelId);
    }

    // ------------------------------------------------------------------ lookups

    /** The cell under a map point, or -1 off the map. */
    cellAt(x, y) {
        if (!(x >= 0 && y >= 0 && x < this.mesh.width && y < this.mesh.height)) return -1;
        if (this.mesh.hasCellRaster) return this.mesh.cellRaster[Math.floor(y) * this.mesh.width + Math.floor(x)];
        this.#hint = this.mesh.cellAt(x, y, this.#hint);
        return this.#hint;
    }

    /** The key of the region of a level at a map point, or UNCLAIMED. */
    ownerAt(levelId, x, y) {
        const cell = this.cellAt(x, y);
        return cell < 0 ? UNCLAIMED : this.layer(levelId).owners[cell];
    }

    /** The region of a level at a map point, or null. */
    regionAt(levelId, x, y) {
        const key = this.ownerAt(levelId, x, y);
        if (key === UNCLAIMED) return null;
        return this.level(levelId)?.regions.find((region) => region.key === key) ?? null;
    }

    /** The level and region with this region id, or null. */
    findRegion(regionId) {
        for (const level of this.levels()) {
            const region = level.regions.find((candidate) => candidate.id === regionId);
            if (region) return { level, region };
        }
        return null;
    }

    // ------------------------------------------------------------------ derived geometry

    /**
     * A level's border arcs (see BorderArcs.arcsForLevel). `excludeLevels` lists levels whose
     * borders are drawn already (the level's visible ancestors): the stretches they draw are left
     * out, so a border is drawn once, by the highest level that has it. Cached per level and per
     * set of excluded levels.
     * @param {string} levelId
     * @param {string[]} [excludeLevels]
     * @returns {import("./BorderArcs.js").BorderArc[]}
     */
    arcsFor(levelId, excludeLevels = []) {
        if (!this.aggregates) return [];
        const variants = this.#arcs.get(levelId) ?? new Map();
        this.#arcs.set(levelId, variants);
        const variant = excludeLevels.join("|");
        if (!variants.has(variant)) {
            const exclude = excludeLevels.length ? coincidentEdges(excludeLevels.flatMap((id) => this.arcsFor(id))) : null;
            variants.set(variant, arcsForLevel(this.mesh, this.layer(levelId).owners, this.aggregates.land, { exclude }));
        }
        return variants.get(variant);
    }

    /**
     * Where a region's label goes by default: the deepest point of its largest part (see
     * BorderArcs.labelAnchor). A label the user has placed keeps its own position; that is the
     * caller's choice. Cached per region.
     * @returns {{x: number, y: number}|null} null for a region with no cells.
     */
    labelAnchor(levelId, key) {
        const anchors = this.#anchors.get(levelId) ?? new Map();
        this.#anchors.set(levelId, anchors);
        if (!anchors.has(key)) anchors.set(key, labelAnchor(this.mesh, this.layer(levelId).owners, key));
        return anchors.get(key);
    }

    /**
     * The bounding box of each region of a level, from its cells' sites widened by a cell's
     * reach (for zooming to a region and outlining it in an undo preview). One pass over the
     * level gives every region's; cached per level.
     * @returns {{minX: number, minY: number, maxX: number, maxY: number}|null}
     */
    regionBounds(levelId, key) {
        if (!this.#bounds.has(levelId)) this.#bounds.set(levelId, this.#measureLevel(levelId));
        return this.#bounds.get(levelId).get(key) ?? null;
    }

    #measureLevel(levelId) {
        const boxes = new Map();
        const owners = this.layer(levelId).owners;
        for (let cell = 0; cell < owners.length; cell++) {
            const key = owners[cell];
            if (key === UNCLAIMED) continue;
            const [x, y] = [this.mesh.siteX(cell), this.mesh.siteY(cell)];
            const box = boxes.get(key);
            if (box) {
                box.minX = Math.min(box.minX, x);
                box.minY = Math.min(box.minY, y);
                box.maxX = Math.max(box.maxX, x);
                box.maxY = Math.max(box.maxY, y);
            } else {
                boxes.set(key, { minX: x, minY: y, maxX: x, maxY: y });
            }
        }
        const reach = this.mesh.spacing * BOUNDS_MARGIN_SPACINGS;
        for (const box of boxes.values()) {
            box.minX = Math.max(0, box.minX - reach);
            box.minY = Math.max(0, box.minY - reach);
            box.maxX = Math.min(this.mesh.width, box.maxX + reach);
            box.maxY = Math.min(this.mesh.height, box.maxY + reach);
        }
        return boxes;
    }

    /**
     * The drawable line of a route (see RoutePath.routePolyline), cached until its legs or its
     * smoothing change. Legs are compared by identity: an edit replaces a route's legs array, and
     * an undo restores a copy, either of which is a new array.
     * @param {{id: string, legs: number[][], smoothing: boolean}} route
     * @returns {Float64Array} Flat [x0, y0, ...]; empty for a route without legs.
     */
    routeLine(route) {
        const cached = this.#routeLines.get(route.id);
        const smoothing = route.smoothing === true;
        if (cached?.legs === route.legs && cached.smoothing === smoothing) return cached.line;
        const line = route.legs?.length ? routePolyline(this.mesh, route.legs, smoothing) : singleWaypointLine(this.mesh, route);
        this.#routeLines.set(route.id, { legs: route.legs, smoothing, line });
        return line;
    }

    /** Drops a route's cached line (a route deleted, or changed in place). */
    forgetRoute(routeId) {
        this.#routeLines.delete(routeId);
    }

    // ------------------------------------------------------------------ changes

    /**
     * Records that a level's owners changed (by an OwnerLayer edit or an undo), clearing what was
     * derived from them: the level's arcs, anchors and bounds, and the arcs of every level that
     * left out its borders. The changed cells are remembered for the next takeOwnerChanges.
     * @param {string} levelId
     * @param {import("./OwnerLayer.js").OwnerPatch|null} [patch] - null when any cell may have changed.
     */
    ownersChanged(levelId, patch = null) {
        this.#forgetLevel(levelId);
        for (const variants of this.#arcs.values()) for (const variant of [...variants.keys()]) if (variant.split("|").includes(levelId)) variants.delete(variant);
        const previous = this.#ownerChanges.get(levelId);
        if (previous === "all" || !patch) {
            this.#ownerChanges.set(levelId, "all");
            return;
        }
        if (!patch.cells.length) return;
        const range = { minCell: patch.cells[0], maxCell: patch.cells.at(-1) };
        this.#ownerChanges.set(levelId, previous ? { minCell: Math.min(previous.minCell, range.minCell), maxCell: Math.max(previous.maxCell, range.maxCell) } : range);
    }

    /**
     * The cells of a level changed since the last call: a range of cell ids, "all", or null when
     * nothing changed. The renderer uploads just those rows of the level's owner texture.
     */
    takeOwnerChanges(levelId) {
        const changes = this.#ownerChanges.get(levelId) ?? null;
        this.#ownerChanges.delete(levelId);
        return changes;
    }

    #forgetLevel(levelId) {
        this.#arcs.delete(levelId);
        this.#anchors.delete(levelId);
        this.#bounds.delete(levelId);
    }

    /**
     * Brings the per-cell terrain summaries up to date after the terrain, water or rivers changed.
     * With bounds, only the cells under them are recomputed: the rows of the bounds plus a margin
     * a cell cannot reach beyond are summed again, and the cells seen inside the bounds take their
     * new sums (complete, since all their pixels are in the summed rows).
     *
     * When any cell turns from land to water or back, every level's arcs are cleared (arc classes
     * and coastlines depend on it). The fill needs nothing: the renderer reads the land mask from
     * the terrain's own texture.
     *
     * @param {object} buffers - As for Mesh.aggregate.
     * @param {{minX: number, minY: number, maxX: number, maxY: number}|null} [bounds]
     * @returns {Int32Array} The cells whose land or river state changed.
     */
    refreshAggregates(buffers, bounds = null) {
        if (!this.aggregates || !bounds) return this.#replaceAggregates(this.mesh.aggregate(buffers));

        const { width, height, spacing } = this.mesh;
        const margin = Math.ceil(spacing * BAND_MARGIN_SPACINGS);
        const inner = [Math.max(0, Math.floor(bounds.minY)), Math.min(height, Math.ceil(bounds.maxY) + 1)];
        const outer = [Math.max(0, inner[0] - margin), Math.min(height, inner[1] + margin)];
        const sums = accumulateRows(this.mesh, buffers, outer[0], outer[1]);

        const cells = new Set();
        const raster = this.mesh.cellRaster;
        const [minX, maxX] = [Math.max(0, Math.floor(bounds.minX)), Math.min(width - 1, Math.ceil(bounds.maxX))];
        for (let y = inner[0]; y < inner[1]; y++) for (let x = minX; x <= maxX; x++) cells.add(raster[y * width + x]);

        const before = cellStates(this.aggregates, cells);
        finishAggregates(this.mesh, buffers, sums, cells, this.aggregates);
        return this.#afterRefresh(cells, before);
    }

    #replaceAggregates(next) {
        const previous = this.aggregates;
        this.aggregates = next;
        if (!previous) {
            this.#arcs.clear();
            return new Int32Array(0);
        }
        const changed = [];
        for (let cell = 0; cell < next.land.length; cell++) {
            if (previous.land[cell] !== next.land[cell] || (previous.riverCount[cell] > 0) !== (next.riverCount[cell] > 0)) changed.push(cell);
        }
        if (changed.some((cell) => previous.land[cell] !== next.land[cell])) this.#arcs.clear();
        return Int32Array.from(changed);
    }

    #afterRefresh(cells, before) {
        const changed = [];
        let landChanged = false;
        for (const cell of cells) {
            const [land, river] = before.get(cell);
            const landNow = this.aggregates.land[cell];
            if (land !== landNow) landChanged = true;
            if (land !== landNow || river !== this.aggregates.riverCount[cell] > 0) changed.push(cell);
        }
        if (landChanged) this.#arcs.clear();
        return Int32Array.from(changed).sort();
    }

    // ------------------------------------------------------------------ saving

    /**
     * Every level's owner array encoded for saving, by level id. Cells still holding the key of a
     * region that has been deleted are saved as unclaimed (the live array keeps them, so undoing
     * the deletion brings the region back whole).
     * @returns {Object<string, string>}
     */
    encodeOwners() {
        const encoded = {};
        for (const level of this.levels()) {
            const keys = new Set(level.regions.map((region) => region.key));
            const owners = this.layer(level.id).owners;
            const clean = owners.some((owner) => owner !== UNCLAIMED && !keys.has(owner)) ? owners.map((owner) => (keys.has(owner) ? owner : UNCLAIMED)) : owners;
            encoded[level.id] = encodeOwners(clean);
        }
        return encoded;
    }

    /**
     * Gives pins the cell they stand in (pins added since the map was opened have none yet).
     * @param {Array} pins - Updated in place.
     */
    assignPinCells(pins) {
        for (const pin of pins ?? []) {
            const onMap = Number.isFinite(pin.x) && Number.isFinite(pin.y);
            pin.cell = onMap ? this.cellAt(pin.x, pin.y) : null;
            if (pin.cell === -1) pin.cell = null;
            pin.pinStyle ??= null;
            pin.generated ??= null;
        }
    }
}

// ------------------------------------------------------------------ opening helpers

/** A map saved before version 4: build its mesh and migrate it (see Migration.migrateMapData). */
async function openLegacy(mapData, meshFor, { onProgress, idFactory, setName, levelOpacity }) {
    onProgress?.({ stage: "mesh" });
    const block = createMeshBlock(mapData);
    const mesh = await meshFor(MeshBuilder.paramsFor({ ...mapData, mesh: block }));
    onProgress?.({ stage: "migrate" });
    const migrated = migrateMapData({ ...mapData, mesh: block }, mesh, { idFactory, setName, levelOpacity });
    return { mapData: migrated.mapData, owners: migrated.owners, mesh, migrated: true, rebuilt: false, warnings: [] };
}

/**
 * A map at version 4: build its mesh from the stored block, decode its owners, and rebuild the mesh
 * if the stored block does not fit (another algorithm version, another map size, or owner arrays
 * of a different length).
 */
async function openCurrent(mapData, encodedOwners, meshFor, { onProgress }) {
    const warnings = [];
    const block = mapData.mesh;
    onProgress?.({ stage: "mesh" });
    if (blockFits(block, mapData)) {
        const mesh = await meshFor(MeshBuilder.paramsFor(mapData));
        const owners = decodeLevels(mapData, encodedOwners, warnings);
        const fits = Object.values(owners).every((array) => array.length === mesh.cellCount) && (!block.cells || block.cells === mesh.cellCount);
        if (fits) {
            fillMissingLevels(mapData, owners, mesh.cellCount, warnings);
            mapData.mapPins = mapData.mapPins?.some((pin) => pin.cell === undefined) ? pinsToCells(mapData.mapPins, mesh) : mapData.mapPins;
            return { mapData, owners, mesh, migrated: false, rebuilt: false, warnings };
        }
    }
    onProgress?.({ stage: "rebuild" });
    return rebuildMesh(mapData, encodedOwners, meshFor, warnings);
}

function blockFits(block, mapData) {
    if (!block || block.version !== FILRODENSWMB.MESH.ALGORITHM_VERSION) return false;
    if (block.width !== undefined && block.width !== mapData.mapWidth) return false;
    return block.height === undefined || block.height === mapData.mapHeight;
}

function decodeLevels(mapData, encodedOwners, warnings) {
    const owners = {};
    for (const set of mapData.layerSets ?? []) {
        for (const level of set.levels) {
            const text = encodedOwners?.[level.id];
            if (typeof text !== "string") continue;
            try {
                owners[level.id] = decodeOwners(text);
            } catch (error) {
                warnings.push({ key: SESSION_WARNINGS.OWNERS_LOST, detail: `${level.name || level.id}: ${error.message}` });
            }
        }
    }
    return owners;
}

/** A level whose owner array is missing gets an unclaimed one; worth a warning only if it has regions. */
function fillMissingLevels(mapData, owners, cellCount, warnings) {
    for (const set of mapData.layerSets ?? []) {
        for (const level of set.levels) {
            if (owners[level.id]) continue;
            owners[level.id] = new Int32Array(cellCount).fill(UNCLAIMED);
            if (level.regions.length) warnings.push({ key: SESSION_WARNINGS.OWNERS_MISSING, detail: level.name || level.id });
        }
    }
}

/**
 * Builds a new mesh for the map as it is now and carries the regions and routes over to it.
 *
 * Owners are resampled from the old mesh when it can still be built (the same algorithm, with
 * the size it was made for) and its owner arrays fit it. Otherwise a region falls back to the
 * polygon it was migrated from (legacy.points), and a region with neither loses its cells, with a
 * warning. Routes are re-traced along their old line the same way, or along their legacy points.
 */
async function rebuildMesh(mapData, encodedOwners, meshFor, warnings) {
    const oldBlock = mapData.mesh ?? null;
    const block = createMeshBlock(mapData, { seed: oldBlock?.seed, modelSpacingKm: oldBlock?.modelSpacingKm });
    mapData.mesh = block;
    const mesh = await meshFor(MeshBuilder.paramsFor(mapData));
    const oldMesh = buildOldMesh(oldBlock, mapData);
    const oldOwners = oldMesh ? decodeLevels(mapData, encodedOwners, []) : {};

    const owners = {};
    for (const set of mapData.layerSets ?? []) {
        for (const level of set.levels) owners[level.id] = carryLevel(level, oldMesh, oldOwners[level.id], mesh, warnings);
    }
    mapData.mapRoutes = (mapData.mapRoutes ?? []).flatMap((route) => carryRoute(route, oldMesh, mesh));
    mapData.mapPins = pinsToCells(mapData.mapPins, mesh);
    warnings.unshift({ key: SESSION_WARNINGS.REBUILT });
    return { mapData, owners, mesh, migrated: false, rebuilt: true, warnings };
}

function buildOldMesh(block, mapData) {
    if (block?.version !== FILRODENSWMB.MESH.ALGORITHM_VERSION) return null;
    const width = block.width ?? mapData.mapWidth;
    const height = block.height ?? mapData.mapHeight;
    return MeshBuilder.fromMapData({ ...mapData, mapWidth: width, mapHeight: height, mesh: block });
}

function carryLevel(level, oldMesh, oldOwners, mesh, warnings) {
    if (oldMesh && oldOwners?.length === oldMesh.cellCount) return resampleOwners(oldMesh, oldOwners, mesh);
    const legacy = level.regions.filter((region) => region.legacy?.points?.length);
    if (legacy.length) {
        const { owners } = regionsToOwners([{ id: level.id, regions: legacy.map((region) => ({ ...region, points: region.legacy.points })) }], mesh);
        // regionsToOwners numbers regions afresh; map its keys back to the level's own
        const remapped = owners[level.id];
        const keys = legacy.map((region) => region.key);
        return remapped.map((owner) => (owner === UNCLAIMED ? UNCLAIMED : keys[owner]));
    }
    if (level.regions.length) warnings.push({ key: SESSION_WARNINGS.OWNERS_LOST, detail: level.name || level.id });
    return new Int32Array(mesh.cellCount).fill(UNCLAIMED);
}

function carryRoute(route, oldMesh, mesh) {
    const line = oldMesh && route.legs?.length && route.legs.flat().every((cell) => cell < oldMesh.cellCount) ? routeMarkedLine(route, oldMesh) : nodesMarkedLine(route.legacy?.points);
    const pieces = retraceLine(line, mesh);
    if (!pieces.length) return [{ ...route, waypoints: [], legs: [] }];
    return pieces.map((piece, i) => ({ ...structuredClone(route), ...(i > 0 ? { id: randomId() } : {}), waypoints: piece.waypoints, legs: piece.legs }));
}

function cellStates(aggregates, cells) {
    const states = new Map();
    for (const cell of cells) states.set(cell, [aggregates.land[cell], aggregates.riverCount[cell] > 0]);
    return states;
}

/** A route with a single waypoint draws as a point. */
function singleWaypointLine(mesh, route) {
    const cell = route.waypoints?.[0];
    return cell === undefined ? new Float64Array(0) : Float64Array.of(mesh.siteX(cell), mesh.siteY(cell));
}
