/**
 * Saved maps in Foundry: each map is a JournalEntry in the world compendium, holding the map data
 * (and each level's encoded owner array) in its flags, plus a readable summary page. From v5 a
 * map's journal also keeps its world record fields (its world, map type, revision and the time of
 * its last changed save) in a flag of their own, and each world is a JournalEntry in a second
 * compendium, its record in its flags (see Worlds). This is the Foundry implementation of the
 * platform's `store` service (see ../index.js); the shared code reaches it as `platform.store`.
 */
import { FILRODENSWMB } from "../../config.js";
import { ColorMath } from "../../kernel/util/ColorMath.js";
import { Blobs } from "../../kernel/data/Blobs.js";
import { TerrainVersion } from "../../studios/world/tools/TerrainVersion.js";
import { BiomePlacement } from "../../studios/world/generation/BiomePlacement.js";

/** Decimal places kept when showing a regional map's zoom (a crop's zoom need not be a whole number). */
const ZOOM_DECIMALS = 2;
/** Decimal places kept when turning a saved noise scale back into its slider value. */
const SCALE_DECIMALS = 2;
/** Decimal places kept when showing the noise's pan offsets. */
const OFFSET_DECIMALS = 2;
/** Pin types that mark river sources (added or removed) rather than points of interest. */
const SPRING_PIN_TYPES = Object.freeze({ ADDED: "spring", REMOVED: "block_spring" });
/** The localisation key naming each grid type (see FILRODENSWMB.GRID_TYPES). */
const GRID_LABELS = Object.freeze({
    none: "FILRODENSWMB.UI.GridNone",
    square: "FILRODENSWMB.UI.GridSquare",
    hexR: "FILRODENSWMB.UI.GridHexRows",
    hexC: "FILRODENSWMB.UI.GridHexCols",
});

/** A compendium of the world, made when it does not exist yet. */
async function ensurePack(name, label) {
    const pack = game.packs.get(`world.${name}`);
    if (pack) return pack;
    console.log(`FWMB | Initializing the ${name} compendium...`);
    return foundry.documents.collections.CompendiumCollection.createCompendium({ type: "JournalEntry", label, name, package: "world" });
}

/**
 * Ensures the maps compendium and the worlds compendium exist, creating them natively if they do not.
 */
export async function initializeCompendium() {
    const pack = await ensurePack(FILRODENSWMB.COMPENDIUM.NAME, FILRODENSWMB.COMPENDIUM.LABEL);
    await ensurePack(FILRODENSWMB.COMPENDIUM.WORLDS_NAME, FILRODENSWMB.COMPENDIUM.WORLDS_LABEL);
    return pack;
}

/**
 * Retrieves a nested hierarchical array of all saved maps for the UI.
 */
export async function getSavedMaps() {
    const packName = `world.${FILRODENSWMB.COMPENDIUM.NAME}`;
    const pack = game.packs.get(packName);
    if (!pack) return [];

    // Instruct Foundry to extract the parentId flag into the index memory
    const index = await pack.getIndex({ fields: [`flags.${FILRODENSWMB.ID}.mapData.parentId`] });

    const mapDict = {};
    const rootMaps = [];

    // 1. Initialise all dictionary entries
    index.forEach((entry) => {
        mapDict[entry._id] = {
            id: entry._id,
            name: entry.name || "",
            parentId: entry.flags?.[FILRODENSWMB.ID]?.mapData?.parentId || null,
            children: [],
        };
    });

    const alphaSort = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

    // 2. Build the structural hierarchy
    Object.values(mapDict).forEach((map) => {
        // If a map has a parentId AND that parent still exists in the compendium, nest it
        if (map.parentId && mapDict[map.parentId]) {
            mapDict[map.parentId].children.push(map);
        } else {
            // Otherwise, it is a root-level map
            rootMaps.push(map);
        }
    });

    // 3. Sort roots and all nested children alphabetically
    rootMaps.sort(alphaSort);
    Object.values(mapDict).forEach((map) => map.children.sort(alphaSort));

    return rootMaps;
}

/**
 * The values the journal summary (templates/world/journal-summary.hbs) shows that are not stored in
 * the map data as they are displayed: they are worked out from it here, so the template only
 * has to print them.
 *
 * @param {object} payload - The map data being saved.
 * @returns {object} Fields to add to the template's data, each prefixed "journal".
 */
function buildJournalContext(payload) {
    // TerrainVersion reads these fields from a uiState; the saved payload keeps the wind
    // distance (from which an older regional map's zoom is recovered) inside its params.
    const state = {
        generationEngine: payload.generationEngine,
        terrainVersion: payload.terrainVersion,
        world: payload.world,
        windDistance: payload.params?.climate?.windDistance,
        mapWidth: payload.mapWidth,
        mapHeight: payload.mapHeight,
    };
    const zoom = TerrainVersion.resolveWorld(state).zoom;

    return {
        journalEngineLabel: getEngineLabel(state),
        journalCurrentCoastline: TerrainVersion.usesCurrentCoastline(state),
        journalRegionalZoom: zoom === 1 ? null : Number(zoom.toFixed(ZOOM_DECIMALS)),
        journalColors: getJournalColors(payload),
        journalGridType: GRID_LABELS[payload.gridType] ?? payload.gridType,
        journalGridless: payload.gridType === "none",
        journalScales: getSliderScales(payload.params?.noise),
        journalNoiseOffset: {
            x: roundTo(payload.params?.noise?.offsetX, OFFSET_DECIMALS),
            y: roundTo(payload.params?.noise?.offsetY, OFFSET_DECIMALS),
        },
        journalFeatures: countFeatures(payload),
    };
}

/**
 * The noise scales as their sliders show them. The map's parameters store each scale as its
 * reciprocal (the noise frequency the engines multiply by), so a slider value of 250 is saved
 * as 0.004; inverting it again gives back the value the user set.
 * @param {object} [noise] - The saved params.noise.
 * @returns {{elevation: number|null, moisture: number|null, temperature: number|null}}
 */
function getSliderScales(noise) {
    const fromFrequency = (frequency) => (frequency > 0 ? roundTo(1 / frequency, SCALE_DECIMALS) : null);
    return {
        elevation: fromFrequency(noise?.elevation?.scale),
        moisture: fromFrequency(noise?.moisture?.scale),
        temperature: fromFrequency(noise?.temperature?.scale),
    };
}

/**
 * A number rounded to a number of decimal places, without trailing zeros (250, not 250.00).
 * @param {number|undefined} value
 * @param {number} decimals
 * @returns {number|null} Null when there is no number to round.
 */
function roundTo(value, decimals) {
    return Number.isFinite(value) ? Number(value.toFixed(decimals)) : null;
}

/**
 * How many of each kind of feature the map holds. Procedural rivers are not counted: they are
 * generated from the terrain each time the map loads, so they are not part of the saved data.
 * @param {object} payload - The map data being saved.
 * @returns {object} A count per feature kind.
 */
function countFeatures(payload) {
    const pins = payload.mapPins || [];
    const countPins = (type) => pins.filter((pin) => pin.type === type).length;
    // A map at vector schema version 4 keeps its regions in the levels of its layer sets; each
    // level counts as a region layer, as the region layers it replaces did
    const layers = payload.regionLayers || (payload.layerSets || []).flatMap((set) => set.levels || []);
    const springs = countPins(SPRING_PIN_TYPES.ADDED);
    const blocked = countPins(SPRING_PIN_TYPES.REMOVED);

    return {
        customRivers: payload.manualRivers?.length ?? 0,
        springsAdded: springs,
        springsRemoved: blocked,
        tectonicFeatures: payload.tectonicFaults?.length ?? 0,
        pointsOfInterest: pins.length - springs - blocked,
        routes: payload.mapRoutes?.length ?? 0,
        regionLayers: layers.length,
        regions: layers.reduce((total, layer) => total + (layer.regions?.length ?? 0), 0),
        labels: payload.mapLabels?.length ?? 0,
        decorations: payload.mapDecorations?.length ?? 0,
    };
}

/**
 * The engine's name as the engine list shows it, with its version for the engines that have had
 * more than one (for example "Guided v2").
 * @param {object} state - Reads generationEngine and terrainVersion.
 * @returns {string}
 */
function getEngineLabel(state) {
    const nameKey = TerrainVersion.ENGINE_NAMES[state.generationEngine];
    if (!nameKey) return state.generationEngine ?? "";
    return game.i18n.format("FILRODENSWMB.UI.EngineVersion", { name: game.i18n.localize(nameKey), version: TerrainVersion.getDisplayVersion(state) });
}

/**
 * The biome palette rows: every built-in biome whose colour was changed, then every custom
 * biome, each with its colour and placement. Built-in names are localisation keys; custom biome
 * names are the user's own text, which the {{localize}} helper passes through unchanged.
 * @param {object} payload - The map data being saved.
 * @returns {Array<{label: string, hex: string, placement: string}>}
 */
function getJournalColors(payload) {
    const builtIn = Object.entries(payload.params?.customColors || {}).map(([key, rgb]) => ({
        label: `FILRODENSWMB.BIOMES.${key}`,
        hex: ColorMath.rgbToHex(rgb),
        placement: BiomePlacement.labelOf(BiomePlacement.placementOfBuiltIn(key)),
    }));
    const custom = (payload.customBiomes || []).map((biome) => ({
        label: biome.name,
        hex: ColorMath.rgbToHex(biome.color),
        placement: BiomePlacement.labelOf(BiomePlacement.placementOfCustom(biome)),
    }));
    return [...builtIn, ...custom];
}

/** The flag path of the map data, and of the owner arrays and the generator's outputs saved beside it. */
const MAP_DATA_PATH = `flags.${FILRODENSWMB.ID}.mapData`;
const OWNERS_PATH = `flags.${FILRODENSWMB.ID}.owners`;
const MODEL_RUN_PATH = `flags.${FILRODENSWMB.ID}.modelRun`;
/** The flag path of a map's world record fields (v5), and of a world journal's record. */
const META_PATH = `flags.${FILRODENSWMB.ID}.meta`;
const WORLD_PATH = `flags.${FILRODENSWMB.ID}.world`;
/** The flag path of the blobs kept with a map (see Blobs), base64 by hash. */
const BLOBS_PATH = `flags.${FILRODENSWMB.ID}.blobs`;

/**
 * `next` with every key of `stored` that `next` no longer has marked for deletion, at every depth.
 *
 * Foundry merges an object written to a flag into the one already there, all the way down, so a
 * key left out of a save would otherwise survive it: the region layers of a map migrated to layer
 * sets, the owner array of a deleted level, or (from v5) the world's settings a map's data no
 * longer holds, some of them nested (`params.globalTemp`, `generatorSettings.ages`). A key whose
 * value is a ForcedDeletion operator is removed instead (the replacement for the older "-=key"
 * syntax, which Foundry now reports as deprecated). Where both hold a plain object under a key, the
 * two are compared the same way; arrays, and everything else, are written as they are.
 *
 * @param {object|undefined} stored - What the flag holds now.
 * @param {object} next - What it should hold.
 * @param {() => object} [deletion] - Makes a deletion operator (Foundry's by default).
 * @returns {object} A copy of `next`'s objects with the deletions added.
 */
export function withStaleKeysDeleted(stored, next, deletion = () => new foundry.data.operators.ForcedDeletion()) {
    const update = { ...next };
    for (const key of Object.keys(stored ?? {})) {
        if (!(key in next)) update[key] = deletion();
        else if (isPlainObject(stored[key]) && isPlainObject(next[key])) update[key] = withStaleKeysDeleted(stored[key], next[key], deletion);
    }
    return update;
}

/** An object written as a flag's nested fields: not an array, a null or an operator. */
function isPlainObject(value) {
    return !!value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * Saves a map to the compendium: a new JournalEntry, or the one with existingId overwritten. The
 * journal holds the map data under its flags, a human-readable summary page, and (for a map on the
 * display mesh) each level's encoded owner array under its own flag key beside the map data, so
 * the arrays do not have to be read whenever the map data is (see loadMapOwners).
 *
 * @param {string} mapName - The journal's name.
 * @param {object} mapDataPayload - The map data to store.
 * @param {string|null} [existingId] - The journal to overwrite, if any.
 * @param {object} [options]
 * @param {Object<string, string>|null} [options.owners] - Encoded owner arrays by level id (see
 *     OwnerLayer.encodeOwners); null leaves any stored owners as they are.
 * @param {object|null} [options.modelRun] - The generator's saved outputs (see ModelRun), under
 *     their own flag key so the map list never reads them; left out keeps what is stored, null
 *     removes it.
 * @param {object|null} [options.meta] - The map's world record fields (see Worlds); null keeps
 *     those stored.
 * @param {object|null} [options.summary] - The data the summary page is drawn from, when it is
 *     not the map data itself (a v5 map's data no longer holds its world's settings, which the
 *     page shows: the caller passes the two merged).
 */
export async function saveMapData(mapName, mapDataPayload, existingId = null, { owners = null, modelRun = undefined, meta = null, summary = null } = {}) {
    if (!mapDataPayload) return null;

    const packName = `world.${FILRODENSWMB.COMPENDIUM.NAME}`;
    const pack = game.packs.get(packName);
    if (!pack) return null;

    const cleanPayload = foundry.utils.deepClone(summary ?? mapDataPayload);
    Object.assign(cleanPayload, buildJournalContext(cleanPayload));

    const narrativeHtml = await foundry.applications.handlebars.renderTemplate("modules/filrodens-world-map-builder/templates/world/journal-summary.hbs", cleanPayload);

    const pages = [
        {
            name: game.i18n.localize("FILRODENSWMB.JOURNAL.CartographicData"),
            type: "text",
            text: { content: narrativeHtml, format: 1 },
        },
    ];

    if (existingId) {
        const doc = await pack.getDocument(existingId);
        if (doc) {
            // Target the specific embedded page to ensure Foundry overwrites it
            const existingPage = doc.pages.contents[0];
            if (existingPage) {
                pages[0]._id = existingPage.id;
            }

            // Overwrite the map data and the page content, removing what the map no longer has
            const stored = doc.flags?.[FILRODENSWMB.ID] ?? {};
            const update = {
                name: mapName,
                [MAP_DATA_PATH]: withStaleKeysDeleted(stored.mapData, mapDataPayload),
                pages: pages,
            };
            if (owners) update[OWNERS_PATH] = withStaleKeysDeleted(stored.owners, owners);
            if (meta) update[META_PATH] = withStaleKeysDeleted(stored.meta, meta);
            if (modelRun) update[MODEL_RUN_PATH] = withStaleKeysDeleted(stored.modelRun, modelRun);
            else if (modelRun === null && stored.modelRun) update[MODEL_RUN_PATH] = new foundry.data.operators.ForcedDeletion();
            await doc.update(update);
            return doc;
        }
    }

    const data = {
        name: mapName,
        pages: pages,
        [MAP_DATA_PATH]: mapDataPayload,
    };
    if (owners) data[OWNERS_PATH] = owners;
    if (modelRun) data[MODEL_RUN_PATH] = modelRun;
    if (meta) data[META_PATH] = meta;
    return await JournalEntry.create(data, { pack: pack.collection });
}

export async function deleteSavedMap(id) {
    const pack = game.packs.get(`world.${FILRODENSWMB.COMPENDIUM.NAME}`);
    if (!pack) return false;
    const doc = await pack.getDocument(id);
    if (!doc) return false;
    await doc.delete();
    return true;
}

export async function renameSavedMap(id, newName) {
    const pack = game.packs.get(`world.${FILRODENSWMB.COMPENDIUM.NAME}`);
    if (!pack) return false;

    const doc = await pack.getDocument(id);
    if (!doc) return false;

    // Return the updated document instead of a boolean
    return await doc.update({ name: newName });
}

/**
 * Copies a saved map under a new name. The shared code names the copy, in the reader's language.
 * @param {string} id - The saved map to copy.
 * @param {string} [name] - The copy's name; the original's when left out.
 */
export async function duplicateSavedMap(id, name) {
    const pack = game.packs.get(`world.${FILRODENSWMB.COMPENDIUM.NAME}`);
    if (!pack) return null;
    const doc = await pack.getDocument(id);
    if (!doc) return null;

    const clonedData = doc.toObject();
    clonedData.name = name ?? clonedData.name;
    delete clonedData._id;

    return await JournalEntry.create(clonedData, { pack: pack.collection });
}

/**
 * Writes individual fields of a saved map's data straight to the compendium, leaving every other
 * field (and the rest of the journal entry) exactly as it was saved.
 *
 * This is for small preferences that must be remembered even if the map's other, unsaved changes
 * are later discarded (for example, declining a terrain update for a map). A full save would write
 * those unsaved changes too, so it cannot be used for this.
 *
 * @param {string} documentId - The saved map's journal entry id.
 * @param {object} fields - Field names (top-level keys of the map data) and their new values.
 * @returns {Promise<boolean>} Whether the map was found and updated.
 */
export async function updateMapDataFields(documentId, fields) {
    const pack = game.packs.get(`world.${FILRODENSWMB.COMPENDIUM.NAME}`);
    if (!pack) return false;

    const doc = await pack.getDocument(documentId);
    if (!doc) return false;

    const update = {};
    for (const [key, value] of Object.entries(fields)) {
        update[`flags.${FILRODENSWMB.ID}.mapData.${key}`] = value;
    }

    await doc.update(update);
    return true;
}

/**
 * The encoded owner arrays saved with a map, by level id (see saveMapData), or an empty object
 * for a map that has none.
 * @param {string} documentId
 * @returns {Promise<Object<string, string>>}
 */
export async function loadMapOwners(documentId) {
    const pack = game.packs.get(`world.${FILRODENSWMB.COMPENDIUM.NAME}`);
    if (!pack) return {};

    const document = await pack.getDocument(documentId);
    return foundry.utils.deepClone(document?.flags?.[FILRODENSWMB.ID]?.owners ?? {});
}

/**
 * The generator's saved outputs of a map (see saveMapData and ModelRun), or null for a map that
 * has none.
 * @param {string} documentId
 * @returns {Promise<object|null>}
 */
export async function loadMapModelRun(documentId) {
    const pack = game.packs.get(`world.${FILRODENSWMB.COMPENDIUM.NAME}`);
    if (!pack) return null;

    const document = await pack.getDocument(documentId);
    const modelRun = document?.flags?.[FILRODENSWMB.ID]?.modelRun;
    return modelRun ? foundry.utils.deepClone(modelRun) : null;
}

/**
 * Every saved map's data, for work that has to look across all of them (such as finding which
 * maps use a pin icon). Each entry's map data is the stored object itself, not a copy.
 *
 * @returns {Promise<Array<{id: string, name: string, mapData: object|null}>>}
 */
export async function listMapData() {
    const pack = game.packs.get(`world.${FILRODENSWMB.COMPENDIUM.NAME}`);
    if (!pack) return [];

    const documents = await pack.getDocuments();
    return documents.map((doc) => {
        const flags = doc.flags?.[FILRODENSWMB.ID];
        return { id: doc.id, name: doc.name, mapData: flags?.mapData ?? null, meta: flags?.meta ?? null, hasModelRun: !!flags?.modelRun };
    });
}

/**
 * Retrieves a specific map's data payload from the compendium.
 */
export async function loadMapData(documentId) {
    const packName = `world.${FILRODENSWMB.COMPENDIUM.NAME}`;
    const pack = game.packs.get(packName);
    if (!pack) return null;

    const document = await pack.getDocument(documentId);

    return document?.flags?.[FILRODENSWMB.ID]?.mapData || null;
}

// ------------------------------------------------------------------ v5: a map's world fields

const mapsPack = () => game.packs.get(`world.${FILRODENSWMB.COMPENDIUM.NAME}`);
const worldsPack = () => game.packs.get(`world.${FILRODENSWMB.COMPENDIUM.WORLDS_NAME}`);

/** A map's world record fields (see Worlds), or null for a map saved before v5. */
export async function loadMapMeta(documentId) {
    const document = await mapsPack()?.getDocument(documentId);
    const meta = document?.flags?.[FILRODENSWMB.ID]?.meta;
    return meta ? foundry.utils.deepClone(meta) : null;
}

/** Writes a map's world record fields, leaving its data and summary as they were saved. */
export async function saveMapMeta(documentId, meta) {
    const document = await mapsPack()?.getDocument(documentId);
    if (!document) return false;
    await document.update({ [META_PATH]: withStaleKeysDeleted(document.flags?.[FILRODENSWMB.ID]?.meta, meta) });
    return true;
}

/** Keeps a blob with a map (see Blobs): its gzipped bytes, base64 in a flag, by hash. */
export async function saveMapBlob(documentId, hash, bytes) {
    const document = await mapsPack()?.getDocument(documentId);
    if (!document) return false;
    await document.update({ [`${BLOBS_PATH}.${hash}`]: Blobs.toBase64(bytes) });
    return true;
}

/** A blob kept with a map, or null. */
export async function loadMapBlob(documentId, hash) {
    const document = await mapsPack()?.getDocument(documentId);
    const text = document?.flags?.[FILRODENSWMB.ID]?.blobs?.[hash];
    return typeof text === "string" ? Blobs.fromBase64(text) : null;
}

/** The hashes of the blobs kept with a map. */
export async function listMapBlobs(documentId) {
    const document = await mapsPack()?.getDocument(documentId);
    return Object.keys(document?.flags?.[FILRODENSWMB.ID]?.blobs ?? {});
}

/** Drops every blob kept with a map but those named (what its record still names). */
export async function keepMapBlobs(documentId, keep) {
    const document = await mapsPack()?.getDocument(documentId);
    if (!document) return false;
    const wanted = new Set(keep);
    const update = {};
    for (const hash of Object.keys(document.flags?.[FILRODENSWMB.ID]?.blobs ?? {})) if (!wanted.has(hash)) update[`${BLOBS_PATH}.${hash}`] = new foundry.data.operators.ForcedDeletion();
    if (Object.keys(update).length) await document.update(update);
    return true;
}

/** Every saved map's id, name and world fields, from the compendium's index (without its data). */
export async function listMaps() {
    const pack = mapsPack();
    if (!pack) return [];
    const index = await pack.getIndex({ fields: [META_PATH] });
    return [...index].map((entry) => ({ id: entry._id, name: entry.name || "", meta: entry.flags?.[FILRODENSWMB.ID]?.meta ?? null }));
}

// ------------------------------------------------------------------ v5: the world records

/** A world journal's record, with its id (the journal's). */
const worldOf = (document) => {
    const record = document?.flags?.[FILRODENSWMB.ID]?.world;
    return record ? { ...foundry.utils.deepClone(record), id: document.id, name: document.name } : null;
};

/** Every world record (see Worlds). */
export async function listWorlds() {
    const pack = worldsPack();
    if (!pack) return [];
    return (await pack.getDocuments()).map(worldOf).filter(Boolean);
}

export async function loadWorld(id) {
    return worldOf(await worldsPack()?.getDocument(id));
}

/**
 * Saves a world record. A record whose journal exists is written over it; a new one is made with
 * the record's id (see Worlds.newWorldId), so the maps that name it find it.
 */
export async function saveWorld(record) {
    const pack = worldsPack();
    if (!pack || !record?.id) return null;
    const { id, name, ...rest } = record;
    const document = await pack.getDocument(id);
    const page = { name: game.i18n.localize("FILRODENSWMB.JOURNAL.WorldTitle"), type: "text", text: { content: await worldSummary(record, pack), format: 1 } };
    if (document) {
        await document.update({ name, [WORLD_PATH]: withStaleKeysDeleted(document.flags?.[FILRODENSWMB.ID]?.world, rest) });
        // The summary page is written over, alone: the world's settlement maps are pages of its
        // journal too, each written by its own call (see saveSettlementMap)
        const existingPage = document.pages.contents.find((each) => !settlementOf(each));
        if (existingPage) await existingPage.update({ name: page.name, text: page.text });
        else await document.createEmbeddedDocuments("JournalEntryPage", [{ ...page, sort: 0 }]);
        return { id, name };
    }
    await JournalEntry.create({ _id: id, name, [WORLD_PATH]: rest, pages: [page] }, { pack: pack.collection, keepId: true });
    return { id, name };
}

/** The map types' names on a world's page. */
const MAP_TYPE_LABELS = Object.freeze({ surface: "FILRODENSWMB.JOURNAL.WorldMapSurface" });

/**
 * A world journal's readable page (templates/world/world-summary.hbs): its maps, the world it was
 * cut from, World setup and, unless it is held, a summary of the settings its maps share.
 * @param {object} record - The world record being saved.
 * @param {object} pack - The worlds compendium.
 */
async function worldSummary(record, pack) {
    const nameOf = async (worldId) => (worldId ? ((await pack.getDocument(worldId))?.name ?? null) : null);
    // The world a held world's settings come from: the first above it that is not held
    let source = record;
    for (let depth = 0; source?.held && source.parentWorldId && depth < MAX_CHAIN; depth++) {
        const parent = await pack.getDocument(source.parentWorldId);
        if (!parent) break;
        source = { id: parent.id, name: parent.name, ...(parent.flags?.[FILRODENSWMB.ID]?.world ?? {}) };
    }
    const settings = record.settings ?? {};
    const count = (list) => (Array.isArray(list) ? list.length : 0);
    const savedAt = record.settingsSavedAt ? new Date(record.settingsSavedAt) : null;
    const context = {
        maps: (record.maps ?? []).map((map) => ({ label: MAP_TYPE_LABELS[map.type] ?? map.type })),
        held: record.held === true,
        parentName: await nameOf(record.parentWorldId),
        sourceName: source?.name ?? "",
        settingsRevision: record.settingsRevision ?? 1,
        savedAt: savedAt && !Number.isNaN(savedAt.getTime()) ? savedAt.toLocaleString(game.i18n.lang) : null,
        setup: settings.setup ?? {},
        engineLabel: TerrainVersion.ENGINE_NAMES[settings.setup?.engine] ?? null,
        areaFactor: settings.setup?.areaFactor ?? 1,
        cultures: (settings.cultures?.list ?? []).map((culture) => culture?.name).filter(Boolean),
        ages: count(settings.ages?.list),
        nameStyle: settings.nameStyle?.nameBase ?? "",
        styles: { pin: count(settings.styles?.pin), route: count(settings.styles?.route), label: count(settings.styles?.label), region: count(settings.styles?.region) },
        icons: { custom: count(settings.icons?.custom), hidden: count(settings.icons?.disabled) },
        biomes: count(settings.biomes?.custom),
        climate: settings.climate ?? {},
    };
    return foundry.applications.handlebars.renderTemplate("modules/filrodens-world-map-builder/templates/world/world-summary.hbs", context);
}

/** How far up a chain of held worlds a page looks for the world its settings come from. */
const MAX_CHAIN = 32;

export async function deleteWorld(id) {
    const document = await worldsPack()?.getDocument(id);
    if (!document) return false;
    await document.delete();
    return true;
}

// ---------------------------------------------------------------- v5: a world's settlement maps

/** The flag a settlement map's page keeps its record in (the Local studio's; see Worlds). */
const SETTLEMENT_FLAG = "settlement";

/** A page's settlement map record, or null for a page that is not one (the world's summary). */
function settlementOf(page) {
    const record = page?.flags?.[FILRODENSWMB.ID]?.[SETTLEMENT_FLAG];
    return record && typeof record === "object" && typeof record.id === "string" ? record : null;
}

/** A world journal's page holding a settlement map, or null. */
function settlementPage(document, id) {
    return document?.pages?.contents.find((page) => settlementOf(page)?.id === id) ?? null;
}

/**
 * A world's settlement maps: each a page of its world's journal (L-surface; Ken, 2026-11-24), so
 * the maps compendium keeps one journal a world map, however many settlement maps a world has.
 */
export async function listSettlementMaps(worldId) {
    const document = await worldsPack()?.getDocument(worldId);
    return (document?.pages?.contents ?? []).map(settlementOf).filter(Boolean).map((record) => foundry.utils.deepClone(record));
}

export async function loadSettlementMap(worldId, id) {
    const record = settlementOf(settlementPage(await worldsPack()?.getDocument(worldId), id));
    return record ? foundry.utils.deepClone(record) : null;
}

/**
 * Writes a world's settlement map as a page of its world's journal, alone: its readable page (the
 * Local studio's words, given as `page`) and its record in the page's flags. The world's journal
 * must exist (Worlds saves the world first).
 * @param {string} worldId
 * @param {object} record - The settlement map's record (its id names it).
 * @param {{name?: string, html?: string}} [page]
 */
export async function saveSettlementMap(worldId, record, page = {}) {
    const document = await worldsPack()?.getDocument(worldId);
    if (!document || !record?.id) return null;
    const data = {
        name: page.name || record.name || record.id,
        type: "text",
        text: { content: page.html ?? "", format: 1 },
        [`flags.${FILRODENSWMB.ID}.${SETTLEMENT_FLAG}`]: record,
    };
    const existing = settlementPage(document, record.id);
    if (existing) {
        // The record is written whole: a field it no longer has is not kept
        await existing.update({ [`flags.${FILRODENSWMB.ID}.-=${SETTLEMENT_FLAG}`]: null }, { render: false });
        await existing.update(data);
    } else {
        const sort = Math.max(0, ...document.pages.contents.map((each) => each.sort ?? 0)) + foundry.CONST.SORT_INTEGER_DENSITY;
        await document.createEmbeddedDocuments("JournalEntryPage", [{ ...foundry.utils.expandObject(data), sort }]);
    }
    return { id: record.id };
}

export async function deleteSettlementMap(worldId, id) {
    const page = settlementPage(await worldsPack()?.getDocument(worldId), id);
    if (!page) return false;
    await page.delete();
    return true;
}

/** Deletes every settlement map of a world; deleting its journal does too. */
export async function deleteSettlementMaps(worldId) {
    const document = await worldsPack()?.getDocument(worldId);
    const ids = (document?.pages?.contents ?? []).filter((page) => settlementOf(page)).map((page) => page.id);
    if (ids.length) await document.deleteEmbeddedDocuments("JournalEntryPage", ids);
    return true;
}

/**
 * Writes a file into the world's data (a backup made before migrating, say), in a folder of the
 * module's, and returns its path.
 * @param {string} folderName - The folder, under the world's data.
 * @param {string} fileName
 * @param {Uint8Array} bytes
 * @param {string} type - Its MIME type.
 */
export async function keepWorldFile(folderName, fileName, bytes, type) {
    const filePicker = foundry.applications.apps.FilePicker.implementation;
    const folder = `worlds/${game.world.id}/${folderName}`;
    try {
        await filePicker.browse("data", folder);
    } catch {
        await filePicker.createDirectory("data", folder);
    }
    const response = await filePicker.upload("data", folder, new File([bytes], fileName, { type }), {}, { notify: false });
    if (!response?.path) throw new Error(`The upload of ${fileName} to ${folder} failed.`);
    return response.path;
}

