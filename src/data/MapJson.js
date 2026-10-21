import { normaliseAreaFactor } from "../mesh/Schema.js";

/**
 * The JSON file a map is exported to and imported from: the map data as saved, plus (for a map on
 * the display mesh) its encoded owner arrays under a top-level `owners` key, by level id. In the
 * compendium the owners live in their own flag beside the map data (see platform.store.saveMapData);
 * a file has to carry them inside, or a re-imported map would lose its regions. The map's name
 * travels as a top-level `name` too: the saved map keeps its name beside its data, and the file's
 * own name is made safe for a file system (lower case, underscores), so it cannot give it back.
 *
 * Kept free of Foundry calls so the round trip can be tested on its own.
 */
export class MapJson {
    /**
     * The object to write to a file.
     * @param {object} mapData
     * @param {Object<string, string>} [owners]
     * @param {string|null} [name] - The saved map's name.
     * @returns {object}
     */
    static toExport(mapData, owners = {}, name = null) {
        const data = structuredClone(mapData);
        delete data.owners;
        delete data.name;
        const named = name ? { name, ...data } : data;
        return Object.keys(owners).length ? { ...named, owners: { ...owners } } : named;
    }

    /**
     * The map data and owners in an imported file. An area factor that is missing a value, not a
     * whole number or out of range is corrected here, so a hand-edited file cannot store one the
     * map could not use.
     * @param {object} parsed - The file's JSON.
     * @returns {{mapData: object, owners: Object<string, string>}}
     */
    static fromImport(parsed) {
        const mapData = structuredClone(parsed);
        const owners = isOwnerMap(mapData.owners) ? mapData.owners : {};
        delete mapData.owners;
        normaliseAreaFactor(mapData);
        return { mapData, owners };
    }
}

/** An object of strings (encoded owner arrays), as toExport writes. */
function isOwnerMap(value) {
    return !!value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((text) => typeof text === "string");
}
