import { FILRODENSWMB } from "../config.js";

/**
 * Ensures the world compendium exists, creating it natively if it does not.
 */
export async function initializeCompendium() {
    const packName = `world.${FILRODENSWMB.COMPENDIUM.NAME}`;
    let pack = game.packs.get(packName);

    if (!pack) {
        console.log("World Map Builder | Initializing Map Compendium...");
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
 * Saves the Map Studio's generation parameters and brush history to a new JournalEntry.
 * Generates an embedded human-readable settings page within the text layer.
 */
/**
 * Upgraded Save function. If existingId is provided, it overwrites the payload natively.
 */
export async function saveMapData(mapName, mapDataPayload, existingId = null) {
    if (!mapDataPayload) return null;

    const packName = `world.${FILRODENSWMB.COMPENDIUM.NAME}`;
    const pack = game.packs.get(packName);
    if (!pack) return null;

    const cleanPayload = foundry.utils.deepClone(mapDataPayload);

    cleanPayload.journalColors = Object.entries(cleanPayload.params.customColors || {}).map(([key, rgb]) => {
        const hex = "#" + rgb.map((x) => x.toString(16).padStart(2, "0")).join("");
        return { label: `FILRODENSWMB.BIOMES.${key}`, hex: hex };
    });

    if (cleanPayload.customBiomes) {
        const customColors = cleanPayload.customBiomes.map((cb) => ({
            label: cb.name, // Passed as a raw string, bypassing the {{localize}} helper
            hex: "#" + cb.color.map((x) => x.toString(16).padStart(2, "0")).join(""),
        }));
        cleanPayload.journalColors.push(...customColors);
    }

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
 * Retrieves a specific map's data payload from the compendium.
 */
export async function loadMapData(documentId) {
    const packName = `world.${FILRODENSWMB.COMPENDIUM.NAME}`;
    const pack = game.packs.get(packName);
    if (!pack) return null;

    const document = await pack.getDocument(documentId);

    return document?.flags?.[FILRODENSWMB.ID]?.mapData || null;
}
