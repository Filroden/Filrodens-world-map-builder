import { FILRODENSWMB } from "../config.js";

/**
 * The default sea and river route styles were redrawn in one pale blue that shows against the
 * water, told apart by their dashes (see ROUTES.DEFAULT_STYLES). Once, as a map saved before then
 * is read, each of those styles still in its old default colour and line takes the new ones, and
 * so does each route following it that still looks as the old style did. A style or route given
 * another colour or line is the reader's own and is left as it is; thickness never changes.
 *
 * The data is marked (`waterRoutes`), and a map is not marked as changed: until it is saved the
 * same pass runs on every load, with the same result.
 */

/** Each style's old default colour and line. */
const OLD_LOOKS = Object.freeze({
    "route-style-sea-lane": { color: "#2e5f8a", style: "dashed" },
    "route-style-minor-sea-lane": { color: "#5f89ad", style: "dashed" },
    "route-style-river-trade": { color: "#3d7fb8", style: "solid" },
    "route-style-minor-river-trade": { color: "#6a9fcc", style: "solid" },
});

/** Each style's new default colour and line. */
const NEW_LOOKS = new Map(FILRODENSWMB.ROUTES.DEFAULT_STYLES.filter((style) => OLD_LOOKS[style.id]).map((style) => [style.id, { color: style.color, style: style.style }]));

/** Whether an item (a style, or a route following one) still has its style's old look. */
function looksOld(item, id) {
    const old = OLD_LOOKS[id];
    return !!old && typeof item?.color === "string" && item.color.toLowerCase() === old.color && item.style === old.style;
}

/**
 * Gives the water route styles still on their old defaults the new look.
 * @param {object[]} [routeStyles] - Changed in place.
 * @returns {Set<string>} The ids of the styles changed.
 */
function refreshStyles(routeStyles = []) {
    const changed = new Set();
    for (const style of routeStyles ?? []) {
        if (!looksOld(style, style?.id)) continue;
        Object.assign(style, NEW_LOOKS.get(style.id));
        changed.add(style.id);
    }
    return changed;
}

/**
 * @param {object} mapData - A map's data as saved (its route styles and routes). Changed in place.
 * @returns {boolean} Whether anything changed.
 */
export function refreshWaterRoutesOnce(mapData) {
    if (!mapData || mapData.waterRoutes === true) return false;
    mapData.waterRoutes = true;
    const changed = refreshStyles(mapData.customRouteStyles);
    let routes = 0;
    for (const route of mapData.mapRoutes ?? []) {
        if (!changed.has(route?.quickStyle) || !looksOld(route, route.quickStyle)) continue;
        Object.assign(route, NEW_LOOKS.get(route.quickStyle));
        routes++;
    }
    return changed.size + routes > 0;
}
