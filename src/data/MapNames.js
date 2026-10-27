import { Sanitize } from "./Sanitize.js";

/**
 * Names for maps that arrive from outside (a JSON import, and each map of a backup): kept as they
 * were, with a number added only when a saved map already has the name ("Harbour (2)",
 * "Harbour (3)"), so an import never shares a name with a map already there.
 */
export class MapNames {
    /**
     * The name a map is given from the file it came in: the file's name without `.json` and the
     * `fwmb_` prefix the export adds, cut to the name limit.
     * @param {string} fileName
     * @param {string} fallback - Used when nothing is left (a file called `.json`).
     * @returns {string}
     */
    static fromFileName(fileName, fallback) {
        const base = String(fileName ?? "")
            .replace(/\.json$/i, "")
            .replace(/^fwmb_/, "")
            .trim();
        return Sanitize.typedText(base || fallback, "name");
    }

    /**
     * The name itself when no saved map has it, else the first free numbered form of it.
     * @param {string} name
     * @param {Iterable<string>} taken - The names already saved.
     * @param {(name: string, number: number) => string} numbered - Formats the numbered name (localised).
     * @returns {string}
     */
    static unique(name, taken, numbered) {
        const names = new Set(taken);
        if (!names.has(name)) return name;
        let number = 2;
        while (names.has(numbered(name, number))) number += 1;
        return numbered(name, number);
    }

    /**
     * Every saved map's name, from the tree platform.store.getSavedMaps returns (regional maps
     * are nested under their parents).
     * @param {{name: string, children?: object[]}[]} tree
     * @returns {string[]}
     */
    static namesIn(tree) {
        const names = [];
        const visit = (entries) => {
            for (const entry of entries ?? []) {
                names.push(entry.name);
                visit(entry.children);
            }
        };
        visit(tree);
        return names;
    }
}
