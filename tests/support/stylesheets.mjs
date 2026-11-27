// The module's stylesheets, for the tests that read them (RF1): in the order the hosts load them
// (module.json's "styles"; web/index.html loads the same, after its own web/web-base.css, which
// tests/ui/stylesheets.test.mjs holds), and the sheet each kind of rule lives in, so a later split
// of a sheet changes this file rather than each test.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The fonts' @font-face rules. */
export const FONTS_SHEET = "styles/fwmb-fonts.css";
/** The design tokens and the four colour themes. */
export const THEME_SHEET = "styles/fwmb-theme.css";
/** The studio's components and surfaces. */
export const STUDIO_SHEET = "styles/filrodens-world-map-builder.css";

/** The module's stylesheets as Foundry loads them (module.json), in order. */
export function moduleStylesheets() {
    return JSON.parse(readFileSync(`${ROOT}module.json`, "utf8")).styles;
}

/** A stylesheet's text, by its repository path. */
export function stylesheet(path) {
    return readFileSync(`${ROOT}${path}`, "utf8");
}
