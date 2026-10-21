import { FILRODENSWMB } from "../config.js";
import { strFromU8, strToU8, unzipSync, zipSync } from "../../vendor/fflate/fflate.js";
import { IMAGE_TYPES } from "./ImageCheck.js";
import { ImportRefusal, Sanitize } from "./Sanitize.js";

/**
 * The backup file: every saved map in one zip, with the images they use.
 *
 *     manifest.json        { format, exportedAt, module: { version }, app, maps: [{ id, name, parentId }], assets: [{ hash, type }] }
 *     maps/<id>.json       each map as its JSON export writes it (see MapPackage, `assets` mode)
 *     assets/<hash>.<ext>  each image once, named by its content hash
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
    /** The manifest format this module writes and reads. */
    static FORMAT = 1;

    /** The file name a backup is saved under. */
    static fileName(date = new Date()) {
        return `fwmb-maps-${date.toISOString().slice(0, DATE_LENGTH)}.zip`;
    }

    /**
     * The backup file's bytes.
     * @param {object} options
     * @param {{id: string, name: string, parentId: string|null, file: object}[]} options.maps
     * @param {Map<string, {type: string, bytes: Uint8Array}>} options.assets - By content hash.
     * @param {"foundry"|"web"} options.app
     * @param {string} options.version - The module's version.
     * @param {Date} [options.exportedAt]
     * @returns {Uint8Array}
     */
    static pack({ maps, assets, app, version, exportedAt = new Date() }) {
        const manifest = {
            format: Backup.FORMAT,
            exportedAt: exportedAt.toISOString(),
            module: { version },
            app,
            maps: maps.map(({ id, name, parentId }) => ({ id, name, parentId: parentId ?? null })),
            assets: [...assets].map(([hash, { type }]) => ({ hash, type })),
        };
        const entries = { [MANIFEST]: strToU8(JSON.stringify(manifest, null, 2)) };
        for (const { id, file } of maps) entries[`${MAPS}${id}.json`] = strToU8(JSON.stringify(file));
        // Images are already compressed, so they are stored as they are
        for (const [hash, { type, bytes }] of assets) entries[`${ASSETS}${hash}.${IMAGE_TYPES[type].extension}`] = [bytes, { level: 0 }];
        return zipSync(entries, { level: JSON_LEVEL });
    }

    /**
     * A backup file opened: its manifest's maps, and each map's file and each image's bytes on
     * request. Refused (ImportRefusal) when it is too large, not a backup, or shaped to do harm.
     *
     * @param {Uint8Array} bytes
     * @returns {{exportedAt: string|null, app: string|null, maps: {id: string, name: string, parentId: string|null}[], mapFile: (id: string) => *, assetBytes: (hash: string) => Uint8Array|null}}
     * @throws {ImportRefusal}
     */
    static read(bytes) {
        const limits = FILRODENSWMB.LIMITS.BACKUP;
        if (bytes.length > limits.BYTES) throw new ImportRefusal("tooLarge", { detail: `${bytes.length} bytes` });
        const entries = unpack(bytes, limits);
        const manifestBytes = entries[MANIFEST];
        if (!manifestBytes) throw new ImportRefusal("notBackup", { detail: "no manifest" });
        const manifest = readManifest(manifestBytes);
        return {
            exportedAt: typeof manifest.exportedAt === "string" ? manifest.exportedAt : null,
            app: typeof manifest.app === "string" ? manifest.app : null,
            maps: manifest.maps.filter((map) => entries[`${MAPS}${map.id}.json`]),
            mapFile: (id) => {
                const file = Sanitize.isId(id) ? entries[`${MAPS}${id}.json`] : null;
                if (!file) throw new ImportRefusal("notMap", { detail: `no file for map ${id}` });
                return parseJson(file, "notMap");
            },
            assetBytes: (hash) => {
                const asset = manifest.assets.find((entry) => entry.hash === hash);
                return asset ? (entries[`${ASSETS}${hash}.${IMAGE_TYPES[asset.type].extension}`] ?? null) : null;
            },
        };
    }
}

const MANIFEST = "manifest.json";
const MAPS = "maps/";
const ASSETS = "assets/";
const DATE_LENGTH = 10;
/** Map JSON compresses well; this is fflate's default level. */
const JSON_LEVEL = 6;
const ASSET_EXTENSIONS = Object.values(IMAGE_TYPES).map((type) => type.extension);
/** The only entry names a backup may hold (folders' own entries aside). */
const ENTRY_NAMES = [new RegExp(`^${MANIFEST.replace(".", "\\.")}$`), /^maps\/[A-Za-z0-9_-]{1,64}\.json$/, new RegExp(`^assets\\/[0-9a-f]{32}\\.(?:${ASSET_EXTENSIONS.join("|")})$`)];
const FOLDER_ENTRIES = new Set([MAPS, ASSETS]);

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

/** The manifest's known fields, checked: the maps' ids, names and parents, and the images' hashes and types. */
function readManifest(bytes) {
    const tree = Sanitize.plainTree(parseJson(bytes, "notBackup"));
    if (!tree || typeof tree !== "object" || tree.format !== Backup.FORMAT || !Array.isArray(tree.maps)) throw new ImportRefusal("notBackup", { detail: "not a backup manifest" });
    const ids = new Set();
    const maps = [];
    for (const map of tree.maps) {
        if (!Sanitize.isId(map?.id) || ids.has(map.id)) throw new ImportRefusal("damaged", { detail: "a map in the manifest has no valid id" });
        ids.add(map.id);
        maps.push({ id: map.id, name: Sanitize.typedText(map.name, "name"), parentId: Sanitize.id(map.parentId) });
    }
    const assets = (Array.isArray(tree.assets) ? tree.assets : []).filter((asset) => typeof asset?.hash === "string" && /^[0-9a-f]{32}$/.test(asset.hash) && Object.hasOwn(IMAGE_TYPES, asset.type));
    return { ...tree, maps, assets };
}
