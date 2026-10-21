import { ImageCheck } from "../../data/ImageCheck.js";

/**
 * Asset paths on the web (the platform's `assets` service), and reading and storing the images a
 * map carries from file to file (see MapPackage).
 *
 * The shared code and saved maps name the module's own files by their Foundry path
 * ("modules/<module id>/assets/pinhead-icons/castle.svg"); on the web the same files sit at
 * "assets/..." beside the page. A path is returned as an absolute URL, so it resolves the same
 * wherever it is used, including inside a CSS custom property read by a stylesheet in another
 * folder (see pinIcons.js). URLs that are already complete (http, https, data, blob) are returned
 * unchanged, which covers images added through the web file picker (data URLs).
 *
 * @param {object} options
 * @param {string} options.moduleId
 * @param {string} options.baseUrl - The page's base URL (document.baseURI).
 */
export function createWebAssets({ moduleId, baseUrl }) {
    const modulePrefix = `modules/${moduleId}/`;
    const url = (path) => {
        if (!path || /^(?:https?|data|blob):/i.test(path)) return path;
        const relative = path.replace(/^\/+/, "");
        const local = relative.startsWith(modulePrefix) ? relative.slice(modulePrefix.length) : relative;
        return new URL(local, baseUrl).href;
    };
    return {
        url,
        /**
         * An image's bytes, for carrying it in a file (see MapPackage): a data URL decoded, anything
         * else fetched. Null when it cannot be read.
         * @param {string} src
         * @returns {Promise<Uint8Array|null>}
         */
        async read(src) {
            if (src?.startsWith("data:")) return ImageCheck.dataUrlBytes(src);
            const response = await fetch(url(src));
            return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
        },
        /**
         * Stores a checked image the web's way: as a data URL, which the map or setting that holds
         * it carries everywhere it goes (the web has nowhere else to keep a file).
         * @param {Uint8Array} bytes
         * @param {string} type - An ImageCheck type.
         * @returns {Promise<string>}
         */
        async keep(bytes, type) {
            return ImageCheck.toDataUrl(bytes, type);
        },
    };
}
