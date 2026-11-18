import { LINKED_GROUPS, WORLD_GROUPS, WorldRecord } from "../../../kernel/worlds/WorldRecord.js";

/**
 * The world's settings, as the World studio's maps carry them: which parts of a saved map's data
 * belong to its world rather than to the map (v5's family records; `claude/v5-studios-workflow.md`
 * §4), split out when a map is saved and merged back when it is loaded.
 *
 * Until v5 every map held its own copy of these. Now the world record holds them once, and the
 * map's data holds the rest. `merge` gives back exactly the payload the studio has always loaded,
 * so the load path does not change: every group the world owns is taken from the world, whatever
 * an older copy left in the map's data says (a map migrated from 4.3 keeps its copies until it is
 * next saved, so that 4.3 can still open it).
 *
 * The groups, by the names the world settings editors will have:
 * - `setup` (World setup): the seed, the terrain engine, the latitude range, the area factor and
 *   the unit name. The frame (`width`, `height`) is recorded too, but the map keeps its own size,
 *   since a map is drawn at it; in S0 a world's maps share its frame.
 * - `cultures`; `ages` (Ages and events); `nameStyle` (Default name style).
 * - `styles` (Styles and icons): the four style lists. The custom pin icons are the world's too
 *   (`icons`, see the pin icon registry), but they are not part of a map's data, so they are kept
 *   by the world record alone.
 * - `biomes`: the custom biomes, their id counter and the built-in biomes' changed colours.
 * - `climate` (Climate base): global temperature, season offset, altitude cooling, the freezing
 *   threshold, global moisture and the moisture scale. The wind stays the map's (hidden, and an
 *   older regional map's zoom is read from it).
 *
 * A held regional world keeps its own `setup` (its frame comes from its crop) and reads every other
 * group from the world its settings come from (see Worlds.settingsSource).
 *
 * Pure and free of host calls: values are copied, never shared with the payload they came from.
 */

export { LINKED_GROUPS, WORLD_GROUPS };

/**
 * Where each field of a group sits in a map's data, as a path of keys. A field missing from the
 * map's data is left out of the group, and a field missing from the group is left out of the
 * merged data, so a round trip gives back exactly what was there.
 */
const FIELDS = Object.freeze({
    setup: {
        seed: ["seed"],
        engine: ["generationEngine"],
        latTop: ["params", "latTop"],
        latBottom: ["params", "latBottom"],
        areaFactor: ["world", "areaFactor"],
        unit: ["mapUnit"],
    },
    cultures: { list: ["cultures"] },
    ages: { list: ["generatorSettings", "ages"] },
    nameStyle: { nameBase: ["generatorSettings", "nameBase"] },
    styles: {
        route: ["customRouteStyles"],
        label: ["customLabelStyles"],
        region: ["customRegionStyles"],
        pin: ["customPinStyles"],
    },
    biomes: {
        custom: ["customBiomes"],
        nextId: ["nextCustomBiomeId"],
        colors: ["params", "customColors"],
    },
    climate: {
        globalTemp: ["params", "globalTemp"],
        seasonOffset: ["params", "seasonOffset"],
        altCooling: ["params", "climate", "altCooling"],
        freezingThreshold: ["params", "climate", "freezingThreshold"],
        globalMoisture: ["params", "globalMoisture"],
        moistureScale: ["params", "noise", "moisture", "scale"],
    },
});

/** The groups held in a map's data (all but the icons, which only the world record holds). */
const MAP_GROUPS = Object.freeze(Object.keys(FIELDS));

const copy = (value) => (value === undefined ? undefined : structuredClone(value));

function read(data, path) {
    let node = data;
    for (const key of path) {
        if (!node || typeof node !== "object" || !Object.hasOwn(node, key)) return undefined;
        node = node[key];
    }
    return node;
}

/** Deletes the field at a path; true when there was one. */
function remove(data, path) {
    let node = data;
    for (const key of path.slice(0, -1)) {
        if (!node || typeof node !== "object") return false;
        node = node[key];
    }
    if (!node || typeof node !== "object" || !Object.hasOwn(node, path.at(-1))) return false;
    delete node[path.at(-1)];
    return true;
}

function write(data, path, value) {
    let node = data;
    for (const key of path.slice(0, -1)) {
        if (!node[key] || typeof node[key] !== "object") node[key] = {};
        node = node[key];
    }
    node[path.at(-1)] = copy(value);
}

/**
 * Removes the objects a removal left empty (a `world` with only its area factor, say). Called only
 * after a field was removed, so an object the data already held empty is kept as it was.
 */
function dropEmpty(data, path) {
    for (let length = path.length - 1; length > 0; length--) {
        const parentPath = path.slice(0, length);
        const node = read(data, parentPath);
        if (node && typeof node === "object" && !Array.isArray(node) && Object.keys(node).length === 0) remove(data, parentPath);
        else return;
    }
}

export class WorldSettings {
    /**
     * A map's saved data split into its world's settings and the map's own data.
     * @param {object} payload - The map's data as the studio builds it to save.
     * @returns {{settings: object, mapData: object}} The groups (icons left out, see above), and a
     *     copy of the payload without them.
     */
    static split(payload) {
        const mapData = structuredClone(payload ?? {});
        const settings = {};
        for (const group of MAP_GROUPS) {
            const values = {};
            for (const [field, path] of Object.entries(FIELDS[group])) {
                const value = read(mapData, path);
                if (value !== undefined) values[field] = copy(value);
            }
            settings[group] = values;
        }
        // A frame is recorded, though the map keeps its own size
        if (Number.isFinite(mapData.mapWidth) && Number.isFinite(mapData.mapHeight)) settings.setup.frame = { width: mapData.mapWidth, height: mapData.mapHeight };
        for (const group of MAP_GROUPS) {
            for (const path of Object.values(FIELDS[group])) {
                if (remove(mapData, path)) dropEmpty(mapData, path);
            }
        }
        return { settings, mapData };
    }

    /**
     * A map's data with its world's settings merged in: the payload the studio loads. Every field a
     * group owns is taken from `settings`, and removed where the group has none, so a copy left in
     * the map's data (a map migrated from 4.3) is never read.
     * @param {object} settings - The world's settings (see split).
     * @param {object} mapData - The map's own data.
     * @returns {object} A new object.
     */
    static merge(settings, mapData) {
        const payload = structuredClone(mapData ?? {});
        for (const group of MAP_GROUPS) {
            for (const [field, path] of Object.entries(FIELDS[group])) {
                const removed = remove(payload, path);
                const value = settings?.[group]?.[field];
                if (value !== undefined) write(payload, path, value);
                else if (removed) dropEmpty(payload, path);
            }
        }
        return payload;
    }

    /** A held regional world's settings (see WorldRecord.linked). */
    static linked(own, source) {
        return WorldRecord.linked(own, source);
    }

    /** A new world's pin icons (see WorldRecord.emptyIcons). */
    static emptyIcons() {
        return WorldRecord.emptyIcons();
    }

    /** The groups in which two sets of settings differ (see WorldRecord.changedGroups). */
    static changedGroups(a, b) {
        return WorldRecord.changedGroups(a, b);
    }
}
