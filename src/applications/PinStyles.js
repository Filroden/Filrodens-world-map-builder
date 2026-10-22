import { FILRODENSWMB } from "../config.js";
import { VISIBILITIES } from "../mesh/Schema.js";
import { platform } from "../platform/index.js";

/**
 * Pin quick styles: a named look for a kind of point of interest (its icon, size and colour, and
 * the size, visibility and quick style of its label), with a detail level that says how prominent
 * the place is. A pin that uses a style takes those fields from it, and follows the style when it
 * is edited (the cascade), exactly as a route follows its route quick style.
 *
 * A style also says from which detail level its pins' names are drawn (`label.detailLevel`; see
 * DetailLevel.ofName). That is the style's own: it is not written onto its pins.
 *
 * Every map starts with a default set, one style per settlement or site tier (see
 * config PINS.DEFAULT_STYLES), made once when the map is created or when a map saved before pin
 * styles existed is loaded. The set is the map's own afterwards: styles can be renamed, changed,
 * deleted or added to, and an emptied set stays empty.
 */
export class PinStyles {
    /** The value a pin style select holds for "no style". */
    static NONE = "custom";

    /**
     * Gives a map its default styles when it has none yet (the registry is missing, not merely
     * empty). Nothing happens otherwise.
     * @param {object} app
     * @returns {boolean} Whether the defaults were made.
     */
    static ensure(app) {
        if (Array.isArray(app.uiState.customPinStyles)) return false;
        app.uiState.customPinStyles = this.defaults();
        return true;
    }

    /** The default style set, with fresh ids and localised names. */
    static defaults() {
        const { DEFAULT_STYLES, DEFAULT_STYLE_COLOR } = FILRODENSWMB.PINS;
        return DEFAULT_STYLES.map((tier) => ({
            id: platform.utils.randomID(),
            tier: tier.tier,
            name: platform.i18n.localize(tier.name),
            icon: tier.icon,
            scale: tier.scale,
            color: tier.color ?? DEFAULT_STYLE_COLOR,
            label: { fontSize: tier.labelSize, visibility: "all", quickStyle: tier.labelStyle ?? this.NONE, detailLevel: tier.labelDetailLevel ?? tier.detailLevel },
            detailLevel: tier.detailLevel,
        }));
    }

    /** The map's styles (an empty list before ensure has run). */
    static list(app) {
        return app.uiState.customPinStyles ?? [];
    }

    /** A style by id, or null (also for the "no style" value). */
    static find(app, id) {
        if (!id || id === this.NONE) return null;
        return this.list(app).find((style) => style.id === id) ?? null;
    }

    /**
     * A style's fields as they are written onto a pin that uses it: the icon, scale and colour,
     * and the label's size and visibility. When the style names a label quick style that the map
     * holds, the label also takes that style's look (its font, colour, width and alignment), with
     * the pin style's own label size over it, since the size is what sets the tiers apart.
     * @param {object} app
     * @param {object} style
     * @returns {{icon: string, scale: number, color: string, label: object}}
     */
    static fields(app, style) {
        const labelStyle = (app.uiState.customLabelStyles ?? []).find((candidate) => candidate.id === style.label?.quickStyle) ?? null;
        const label = labelStyle ? { quickStyle: labelStyle.id, fontFamily: labelStyle.fontFamily, fillColor: labelStyle.fillColor, maxChars: labelStyle.maxChars, justify: labelStyle.justify } : { quickStyle: this.NONE };
        label.fontSize = style.label?.fontSize ?? style.scale;
        label.visibility = VISIBILITIES.includes(style.label?.visibility) ? style.label.visibility : "all";
        return { icon: style.icon, scale: style.scale, color: style.color, label };
    }

    /**
     * Writes a style's fields onto a pin (see fields) and records the style on it. The pin's other
     * label fields (its rotation, say) are kept.
     * @param {object} app
     * @param {object} pin
     * @param {object} style
     */
    static apply(app, pin, style) {
        const { label, ...own } = this.fields(app, style);
        Object.assign(pin, own, { pinStyle: style.id });
        pin.label = { ...(pin.label ?? {}), ...label };
    }

    /** Writes a style's fields onto every pin that uses it (after the style was edited). */
    static cascade(app, style) {
        for (const pin of app.mapPins ?? []) if (pin.pinStyle === style.id) this.apply(app, pin, style);
    }

    /** Takes a deleted style off the pins that used it; they keep the look they have. */
    static disconnect(app, id) {
        for (const pin of app.mapPins ?? []) if (pin.pinStyle === id) pin.pinStyle = null;
    }

    /** How many pins use a style. */
    static usageCount(app, id) {
        return (app.mapPins ?? []).filter((pin) => pin.pinStyle === id).length;
    }

    /**
     * The bar's choice of style for new pins: a pin placed with one takes its look; with "no
     * style" it is the plain default pin (see MapStudio#handleInfrastructureClick).
     * @param {object} app
     * @returns {object|null} The chosen style.
     */
    static active(app) {
        return this.find(app, app.uiState.activePinStyle);
    }

    /** The choices a style select offers: "no style" first, then the map's styles by name. */
    static choices(app, selected) {
        const styles = [...this.list(app)].sort((a, b) => a.name.localeCompare(b.name));
        return styles.map((style) => ({ id: style.id, name: style.name, selected: style.id === selected }));
    }

    /**
     * The detail level from which a style's pins' names are drawn: its own (`label.detailLevel`),
     * else its tier's default (a style saved before it existed), else the style's own level.
     * @param {object} style
     * @returns {number|undefined}
     */
    static nameLevel(style) {
        const own = style?.label?.detailLevel;
        if (Number.isFinite(own)) return own;
        return this.tierNameLevel(style?.tier) ?? style?.detailLevel;
    }

    /** A tier's default name level (see PINS.DEFAULT_STYLES), or undefined for none. */
    static tierNameLevel(tier) {
        const seed = tier ? FILRODENSWMB.PINS.DEFAULT_STYLES.find((candidate) => candidate.tier === tier) : null;
        return seed ? (seed.labelDetailLevel ?? seed.detailLevel) : undefined;
    }

    /** The detail levels a style may have, for a select. */
    static detailLevelChoices(selected) {
        return FILRODENSWMB.PINS.DETAIL_LEVELS.map((level) => ({ value: level, label: `FILRODENSWMB.UI.PinDetailLevel${level}`, selected: level === selected }));
    }

    /** The visibility choices of a style's label, for a select. */
    static visibilityChoices(selected) {
        const labels = { all: "FILRODENSWMB.UI.VisibleToAll", gm: "FILRODENSWMB.UI.VisibleToGM", none: "FILRODENSWMB.UI.VisibleToNone" };
        return VISIBILITIES.map((value) => ({ value, label: labels[value], selected: value === (selected ?? "all") }));
    }
}
