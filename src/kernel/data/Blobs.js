import { gunzipSync, gzipSync, strFromU8, strToU8 } from "../../../vendor/fflate/fflate.js";

/**
 * Blobs: content too large to sit in a world's record (a regional world's `cutBase`), kept with
 * the map whose record names it, as its owner arrays and its run are (Ken, 2026-11-18). A blob is
 * known by the hash of its content, as MapPackage names an image (the first 128 bits of a SHA-256,
 * in hex), so the same content is kept once in a backup and a damaged one can be told.
 *
 * A blob is gzipped JSON. The stores keep its bytes: base64 in a flag on the map's journal in
 * Foundry, the bytes themselves in the map's record on the web.
 */

/** The largest blob, unpacked, that is read back (a zip bomb stops here, before it is inflated). */
export const MAX_BLOB_BYTES = 64 * 1024 * 1024;
const HASH_BYTES = 16;
const HEX = 16;
const GZIP_SIZE_BYTES = 4;
const CHUNK = 0x8000;

export class Blobs {
    /**
     * A value packed as a blob.
     * @param {*} value - Anything JSON can hold.
     * @returns {Promise<{hash: string, bytes: Uint8Array}>} Its hash (of the JSON) and its gzipped bytes.
     */
    static async pack(value) {
        const json = strToU8(JSON.stringify(value));
        return { hash: await Blobs.hash(json), bytes: gzipSync(json, { level: 9, mtime: 0 }) };
    }

    /**
     * A blob's value, or null when its bytes cannot be read, are too large, or (given its hash)
     * are not the content the hash names.
     * @param {Uint8Array} bytes
     * @param {string} [hash]
     * @returns {Promise<*>}
     */
    static async unpack(bytes, hash = null) {
        try {
            if (!(bytes instanceof Uint8Array) || bytes.length < GZIP_SIZE_BYTES) return null;
            // The gzip footer's last four bytes give the unpacked size (modulo 4 GB)
            const tail = bytes.subarray(bytes.length - GZIP_SIZE_BYTES);
            const size = (tail[0] | (tail[1] << 8) | (tail[2] << 16) | (tail[3] << 24)) >>> 0;
            if (size > MAX_BLOB_BYTES) return null;
            const json = gunzipSync(bytes, { out: new Uint8Array(size) });
            if (hash && (await Blobs.hash(json)) !== hash) return null;
            return JSON.parse(strFromU8(json));
        } catch {
            return null;
        }
    }

    /** The hash a blob is known by (see the class comment). */
    static async hash(bytes) {
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
        return Array.from(digest.subarray(0, HASH_BYTES), (byte) => byte.toString(HEX).padStart(2, "0")).join("");
    }

    /** Bytes as base64 text (in chunks: String.fromCharCode cannot take a large array at once). */
    static toBase64(bytes) {
        let binary = "";
        for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        return btoa(binary);
    }

    /** Base64 text as bytes, or null when it is not base64. */
    static fromBase64(text) {
        try {
            const binary = atob(text);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return bytes;
        } catch {
            return null;
        }
    }
}
