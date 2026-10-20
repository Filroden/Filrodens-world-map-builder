import { FONT_FAMILIES, FONT_SUBSETS, fontFaces, fontLicencePath } from "./fonts.js";

/**
 * Every third-party library, icon set and font the module ships, with its licence: the one list
 * from which Help's Acknowledgements are drawn (see HelpPanel) and the README's third-party table is
 * written (scripts/credits-readme.mjs). The fonts come from the font registry (src/data/fonts.js).
 * tests/ui/credits.test.mjs checks that every folder of vendor/ and assets/fonts/ has an entry whose
 * licence file is there, and that the README's table is the one written from this list.
 *
 * An entry is `{ id, name, url, version?, what, folder, licenceFile, licence }`: `what` is the
 * localisation key of what it is and does (en.json holds the README's English), `folder` the folder
 * it is kept in, from the module's root, and `licenceFile` its licence there.
 */
export const LIBRARY_CREDITS = Object.freeze([
    Object.freeze({ id: "d3-delaunay", name: "d3-delaunay", version: "6.0.4", url: "https://github.com/d3/d3-delaunay", what: "FILRODENSWMB.Credits.D3Delaunay", folder: "vendor/d3-delaunay", licenceFile: "licence-d3-delaunay.md", licence: "ISC" }),
    Object.freeze({ id: "delaunator", name: "delaunator", version: "5.1.0", url: "https://github.com/mapbox/delaunator", what: "FILRODENSWMB.Credits.Delaunator", folder: "vendor/d3-delaunay", licenceFile: "licence-delaunator.md", licence: "ISC" }),
    Object.freeze({ id: "robust-predicates", name: "robust-predicates", version: "3.0.3", url: "https://github.com/mourner/robust-predicates", what: "FILRODENSWMB.Credits.RobustPredicates", folder: "vendor/d3-delaunay", licenceFile: "licence-robust-predicates.md", licence: "Unlicense (public domain)" }),
    Object.freeze({ id: "simplex-noise", name: "Simplex noise by Jonas Wagner", url: null, what: "FILRODENSWMB.Credits.SimplexNoise", folder: "vendor/simplex-noise", licenceFile: "licence-simplex-noise.md", licence: "MIT" }),
    Object.freeze({ id: "idiomorph", name: "idiomorph", version: "0.7.4", url: "https://github.com/bigskysoftware/idiomorph", what: "FILRODENSWMB.Credits.Idiomorph", folder: "vendor/idiomorph", licenceFile: "licence-idiomorph.md", licence: "0BSD" }),
    Object.freeze({ id: "pixi", name: "PixiJS", version: "7.4.2", url: "https://pixijs.com/", what: "FILRODENSWMB.Credits.Pixi", folder: "vendor/pixi", licenceFile: "licence-pixi.md", licence: "MIT" }),
    Object.freeze({ id: "handlebars", name: "Handlebars", version: "4.7.10", url: "https://handlebarsjs.com/", what: "FILRODENSWMB.Credits.Handlebars", folder: "vendor/handlebars", licenceFile: "licence-handlebars.md", licence: "MIT" }),
    Object.freeze({ id: "three", name: "three.js", version: "r185", url: "https://threejs.org/", what: "FILRODENSWMB.Credits.Three", folder: "vendor/three", licenceFile: "licence-three.md", licence: "MIT" }),
    Object.freeze({ id: "material-icons", name: "Google Material Design icons", url: "https://fonts.google.com/icons", what: "FILRODENSWMB.Credits.MaterialIcons", folder: "assets/icons", licenceFile: "icons-licence.md", licence: "Apache 2.0" }),
    Object.freeze({ id: "pinhead-icons", name: "Pinhead icons", url: "https://pinhead.ink/", what: "FILRODENSWMB.Credits.PinheadIcons", folder: "assets/pinhead-icons", licenceFile: "licence-pinhead-icons.md", licence: "CC0 1.0 (public domain dedication)" }),
]);

/** The name of the fonts' licence. */
export const FONT_LICENCE = "SIL Open Font License 1.1";

/** The scripts a font's subsets cover, by name, in the README's words. */
const SUBSET_NAMES = Object.freeze({
    latin: "Latin",
    "latin-ext": "Latin Extended",
    greek: "Greek",
    "greek-ext": "Greek Extended",
    cyrillic: "Cyrillic",
    "cyrillic-ext": "Cyrillic Extended",
    devanagari: "Devanagari",
    arabic: "Arabic",
    hebrew: "Hebrew",
});

/** What each interface font draws, in the README's words. */
const FONT_ROLES = Object.freeze({ interface: "the interface font", titles: "titles", readouts: "values and readouts" });

/** "a, b and c" */
function listed(items) {
    return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * Each vendored font family as a credit: its faces described as the README describes them.
 * @returns {{id: string, name: string, url: string, folder: string, licenceFile: string, licence: string, category: string, description: string}[]}
 */
export function fontCredits() {
    return FONT_FAMILIES.map((family) => {
        const faces = fontFaces(family);
        const weights = [...new Set(faces.map((face) => face.weight))];
        const italics = [...new Set(faces.filter((face) => face.style === "italic").map((face) => face.weight))];
        const role = family.ui ? `${FONT_ROLES[family.role] ?? family.role}, and a label font` : "a label font";
        const scripts = listed(family.subsets.filter((subset) => FONT_SUBSETS[subset]).map((subset) => SUBSET_NAMES[subset] ?? subset));
        const weightText = `${weights.length > 1 ? "weights" : "weight"} ${listed(weights.map(String))}`;
        let styles = "";
        if (italics.length && italics.length === weights.length) styles = ", upright and italic";
        else if (italics.length) styles = `, italic in ${listed(italics.map(String))}`;
        return {
            id: family.id,
            name: family.name,
            url: family.source,
            folder: fontLicencePath(family).replace(/\/[^/]+$/, ""),
            licenceFile: fontLicencePath(family).split("/").at(-1),
            licence: FONT_LICENCE,
            category: family.category,
            description: `${role}; ${scripts}, ${weightText}${styles}`,
        };
    });
}

/**
 * The README's third-party table (between its credits markers), written from the credits.
 * @param {(key: string) => string} english - The English of a localisation key (en.json).
 * @returns {string}
 */
export function creditsTable(english) {
    const link = (name, url) => (url ? `[${name}](${url})` : name);
    const row = (dependency, folder, file, licence) => `| ${dependency} | [\`${folder}/\`](${folder}/) | [\`${file}\`](${folder}/${file}) | ${licence} |`;
    const rows = [
        "| Dependency | Folder | Licence file | Licence |",
        "| :--- | :--- | :--- | :--- |",
        ...LIBRARY_CREDITS.map((credit) => row(`${link(credit.name, credit.url)}${credit.version ? ` ${credit.version}` : ""} (${english(credit.what)})`, credit.folder, credit.licenceFile, credit.licence)),
        ...fontCredits().map((credit) => row(`${link(credit.name, credit.url)} (${credit.description})`, credit.folder, credit.licenceFile, credit.licence)),
    ];
    return rows.join("\n");
}

/** The README's markers around the table. */
export const CREDITS_MARKERS = Object.freeze({ start: "<!-- credits:start (written by scripts/credits-readme.mjs from src/data/credits.js) -->", end: "<!-- credits:end -->" });
