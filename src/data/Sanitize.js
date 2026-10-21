import { FILRODENSWMB } from "../config.js";

/**
 * The checks every value from outside the studio passes before it is stored: a map or styles file
 * being imported, and every field an inspector or dialogue applies. Each helper takes an untrusted
 * value and returns a safe one (or a stated fallback), never throwing for an ordinary bad value; the
 * structural walk (`plainTree`) and the text check are the exceptions, refusing a file outright
 * with an ImportRefusal, since a file that breaks them is damaged or hostile rather than merely
 * out of date.
 *
 * Why each rule exists:
 * - **Keys:** `__proto__`, `constructor` and `prototype` are dropped wherever they appear. A JSON
 *   object can hold an own `__proto__` key, and code that later copies it key by key (Foundry's
 *   deepClone and mergeObject among them) would make it the copy's prototype, or write onto
 *   `Object.prototype` itself.
 * - **Colours** reach style attributes (`style="background-color: …"`) and PIXI. Handlebars
 *   escapes markup, but the browser decodes the entities before the CSS is read, so a value such as
 *   `red;background:url(…)` would add declarations of its own. Only `#rrggbb` (and `transparent`
 *   where a field allows no fill) passes.
 * - **Enums** are looked up in tables (`ARCS.DASH[lineStyle]`, `FILL_STYLE[fillStyle]`); a value
 *   such as `constructor` would find a function on the table's prototype instead of a row.
 * - **Numbers** must be finite, and are clamped where a range is known, since several size buffers
 *   or loops from them.
 * - **Ids** become flag keys in Foundry (`owners.<levelId>`), where a dot or a `-=` prefix would be
 *   read as a path or a deletion, so they are short strings of letters, digits, `-` and `_`.
 * - **Font family names** are written into `font-family: "…"` and canvas font strings, so quotes,
 *   semicolons, brackets and backslashes are refused.
 * - **Image sources** reach `url('…')` in CSS and texture loads, so a path may not leave its quotes,
 *   carry a scheme other than an embedded image, or climb out of its folder.
 */

/** Keys never copied from outside data, at any depth. */
export const UNSAFE_KEYS = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const TRANSPARENT = "transparent";
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
/** Letters and digits in any script, spaces, and the few marks font names use. */
const FONT_PATTERN = /^[\p{L}\p{N} _.'-]+$/u;
const FONT_LENGTH = 100;
/** An embedded image: a data URL of one of the image types the studio accepts, in base64. */
const DATA_IMAGE = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]*={0,2}$/;
/** A URL scheme at the start of a string ("https:", "javascript:"). */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** Characters that would end a quoted CSS url() or attribute, or start an escape, plus whitespace and controls. */
const PATH_BREAKERS = /["'()\\<>`\s\p{Cc}]/u;

/** Characters escaped for HTML, attribute values included (the set Handlebars escapes). */
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;", "`": "&#x60;", "=": "&#x3D;" };

/**
 * A file or field refused, with the reason a reader is told. `reason` names the message (see
 * Sanitize.refusalMessage); `data` fills its placeholders.
 */
export class ImportRefusal extends Error {
    /**
     * @param {"tooLarge"|"notMap"|"notStyles"|"damaged"|"textTooLong"|"image"} reason
     * @param {object} [data]
     */
    constructor(reason, data = {}) {
        super(`FWMB | Import refused (${reason})${data.detail ? `: ${data.detail}` : ""}`);
        this.name = "ImportRefusal";
        this.reason = reason;
        this.data = data;
    }
}

/** The message shown for each reason a file is refused (all localised, see refusalMessage). */
const REFUSAL_KEYS = Object.freeze({
    tooLarge: "FILRODENSWMB.UI.ImportRefusedTooLarge",
    notMap: "FILRODENSWMB.UI.ImportRefusedNotMap",
    notStyles: "FILRODENSWMB.UI.ImportRefusedNotStyles",
    damaged: "FILRODENSWMB.UI.ImportRefusedDamaged",
    textTooLong: "FILRODENSWMB.UI.ImportRefusedTextTooLong",
    image: "FILRODENSWMB.UI.ImportRefusedImage",
});

const BYTES_PER_MEGABYTE = 1048576;

/** The kinds of free text, each with its limit in FILRODENSWMB.LIMITS.TEXT. */
export const TEXT_KINDS = Object.freeze({ name: "NAME", description: "DESCRIPTION", label: "LABEL" });

export class Sanitize {
    /** Whether a key may be copied from outside data. */
    static isSafeKey(key) {
        return !UNSAFE_KEYS.has(key);
    }

    /**
     * A fresh copy of parsed JSON holding only plain data (objects, arrays, strings, finite
     * numbers, booleans, null) with every unsafe key dropped, refusing a file that nests too
     * deeply, holds too many values, too long an array or too long a string (the limits in
     * FILRODENSWMB.LIMITS.IMPORT). Objects are rebuilt key by key on a fresh object, so nothing in
     * the copy shares or changes a prototype.
     *
     * @param {*} value - Parsed JSON.
     * @returns {*}
     * @throws {ImportRefusal}
     */
    static plainTree(value) {
        const limits = FILRODENSWMB.LIMITS.IMPORT;
        const budget = { values: limits.VALUES };
        return copyPlain(value, 0, budget, limits);
    }

    /**
     * The limit, in characters, of a kind of free text.
     * @param {"name"|"description"|"label"} kind
     * @returns {number}
     */
    static textLimit(kind) {
        return FILRODENSWMB.LIMITS.TEXT[TEXT_KINDS[kind] ?? TEXT_KINDS.name];
    }

    /**
     * Free text as a string: a string as it is, a number (an older map's seed) as its digits, and
     * anything else as the fallback. Its length is not changed here; see textTooLong.
     * @param {*} value
     * @param {string|null} [fallback]
     * @returns {string|null}
     */
    static text(value, fallback = null) {
        if (typeof value === "string") return value;
        if (typeof value === "number" && Number.isFinite(value)) return String(value);
        return fallback;
    }

    /**
     * Whether a string is longer than its kind of text allows.
     * @param {string} value
     * @param {"name"|"description"|"label"} kind
     */
    static textTooLong(value, kind) {
        return typeof value === "string" && value.length > Sanitize.textLimit(kind);
    }

    /**
     * Typed text cut to its kind's limit. Fields already stop at their maxlength; this is the
     * second line, for text that reaches an apply by another route (a script, a pasted value).
     * @param {*} value
     * @param {"name"|"description"|"label"} kind
     * @param {string} [fallback]
     * @returns {string}
     */
    static typedText(value, kind, fallback = "") {
        const text = Sanitize.text(value, fallback) ?? fallback;
        return text.slice(0, Sanitize.textLimit(kind));
    }

    /**
     * A colour as `#rrggbb`, or the fallback.
     * @param {*} value
     * @param {{transparent?: boolean, fallback?: string|null}} [options] - transparent: also accept "transparent".
     * @returns {string|null}
     */
    static color(value, { transparent = false, fallback = null } = {}) {
        if (typeof value !== "string") return fallback;
        if (transparent && value === TRANSPARENT) return value;
        return HEX_COLOR.test(value) ? value : fallback;
    }

    /**
     * An RGB triple of whole numbers 0–255 (custom biome colours), or the fallback.
     * @param {*} value
     * @param {number[]|null} [fallback]
     * @returns {number[]|null}
     */
    static rgb(value, fallback = null) {
        if (!Array.isArray(value) || value.length !== 3) return fallback;
        if (!value.every((part) => Number.isFinite(part))) return fallback;
        return value.map((part) => Math.min(255, Math.max(0, Math.round(part))));
    }

    /**
     * One of a list of allowed values, or the fallback. Compared with ===, so a value found on an
     * object's prototype can never pass.
     * @param {*} value
     * @param {readonly any[]} allowed
     * @param {*} [fallback]
     */
    static oneOf(value, allowed, fallback = null) {
        return allowed.includes(value) ? value : fallback;
    }

    /**
     * A finite number, clamped to [min, max] and rounded when `integer`, or the fallback.
     * @param {*} value
     * @param {{min?: number, max?: number, integer?: boolean, fallback?: number|null}} [options]
     * @returns {number|null}
     */
    static number(value, { min = -Infinity, max = Infinity, integer = false, fallback = null } = {}) {
        if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
        const whole = integer ? Math.round(value) : value;
        return Math.min(max, Math.max(min, whole));
    }

    /**
     * A boolean, or the fallback.
     * @param {*} value
     * @param {boolean|null} [fallback]
     */
    static bool(value, fallback = null) {
        return typeof value === "boolean" ? value : fallback;
    }

    /**
     * Whether a value is a safe id: a short string of letters, digits, `-` and `_`.
     * @param {*} value
     */
    static isId(value) {
        return typeof value === "string" && value.length > 0 && value.length <= FILRODENSWMB.LIMITS.IMPORT.ID_LENGTH && ID_PATTERN.test(value) && Sanitize.isSafeKey(value);
    }

    /**
     * A safe id, or the fallback.
     * @param {*} value
     * @param {string|null} [fallback]
     */
    static id(value, fallback = null) {
        return Sanitize.isId(value) ? value : fallback;
    }

    /**
     * A font family name safe to write into CSS and canvas font strings, or the fallback. Names
     * the host lacks are kept (the label draws in the default face and the picker lists the name
     * as missing), since a map made where that font exists should keep asking for it.
     * @param {*} value
     * @param {string|null} [fallback]
     */
    static fontFamily(value, fallback = null) {
        if (typeof value !== "string" || value.length === 0 || value.length > FONT_LENGTH) return fallback;
        return FONT_PATTERN.test(value) ? value : fallback;
    }

    /**
     * An image source safe to hand to the asset resolver, a CSS url() or a texture loader, or the
     * fallback: an embedded image (a base64 data URL of PNG, JPEG, WebP or SVG; its content is
     * checked separately, see ImageCheck) or a relative path into the host's data with no scheme,
     * no `..` segment and nothing that would end its quotes. An absolute `https:` URL passes only
     * when `remote` is set: a Foundry file picker can return one for a file in a remote asset
     * library, but data from a file someone else made should not make the studio fetch from
     * anywhere it chooses.
     *
     * @param {*} value
     * @param {{remote?: boolean, fallback?: string|null}} [options]
     * @returns {string|null}
     */
    static imageSource(value, { remote = false, fallback = null } = {}) {
        if (typeof value !== "string" || value.length === 0) return fallback;
        if (value.startsWith("data:")) return DATA_IMAGE.test(value) ? value : fallback;
        if (PATH_BREAKERS.test(value)) return fallback;
        if (SCHEME.test(value)) return remote && value.startsWith("https://") ? value : fallback;
        if (value.startsWith("/") || value.split("/").includes("..")) return fallback;
        return value;
    }

    /** Text made safe to place in HTML, attribute values included. */
    static escapeHtml(text) {
        return String(text ?? "").replaceAll(/[&<>"'`=]/g, (character) => HTML_ESCAPES[character]);
    }

    /**
     * Plain text as HTML paragraphs, for a journal page: every character escaped, a blank line
     * starting a new paragraph and a single line break kept as `<br>`. Markup typed into the text
     * shows as the characters typed.
     * @param {string} text
     * @returns {string}
     */
    static textToHtml(text) {
        const normalised = String(text ?? "")
            .replaceAll("\r\n", "\n")
            .trim();
        if (!normalised) return "";
        return normalised
            .split(/\n\s*\n/)
            .map((paragraph) => `<p>${paragraph.split("\n").map(Sanitize.escapeHtml).join("<br>")}</p>`)
            .join("");
    }

    /**
     * The localised message for a refused file.
     * @param {ImportRefusal} refusal
     * @param {{format: Function}} i18n
     * @returns {string}
     */
    static refusalMessage(refusal, i18n) {
        const key = REFUSAL_KEYS[refusal.reason] ?? REFUSAL_KEYS.damaged;
        const data = { ...refusal.data };
        if (refusal.reason === "textTooLong") Object.assign(data, Sanitize.limitParts(data, i18n));
        if (refusal.reason === "image") Object.assign(data, { megabytes: Math.floor(FILRODENSWMB.LIMITS.IMAGE.BYTES / BYTES_PER_MEGABYTE), pixels: FILRODENSWMB.LIMITS.IMAGE.DIMENSION });
        const message = i18n.format(key, data);
        return data.more > 0 ? `${message} ${i18n.format("FILRODENSWMB.UI.ImportRefusedMore", { count: data.more })}` : message;
    }

    /**
     * The words naming a piece of text past its limit: what holds it ("the pin “Elaris”", or "the
     * map") and which of its fields it is ("description").
     * @param {{where?: string, item?: string, field?: string}} entry - `where` and `field` are
     *     localisation keys (see MapRules); `item` is the object's own name.
     * @param {{localize: Function, format: Function}} i18n
     * @returns {{what: string, field: string}}
     */
    static limitParts({ where, item, field }, i18n) {
        const kind = where ? i18n.localize(where) : "";
        const what = item ? i18n.format("FILRODENSWMB.UI.LimitItemNamed", { kind, name: item }) : i18n.format("FILRODENSWMB.UI.LimitItemUnnamed", { kind });
        return { what, field: field ? i18n.localize(field) : "" };
    }

    /**
     * One line of an export's over-limit list: what holds the text, which field, how long it is
     * and its limit.
     * @param {{where?: string, item?: string, field?: string, length: number, limit: number}} entry
     * @param {{localize: Function, format: Function}} i18n
     * @returns {string}
     */
    static limitLine(entry, i18n) {
        return i18n.format("FILRODENSWMB.UI.LimitLine", { ...Sanitize.limitParts(entry, i18n), length: entry.length, limit: entry.limit });
    }
}

/** One step of plainTree: a value at `depth`, counted against `budget.values`. */
function copyPlain(value, depth, budget, limits) {
    budget.values -= 1;
    if (budget.values < 0) throw new ImportRefusal("tooLarge", { detail: "too many values" });
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") {
        if (value.length > limits.STRING_LENGTH) throw new ImportRefusal("tooLarge", { detail: "string too long" });
        return value;
    }
    if (typeof value !== "object") return null;
    if (depth >= limits.DEPTH) throw new ImportRefusal("damaged", { detail: "nested too deeply" });
    if (Array.isArray(value)) return copyArray(value, depth, budget, limits);
    return copyObject(value, depth, budget, limits);
}

function copyArray(value, depth, budget, limits) {
    if (value.length > limits.ARRAY_LENGTH) throw new ImportRefusal("tooLarge", { detail: "array too long" });
    const copy = new Array(value.length);
    for (let i = 0; i < value.length; i++) copy[i] = copyPlain(value[i], depth + 1, budget, limits);
    return copy;
}

function copyObject(value, depth, budget, limits) {
    const copy = {};
    for (const key of Object.keys(value)) {
        if (!Sanitize.isSafeKey(key)) continue;
        // defineProperty rather than assignment, so even a key the rule above missed could never
        // reach the prototype through a setter
        Object.defineProperty(copy, key, { value: copyPlain(value[key], depth + 1, budget, limits), enumerable: true, writable: true, configurable: true });
    }
    return copy;
}
