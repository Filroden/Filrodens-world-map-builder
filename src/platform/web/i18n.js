/**
 * Translated text on the web (the platform's `i18n` service): the module's language files, the
 * English one first and the reader's language over it, so a string the reader's file lacks falls
 * back to English, as in Foundry.
 */

/**
 * The language to show: the first of the browser's preferred languages the module has a file for
 * (an exact match, such as "en-GB", before a match on the language alone, such as "en"), or the
 * fallback.
 *
 * @param {Array<{lang: string, path: string}>} available - The module's languages (module.json).
 * @param {readonly string[]} preferred - The browser's languages, most preferred first.
 * @param {string} [fallback]
 * @returns {{lang: string, path: string}|undefined}
 */
export function chooseLanguage(available, preferred, fallback = "en") {
    const byCode = new Map(available.map((entry) => [entry.lang.toLowerCase(), entry]));
    for (const code of preferred) {
        const wanted = code.toLowerCase();
        const match = byCode.get(wanted) ?? byCode.get(wanted.split("-")[0]);
        if (match) return match;
    }
    return byCode.get(fallback);
}

/**
 * Language files as one flat map of key to string. A file may be flat (every key written out in
 * full) or nested (keys split at their dots); both are read.
 *
 * @param {...object} files - Later files override earlier ones.
 * @returns {Map<string, string>}
 */
export function flattenStrings(...files) {
    const strings = new Map();
    const add = (object, prefix) => {
        for (const [key, value] of Object.entries(object)) {
            const path = prefix ? `${prefix}.${key}` : key;
            if (value && typeof value === "object") add(value, path);
            else strings.set(path, String(value));
        }
    };
    for (const file of files) add(file, "");
    return strings;
}

/**
 * The i18n service over a set of strings.
 *
 * @param {Map<string, string>} strings - See flattenStrings.
 * @param {string} lang - The language code shown.
 */
export function createI18n(strings, lang) {
    const localize = (key) => strings.get(key) ?? key;
    return {
        lang,
        localize,
        /** The string with each `{name}` replaced from `data`; unknown names are left as written. */
        format: (key, data = {}) => localize(key).replace(/\{(\w+)\}/g, (placeholder, name) => (name in data ? String(data[name]) : placeholder)),
        has: (key) => strings.has(key),
    };
}
