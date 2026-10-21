import { ImageCheck } from "./ImageCheck.js";
import { MapJson } from "./MapJson.js";
import { ASSET_SCHEME } from "./Sanitize.js";

/**
 * A map as a file carries it to another world or host, and back: the map data with every image it
 * uses carried along, rather than named by a path or address only its own host can reach.
 *
 * A map uses images in three places: its decorations, its reference image, and the custom pin icons
 * its pins and pin styles name (entries of the host's own settings, `{id, name, path}`, which the
 * file carries as `pinIcons`). On Foundry these are paths into the world's data; on the web they are
 * data URLs. Neither travels: a path means nothing on the web or in another world, and the web's
 * data URLs need uploading to become Foundry files.
 *
 * - **prepare** writes a map out. `embed` puts each image in the file as a data URL (a single map's
 *   JSON export); `assets` replaces each with `fwmb-asset:<hash>` and collects the bytes once per
 *   content hash (a backup's assets/ folder); `keep` carries no images at all, keeping paths (which
 *   still resolve in the same world) and dropping data URLs (the backup's "Maps only").
 * - **resolve** reads a map in: each image, embedded or packaged, is checked by its bytes (see
 *   ImageCheck) and stored the host's way (`keep`: an upload in Foundry, a data URL on the web), and
 *   each custom pin icon is matched to one the host already has (the same stored image) or added,
 *   with pins and pin styles moved to its id. A path is left as it is.
 *
 * Images that cannot be read, or fail their check, are left out and counted, so one broken image
 * never stops a map: a decoration without its image is removed, a reference image is dropped, and
 * pins on a missing icon fall back to the default, as an unknown icon always has.
 */
export class MapPackage {
    /**
     * The custom pin icons a map uses (by its pins and its pin styles), as registry entries.
     * @param {object} mapData
     * @param {{id: string, name: string, path: string}[]} registry - The host's custom pin icons.
     * @returns {{id: string, name: string, path: string}[]}
     */
    static iconsUsed(mapData, registry) {
        const used = new Set([...(mapData.mapPins ?? []), ...(mapData.customPinStyles ?? [])].map((item) => item?.icon).filter(Boolean));
        return registry.filter((entry) => used.has(entry.id));
    }

    /**
     * A map written out as a file, with its images carried as `mode` says.
     *
     * @param {object} options
     * @param {object} options.mapData - The map as saved.
     * @param {Object<string, string>} [options.owners] - Its encoded owner arrays.
     * @param {string|null} [options.name] - Its saved name.
     * @param {{id: string, name: string, path: string}[]} [options.icons] - The host's custom pin icons.
     * @param {"embed"|"assets"|"keep"} options.mode
     * @param {(src: string) => Promise<Uint8Array|null>} [options.read] - An image's bytes (platform.assets.read).
     * @param {Map<string, {type: string, bytes: Uint8Array}>} [options.assets] - Filled with the
     *     images by content hash, in `assets` mode (shared between the maps of a backup).
     * @returns {Promise<{file: object, missing: number, hashes: string[]}>} The file's JSON, how
     *     many images could not be carried, and the hashes of the assets this map uses.
     */
    static async prepare({ mapData, owners = {}, name = null, icons = [], mode, read = async () => null, assets = new Map() }) {
        const file = MapJson.toExport(mapData, owners, name);
        const state = { missing: 0, hashes: new Set() };
        const carry = (src) => carryOut(src, { mode, read, assets, state });

        for (const decoration of file.mapDecorations ?? []) {
            const src = await carry(decoration.src);
            if (src) decoration.src = src;
            else delete decoration.src;
        }
        if (file.reference?.src) {
            const src = await carry(file.reference.src);
            file.reference = src ? { ...file.reference, src } : null;
        }
        const pinIcons = [];
        for (const icon of MapPackage.iconsUsed(mapData, icons)) {
            const src = await carry(icon.path);
            if (src) pinIcons.push({ id: icon.id, name: icon.name, src });
        }
        if (pinIcons.length) file.pinIcons = pinIcons;
        return { file, missing: state.missing, hashes: [...state.hashes] };
    }

    /**
     * Brings a map's images in, the host's way. Changes `mapData` in place.
     *
     * @param {object} options
     * @param {object} options.mapData - From MapImport.read.
     * @param {{id: string, name: string, src: string}[]} [options.pinIcons] - From MapImport.read.
     * @param {(hash: string) => Uint8Array|null} [options.assetBytes] - A packaged image's bytes (a
     *     backup's assets/ entry), or null when the file has none.
     * @param {(bytes: Uint8Array, type: string, hash: string) => Promise<string>} options.keep -
     *     Stores a checked image and returns the source to save (platform.assets.keep).
     * @param {{list: () => object[], add: (entry: {name: string, path: string}) => Promise<{id: string}>}} options.icons -
     *     The host's custom pin icons.
     * @param {object} [options.check] - Options for ImageCheck.check (a decoder and a purifier, for tests).
     * @returns {Promise<{missing: number}>} How many images were left out.
     */
    static async resolve({ mapData, pinIcons = [], assetBytes = () => null, keep, icons, check = {} }) {
        const state = { missing: 0, kept: new Map() };
        const bring = (src) => bringIn(src, { assetBytes, keep, check, state });

        const decorations = [];
        for (const decoration of mapData.mapDecorations ?? []) {
            const src = await bring(decoration.src);
            if (src) decorations.push({ ...decoration, src });
            // A decoration that arrived without its image (left out when the file was written) counts as one missing
            else if (!decoration.src) state.missing += 1;
        }
        if (mapData.mapDecorations) mapData.mapDecorations = decorations;
        if (mapData.reference) {
            const src = await bring(mapData.reference.src);
            mapData.reference = src ? { ...mapData.reference, src } : null;
        }

        const renamed = new Map();
        for (const icon of pinIcons) {
            const path = await bring(icon.src);
            if (!path) continue;
            const existing = icons.list().find((entry) => entry.path === path);
            const entry = existing ?? (await icons.add({ name: icon.name, path }));
            renamed.set(icon.id, entry.id);
        }
        for (const item of [...(mapData.mapPins ?? []), ...(mapData.customPinStyles ?? [])]) {
            if (item && renamed.has(item.icon)) item.icon = renamed.get(item.icon);
        }
        return { missing: state.missing };
    }

    /**
     * The hash an image is known by in a backup: the first 128 bits of its SHA-256, in hex.
     * @param {Uint8Array} bytes
     * @returns {Promise<string>}
     */
    static async hash(bytes) {
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
        return Array.from(digest.subarray(0, HASH_BYTES), (byte) => byte.toString(HEX).padStart(2, "0")).join("");
    }
}

/** How many bytes of the SHA-256 name an asset (32 hex characters, see Sanitize's packaged images). */
const HASH_BYTES = 16;
const HEX = 16;

/** One image written out: as a data URL, a packaged reference, or as it is; null when it cannot be carried. */
async function carryOut(src, { mode, read, assets, state }) {
    if (!src) return null;
    if (mode === "keep") {
        if (!src.startsWith("data:")) return src;
        state.missing += 1;
        return null;
    }
    const bytes = await read(src).catch(() => null);
    const type = bytes ? ImageCheck.sniff(bytes) : null;
    if (!type) {
        state.missing += 1;
        return null;
    }
    if (mode === "embed") return ImageCheck.toDataUrl(bytes, type);
    const hash = await MapPackage.hash(bytes);
    if (!assets.has(hash)) assets.set(hash, { type, bytes });
    state.hashes.add(hash);
    return `${ASSET_SCHEME}${hash}`;
}

/**
 * One image read in: checked and stored when it is embedded or packaged, left as it is when it is
 * a path; null when it cannot be used. The same source is only checked and stored once per map.
 */
async function bringIn(src, { assetBytes, keep, check, state }) {
    if (!src) return null;
    if (state.kept.has(src)) return state.kept.get(src);
    let result = src;
    const packaged = src.startsWith(ASSET_SCHEME);
    if (packaged || src.startsWith("data:")) {
        const bytes = packaged ? assetBytes(src.slice(ASSET_SCHEME.length)) : ImageCheck.dataUrlBytes(src);
        result = bytes ? await checkAndKeep(bytes, keep, check) : null;
    }
    if (!result) state.missing += 1;
    state.kept.set(src, result);
    return result;
}

async function checkAndKeep(bytes, keep, check) {
    try {
        const { type, bytes: kept } = await ImageCheck.check(bytes, check);
        return await keep(kept, type, await MapPackage.hash(kept));
    } catch (error) {
        console.warn("FWMB | An image was left out of the import:", error);
        return null;
    }
}
