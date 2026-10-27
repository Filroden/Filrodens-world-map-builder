import { IMAGE_TYPES, ImageCheck } from "../../data/ImageCheck.js";

/**
 * Asset paths in Foundry (the platform's `assets` service), and reading and storing the images a
 * map carries from file to file (see MapPackage).
 *
 * An image an import brings in is uploaded into the world's own data, in IMPORT_FOLDER, named by
 * its content hash. The world's folder, not the module's: Foundry replaces a module's folder
 * whenever the module updates, and would take the images with it. Naming by hash means the same
 * image imported twice (a backup restored again, two maps sharing a decoration) is one file.
 */
const IMPORT_FOLDER = "fwmb-assets";

/** The folder images are uploaded into, once it is known to exist (per session). */
let folderReady = null;
/** Names of the files already in the folder, so a known image is not uploaded again. */
const existing = new Set();

const filePicker = () => foundry.applications.apps.FilePicker.implementation;

/** The world's import folder, made when it does not exist yet, with the names of the files it holds. */
async function ensureFolder() {
    const folder = `worlds/${game.world.id}/${IMPORT_FOLDER}`;
    if (folderReady === folder) return folder;
    try {
        const listing = await filePicker().browse("data", folder);
        for (const file of listing.files ?? []) existing.add(file.split("/").pop());
    } catch {
        await filePicker().createDirectory("data", folder);
    }
    folderReady = folder;
    return folder;
}

/**
 * A stored asset path made root-relative (with any route prefix Foundry is configured with), so
 * it resolves the same from any page or stylesheet. Complete URLs (http, https, and the data URLs a
 * map made in the web version holds for its images) are returned unchanged.
 */
const url = (path) => (!path || /^(?:https?|data|blob):/i.test(path) ? path : foundry.utils.getRoute(path));

export const foundryAssets = {
    url,

    /**
     * An image's bytes, for carrying it in a file: a data URL decoded, a path in the world's data
     * (or an address) fetched. Null when it cannot be read.
     * @param {string} src
     * @returns {Promise<Uint8Array|null>}
     */
    async read(src) {
        if (src?.startsWith("data:")) return ImageCheck.dataUrlBytes(src);
        const response = await fetch(url(src));
        return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
    },

    /**
     * Stores a checked image in the world's import folder and returns its path. The file is named
     * by its hash, so the path can only be one the module made, inside that folder.
     * @param {Uint8Array} bytes
     * @param {string} type - An ImageCheck type.
     * @param {string} hash - Its content hash (see MapPackage.hash).
     * @returns {Promise<string>}
     */
    async keep(bytes, type, hash) {
        const folder = await ensureFolder();
        const { mime, extension } = IMAGE_TYPES[type];
        const name = `${hash}.${extension}`;
        if (!existing.has(name)) {
            // A failed upload resolves without a path (or false, or an empty object), rather than throwing
            const response = await filePicker().upload("data", folder, new File([bytes], name, { type: mime }), {}, { notify: false });
            if (!response?.path) throw new Error(`The upload of ${name} to ${folder} failed.`);
            existing.add(name);
        }
        return `${folder}/${name}`;
    },
};
