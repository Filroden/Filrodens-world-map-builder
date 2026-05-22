import { FILRODENSHEX } from "../config.js";

/**
 * Ensures the world compendium exists, creating it natively if it does not.
 */
export async function initializeCompendium() {
    const packName = `world.${FILRODENSHEX.COMPENDIUM.NAME}`;
    let pack = game.packs.get(packName);

    if (!pack) {
        console.log("Hex Crafter | Initialising Map Compendium...");
        pack = await foundry.documents.collections.CompendiumCollection.createCompendium({
            type: "JournalEntry",
            label: FILRODENSHEX.COMPENDIUM.LABEL,
            name: FILRODENSHEX.COMPENDIUM.NAME,
            package: "world",
        });
    }

    return pack;
}

/**
 * Retrieves a flattened array of all saved maps for the UI.
 */
export async function getSavedMaps() {
    const packName = `world.${FILRODENSHEX.COMPENDIUM.NAME}`;
    const pack = game.packs.get(packName);
    if (!pack) return [];

    const index = await pack.getIndex();
    return index
        .map((entry) => ({
            id: entry._id,
            name: entry.name,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Saves the current scene's entire hex state to a new JournalEntry in the compendium.
 */
export async function saveCurrentMap(mapName) {
    // 1. Strict Fix: deepClone the flags to strip any DataModel proxies before saving
    const allModuleFlags = foundry.utils.deepClone(canvas.scene.flags[FILRODENSHEX.ID]);

    if (!allModuleFlags?.[FILRODENSHEX.FLAGS.HEX_DATA]) return null;

    const packName = `world.${FILRODENSHEX.COMPENDIUM.NAME}`;
    const pack = game.packs.get(packName);
    if (!pack) return null;

    const documentData = {
        name: mapName || "Untitled Map",
        flags: {
            [FILRODENSHEX.ID]: allModuleFlags,
        },
    };

    return await JournalEntry.create(documentData, { pack: packName });
}

/**
 * Retrieves a specific map's data object from the compendium.
 */
export async function loadMapData(documentId) {
    const packName = `world.${FILRODENSHEX.COMPENDIUM.NAME}`;
    const pack = game.packs.get(packName);
    if (!pack) return null;

    const document = await pack.getDocument(documentId);

    // 2. Strict Fix: Bypass getFlag() and read the raw scope object directly
    return document?.flags?.[FILRODENSHEX.ID] || null;
}
