import { FILRODENSWMB } from "../config.js";
import createDOMPurify from "../../vendor/dompurify/purify.es.mjs";
import { ImportRefusal } from "./Sanitize.js";

/**
 * The checks an image passes before the studio keeps it: one picked from the reader's computer on
 * the web, or one embedded in a file being imported. An image is known by its first bytes, never by
 * its name or the type it declares, since either can lie (an SVG renamed `.png` is still an SVG).
 *
 * - **PNG, JPEG and WebP** are decoded with createImageBitmap (nothing is put in the page) to prove
 *   they are images, and refused past the size and dimension limits in FILRODENSWMB.LIMITS.IMAGE.
 * - **SVG** can carry script, event handlers and references to other files. It is cleaned with
 *   DOMPurify's SVG profile and a few further rules (no `foreignObject`, no embedded images or
 *   links, no animation that could rewrite a link, no `<style>`, and no reference outside the file
 *   itself), and the cleaned text is what is kept. The studio only ever draws an SVG as an image or
 *   a CSS mask, where a browser runs no script anyway; the cleaning makes that true of the file
 *   itself, wherever it goes next (a Foundry upload, a backup, another user).
 *
 * Every refusal is an ImportRefusal with the reason "image", so callers show one localised message.
 */

/** The image types accepted, by the name sniff() gives them, with their MIME types and file extensions. */
export const IMAGE_TYPES = Object.freeze({
    png: Object.freeze({ mime: "image/png", extension: "png" }),
    jpeg: Object.freeze({ mime: "image/jpeg", extension: "jpg" }),
    webp: Object.freeze({ mime: "image/webp", extension: "webp" }),
    svg: Object.freeze({ mime: "image/svg+xml", extension: "svg" }),
});

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];
const WEBP_TAG_OFFSET = 8;
/** How much of a file is read as text to tell whether it is an SVG. */
const SVG_SNIFF_BYTES = 4096;
const SVG_ROOT = /<svg[\s>/]/i;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SVG_XMLNS = /^<svg[^>]*\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/i;
/** What may come before an SVG's root: an XML declaration, comments, a doctype, whitespace. */
const SVG_PROLOGUE = /^(?:\uFEFF)?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>/]/i;

/** Elements removed from an SVG on top of what DOMPurify's SVG profile removes. */
const SVG_FORBIDDEN_TAGS = Object.freeze(["foreignObject", "image", "a", "script", "style", "animate", "set", "animateMotion", "animateTransform", "feImage"]);
/** Attributes that point at another resource; only a reference within the file ("#id") is kept. */
const LINK_ATTRIBUTES = new Set(["href", "xlink:href"]);

const startsWith = (bytes, signature, offset = 0) => signature.every((byte, index) => bytes[offset + index] === byte);

export class ImageCheck {
    /**
     * Which accepted image type the bytes are, from their signature, or null.
     * @param {Uint8Array} bytes
     * @returns {"png"|"jpeg"|"webp"|"svg"|null}
     */
    static sniff(bytes) {
        if (startsWith(bytes, PNG_SIGNATURE)) return "png";
        if (startsWith(bytes, JPEG_SIGNATURE)) return "jpeg";
        if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, WEBP_TAG_OFFSET)) return "webp";
        const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, SVG_SNIFF_BYTES));
        return SVG_PROLOGUE.test(head) ? "svg" : null;
    }

    /**
     * Checks an image's bytes and returns what may be kept: the same bytes for a raster image, the
     * cleaned text's bytes for an SVG.
     *
     * @param {Uint8Array} bytes
     * @param {object} [options]
     * @param {(blob: Blob) => Promise<{width: number, height: number, close?: Function}>} [options.decode]
     *     Decodes a raster image; createImageBitmap by default.
     * @param {object} [options.purifier] - A DOMPurify instance (the page's by default).
     * @returns {Promise<{type: string, bytes: Uint8Array}>}
     * @throws {ImportRefusal}
     */
    static async check(bytes, { decode = defaultDecode, purifier = null } = {}) {
        const limits = FILRODENSWMB.LIMITS.IMAGE;
        if (bytes.length > limits.BYTES) throw new ImportRefusal("image", { detail: `${bytes.length} bytes` });
        const type = ImageCheck.sniff(bytes);
        if (!type) throw new ImportRefusal("image", { detail: "not a PNG, JPEG, WebP or SVG image" });
        if (type === "svg") {
            const text = new TextDecoder("utf-8").decode(bytes);
            return { type, bytes: new TextEncoder().encode(ImageCheck.cleanSvg(text, purifier)) };
        }
        await checkRaster(bytes, type, decode, limits.DIMENSION);
        return { type, bytes };
    }

    /**
     * An SVG's text cleaned of everything that could run, reach out or rewrite itself.
     * @param {string} text
     * @param {object} [purifier] - A DOMPurify instance; the page's by default.
     * @returns {string}
     * @throws {ImportRefusal} When nothing usable is left, or no DOM is available to clean it with.
     */
    static cleanSvg(text, purifier = null) {
        const dompurify = purifier ?? defaultPurifier();
        // DOMPurify returns its input unchanged where it cannot work (no DOM), so this is checked
        // first: an SVG that cannot be cleaned is refused, never passed through
        if (!dompurify?.isSupported) throw new ImportRefusal("image", { detail: "SVG cleaning is not available" });
        dompurify.addHook("uponSanitizeAttribute", dropOutsideLinks);
        try {
            const cleaned = dompurify.sanitize(text, {
                USE_PROFILES: { svg: true, svgFilters: true },
                FORBID_TAGS: SVG_FORBIDDEN_TAGS,
                FORBID_ATTR: ["style"],
                RETURN_TRUSTED_TYPE: false,
            });
            if (!SVG_ROOT.test(cleaned)) throw new ImportRefusal("image", { detail: "no SVG left after cleaning" });
            // A browser draws an SVG file as an image only when its root names the SVG namespace
            return SVG_XMLNS.test(cleaned) ? cleaned : cleaned.replace(/<svg/i, `<svg xmlns="${SVG_NAMESPACE}"`);
        } finally {
            dompurify.removeHook("uponSanitizeAttribute");
        }
    }

    /**
     * Checks an image held as a data URL (a decoration or reference image in a web map) and returns
     * the data URL to keep, typed by what the bytes are rather than what the URL declared.
     * @param {string} url
     * @param {object} [options] - As for check().
     * @returns {Promise<string>}
     * @throws {ImportRefusal}
     */
    static async checkDataUrl(url, options = {}) {
        const bytes = ImageCheck.dataUrlBytes(url);
        if (!bytes) throw new ImportRefusal("image", { detail: "not a base64 image data URL" });
        const { type, bytes: kept } = await ImageCheck.check(bytes, options);
        return ImageCheck.toDataUrl(kept, type);
    }

    /**
     * Checks a file the reader picked and returns it as a data URL.
     * @param {Blob} file
     * @param {object} [options] - As for check().
     * @returns {Promise<string>}
     * @throws {ImportRefusal}
     */
    static async checkFile(file, options = {}) {
        if (file.size > FILRODENSWMB.LIMITS.IMAGE.BYTES) throw new ImportRefusal("image", { detail: `${file.size} bytes` });
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { type, bytes: kept } = await ImageCheck.check(bytes, options);
        return ImageCheck.toDataUrl(kept, type);
    }

    /**
     * The bytes of a base64 data URL, or null when it is not one.
     * @param {string} url
     * @returns {Uint8Array|null}
     */
    static dataUrlBytes(url) {
        const match = /^data:[^,;]*;base64,([A-Za-z0-9+/]*={0,2})$/.exec(url ?? "");
        if (!match) return null;
        const binary = atob(match[1]);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.codePointAt(i);
        return bytes;
    }

    /**
     * Bytes as a base64 data URL of the given type.
     * @param {Uint8Array} bytes
     * @param {keyof IMAGE_TYPES} type
     * @returns {string}
     */
    static toDataUrl(bytes, type) {
        const CHUNK = 0x8000;
        let binary = "";
        for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCodePoint(...bytes.subarray(i, i + CHUNK));
        return `data:${IMAGE_TYPES[type].mime};base64,${btoa(binary)}`;
    }
}

async function checkRaster(bytes, type, decode, maxDimension) {
    let image;
    try {
        image = await decode(new Blob([bytes], { type: IMAGE_TYPES[type].mime }));
    } catch (error) {
        throw new ImportRefusal("image", { detail: `cannot be decoded (${error?.message ?? error})` });
    }
    const { width, height } = image;
    image.close?.();
    if (!(width > 0 && height > 0)) throw new ImportRefusal("image", { detail: "has no size" });
    if (width > maxDimension || height > maxDimension) throw new ImportRefusal("image", { detail: `${width} × ${height} pixels` });
}

function defaultDecode(blob) {
    if (typeof createImageBitmap !== "function") return Promise.reject(new Error("createImageBitmap is not available"));
    return createImageBitmap(blob);
}

let pagePurifier = null;
function defaultPurifier() {
    if (!pagePurifier && typeof window !== "undefined") pagePurifier = createDOMPurify(window);
    return pagePurifier;
}

/** DOMPurify hook: a link attribute survives only as a reference to an element of the same file. */
function dropOutsideLinks(_node, data) {
    if (LINK_ATTRIBUTES.has(data.attrName) && !String(data.attrValue ?? "").trim().startsWith("#")) data.keepAttr = false;
}
