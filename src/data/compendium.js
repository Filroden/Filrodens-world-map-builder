import { FILRODENSWMB } from "../config.js";
import { ColorMath } from "../tools/ColorMath.js";
import { TerrainVersion } from "../tools/TerrainVersion.js";
import { BiomePlacement } from "../generation/BiomePlacement.js";

/** Decimal places kept when showing a regional map's zoom (a crop's zoom need not be a whole number). */
const ZOOM_DECIMALS = 2;
/** Decimal places kept when turning a saved noise scale back into its slider value. */
const SCALE_DECIMALS = 2;
/** Pin types that mark river sources (added or removed) rather than points of interest. */
const SPRING_PIN_TYPES = Object.freeze({ ADDED: "spring", REMOVED: "block_spring" });
/** The localisation key naming each grid type (see FILRODENSWMB.GRID_TYPES). */
const GRID_LABELS = Object.freeze({
    none: "FILRODENSWMB.UI.GridNone",
    square: "FILRODENSWMB.UI.GridSquare",
    hexR: "FILRODENSWMB.UI.GridHexRows",
    hexC: "FILRODENSWMB.UI.GridHexCols",
});

/**
 * Ensures the world compendium exists, creating it natively if it does not.
 */
export async function initializeCompendium() {
    const packName = `world.${FILRODENSWMB.COMPENDIUM.NAME}`;
    let pack = game.packs.get(packName);

    if (!pack) {
        console.log("FWMB | Initializing Map Compendium...");
        pack = await foundry.documents.collections.CompendiumCollection.createCompendium({
            type: "JournalEntry",
            label: FILRODENSWMB.COMPENDIUM.LABEL,
            name: FILRODENSWMB.COMPENDIUM.NAME,
            package: "world",
        });
    }

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
            name: entry.name || "Unnamed Map",
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
 * The values the journal summary (templates/journal-summary.hbs) shows that are not stored in
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
    const fromFrequency = (frequency) => (frequency > 0 ? Number((1 / frequency).toFixed(SCALE_DECIMALS)) : null);
    return {
        elevation: fromFrequency(noise?.elevation?.scale),
        moisture: fromFrequency(noise?.moisture?.scale),
        temperature: fromFrequency(noise?.temperature?.scale),
    };
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
    const layers = payload.regionLayers || [];
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
    const nameKeys = {
        standard: "FILRODENSWMB.UI.StandardGeneration",
        flat: "FILRODENSWMB.UI.FlatCanvas",
        advanced: "FILRODENSWMB.UI.EngineNameTectonics",
        guided: "FILRODENSWMB.UI.EngineNameGuided",
    };
    const nameKey = nameKeys[state.generationEngine];
    if (!nameKey) return state.generationEngine ?? "";

    const name = game.i18n.localize(nameKey);
    const version = TerrainVersion.getDisplayVersion(state);
    return version === null ? name : game.i18n.format("FILRODENSWMB.UI.EngineVersion", { name, version });
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

/**
 * Saves the Map Studio's generation parameters and brush history to a new JournalEntry.
 * Generates an embedded human-readable settings page within the text layer.
 */
/**
 * Upgraded Save function. If existingId is provided, it overwrites the payload natively.
 *
 * @param {string} mapName - The journal's name.
 * @param {object} mapDataPayload - The map data to store.
 * @param {string|null} [existingId] - The journal to overwrite, if any.
 */
export async function saveMapData(mapName, mapDataPayload, existingId = null) {
    if (!mapDataPayload) return null;

    const packName = `world.${FILRODENSWMB.COMPENDIUM.NAME}`;
    const pack = game.packs.get(packName);
    if (!pack) return null;

    const cleanPayload = foundry.utils.deepClone(mapDataPayload);
    Object.assign(cleanPayload, buildJournalContext(cleanPayload));

    const narrativeHtml = await foundry.applications.handlebars.renderTemplate("modules/filrodens-world-map-builder/templates/journal-summary.hbs", cleanPayload);

    const pages = [
        {
            name: "Cartographic Data",
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

            // Strictly overwrite the internal flags and the page content
            await doc.update({
                name: mapName,
                "flags.filrodens-world-map-builder.mapData": mapDataPayload,
                pages: pages,
            });
            return doc;
        }
    }

    return await JournalEntry.create(
        {
            name: mapName,
            pages: pages,
            "flags.filrodens-world-map-builder.mapData": mapDataPayload,
        },
        { pack: pack.collection },
    );
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

export async function duplicateSavedMap(id) {
    const pack = game.packs.get(`world.${FILRODENSWMB.COMPENDIUM.NAME}`);
    if (!pack) return null;
    const doc = await pack.getDocument(id);
    if (!doc) return null;

    const clonedData = doc.toObject();
    clonedData.name = `${clonedData.name} (Copy)`;
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
 * Retrieves a specific map's data payload from the compendium.
 */
export async function loadMapData(documentId) {
    const packName = `world.${FILRODENSWMB.COMPENDIUM.NAME}`;
    const pack = game.packs.get(packName);
    if (!pack) return null;

    const document = await pack.getDocument(documentId);

    return document?.flags?.[FILRODENSWMB.ID]?.mapData || null;
}
