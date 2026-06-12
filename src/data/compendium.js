import { FILRODENSWMB } from "../config.js";

/**
 * Ensures the world compendium exists, creating it natively if it does not.
 */
export async function initializeCompendium() {
    const packName = `world.${FILRODENSWMB.COMPENDIUM.NAME}`;
    let pack = game.packs.get(packName);

    if (!pack) {
        console.log("World Map Builder | Initialising Map Compendium...");
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
export async function saveMapData(mapName, mapDataPayload) {
    if (!mapDataPayload) return null;

    const packName = `world.${FILRODENSWMB.COMPENDIUM.NAME}`;
    const pack = game.packs.get(packName);
    if (!pack) return null;

    const cleanPayload = foundry.utils.deepClone(mapDataPayload);

    // Format custom colours for the Handlebars journal template
    cleanPayload.journalColors = Object.entries(cleanPayload.params.customColors || {}).map(([key, rgb]) => {
        const hex = "#" + rgb.map((x) => x.toString(16).padStart(2, "0")).join("");
        return { label: `FILRODENSWMB.BIOMES.${key}`, hex: hex };
    });

    // Compile the template into flat text via native engine utilities
    const narrativeHtml = await foundry.applications.handlebars.renderTemplate("modules/filrodens-world-map-builder/templates/journal-summary.hbs", cleanPayload);

    const documentData = {
        name: mapName || "Untitled Map",
        pages: [
            {
                name: "Generation Settings Log",
                type: "text",
                text: {
                    content: narrativeHtml,
                    format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML,
                },
            },
        ],
        flags: {
            [FILRODENSWMB.ID]: cleanPayload,
        },
    };

    return await JournalEntry.create(documentData, { pack: packName });
}

/**
 * Retrieves a specific map's data payload from the compendium.
 */
export async function loadMapData(documentId) {
    const packName = `world.${FILRODENSWMB.COMPENDIUM.NAME}`;
    const pack = game.packs.get(packName);
    if (!pack) return null;

    const document = await pack.getDocument(documentId);

    // Strict Fix: Bypass getFlag() and read the raw scope object directly
    return document?.flags?.[FILRODENSWMB.ID] || null;
}
