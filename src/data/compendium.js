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
 * Retrieves a flattened array of all saved maps for the UI.
 */
export async function getSavedMaps() {
    const packName = `world.${FILRODENSWMB.COMPENDIUM.NAME}`;
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
