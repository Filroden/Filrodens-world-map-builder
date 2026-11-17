/**
 * The map's border (the Cartography tool's Border): its lines by style, in map pixels, and the band
 * along the map's edges they cover, which names keep clear of.
 *
 * Each style draws inside the map's edge (a line's width runs inwards), so the map and its
 * exports keep their size and the grid stays where it is.
 */

/** Each style's lines: an outer line at the edge, and an inner one `INNER_MARGIN` in. */
const STYLES = Object.freeze({
    solid: Object.freeze({ outer: 10, inner: 0, corner: 0 }),
    double: Object.freeze({ outer: 10, inner: 3, corner: 0 }),
    ornate: Object.freeze({ outer: 12, inner: 4, corner: 40 }),
});

/** How far in from the edge the inner line starts. */
const INNER_MARGIN = 20;

/** The room names keep beyond the border's lines, so they do not touch them. */
const NAME_GAP = 4;

/** A style's lines (an unknown style is drawn as solid). */
export function borderLines(style) {
    return { ...(STYLES[style] ?? STYLES.solid), innerMargin: INNER_MARGIN };
}

/**
 * How far in from each edge names keep: the depth of the border's lines and a small gap, or none
 * with no border. The ornate style's corner blocks are not counted, so a name may sit beside one.
 * @param {object} uiState
 * @returns {number} In map pixels.
 */
export function nameInset(uiState) {
    if (!uiState?.cartographyBorderEnable) return 0;
    const lines = borderLines(uiState.cartographyBorderStyle);
    const depth = lines.inner > 0 ? lines.innerMargin + lines.inner : lines.outer;
    return depth + NAME_GAP;
}
