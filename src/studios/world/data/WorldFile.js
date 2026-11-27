import { KERNEL_PARTS } from "../../../kernel/config.js";
import { ImportRefusal, Sanitize } from "../../../kernel/data/Sanitize.js";
import { MAP_TYPES, WORLD_FORMAT } from "../../../kernel/worlds/WorldRecord.js";
import { BLOB_HASH, RegionalRecord } from "../../../kernel/worlds/RegionalRecord.js";
import { Blobs } from "../../../kernel/data/Blobs.js";
import { WorldSettings } from "./WorldSettings.js";

/**
 * The world file (v5's Export JSON; `claude/v5-s0-shell-handoff.md` §13 step 2b): a world and its
 * maps in one file, readable on either host.
 *
 *     {
 *       format: "fwmb-world", formatVersion: 5, exportedAt, module: { version },
 *       world: {
 *         name, settings,                       // its settings as it reads them; icons embedded
 *         held,                                 // a held regional world
 *         cutFrom?: { name, worldId, mapId },   // the world and map it was cut from
 *         regional?, blobs?,                    // its regional record, and the blobs it names (base64 by hash)
 *         settlements?,                         // its settlement maps (L-surface; the Local studio's records)
 *       },
 *       maps: [{ id, type, file }],             // each a map file (see MapJson) without the world's settings
 *     }
 *
 * A regional world is written standing alone, its settings the ones it reads, so the file opens
 * anywhere. Its link to its parent is kept too (Ken, 2026-11-18): imported where that parent is
 * still saved, it goes back under it, held again if it was (see MapTransfer); anywhere else it is a
 * world of its own.
 *
 * Reading one gives back, for each of its maps, a map file as 4.3 wrote them (the world's settings
 * merged in, its icons as the file's `pinIcons`), so the import checks a world file with every
 * rule and input-safety case a map file has (MapImport.read).
 */
export const WORLD_FILE_FORMAT = "fwmb-world";
/** The most maps a world file may hold (a world has one of each type, and a handful of types). */
const MAX_MAPS = 16;
const MAX_NAME = 200;

export class WorldFile {
    /** Whether a parsed file is a world file (rather than a map file). */
    static is(parsed) {
        return !!parsed && typeof parsed === "object" && parsed.format === WORLD_FILE_FORMAT;
    }

    /**
     * A world file from a map file the export prepared.
     * @param {object} options
     * @param {string} options.name - The world's name.
     * @param {string} options.mapId
     * @param {object} options.file - The map file (MapPackage.prepare), the world's settings merged in.
     * @param {string[]} [options.disabledIcons] - The built-in pin icons the world hides.
     * @param {{name: string, worldId: string, mapId: string|null}|null} [options.cutFrom] - The
     *     world (and its map) it was cut from.
     * @param {boolean} [options.held] - Whether it is a held regional world.
     * @param {object|null} [options.regional] - Its regional record.
     * @param {Map<string, Uint8Array>} [options.blobs] - The blobs its record names, by hash.
     * @param {object[]} [options.settlements] - Its settlement maps' records.
     * @param {string} options.version - The module's version.
     * @param {Date} [options.exportedAt]
     * @returns {object}
     */
    static write({ name, mapId, file, disabledIcons = [], cutFrom = null, held = false, regional = null, blobs = new Map(), settlements = [], version, exportedAt = new Date() }) {
        const { pinIcons = [], name: _mapName, owners, modelRun, ...data } = file;
        const { settings, mapData } = WorldSettings.split(data);
        settings.icons = { custom: pinIcons, disabled: [...disabledIcons] };
        // The link to the parent is the world's (cutFrom), so the map stands alone
        delete mapData.parentId;
        const mapFile = { ...mapData };
        if (owners) mapFile.owners = owners;
        if (modelRun) mapFile.modelRun = modelRun;
        const world = { name, settings, held: !!cutFrom && held === true };
        if (cutFrom) world.cutFrom = { name: cutFrom.name ?? "", worldId: cutFrom.worldId, mapId: cutFrom.mapId ?? null };
        if (cutFrom && regional) {
            world.regional = regional;
            if (blobs.size) world.blobs = Object.fromEntries([...blobs].map(([hash, bytes]) => [hash, Blobs.toBase64(bytes)]));
        }
        if (settlements.length) world.settlements = settlements;
        return { format: WORLD_FILE_FORMAT, formatVersion: WORLD_FORMAT, exportedAt: exportedAt.toISOString(), module: { version }, world, maps: [{ id: mapId, type: MAP_TYPES.SURFACE, file: mapFile }] };
    }

    /**
     * The world's name, the built-in icons it hides, its maps as map files (see the class comment),
     * the Surface map first, and what links it to the world it was cut from: as a world record
     * (`world`: its id in the file, its parent, whether held, its regional record read safely) and
     * each map file's `parentId`, the map it was cut from, so an import can go back under it.
     * Refused when the file is not a world file this version can read.
     * @param {object} parsed - The file's JSON.
     * And its settlement maps as the file holds them (`settlements`, unchecked: the Local studio's
     * rules check each as they arrive), at most LOCAL.MAX_SETTLEMENTS.
     * @returns {{name: string|null, disabledIcons: string[], maps: Array<{id: string|null, type: string, file: object}>, world: {id: string, held: boolean, parentWorldId: string|null, maps: Array<{id: string, type: string}>, regional: object|null}, blobBytes: (hash: string) => Uint8Array|null, settlements: object[]}}
     * @throws {ImportRefusal}
     */
    static read(parsed) {
        const tree = Sanitize.plainTree(parsed);
        if (!WorldFile.is(tree)) throw new ImportRefusal("notMap");
        if (!Number.isInteger(tree.formatVersion) || tree.formatVersion < 1) throw new ImportRefusal("damaged", { detail: "a world file without a format version" });
        if (tree.formatVersion > WORLD_FORMAT) throw new ImportRefusal("newer", { detail: `world file format ${tree.formatVersion}` });
        const world = tree.world;
        if (!world || typeof world !== "object" || Array.isArray(world)) throw new ImportRefusal("damaged", { detail: "a world file without its world" });
        if (!Array.isArray(tree.maps) || !tree.maps.length || tree.maps.length > MAX_MAPS) throw new ImportRefusal("damaged", { detail: "a world file's maps" });
        const settings = world.settings && typeof world.settings === "object" && !Array.isArray(world.settings) ? world.settings : {};
        const icons = settings.icons && typeof settings.icons === "object" ? settings.icons : {};
        const name = typeof world.name === "string" && world.name.trim() ? world.name.trim().slice(0, MAX_NAME) : null;
        const cutFrom = world.cutFrom && typeof world.cutFrom === "object" && Sanitize.isId(world.cutFrom.worldId) ? { worldId: world.cutFrom.worldId, mapId: Sanitize.id(world.cutFrom.mapId) } : null;
        // Only the map types this version knows, each a map file once the world's settings are merged in
        const maps = tree.maps
            .filter((map) => map && typeof map === "object" && Object.values(MAP_TYPES).includes(map.type) && map.file && typeof map.file === "object" && !Array.isArray(map.file))
            .map((map, index) => {
                const { owners, modelRun, ...data } = map.file;
                delete data.parentId;
                const file = WorldSettings.merge(settings, data, { inline: world.held !== true });
                // The map it was cut from, for the import to look for
                if (cutFrom?.mapId) file.parentId = cutFrom.mapId;
                if (owners) file.owners = owners;
                if (modelRun) file.modelRun = modelRun;
                if (name) file.name = name;
                file.pinIcons = Array.isArray(icons.custom) ? icons.custom : [];
                return { id: Sanitize.id(map.id) ?? `map${index}`, type: map.type, file };
            });
        if (!maps.length) throw new ImportRefusal("damaged", { detail: "a world file with no map this version can open" });
        maps.sort((a, b) => (a.type === MAP_TYPES.SURFACE ? -1 : 0) - (b.type === MAP_TYPES.SURFACE ? -1 : 0));
        const disabledIcons = Array.isArray(icons.disabled) ? icons.disabled.filter((id) => typeof id === "string" && id.length <= MAX_NAME) : [];
        const record = {
            id: "file",
            held: !!cutFrom && world.held === true,
            parentWorldId: cutFrom?.worldId ?? null,
            maps: maps.map(({ id, type }) => ({ id, type })),
            regional: cutFrom ? RegionalRecord.check(world.regional) : null,
        };
        const blobs = world.blobs && typeof world.blobs === "object" && !Array.isArray(world.blobs) ? world.blobs : {};
        const blobBytes = (hash) => (typeof hash === "string" && BLOB_HASH.test(hash) && typeof blobs[hash] === "string" ? Blobs.fromBase64(blobs[hash]) : null);
        const settlements = Array.isArray(world.settlements) ? world.settlements.slice(0, KERNEL_PARTS.MAX_SETTLEMENTS) : [];
        return { name, disabledIcons, maps, world: record, blobBytes, settlements };
    }
}
