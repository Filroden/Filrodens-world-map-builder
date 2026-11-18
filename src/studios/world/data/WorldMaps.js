import { platform } from "../../../platform/index.js";
import { Worlds } from "../../../kernel/worlds/Worlds.js";
import { WorldRecord } from "../../../kernel/worlds/WorldRecord.js";
import { WorldSettings } from "./WorldSettings.js";

/**
 * The World studio's maps as their worlds give them: a saved map's data merged with the settings
 * its world reads (see WorldSettings), the payload the studio has always loaded, exported and cut
 * from. A map saved before v5 and not yet given a world is read as it was saved.
 */
export class WorldMaps {
    /**
     * A saved map's payload with its world's settings merged in, and its world.
     * @param {string} mapId
     * @returns {Promise<{payload: object, world: object|null, settings: object|null}|null>} Null for
     *     a map that is not saved.
     */
    static async load(mapId) {
        const mapData = await platform.store.loadMapData(mapId);
        if (!mapData) return null;
        const world = await Worlds.ofMap(mapId);
        if (!world) return { payload: structuredClone(mapData), world: null, settings: null };
        const settings = await Worlds.settingsOf(world);
        return { payload: WorldSettings.merge(settings, mapData), world, settings };
    }

    /** A saved map's payload with its world's settings merged in (see load), or null. */
    static async payload(mapId) {
        return (await WorldMaps.load(mapId))?.payload ?? null;
    }

    /**
     * The saved maps that read a world's settings: its own, and those of the held regional worlds
     * whose settings come from it, however far down.
     * @param {string|null} worldId
     * @returns {Promise<Set<string>>}
     */
    static async readingSettingsOf(worldId) {
        const ids = new Set();
        if (!worldId) return ids;
        const worlds = await Worlds.all();
        const byId = (id) => worlds.get(id) ?? null;
        for (const world of worlds.values()) {
            if (WorldRecord.settingsSource(world, byId)?.id !== worldId) continue;
            for (const map of world.maps ?? []) ids.add(map.id);
        }
        return ids;
    }
}
