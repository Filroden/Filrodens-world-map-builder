import { ALLOWED, BLOCKED_WORDS } from "./data/BlockedWords.js";

/**
 * Keeps common rude words out of generated names (roadmap decision 45). The name generator is a
 * Markov chain over letters, so any name base can spell a rude word in some language by chance
 * (Arsereacht); one list across several languages serves every base, since whether a name offends
 * depends on the reader's language, not the base's.
 *
 * A name is read without accents and in lower case, in words split at spaces, hyphens and
 * apostrophes. It is blocked when it holds a listed word where that word is rude (see
 * data/BlockedWords.js: anywhere, at a word's start or end, or as a whole word), unless it is on
 * the allowlist. Real names are checked like any other (Ken, 2026-11-26): Cockermouth reads the same
 * to anyone who doesn't know Cumbria.
 *
 * Only generated names are checked, by those who draw them (the run's and Fill in's names under
 * generator REVISION_3, the suggestions, people's names): never a user's typed names, a saved
 * name, or the map's own names that people's family names draw on.
 */

/** Letters NFD does not take apart, as they read. */
const LETTERS = Object.freeze({ ß: "ss", æ: "ae", œ: "oe", ø: "o", ł: "l", đ: "d", ð: "d", þ: "th", ı: "i" });

/** A name as the list reads it: no accents, lower case. */
export function readName(name) {
    return String(name)
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/[ßæœøłđðþı]/g, (c) => LETTERS[c]);
}

const escape = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const join = (list) => list.map(escape).join("|");
// One expression for the whole list: a word's edges are the name's, or a space, hyphen or apostrophe
const EDGE = "[\\s'’\\-]";
const BLOCKED = new RegExp(
    [
        `(?:${join(BLOCKED_WORDS.anywhere)})`,
        `(?:^|${EDGE})(?:${join(BLOCKED_WORDS.start)})`,
        `(?:${join(BLOCKED_WORDS.end)})(?:$|${EDGE})`,
        `(?:^|${EDGE})(?:${join(BLOCKED_WORDS.whole)})(?:$|${EDGE})`,
    ].join("|"),
    "u",
);
const ALLOWED_NAMES = new Set(Object.keys(ALLOWED).map(readName));

/**
 * Whether a generated name is kept out: it holds a listed word where that word is rude, and is
 * not on the allowlist.
 * @param {string} name
 * @returns {boolean}
 */
export function isBlockedName(name) {
    if (typeof name !== "string" || !name) return false;
    const read = readName(name);
    return BLOCKED.test(read) && !ALLOWED_NAMES.has(read);
}

/**
 * The word a name is blocked for, or null: for the probe and tests.
 * @param {string} name
 * @returns {string|null}
 */
export function blockedWordIn(name) {
    if (!isBlockedName(name)) return null;
    return readName(name).match(BLOCKED)[0].replace(new RegExp(`^${EDGE}|${EDGE}$`, "gu"), "");
}

/**
 * A name drawn until it is neither used nor (with `clean`) blocked, up to `retries` draws more.
 * With `clean` off it draws exactly as a plain retry for duplicates does (the same draws, the same
 * name). With it on, a blocked name counts as used. If the retries run out, the last clean draw
 * stands, a repeat or not, else the fallback's: a blocked name is never returned while a fallback
 * is given.
 *
 * @param {() => string} make - One draw.
 * @param {object} [options]
 * @param {Set<string>} [options.used] - Names taken already (left unchanged).
 * @param {boolean} [options.clean] - Whether blocked names are drawn again.
 * @param {number} options.retries
 * @param {() => string|null} [options.fallback] - A clean name when every draw was blocked.
 * @returns {string}
 */
export function drawName(make, { used = null, clean = false, retries, fallback = null }) {
    let name = make();
    let lastClean = clean && isBlockedName(name) ? null : name;
    const taken = (candidate) => used?.has(candidate) || (clean && isBlockedName(candidate));
    for (let attempt = 0; attempt < retries && taken(name); attempt++) {
        name = make();
        if (!clean || !isBlockedName(name)) lastClean = name;
    }
    if (clean && isBlockedName(name)) return lastClean ?? fallback?.() ?? name;
    return name;
}

/**
 * A clean name from a list (a name base's own names), chosen by `rng`: the one it lands on, or the
 * next clean one after it; null when none is clean.
 * @param {string[]} list
 * @param {() => number} rng
 * @returns {string|null}
 */
export function cleanFromList(list, rng) {
    if (!list.length) return null;
    const start = Math.floor(rng() * list.length);
    for (let step = 0; step < list.length; step++) {
        const name = list[(start + step) % list.length];
        if (name && !isBlockedName(name)) return name;
    }
    return null;
}
