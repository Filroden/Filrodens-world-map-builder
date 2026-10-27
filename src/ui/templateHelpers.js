import { Sanitize } from "../data/Sanitize.js";

/**
 * The module's own Handlebars helpers, registered on both hosts (Foundry's Handlebars in main.js,
 * the web page's in platform/web/templates.js). Each name starts `fwmb` so it cannot collide with
 * Foundry's helpers or another module's in Foundry's shared Handlebars.
 *
 * - `fwmbTextLimit kind`: the most characters a free-text field of that kind takes ("name",
 *   "description" or "label"; see FILRODENSWMB.LIMITS.TEXT), for its maxlength. A field stopping at
 *   the limit means a map can always be exported, since an export refuses text past it.
 *
 * @param {object} handlebars
 */
export function registerModuleHelpers(handlebars) {
    handlebars.registerHelper("fwmbTextLimit", (kind) => Sanitize.textLimit(typeof kind === "string" ? kind : "name"));
}
