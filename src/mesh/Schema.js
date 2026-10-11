import { FILRODENSWMB } from "../config.js";

/**
 * The shapes of the map's vector data from vector schema version 4 onwards: the display mesh's
 * parameters, layer sets with their levels and regions, routes as waypoint cells, and the extra
 * fields pins carry. Factories fill in defaults, validateVectorData reports what is wrong with a
 * map's data, and the scale helpers turn a map's latitudes into effective kilometres.
 *
 * Nothing here touches Foundry, PIXI or the DOM, so the same module runs in the browser, in a
 * worker and under Node.
 *
 * Owner arrays (one Int32Array per level, a cell's value being the `key` of the region that owns
 * it, or -1) are deliberately not part of mapData: they live under their own flag keys (see
 * ownersKeyFor) so a save or an undo touches only the level that changed.
 */

export const VECTOR_SCHEMA_VERSION = FILRODENSWMB.VECTOR_SCHEMA_VERSION;

/** The owner value of a cell no region owns. */
export const UNCLAIMED = -1;

export const LAYER_SET_KINDS = Object.freeze(["political", "custom"]);
export const VISIBILITIES = Object.freeze(["all", "gm", "none"]);
export const ROUTE_MODES = Object.freeze(["terrain", "direct", "trace"]);
export const ROUTE_CLASSES = Object.freeze(["trunk", "main", "minor"]);
export const ROUTE_TRANSPORTS = Object.freeze(["road", "river", "sea"]);

const KM_PER_DEGREE = 111.2;
const ID_LENGTH = 16;
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const SEED_RANGE = 0x100000000;

/** Cells per square pixel of a Bridson mesh at spacing 1 (measured, about 0.6). */
export const POISSON_DENSITY = 0.6;

/**
 * A random 16-character id in the same alphabet as foundry.utils.randomID, for code that may run
 * where Foundry is not loaded. Callers inside Foundry may pass foundry.utils.randomID instead
 * wherever a factory accepts an `idFactory`.
 * @returns {string}
 */
export function randomId() {
    let id = "";
    // Ids only need to be unique within a map, not unpredictable
    for (let i = 0; i < ID_LENGTH; i++) id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)]; // NOSONAR
    return id;
}

/**
 * FNV-1a hash of a string to an unsigned 32-bit integer. Used to derive a mesh seed from the map's
 * own seed text when a map is first given a mesh, so the same map migrates to the same mesh on
 * every machine; afterwards the stored mesh seed is used and the terrain seed can change freely.
 * @param {string} text
 * @returns {number}
 */
export function hashString(text) {
    let hash = 2166136261;
    for (const char of String(text)) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

// ------------------------------------------------------------------ scale

/**
 * Effective kilometres per map pixel. The drawn map spans its latitude range over its height; the
 * world it shows is AREA_FACTOR times smaller in area than that would make it (see config MESH).
 *
 * @param {object} mapData - Needs mapHeight and, optionally, params.latTop/latBottom and world.areaFactor.
 * @returns {number}
 */
export function effectiveKmPerPx(mapData) {
    const config = FILRODENSWMB.MESH;
    const top = mapData?.params?.latTop ?? config.DEFAULT_LAT_TOP;
    const bottom = mapData?.params?.latBottom ?? config.DEFAULT_LAT_BOTTOM;
    const areaFactor = clampAreaFactor(mapData?.world?.areaFactor);
    const span = Math.abs(top - bottom) || config.DEFAULT_LAT_TOP - config.DEFAULT_LAT_BOTTOM;
    return (span * KM_PER_DEGREE) / mapData.mapHeight / Math.sqrt(areaFactor);
}

/**
 * A map's area factor made valid: a whole number within MESH.AREA_FACTOR_RANGE, or the default
 * (MESH.AREA_FACTOR) when there is no usable number.
 * @param {*} value
 * @returns {number}
 */
export function clampAreaFactor(value) {
    const config = FILRODENSWMB.MESH;
    const [min, max] = config.AREA_FACTOR_RANGE;
    const number = Number(value);
    if (value === null || value === undefined || value === "" || !Number.isFinite(number)) return config.AREA_FACTOR;
    return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * The display spacing a map of this size gets: the requested spacing, widened if the mesh would
 * otherwise have more than MAX_CELLS cells (a Poisson-disc mesh at spacing r has about
 * 0.6 x area / r² cells).
 *
 * @param {number} width
 * @param {number} height
 * @param {number} [spacing]
 * @returns {number}
 */
export function resolveSpacing(width, height, spacing = FILRODENSWMB.MESH.SPACING) {
    const config = FILRODENSWMB.MESH;
    const requested = Math.max(spacing, config.MIN_SPACING);
    const smallestThatFits = Math.sqrt((POISSON_DENSITY * width * height) / config.MAX_CELLS);
    if (requested >= smallestThatFits) return requested;
    // Round up to a tenth of a pixel so the stored value is short and the estimate stays under the cap
    return Math.ceil(smallestThatFits * 10) / 10;
}


// ------------------------------------------------------------------ factories

/**
 * The mesh parameters stored with a map. Everything else about the mesh is rebuilt from these.
 *
 * The model spacing is stored in pixels as well as in effective km. The model sites are sampled
 * before the display sites and every display site depends on where they fell, so if the pixel
 * spacing were worked out afresh from the km value on each load, changing the map's area factor
 * (which changes km per pixel) would move every cell and invalidate every owner array. Fixing the
 * pixel value when the mesh is created keeps the mesh, and so the regions painted on it, exactly
 * where they are whatever the area factor later becomes; the generator reads modelSpacingKm for
 * its own scale.
 *
 * The map's width and height are recorded too, so a map whose size no longer matches its mesh can
 * be told apart from one whose mesh simply has to be rebuilt (see MeshSession).
 *
 * @param {object} mapData - Needs mapWidth, mapHeight and seed; params.latTop/latBottom and
 *     world.areaFactor give the km scale.
 * @param {object} [overrides]
 * @returns {{seed: number, spacing: number, cells: number, modelSpacingKm: number, modelSpacingPx: number, width: number, height: number, version: number}}
 */
export function createMeshBlock(mapData, overrides = {}) {
    const config = FILRODENSWMB.MESH;
    const spacing = resolveSpacing(mapData.mapWidth, mapData.mapHeight, overrides.spacing ?? config.SPACING);
    const modelSpacingKm = overrides.modelSpacingKm ?? config.MODEL_SPACING_KM;
    return {
        seed: (overrides.seed ?? hashString(`mesh:${mapData.seed ?? ""}`)) % SEED_RANGE,
        spacing,
        cells: overrides.cells ?? 0,
        modelSpacingKm,
        modelSpacingPx: overrides.modelSpacingPx ?? modelSpacingKm / effectiveKmPerPx(mapData),
        width: mapData.mapWidth,
        height: mapData.mapHeight,
        version: config.ALGORITHM_VERSION,
    };
}

/** The flag key, relative to the map's flag object, that holds a level's owner array. */
export function ownersKeyFor(levelId) {
    return `owners.${levelId}`;
}

/** Default border style of a level. */
export function defaultLevelStyle() {
    return {
        quickStyle: null,
        lineColor: "#ffffff",
        lineThickness: 1.5,
        lineStyle: "solid",
        seaLineThickness: 0.75,
        seaLineStyle: "dashed",
        // Off: thicknesses are map pixels, as region borders have always been. On: they are
        // multiplied by the map's resolution scale, as pins and labels are, so a border keeps its
        // weight relative to the map on very large or very small maps.
        scaleWithMap: false,
    };
}

/**
 * A layer set (for example "Political"): ordered levels, each a partition of the mesh.
 * @param {object} [fields]
 * @param {Function} [idFactory]
 */
export function createLayerSet(fields = {}, idFactory = randomId) {
    return {
        id: fields.id ?? idFactory(),
        name: fields.name ?? "",
        kind: fields.kind ?? "custom",
        visibility: fields.visibility ?? "all",
        waterTint: fields.waterTint ?? true,
        levels: fields.levels ?? [],
    };
}

/**
 * A level of a layer set. Region keys are small integers unique within the level and never reused
 * (nextKey only grows), so an owner array stays valid when regions are deleted or reordered and
 * undo never has to renumber cells.
 * @param {object} [fields]
 * @param {Function} [idFactory]
 */
export function createLevel(fields = {}, idFactory = randomId) {
    const id = fields.id ?? idFactory();
    return {
        id,
        name: fields.name ?? "",
        titleTemplate: fields.titleTemplate ?? "{name}",
        parentLevelId: fields.parentLevelId ?? null,
        visibility: fields.visibility ?? "all",
        opacity: fields.opacity ?? 0.35,
        style: { ...defaultLevelStyle(), ...fields.style },
        regions: fields.regions ?? [],
        nextKey: fields.nextKey ?? (fields.regions ?? []).reduce((next, region) => Math.max(next, region.key + 1), 0),
        ownersKey: ownersKeyFor(id),
    };
}

/**
 * A region of a level, taking the level's next key. The region holds no geometry: the cells whose
 * owner equals its key are the region.
 * @param {object} level - Updated in place (nextKey advances).
 * @param {object} [fields]
 * @param {Function} [idFactory]
 */
export function addRegion(level, fields = {}, idFactory = randomId) {
    const region = {
        id: fields.id ?? idFactory(),
        key: level.nextKey,
        name: fields.name ?? "",
        description: fields.description ?? "",
        fillColor: fields.fillColor ?? null,
        quickStyle: fields.quickStyle ?? null,
        visibility: fields.visibility ?? "all",
        label: fields.label ?? null,
        journalPageId: fields.journalPageId ?? null,
        generated: fields.generated ?? null,
    };
    if (fields.legacy) region.legacy = fields.legacy;
    level.nextKey += 1;
    level.regions.push(region);
    return region;
}

/**
 * A route in the mesh shape. `legs[k]` runs from waypoints[k] to waypoints[k + 1], both included.
 * @param {object} [fields]
 * @param {Function} [idFactory]
 */
export function createRoute(fields = {}, idFactory = randomId) {
    const route = {
        id: fields.id ?? idFactory(),
        name: fields.name ?? "",
        description: fields.description ?? "",
        visibility: fields.visibility ?? "all",
        label: fields.label ?? null,
        quickStyle: fields.quickStyle ?? null,
        color: fields.color ?? "#000000",
        thickness: fields.thickness ?? 2,
        style: fields.style ?? "solid",
        outline: fields.outline ?? false,
        smoothing: fields.smoothing ?? false,
        mode: fields.mode ?? "terrain",
        waypoints: fields.waypoints ?? [],
        legs: fields.legs ?? [],
        class: fields.class ?? null,
        transport: fields.transport ?? null,
        generated: fields.generated ?? null,
    };
    if (fields.legacy) route.legacy = fields.legacy;
    return route;
}

// ------------------------------------------------------------------ validation

/**
 * Checks a map's v4 vector data. Owner arrays are checked separately (validateOwners), since they
 * are stored apart from mapData.
 *
 * The one thing it repairs rather than reports is the area factor: a missing, fractional or out of
 * range world.areaFactor is set to its clamped value (see clampAreaFactor), because a map from an
 * older build or an edited JSON file can carry any number there, and every km-based figure the
 * map shows depends on it. A map without a world object is left without one; it reads as the
 * default.
 *
 * @param {object} mapData - Its world.areaFactor may be updated.
 * @returns {string[]} One message per problem; empty when the data is valid.
 */
export function validateVectorData(mapData) {
    const errors = [];
    normaliseAreaFactor(mapData);
    if (mapData.vectorSchemaVersion !== VECTOR_SCHEMA_VERSION) errors.push(`vectorSchemaVersion is ${mapData.vectorSchemaVersion}, expected ${VECTOR_SCHEMA_VERSION}`);
    if ("regionLayers" in mapData) errors.push("regionLayers is still present");
    validateMeshBlock(mapData.mesh, errors);

    const levelIds = new Set();
    for (const set of mapData.layerSets ?? []) validateLayerSet(set, levelIds, errors);
    for (const route of mapData.mapRoutes ?? []) validateRoute(route, mapData.mesh?.cells, errors);
    return errors;
}

/**
 * Sets a map's world.areaFactor to its clamped value when the map has a world object (see
 * clampAreaFactor). Returns the value in force either way.
 * @param {object} mapData
 * @returns {number}
 */
export function normaliseAreaFactor(mapData) {
    const value = clampAreaFactor(mapData?.world?.areaFactor);
    if (mapData?.world && typeof mapData.world === "object") mapData.world.areaFactor = value;
    return value;
}

function validateMeshBlock(mesh, errors) {
    if (!mesh) {
        errors.push("mesh is missing");
        return;
    }
    if (!Number.isInteger(mesh.seed) || mesh.seed < 0) errors.push("mesh.seed must be a non-negative integer");
    if (!Number.isFinite(mesh.spacing) || mesh.spacing < FILRODENSWMB.MESH.MIN_SPACING) errors.push(`mesh.spacing must be at least ${FILRODENSWMB.MESH.MIN_SPACING}`);
    if (!Number.isFinite(mesh.modelSpacingKm) || mesh.modelSpacingKm <= 0) errors.push("mesh.modelSpacingKm must be positive");
}

function validateLayerSet(set, levelIds, errors) {
    if (!LAYER_SET_KINDS.includes(set.kind)) errors.push(`layer set ${set.id}: unknown kind ${set.kind}`);
    if (!VISIBILITIES.includes(set.visibility)) errors.push(`layer set ${set.id}: unknown visibility ${set.visibility}`);
    const own = new Set(set.levels.map((level) => level.id));
    for (const level of set.levels) {
        if (levelIds.has(level.id)) errors.push(`level ${level.id} appears twice`);
        levelIds.add(level.id);
        // A parent must come earlier in the same set, which also rules out cycles
        if (level.parentLevelId !== null && (!own.has(level.parentLevelId) || !levelIds.has(level.parentLevelId))) {
            errors.push(`level ${level.id}: parent ${level.parentLevelId} is not an earlier level of the same set`);
        }
        validateRegionKeys(level, errors);
    }
}

function validateRegionKeys(level, errors) {
    const keys = new Set();
    for (const region of level.regions) {
        if (!Number.isInteger(region.key) || region.key < 0) errors.push(`level ${level.id}: region ${region.id} has no valid key`);
        else if (keys.has(region.key)) errors.push(`level ${level.id}: key ${region.key} is used twice`);
        else if (region.key >= level.nextKey) errors.push(`level ${level.id}: key ${region.key} is not below nextKey`);
        keys.add(region.key);
    }
}

function validateRoute(route, cellCount, errors) {
    if (!ROUTE_MODES.includes(route.mode)) errors.push(`route ${route.id}: unknown mode ${route.mode}`);
    const { waypoints, legs } = route;
    if (legs.length !== Math.max(0, waypoints.length - 1)) {
        errors.push(`route ${route.id}: ${waypoints.length} waypoints need ${Math.max(0, waypoints.length - 1)} legs, found ${legs.length}`);
        return;
    }
    legs.forEach((leg, k) => {
        if (leg[0] !== waypoints[k] || leg.at(-1) !== waypoints[k + 1]) errors.push(`route ${route.id}: leg ${k} does not run between its waypoints`);
    });
    if (cellCount && waypoints.some((cell) => !(cell >= 0 && cell < cellCount))) errors.push(`route ${route.id}: a waypoint is not a cell of the mesh`);
}

/**
 * Checks an owner array against its level: the right length, and every value either UNCLAIMED or
 * the key of one of the level's regions.
 * @param {Int32Array} owners
 * @param {object} level
 * @param {number} cellCount
 * @returns {string[]}
 */
export function validateOwners(owners, level, cellCount) {
    const errors = [];
    if (owners.length !== cellCount) errors.push(`level ${level.id}: ${owners.length} owners for ${cellCount} cells`);
    const keys = new Set(level.regions.map((region) => region.key));
    const unknown = new Set();
    for (const owner of owners) if (owner !== UNCLAIMED && !keys.has(owner)) unknown.add(owner);
    if (unknown.size) errors.push(`level ${level.id}: owners refer to unknown keys ${[...unknown].slice(0, 5).join(", ")}`);
    return errors;
}
