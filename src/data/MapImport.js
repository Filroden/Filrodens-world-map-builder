import { FILRODENSWMB } from "../config.js";
import { normaliseAreaFactor, ownersKeyFor, randomId, resolveSpacing } from "../mesh/Schema.js";
import { decodeModelRun, unpackArray } from "../generator/ModelRun.js";
import { clean, cleanContext, RULES, STYLE_LIST_RULES } from "./MapRules.js";
import { ImportRefusal, Sanitize } from "./Sanitize.js";
import { needsRebase, rebaseStyles } from "./SymbolSizes.js";

/**
 * Reads a map (or a styles file) someone may have made elsewhere into data the studio can trust.
 * Every import goes through here before anything is saved: a map JSON file, and (from the backup)
 * each map of a zip; and the shared styles file.
 *
 * The steps, in order:
 * 1. **Size:** a file larger than LIMITS.IMPORT.FILE_BYTES is refused before it is read.
 * 2. **Structure:** the parsed JSON is copied value by value (Sanitize.plainTree), dropping every
 *    `__proto__`, `constructor` and `prototype` key and refusing a file that nests too deeply or
 *    holds too many values, too long an array or too long a string.
 * 3. **Allow-list:** a fresh object is built from the known fields only (MapRules), each checked:
 *    colours, enums, numbers, ids, font names and image sources. A value that fails is dropped
 *    and the load path's own default takes its place.
 * 4. **Consistency:** the map's size, the mesh's spacing and the ids other objects refer to are
 *    checked; a map that fails these is refused as damaged, since repairing them would lose data.
 * 5. **Text:** free text longer than its limit (LIMITS.TEXT) refuses the file, naming where.
 * 6. **Images:** done afterwards by MapPackage.resolve: an embedded or packaged image is checked
 *    by its bytes and kept only as what it really is (an SVG is cleaned, see ImageCheck), then
 *    stored the host's way.
 *
 * Nothing is merged into existing state: the result is a new object the caller saves as a new map.
 */
export class MapImport {
    /**
     * A file's text, refused when it is larger than an import may be.
     * @param {Blob} file
     * @returns {Promise<string>}
     * @throws {ImportRefusal}
     */
    static async readText(file) {
        if (file.size > FILRODENSWMB.LIMITS.IMPORT.FILE_BYTES) throw new ImportRefusal("tooLarge", { detail: `${file.size} bytes` });
        return file.text();
    }

    /**
     * JSON text parsed, or refused as not being a file the studio made.
     * @param {string} text
     * @param {"notMap"|"notStyles"} reason
     * @returns {*}
     * @throws {ImportRefusal}
     */
    static parse(text, reason = "notMap") {
        try {
            return JSON.parse(text);
        } catch (error) {
            throw new ImportRefusal(reason, { detail: error.message });
        }
    }

    /**
     * A parsed map file made safe: the map data, its owner arrays (by level id) and how many values
     * were dropped or replaced because they failed their rules. Embedded and packaged images are
     * not checked here (that is asynchronous and depends on the host); MapPackage.resolve checks
     * and stores them before the map is saved.
     *
     * @param {*} parsed - The file's JSON.
     * @param {{newId?: Function}} [options]
     * @returns {{mapData: object, owners: Object<string, string>, modelRun: object|null, name: string|null, pinIcons: object[], corrected: number}}
     *     `modelRun` is the generator's saved outputs (see ModelRun), or null when the file has
     *     none or they do not hold together. `name` is the map's name as the file carries it (see MapJson.toExport), or null for a
     *     file from before exports carried one; it is kept apart from the map data, as a save keeps
     *     it. `pinIcons` are the custom pin icons the file carries for the map (see MapPackage),
     *     which belong to the host's settings rather than the map.
     * @throws {ImportRefusal}
     */
    static read(parsed, { newId = randomId } = {}) {
        const tree = Sanitize.plainTree(parsed);
        if (!isMapShaped(tree)) throw new ImportRefusal("notMap");

        const context = cleanContext(newId);
        const mapData = clean(tree, RULES.map, context);
        if (context.strictIds) throw new ImportRefusal("damaged", { detail: "a layer, set or style has an id that is not valid" });

        checkSize(mapData);
        checkMesh(mapData);
        checkUniqueIds(mapData, newId);
        settleLevels(mapData);
        const owners = cleanOwners(tree.owners, mapData, context);
        const modelRun = cleanModelRun(tree.modelRun, context);
        refuseOverLimit(context);
        normaliseAreaFactor(mapData);
        const name = typeof mapData.name === "string" && mapData.name.trim() ? mapData.name.trim() : null;
        const pinIcons = mapData.pinIcons ?? [];
        delete mapData.name;
        delete mapData.pinIcons;
        return { mapData, owners, modelRun, name, pinIcons, corrected: context.corrected };
    }

    /**
     * A parsed styles file (Styles and icons' Export settings) made safe: its categories, each a
     * list of entries checked by the same rules as a map's own styles and custom biomes. Entries
     * come back without ids: the caller gives each a new one as it adds it.
     *
     * @param {*} parsed
     * @returns {{categories: Object<string, object[]>, corrected: number}}
     * @throws {ImportRefusal}
     */
    static readStyles(parsed) {
        const tree = Sanitize.plainTree(parsed);
        if (!tree || typeof tree !== "object" || !tree.categories || typeof tree.categories !== "object" || Array.isArray(tree.categories)) throw new ImportRefusal("notStyles");
        const context = cleanContext(randomId);
        const categories = {};
        for (const [category, rule] of Object.entries(STYLE_LIST_RULES)) {
            const entries = tree.categories[category];
            if (!Array.isArray(entries)) continue;
            // Ids are left out: the studio gives every imported entry a new one as it adds it
            const { id: _id, ...fields } = rule.fields;
            categories[category] = clean(entries, { t: "list", of: { ...rule, fields } }, context) ?? [];
        }
        refuseOverLimit(context);
        // A file exported before the current size unit holds older pin and label sizes
        if (needsRebase(tree.sizeRevision)) rebaseStyles(categories.customPinStyles, categories.customLabelStyles);
        return { categories, corrected: context.corrected };
    }
}

/** Whether a parsed file looks like a map: a seed, and the generation settings every load reads. */
function isMapShaped(tree) {
    if (!tree || typeof tree !== "object" || Array.isArray(tree)) return false;
    const seed = tree.seed;
    const hasSeed = (typeof seed === "string" && seed.length > 0) || (typeof seed === "number" && Number.isFinite(seed));
    const noise = tree.params?.noise;
    return hasSeed && !!noise?.elevation && typeof noise.elevation === "object" && !!noise.moisture && typeof noise.moisture === "object";
}

/** A map's width and height must be within the import limits: every buffer is allocated from them. */
function checkSize(mapData) {
    const { MAP_DIMENSION_MIN: min, MAP_DIMENSION_MAX: max } = FILRODENSWMB.LIMITS.IMPORT;
    for (const side of [mapData.mapWidth, mapData.mapHeight]) {
        if (!(side >= min && side <= max)) throw new ImportRefusal("damaged", { detail: `map size ${mapData.mapWidth} × ${mapData.mapHeight}` });
    }
}

/**
 * A stored mesh may not be finer than the map's size allows: the mesh is rebuilt from its spacing,
 * and a spacing far below what resolveSpacing would give means millions of cells.
 */
function checkMesh(mapData) {
    const mesh = mapData.mesh;
    if (!mesh) return;
    const config = FILRODENSWMB.MESH;
    const finest = resolveSpacing(mapData.mapWidth, mapData.mapHeight, config.MIN_SPACING);
    if (!(mesh.spacing >= config.MIN_SPACING) || mesh.spacing < finest * MESH_SPACING_TOLERANCE) throw new ImportRefusal("damaged", { detail: `mesh spacing ${mesh.spacing}` });
    if (mesh.cells > config.MAX_CELLS * MESH_CELL_HEADROOM) throw new ImportRefusal("damaged", { detail: `mesh of ${mesh.cells} cells` });
}

/** resolveSpacing rounds up to a tenth of a pixel; a stored spacing a hair under it is the same mesh. */
const MESH_SPACING_TOLERANCE = 0.99;
/** A mesh's cell count is sized from an estimate of its density; twice MAX_CELLS is beyond any real one. */
const MESH_CELL_HEADROOM = 2;

/** The lists whose objects nothing else refers to by id: a repeated id is simply replaced. */
const FREE_LISTS = ["mapPins", "mapRoutes", "mapLabels", "mapDecorations", "tectonicFaults", "manualRivers", "landMasks"];
/** The lists whose objects others refer to by id: a repeated id leaves the references ambiguous. */
const REFERENCED_LISTS = ["customRouteStyles", "customLabelStyles", "customRegionStyles", "customPinStyles"];

function checkUniqueIds(mapData, newId) {
    for (const key of FREE_LISTS) renewRepeatedIds(mapData[key], newId);
    for (const set of mapData.layerSets ?? []) for (const level of set.levels ?? []) renewRepeatedIds(level.regions, newId);
    for (const key of REFERENCED_LISTS) refuseRepeatedIds(mapData[key], key);
    refuseRepeatedIds(mapData.layerSets, "layerSets");
    refuseRepeatedIds(
        (mapData.layerSets ?? []).flatMap((set) => set.levels ?? []),
        "levels",
    );
    refuseRepeatedIds(mapData.customBiomes, "customBiomes");
    refuseRepeatedKeys(mapData);
}

function renewRepeatedIds(items, newId) {
    const seen = new Set();
    for (const item of items ?? []) {
        if (!item.id || seen.has(item.id)) item.id = newId();
        seen.add(item.id);
    }
}

function refuseRepeatedIds(items, where) {
    const seen = new Set();
    for (const item of items ?? []) {
        if (item.id === undefined) throw new ImportRefusal("damaged", { detail: `an entry of ${where} has no id` });
        if (seen.has(item.id)) throw new ImportRefusal("damaged", { detail: `${where} repeats the id ${item.id}` });
        seen.add(item.id);
    }
}

/** Two regions of a level with the same key would own the same cells. */
function refuseRepeatedKeys(mapData) {
    for (const set of mapData.layerSets ?? []) {
        for (const level of set.levels ?? []) {
            const keys = new Set();
            for (const region of level.regions ?? []) {
                if (region.key === undefined) continue;
                if (keys.has(region.key)) throw new ImportRefusal("damaged", { detail: `layer ${level.id} repeats the region key ${region.key}` });
                keys.add(region.key);
            }
        }
    }
}

/**
 * A level's owner key always follows from its id, and its parent must be an earlier level of the
 * same set (anything else is let go, leaving it a top layer, rather than pointing at nothing).
 */
function settleLevels(mapData) {
    for (const set of mapData.layerSets ?? []) {
        const earlier = new Set();
        for (const level of set.levels ?? []) {
            level.ownersKey = ownersKeyFor(level.id);
            if (level.parentLevelId != null && !earlier.has(level.parentLevelId)) level.parentLevelId = null;
            earlier.add(level.id);
        }
    }
}

/** The owner arrays kept: only those of the map's own levels, each a base64 string. */
function cleanOwners(raw, mapData, context) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const levelIds = new Set((mapData.layerSets ?? []).flatMap((set) => (set.levels ?? []).map((level) => level.id)));
    const owners = {};
    for (const [levelId, encoded] of Object.entries(raw)) {
        if (!levelIds.has(levelId) || typeof encoded !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
            context.corrected += 1;
            continue;
        }
        owners[levelId] = encoded;
    }
    return owners;
}

/**
 * The generator's saved outputs kept only when they hold together: every array decodes, and each
 * holds one value per model cell (the shares' start one more, and their cultures and values as many
 * as each other), so nothing reading them can run past an end. Anything else is dropped whole (the
 * map's content is untouched; only the thematic layers lose their data until the next run).
 */
function cleanModelRun(raw, context) {
    if (raw == null) return null;
    const modelRun = clean(raw, RULES.modelRun, context);
    if (modelRun && modelRunHoldsTogether(modelRun)) return modelRun;
    context.corrected += 1;
    return null;
}

function modelRunHoldsTogether(modelRun) {
    const count = modelRun.cellCount;
    if (!Number.isInteger(count) || count <= 0) return false;
    let arrays;
    try {
        arrays = decodeModelRun(modelRun);
    } catch {
        return false;
    }
    const perCell = ["capacity", "population", "security", "cleared", "water", "realm", "duchy", "county", "culture"];
    if (!perCell.every((name) => arrays[name]?.length === count)) return false;
    // An earlier age's realms, one per cell like the run's own
    for (const age of modelRun.history ?? []) {
        try {
            if (age.realm && unpackArray(age.realm).length !== count) return false;
        } catch {
            return false;
        }
    }
    const { shareStart, shareCulture, shareValue } = arrays;
    if (!shareStart || shareStart.length !== count + 1 || shareCulture?.length !== shareValue?.length) return false;
    return shareStart.every((start, index) => start >= 0 && start <= shareCulture.length && (index === 0 || start >= shareStart[index - 1]));
}

/** Refuses a file holding free text past its limit, naming the first place and counting the rest. */
function refuseOverLimit(context) {
    const [first, ...rest] = context.overLimit;
    if (!first) return;
    throw new ImportRefusal("textTooLong", { ...first, more: rest.length, detail: `${context.overLimit.length} over the limit` });
}
