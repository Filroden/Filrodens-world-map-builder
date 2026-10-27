// Name generator from Azgaar's Fantasy Map Generator (MIT licence, see licence-azgaar-fmg.md in this folder).
// Source: https://github.com/Azgaar/Fantasy-Map-Generator, src/generators/names-generator.ts at commit
// 619d37c7 (2026-10-09), with the helpers it uses from src/utils (isVowel, last, capitalize, P, ra, rand).
//
// Changes from the original:
// - Plain JavaScript ES module (TypeScript types removed), no globals (window, pack, tip, ERROR/WARN).
// - A class taking its own random source (`rng`, a function returning [0, 1)), so names are
//   deterministic for a seed, instead of Math.random.
// - getCulture/getCultureShort (which read FMG's `pack.cultures`) removed; callers pass a base index.
// - getState takes the base index directly; getMapName and the era helpers removed.
// The Markov chain construction and name assembly are unchanged.
import { getDefaultNameBases } from "./name-bases.js";

const VOWELS = "aeiouyɑ'əøɛœæɶɒɨɪɔɐʊɤɯаоиеёэыуюяàèìòùỳẁȁȅȉȍȕáéíóúýẃőűâêîôûŷŵäëïöüÿẅãẽĩõũỹąęįǫųāēīōūȳăĕĭŏŭǎěǐǒǔȧėȯẏẇạẹịọụỵẉḛḭṵṳ";
const isVowel = (c) => VOWELS.includes(c);
const last = (array) => array[array.length - 1];
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export class NamesGenerator {
    /**
     * @param {() => number} rng - Random source returning [0, 1).
     * @param {object[]} [nameBases] - Name bases; defaults to Azgaar's built-in set.
     */
    constructor(rng, nameBases = getDefaultNameBases()) {
        this.rng = rng;
        this.nameBases = nameBases;
        this.chains = [];
    }

    #P(probability) {
        if (probability >= 1) return true;
        if (probability <= 0) return false;
        return this.rng() < probability;
    }

    #ra(array) {
        return array[Math.floor(this.rng() * array.length)];
    }

    /** The index of the base with this name, or -1. */
    indexOf(name) {
        return this.nameBases.findIndex((b) => b.name === name);
    }

    calculateChain(namesList) {
        const chain = [];
        const availableNames = namesList.split(",");

        for (const n of availableNames) {
            const name = n.trim().toLowerCase();
            const basic = !/[^\x20-\x7e]/.test(name); // basic printable ASCII chars and English rules can be applied

            // split word into pseudo-syllables
            for (let i = -1, syllable = ""; i < name.length; i += syllable.length || 1, syllable = "") {
                const prev = name[i] || ""; // pre-onset letter
                let v = 0; // 0 if no vowels in syllable

                for (let c = i + 1; name[c] && syllable.length < 5; c++) {
                    const that = name[c],
                        next = name[c + 1]; // next char
                    syllable += that;
                    if (syllable === " " || syllable === "-") break; // syllable starts with space or hyphen
                    if (!next || next === " " || next === "-") break; // no need to check

                    if (isVowel(that)) v = 1; // check if letter is vowel

                    // do not split some diphthongs
                    if (that === "y" && next === "e") continue; // 'ye'
                    if (basic) {
                        // English-like
                        if (that === "o" && next === "o") continue; // 'oo'
                        if (that === "e" && next === "e") continue; // 'ee'
                        if (that === "a" && next === "e") continue; // 'ae'
                        if (that === "c" && next === "h") continue; // 'ch'
                    }

                    if (isVowel(that) === next) break; // two same vowels in a row (original quirky behaviour)
                    if (v && isVowel(name[c + 2])) break; // syllable has vowel and additional vowel is expected soon
                }

                if (!chain[prev]) chain[prev] = [];
                chain[prev].push(syllable);
            }
        }

        return chain;
    }

    updateChain(index) {
        this.chains[index] = this.nameBases[index]?.b ? this.calculateChain(this.nameBases[index].b) : null;
    }

    /** A name from base `base` using its Markov chain. */
    getBase(base, min, max, dupl) {
        if (this.nameBases[base] === undefined) base = 0;
        if (!this.chains[base]) this.updateChain(base);

        const data = this.chains[base];
        if (!data || data[""] === undefined) throw new Error(`Name base ${base} is incorrect`);

        if (!min) min = this.nameBases[base].min;
        if (!max) max = this.nameBases[base].max;
        if (dupl !== "") dupl = this.nameBases[base].d;

        let v = data[""],
            cur = this.#ra(v),
            w = "";
        for (let i = 0; i < 20; i++) {
            if (cur === "") {
                // end of word
                if (w.length < min) {
                    cur = "";
                    w = "";
                    v = data[""];
                } else break;
            } else {
                if (w.length + cur.length > max) {
                    // word too long
                    if (w.length < min) w += cur;
                    break;
                } else v = data[last(cur.split(""))] || data[""];
            }

            w += cur;
            cur = this.#ra(v);
        }

        // parse word to get a final name
        const l = last(w.split("")); // last letter
        if (l === "'" || l === " " || l === "-") w = w.slice(0, -1); // not allow some characters at the end

        let name = [...w].reduce((r, c, i, d) => {
            if (c === d[i + 1] && !dupl.includes(c)) return r; // duplication is not allowed
            if (!r.length) return c.toUpperCase();
            if (r.slice(-1) === "-" && c === " ") return r; // remove space after hyphen
            if (r.slice(-1) === " ") return r + c.toUpperCase(); // capitalize letter after space
            if (r.slice(-1) === "-") return r + c.toUpperCase(); // capitalize letter after hyphen
            if (c === "a" && d[i + 1] === "e") return r; // "ae" => "e"
            if (i + 2 < d.length && c === d[i + 1] && c === d[i + 2]) return r; // remove three same letters in a row
            return r + c;
        }, "");

        // join the word if any part has only 1 letter
        if (name.split(" ").some((part) => part.length < 2))
            name = name
                .split(" ")
                .map((p, i) => (i ? p.toLowerCase() : p))
                .join("");

        if (name.length < 2) name = this.#ra(this.nameBases[base].b.split(","));

        return name;
    }

    /** A short name from base `base`. */
    getBaseShort(base) {
        const min = this.nameBases[base] ? this.nameBases[base].min - 1 : undefined;
        const max = min ? Math.max(this.nameBases[base].max - 2, min) : undefined;
        return this.getBase(base, min, max, "");
    }

    #validateSuffix(name, suffix) {
        if (name.slice(-1 * suffix.length) === suffix) return name; // no suffix if name already ends with it
        const s1 = suffix.charAt(0);
        if (name.slice(-1) === s1) name = name.slice(0, -1); // remove name last letter if it's a suffix first letter
        if (isVowel(s1) === isVowel(name.slice(-1)) && isVowel(s1) === isVowel(name.slice(-2, -1)))
            name = name.slice(0, -1); // remove name last char if 2 last chars are the same type as suffix's 1st
        if (name.slice(-1) === s1) name = name.slice(0, -1); // remove name last letter if it's a suffix first letter
        return name + suffix;
    }

    /** A state (realm) name from a base name, usually its capital's, with a base-specific suffix. */
    getState(name, base) {
        // exclude endings inappropriate for states name
        if (name.includes(" ")) name = capitalize(name.replace(/ /g, "").toLowerCase()); // don't allow multiword state names
        if (name.length > 6 && name.slice(-4) === "berg") name = name.slice(0, -4); // remove -berg for any
        if (name.length > 5 && name.slice(-3) === "ton") name = name.slice(0, -3); // remove -ton for any

        if (base === 5 && ["sk", "ev", "ov"].includes(name.slice(-2))) name = name.slice(0, -2);
        // remove -sk/-ev/-ov for Ruthenian
        else if (base === 12) return isVowel(name.slice(-1)) ? name : `${name}u`;
        // Japanese ends on any vowel or -u
        else if (base === 18 && this.#P(0.4))
            name = isVowel(name.slice(0, 1).toLowerCase()) ? `Al${name.toLowerCase()}` : `Al ${name}`; // Arabic starts with -Al

        // no suffix for fantasy bases
        if (base > 32 && base < 42) return name;

        // define if suffix should be used
        if (name.length > 3 && isVowel(name.slice(-1))) {
            if (isVowel(name.slice(-2, -1)) && this.#P(0.85)) name = name.slice(0, -2);
            // 85% for vv
            else if (this.#P(0.7)) name = name.slice(0, -1);
            // ~60% for cv
            else return name;
        } else if (this.#P(0.4)) return name; // 60% for cc and vc

        // define suffix
        let suffix = "ia"; // standard suffix

        const rnd = this.rng(),
            l = name.length;
        if (base === 3 && rnd < 0.03 && l < 7) suffix = "terra";
        else if (base === 4 && rnd < 0.03 && l < 7) suffix = "terra";
        else if (base === 13 && rnd < 0.03 && l < 7) suffix = "terra";
        else if (base === 2 && rnd < 0.03 && l < 7) suffix = "terre";
        else if (base === 0 && rnd < 0.5 && l < 7) suffix = "land";
        else if (base === 1 && rnd < 0.4 && l < 7) suffix = "land";
        else if (base === 6 && rnd < 0.3 && l < 7) suffix = "land";
        else if (base === 32 && rnd < 0.1 && l < 7) suffix = "land";
        else if (base === 7 && rnd < 0.1) suffix = "eia";
        else if (base === 9 && rnd < 0.35) suffix = "maa";
        else if (base === 15 && rnd < 0.4 && l < 6) suffix = "orszag";
        else if (base === 16) suffix = rnd < 0.6 ? "yurt" : "eli";
        else if (base === 10) suffix = "guk";
        else if (base === 11) suffix = " Guo";
        else if (base === 14) suffix = rnd < 0.5 && l < 6 ? "tlan" : "co";
        else if (base === 17 && rnd < 0.8) suffix = "a";
        else if (base === 18 && rnd < 0.8) suffix = "a";

        return this.#validateSuffix(name, suffix);
    }
}
