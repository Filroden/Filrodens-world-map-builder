import { FILRODENSWMB } from "../../../config.js";
import { strFromU8, strToU8, unzipSync, zipSync } from "../../../../vendor/fflate/fflate.js";
import { IMAGE_TYPES } from "../../../kernel/data/ImageCheck.js";
import { ImportRefusal, Sanitize } from "../../../kernel/data/Sanitize.js";
import { RegionalRecord, BLOB_HASH } from "../../../kernel/worlds/RegionalRecord.js";
import { MAP_TYPES, WORLD_GROUPS, WorldRecord } from "../../../kernel/worlds/WorldRecord.js";
import { WorldSettings } from "./WorldSettings.js";

/**
 * The backup file: every saved world and map in one zip, with the images and blobs they use (or,
 * as the migration to v5 writes it, the 4.3 maps in one JSON file without images; see packJson).
 *
 *     manifest.json        { format, exportedAt, module: { version }, app, maps: [{ id, name, parentId }],
 *                            worlds: [world record], blobs: [hash], assets: [{ hash, type }] }
 *     maps/<id>.json       each map as MapPackage writes it (`assets` mode)
 *     assets/<hash>.<ext>  each image once, named by its content hash
 *     blobs/<hash>.gz      each blob once (see Blobs), named by its content hash
 *
 * Format 2 (v5) holds the world records, and each map without its world's settings; format 1 (4.3,
 * and the migration's JSON backup) holds maps only, each with its settings. Both are read: a map is
 * always handed back with its settings, a format 2 map's merged in from its world (the top of its
 * held chain for a held world), so it arrives as any map file does.
 *
 * Reading one is guarded as any import is, and more, since a zip can lie about itself:
 * - nothing is unpacked before every entry has been looked at: a name other than those three
 *   shapes (a path that climbs out, a backslash, a folder of its own) refuses the file, so no
 *   entry is ever looked up by a name the file chose;
 * - the number of entries, the total they unpack to, and each entry's ratio of unpacked to packed
 *   size are capped (LIMITS.BACKUP), which stops a zip bomb before it is inflated; each entry is
 *   inflated into a buffer of the size it declares, so it cannot grow past it;
 * - the manifest is copied as any import is (Sanitize.plainTree) and only its known fields are read.
 * Each map then goes through MapImport like a JSON file, and each image through ImageCheck.
 */
export class Backup {
    /** The manifest format Back up all writes (v5: worlds, maps and blobs). */
    static FORMAT = 2;
    /** The format of a backup of maps only, with their settings: 4.3's, and the migration's JSON. */
    static MAPS_FORMAT = 1;

    /** The file name a backup is saved under. */
    static fileName(date = new Date()) {
        return `fwmb-maps-${date.toISOString().slice(0, DATE_LENGTH)}.zip`;
    }

    /**
     * The backup file's bytes.
     * @param {object} options
     * @param {{id: string, name: string, parentId: string|null, file: object}[]} options.maps
     * @param {Map<string, {type: string, bytes: Uint8Array}>} options.assets - By content hash.
     * @param {object[]} [options.worlds] - The world records the maps belong to.
     * @param {Map<string, Uint8Array>} [options.blobs] - The blobs their records name, by hash.
     * @param {"foundry"|"web"} options.app
     * @param {string} options.version - The module's version.
     * @param {Date} [options.exportedAt]
     * @returns {Uint8Array}
     */
    static pack({ maps, assets, worlds = [], blobs = new Map(), app, version, exportedAt = new Date() }) {
        const manifest = {
            format: Backup.FORMAT,
            exportedAt: exportedAt.toISOString(),
            module: { version },
            app,
            maps: maps.map(({ id, name, parentId }) => ({ id, name, parentId: parentId ?? null })),
            worlds,
            blobs: [...blobs.keys()],
            assets: [...assets].map(([hash, { type }]) => ({ hash, type })),
        };
        const entries = { [MANIFEST]: strToU8(JSON.stringify(manifest, null, 2)) };
        for (const { id, file } of maps) entries[`${MAPS}${id}.json`] = strToU8(JSON.stringify(file));
        // Images and blobs are already compressed, so they are stored as they are
        for (const [hash, { type, bytes }] of assets) entries[`${ASSETS}${hash}.${IMAGE_TYPES[type].extension}`] = [bytes, { level: 0 }];
        for (const [hash, bytes] of blobs) entries[`${BLOBS}${hash}.gz`] = [bytes, { level: 0 }];
        return zipSync(entries, { level: JSON_LEVEL });
    }

    /**
     * The backup as one JSON file, without images: what the migration to v5 writes into the
     * Foundry world's data before it changes anything, since Foundry will not take a zip there.
     * Its images stay where they are in the world's data, which the maps still name. Restore reads
     * it as it reads the zip.
     * @param {object} options - As pack, with no assets.
     * @returns {Uint8Array}
     */
    static packJson({ maps, app, version, exportedAt = new Date() }) {
        const file = {
            format: Backup.MAPS_FORMAT,
            exportedAt: exportedAt.toISOString(),
            module: { version },
            app,
            maps: maps.map(({ id, name, parentId, file: mapFile }) => ({ id, name, parentId: parentId ?? null, file: mapFile })),
            assets: [],
        };
        return strToU8(JSON.stringify(file));
    }

    /**
     * A backup file opened, a zip or the JSON form (see packJson): its manifest's maps and worlds
     * (none in format 1), and each map's file (its settings merged in), each image's bytes and each
     * blob's bytes on request. Refused (ImportRefusal) when it is too large, not a backup, or shaped
     * to do harm.
     *
     * @param {Uint8Array} bytes
     * @returns {{format: number, exportedAt: string|null, app: string|null, maps: {id: string, name: string, parentId: string|null}[], worlds: object[], mapFile: (id: string) => *, assetBytes: (hash: string) => Uint8Array|null, blobBytes: (hash: string) => Uint8Array|null}}
     * @throws {ImportRefusal}
     */
    static read(bytes) {
        const limits = FILRODENSWMB.LIMITS.BACKUP;
        if (bytes.length > limits.BYTES) throw new ImportRefusal("tooLarge", { detail: `${bytes.length} bytes` });
        if (isJson(bytes)) return readJson(bytes);
        const entries = unpack(bytes, limits);
        const manifestBytes = entries[MANIFEST];
        if (!manifestBytes) throw new ImportRefusal("notBackup", { detail: "no manifest" });
        const manifest = readManifest(manifestBytes);
        const withSettings = settingsMerger(manifest.worlds);
        return {
            format: manifest.format,
            exportedAt: typeof manifest.exportedAt === "string" ? manifest.exportedAt : null,
            app: typeof manifest.app === "string" ? manifest.app : null,
            maps: manifest.maps.filter((map) => entries[`${MAPS}${map.id}.json`]),
            worlds: manifest.worlds,
            mapFile: (id) => {
                const file = Sanitize.isId(id) ? entries[`${MAPS}${id}.json`] : null;
                if (!file) throw new ImportRefusal("notMap", { detail: `no file for map ${id}` });
                return withSettings(id, parseJson(file, "notMap"));
            },
            assetBytes: (hash) => {
                const asset = manifest.assets.find((entry) => entry.hash === hash);
                return asset ? (entries[`${ASSETS}${hash}.${IMAGE_TYPES[asset.type].extension}`] ?? null) : null;
            },
            blobBytes: (hash) => (typeof hash === "string" && BLOB_HASH.test(hash) && manifest.blobs.includes(hash) ? (entries[`${BLOBS}${hash}.gz`] ?? null) : null),
        };
    }
}

const MANIFEST = "manifest.json";
const MAPS = "maps/";
const ASSETS = "assets/";
const BLOBS = "blobs/";
const DATE_LENGTH = 10;
/** Map JSON compresses well; this is fflate's default level. */
const JSON_LEVEL = 6;
const ASSET_EXTENSIONS = Object.values(IMAGE_TYPES).map((type) => type.extension);
/** The only entry names a backup may hold (folders' own entries aside). */
const ENTRY_NAMES = [new RegExp(`^${MANIFEST.replace(".", "\\.")}$`), /^maps\/[A-Za-z0-9_-]{1,64}\.json$/, new RegExp(`^assets\\/[0-9a-f]{32}\\.(?:${ASSET_EXTENSIONS.join("|")})$`), /^blobs\/[0-9a-f]{32}\.gz$/];
const FOLDER_ENTRIES = new Set([MAPS, ASSETS, BLOBS]);

/** Every entry looked at before any is inflated; the zip is refused if any breaks the rules. */
function unpack(bytes, limits) {
    let count = 0;
    let unpacked = 0;
    let problem = null;
    const filter = (entry) => {
        if (problem) return false;
        count += 1;
        unpacked += entry.originalSize;
        problem = entryProblem(entry, { count, unpacked, limits });
        return !problem && !FOLDER_ENTRIES.has(entry.name);
    };
    let entries;
    try {
        // A first pass with every entry refused only reads the central directory: nothing is inflated
        unzipSync(bytes, { filter: (entry) => filter(entry) && false });
        if (problem) throw problem;
        count = 0;
        unpacked = 0;
        entries = unzipSync(bytes, { filter });
    } catch (error) {
        if (error instanceof ImportRefusal) throw error;
        throw new ImportRefusal("notBackup", { detail: error.message });
    }
    if (problem) throw problem;
    return entries;
}

function entryProblem(entry, { count, unpacked, limits }) {
    if (!FOLDER_ENTRIES.has(entry.name) && !ENTRY_NAMES.some((pattern) => pattern.test(entry.name))) return new ImportRefusal("damaged", { detail: `an entry named ${JSON.stringify(entry.name).slice(0, 80)}` });
    if (count > limits.ENTRIES) return new ImportRefusal("tooLarge", { detail: `more than ${limits.ENTRIES} entries` });
    if (unpacked > limits.UNPACKED_BYTES) return new ImportRefusal("tooLarge", { detail: "unpacks to too much" });
    if (entry.originalSize > limits.RATIO_FLOOR && entry.originalSize > entry.size * limits.RATIO) return new ImportRefusal("tooLarge", { detail: `${entry.name} unpacks to ${entry.originalSize} bytes from ${entry.size}` });
    return null;
}

function parseJson(bytes, reason) {
    let text;
    try {
        text = strFromU8(bytes);
    } catch (error) {
        throw new ImportRefusal(reason, { detail: error.message });
    }
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new ImportRefusal(reason, { detail: error.message });
    }
}

/** Whether a file's first character (after any byte order mark or space) opens a JSON object. */
function isJson(bytes) {
    for (const byte of bytes.subarray(0, 64)) {
        if (byte === 0x7b) return true;
        if (![0x20, 0x09, 0x0a, 0x0d, 0xef, 0xbb, 0xbf].includes(byte)) return false;
    }
    return false;
}

/** The JSON form of a backup read: the manifest's checks, each map's file kept beside it. */
function readJson(bytes) {
    const raw = parseJson(bytes, "notBackup");
    const files = new Map();
    for (const map of Array.isArray(raw?.maps) ? raw.maps : []) if (Sanitize.isId(map?.id) && map.file && typeof map.file === "object") files.set(map.id, map.file);
    const manifest = readManifest(strToU8(JSON.stringify({ ...raw, maps: (raw?.maps ?? []).map(({ id, name, parentId }) => ({ id, name, parentId })), worlds: [], blobs: [], assets: [] })));
    return {
        format: manifest.format,
        exportedAt: typeof manifest.exportedAt === "string" ? manifest.exportedAt : null,
        app: typeof manifest.app === "string" ? manifest.app : null,
        maps: manifest.maps.filter((map) => files.has(map.id)),
        worlds: [],
        mapFile: (id) => {
            const file = Sanitize.isId(id) ? files.get(id) : null;
            if (!file) throw new ImportRefusal("notMap", { detail: `no file for map ${id}` });
            return structuredClone(file);
        },
        assetBytes: () => null,
        blobBytes: () => null,
    };
}

/**
 * The manifest's known fields, checked: the maps' ids, names and parents, the worlds (format 2),
 * the blobs' and the images' hashes and the images' types.
 */
function readManifest(bytes) {
    const tree = Sanitize.plainTree(parseJson(bytes, "notBackup"));
    if (tree && typeof tree === "object" && Number.isInteger(tree.format) && tree.format > Backup.FORMAT) throw new ImportRefusal("newer", { detail: `backup format ${tree.format}` });
    if (!tree || typeof tree !== "object" || ![Backup.MAPS_FORMAT, Backup.FORMAT].includes(tree.format) || !Array.isArray(tree.maps)) throw new ImportRefusal("notBackup", { detail: "not a backup manifest" });
    const ids = new Set();
    const maps = [];
    for (const map of tree.maps) {
        if (!Sanitize.isId(map?.id) || ids.has(map.id)) throw new ImportRefusal("damaged", { detail: "a map in the manifest has no valid id" });
        ids.add(map.id);
        maps.push({ id: map.id, name: Sanitize.typedText(map.name, "name"), parentId: Sanitize.id(map.parentId) });
    }
    const assets = (Array.isArray(tree.assets) ? tree.assets : []).filter((asset) => typeof asset?.hash === "string" && /^[0-9a-f]{32}$/.test(asset.hash) && Object.hasOwn(IMAGE_TYPES, asset.type));
    const worlds = tree.format === Backup.FORMAT ? readWorlds(tree.worlds, ids) : [];
    const blobs = tree.format === Backup.FORMAT && Array.isArray(tree.blobs) ? tree.blobs.filter((hash) => typeof hash === "string" && BLOB_HASH.test(hash)) : [];
    return { ...tree, maps, worlds, blobs, assets };
}

/**
 * The manifest's world records, checked as the store would hold them: each world's own fields,
 * its maps only those the backup holds (a map in one world only), its settings' known groups, and
 * its regional record through RegionalRecord.check. The settings reach the store only through the
 * maps they are merged into, which MapImport checks as any map file.
 */
function readWorlds(list, mapIds) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const claimed = new Set();
    const worlds = [];
    for (const world of list) {
        if (!world || typeof world !== "object" || !Sanitize.isId(world.id) || seen.has(world.id)) continue;
        seen.add(world.id);
        const maps = (Array.isArray(world.maps) ? world.maps : []).filter((map) => Sanitize.isId(map?.id) && mapIds.has(map.id) && !claimed.has(map.id) && Object.values(MAP_TYPES).includes(map.type)).map((map) => ({ ...WorldRecord.mapCard(map), id: map.id, type: map.type }));
        for (const map of maps) claimed.add(map.id);
        const settings = {};
        const given = world.settings && typeof world.settings === "object" && !Array.isArray(world.settings) ? world.settings : {};
        for (const group of WORLD_GROUPS) if (given[group] && typeof given[group] === "object" && !Array.isArray(given[group])) settings[group] = given[group];
        const record = WorldRecord.create({ id: world.id, name: Sanitize.typedText(world.name, "name"), settings, maps, parentWorldId: Sanitize.id(world.parentWorldId), held: world.held === true });
        if (Number.isInteger(world.settingsRevision) && world.settingsRevision >= 1) record.settingsRevision = world.settingsRevision;
        record.regional = RegionalRecord.check(world.regional);
        worlds.push(record);
    }
    // A world cannot be its own parent. (A parent the backup does not hold may still be saved where
    // it is restored; the restore decides.)
    for (const world of worlds) if (world.parentWorldId === world.id) world.parentWorldId = null;
    return worlds;
}

/**
 * A format 2 map's file with its world's settings merged in (a held world's from the top of its
 * held chain), so it arrives as a map file does; a format 1 map's file as it is.
 */
function settingsMerger(worlds) {
    if (!worlds.length) return (_id, file) => file;
    const byId = new Map(worlds.map((world) => [world.id, world]));
    const worldOf = new Map(worlds.flatMap((world) => world.maps.map((map) => [map.id, world])));
    return (id, file) => {
        const world = worldOf.get(id);
        if (!world || !file || typeof file !== "object" || Array.isArray(file)) return file;
        const { pinIcons, name, owners, modelRun, ...data } = file;
        const merged = WorldSettings.merge(WorldRecord.effectiveSettings(world, (key) => byId.get(key) ?? null), data);
        return { ...merged, ...(name !== undefined ? { name } : {}), ...(owners ? { owners } : {}), ...(modelRun ? { modelRun } : {}), ...(pinIcons ? { pinIcons } : {}) };
    };
}
