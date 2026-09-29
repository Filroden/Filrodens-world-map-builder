/**
 * A label's maximum width, measured in characters.
 *
 * A label wraps its text once a line would be wider than `maxChars` characters of its own font
 * at its own size, where a character is the width of the digit "0" (the same definition as the
 * CSS `ch` unit). Because the width is worked out from the label's font and size each time it is
 * drawn, a label keeps the same line breaks when it is resized or given another font. In a
 * proportional font most letters are narrower than "0", so a line usually holds a few more
 * letters than `maxChars`; words are never split. 0 means no limit.
 *
 * Labels saved before this unit existed store `maxWidth` instead: a width in pixels on a
 * 1000 pixel map, scaled with the map like everything else. migrateLabel converts it to
 * characters once, rounding up, so an existing label is never made narrower than it was and
 * none of its lines break earlier than before.
 *
 * Measuring a font needs PIXI, which only exists in Foundry. The measurement can be replaced
 * with setMeasurer so the conversions can be checked outside Foundry.
 */
export class LabelWidth {
    // The character whose width defines one unit, as for CSS `ch`
    static #SAMPLE = "0";
    // Fonts are measured at this size and the result divided by it, for precision
    static #SAMPLE_SIZE_PX = 100;
    // Allows for floating point noise, so an exact whole number of characters is not rounded
    // up to the next one
    static #ROUNDING_TOLERANCE = 1e-6;
    // Labels are drawn bold (see StudioCanvas#renderLabels), which is wider than regular
    static #FONT_WEIGHT = "bold";
    // The browser's usual root font size, used when the page cannot be read
    static #DEFAULT_ROOT_FONT_PX = 16;

    /** Width of "0" as a share of the font size, by font family. */
    static #ratios = new Map();
    static #measurer = null;

    /**
     * Replaces how a font's "0" is measured. Used by checks outside Foundry.
     *
     * @param {((fontFamily: string, fontSizePx: number) => number)|null} measurer  Returns the
     *   width in pixels of "0" in bold at the given size, or null to use PIXI again.
     */
    static setMeasurer(measurer) {
        LabelWidth.#measurer = measurer;
        LabelWidth.#ratios.clear();
    }

    /**
     * The width of one character (a bold "0") in a font, as a share of the font size. The same
     * for every size of that font, so it is measured once per font and remembered.
     *
     * @param {string} fontFamily
     * @returns {number}
     */
    static charRatio(fontFamily) {
        const cached = LabelWidth.#ratios.get(fontFamily);
        if (cached) return cached;

        const width = (LabelWidth.#measurer ?? LabelWidth.#measureWithPixi)(fontFamily, LabelWidth.#SAMPLE_SIZE_PX);
        const ratio = width / LabelWidth.#SAMPLE_SIZE_PX;
        // A web font still loading is measured in its fallback font. That result is used for now
        // (the label is drawn in the fallback too) but not remembered, so the real font is
        // measured once it has loaded.
        if (LabelWidth.#measurer || LabelWidth.#isFontReady(fontFamily)) LabelWidth.#ratios.set(fontFamily, ratio);
        return ratio;
    }

    static #isFontReady(fontFamily) {
        try {
            return globalThis.document?.fonts?.check?.(`${LabelWidth.#FONT_WEIGHT} ${LabelWidth.#SAMPLE_SIZE_PX}px "${fontFamily}"`) ?? true;
        } catch {
            return true;
        }
    }

    /**
     * The page's root font size in pixels, which a label's font size setting multiplies (as the
     * CSS rem unit does).
     *
     * @returns {number}
     */
    static rootFontSize() {
        const element = globalThis.document?.documentElement;
        if (!element) return LabelWidth.#DEFAULT_ROOT_FONT_PX;
        return Number.parseFloat(getComputedStyle(element).fontSize) || LabelWidth.#DEFAULT_ROOT_FONT_PX;
    }

    static #measureWithPixi(fontFamily, fontSizePx) {
        const style = new PIXI.TextStyle({ fontFamily, fontSize: fontSizePx, fontWeight: LabelWidth.#FONT_WEIGHT });
        return PIXI.TextMetrics.measureText(LabelWidth.#SAMPLE, style).width;
    }

    /**
     * The wrap width in pixels for a label drawn at a given font size, or 0 for no wrapping.
     * A label still holding only a legacy pixel width (not yet converted) keeps wrapping at that
     * width, scaled with the map.
     *
     * @param {{maxChars?: number, maxWidth?: number, fontFamily?: string}} label
     * @param {number} fontSizePx  The size the label is drawn at.
     * @param {number} resScale  The map's size scale (1 on a 1000 pixel map).
     * @returns {number}
     */
    static wrapWidth(label, fontSizePx, resScale) {
        const maxChars = Number(label.maxChars) || 0;
        if (maxChars > 0) return maxChars * LabelWidth.charRatio(LabelWidth.#fontOf(label)) * fontSizePx;

        const legacyPx = label.maxChars === undefined ? Number(label.maxWidth) || 0 : 0;
        return legacyPx > 0 ? legacyPx * resScale : 0;
    }

    /**
     * How many characters a legacy pixel width holds for a label's font and size, rounded up.
     * The map's size scale applies to both the old width and the font, so it cancels out and
     * the result is the same on any map size.
     *
     * @param {number} legacyPx  The old width, in pixels on a 1000 pixel map.
     * @param {string} fontFamily
     * @param {number} fontSizeRem  The label's font size setting.
     * @param {number} rootFontPx  The page's root font size, which labels' font sizes multiply.
     * @returns {number}
     */
    static pixelsToChars(legacyPx, fontFamily, fontSizeRem, rootFontPx) {
        if (!(legacyPx > 0)) return 0;
        const charPx = LabelWidth.charRatio(fontFamily) * (fontSizeRem || 1) * rootFontPx;
        if (!(charPx > 0)) return 0;
        return Math.max(1, Math.ceil(legacyPx / charPx - LabelWidth.#ROUNDING_TOLERANCE));
    }

    /**
     * Converts one label, or label quick style, from a pixel width to a character width, in
     * place. Anything already in characters is left alone, so this is safe to run again.
     *
     * @param {object|null|undefined} label  Holds maxWidth/maxChars, fontFamily and fontSize.
     * @param {number} rootFontPx
     * @returns {boolean}  Whether it was converted.
     */
    static migrateLabel(label, rootFontPx) {
        if (!label || typeof label !== "object" || label.maxChars !== undefined) return false;
        if (label.maxWidth === undefined) return false;

        label.maxChars = LabelWidth.pixelsToChars(Number(label.maxWidth) || 0, LabelWidth.#fontOf(label), Number(label.fontSize) || 1, rootFontPx);
        delete label.maxWidth;
        return true;
    }

    /**
     * Converts every label on a map, and its label quick styles, to character widths: custom
     * labels (width on the label itself) and the labels attached to pins, routes and regions
     * (width on their `label`).
     *
     * @param {{mapLabels?: object[], mapPins?: object[], mapRoutes?: object[], regionLayers?: object[], customLabelStyles?: object[]}} data
     * @param {number} rootFontPx
     * @returns {number}  How many were converted.
     */
    static migrateMap(data, rootFontPx) {
        const regions = (data.regionLayers ?? []).flatMap((layer) => layer.regions ?? []);
        const labels = [
            ...(data.mapLabels ?? []),
            ...(data.customLabelStyles ?? []),
            ...[...(data.mapPins ?? []), ...(data.mapRoutes ?? []), ...regions].map((owner) => owner.label),
        ];
        return labels.filter((label) => LabelWidth.migrateLabel(label, rootFontPx)).length;
    }

    static #fontOf(label) {
        return label.fontFamily || "Signika";
    }
}
