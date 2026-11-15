import { capacityInBackground } from "../generator/Generate.js";
import { levelFactors } from "../generator/InfluenceLevels.js";
import { panelSettings } from "../generator/GeneratorSettings.js";
import { GeneratorRevision } from "../generator/GeneratorRevision.js";
import { INFLUENCE_KINDS, MAX_INFLUENCE_LEVEL, NO_INFLUENCE } from "../mesh/Influences.js";
import { platform } from "../platform/index.js";
import { LAYERS, ThematicSource, rampLookup, scalePosition, stepOf } from "../thematic/ThematicData.js";
import { Generation } from "./Generation.js";
import { RunInputs } from "./RunInputs.js";
import { ThematicView } from "./ThematicView.js";
import { VectorHistory } from "./VectorHistory.js";

/**
 * The Influences tool (templates/tools-influences.hbs): steering Generate by painting where the
 * land should feed more or fewer people, or be safer or more dangerous, relative to whatever the
 * generator works out (see Influences), with a brush raising or lowering a value as the terrain
 * brush raises and lowers the land (see InfluencePainter). Painting is optional: Generate works
 * without any, and this is where to steer it.
 *
 * While the tool is open, the map's colour layer gives way to what the painting is judged
 * against, with the painted values tinted over it (blue above 0, red below, stronger the further
 * from 0):
 * - Food capacity over the last run's Capacity layer, or with no run of this map's mesh, the
 *   capacity worked out from the terrain alone in the background (see LandCapacity), as a run's
 *   first stage would;
 * - Security over the last run's Danger layer, or with no run the painting alone (danger comes
 *   from the realms, which only a run makes).
 *
 * Both are drawn as one byte per display cell through the thematic layer (see ThematicLayer): the
 * base value in BASE_LEVELS shades, each with TINT_BANDS tints either way, so the base shows
 * through the tint and a feathered edge fades in bands too fine to notice.
 */

/** Shades the base layer is drawn in under the tint. */
const BASE_LEVELS = 21;
/** Tints either way of none: a painted value is drawn in the band nearest it. */
const TINT_BANDS = 5;
/**
 * The tints a shade holds: -TINT_BANDS to TINT_BANDS. With no base value as a shade of its own,
 * 1 + (BASE_LEVELS + 1) x TINTS_PER_LEVEL bytes are used, which must stay within the lookup's 256.
 */
const TINTS_PER_LEVEL = 2 * TINT_BANDS + 1;
const BYTES_PER_COLOUR = 4;
const LOOKUP_SIZE = 256;
const RAMP_STEPS = 255;
const OPAQUE = 255;
/** How strongly the strongest tint covers the base; weaker bands cover it in proportion. */
const TINT_MIX = 0.75;
/** The tints: above 0 (more food, safer) and below (less food, more dangerous). */
const TINTS = Object.freeze({ up: "#2166ac", down: "#b2182b" });
/** The base layer of each kind from a run (see THEMATIC.LAYERS). */
const RUN_LAYER = Object.freeze({ capacity: "capacity", security: "danger" });
const PERCENT = 100;

/** Each value's factor, indexed by value + MAX_LEVEL (see InfluenceLevels). */
const FACTORS = levelFactors();

/** Per studio: the land's capacity worked out without a run, with what it was built from. */
const liveCapacity = new WeakMap();
/** Per studio: the combined colour lookup for the base layer last drawn (see #lookup). */
const lookups = new WeakMap();

export class InfluenceView {
    /** Whether the tool is open (its overlay takes the colour layer's place). */
    static active(app) {
        return app.activeTool === "influences";
    }

    /** The kind being painted (one of INFLUENCE_KINDS). */
    static kind(app) {
        const kind = app.uiState?.influenceKind;
        return INFLUENCE_KINDS.includes(kind) ? kind : INFLUENCE_KINDS[0];
    }

    /** The panel's choice of kind. */
    static chooseKind(app, kind) {
        if (!INFLUENCE_KINDS.includes(kind)) return;
        app.uiState.influenceKind = kind;
        this.#redraw(app);
    }

    /**
     * Clear (a kind's own button): all the painting of the kind goes, as one undo step, after a
     * confirmation. Does nothing when the kind has nothing painted.
     * @param {object} app
     * @param {string} kind
     * @param {function(string, string): Promise<boolean>} confirm - Asks the user (title, message).
     * @returns {Promise<boolean>} Whether anything was cleared.
     */
    static async clear(app, kind, confirm) {
        const influences = app.meshSession?.influences;
        if (!INFLUENCE_KINDS.includes(kind) || !influences?.any(kind)) return false;
        if (!(await confirm(platform.i18n.localize("FILRODENSWMB.UI.InfluenceClearTitle"), platform.i18n.localize(CLEAR_MESSAGES[kind])))) return false;
        const before = influences.encodeKind(kind);
        influences.restoreKind(kind, null);
        VectorHistory.push(app, VectorHistory.influenceLayer(kind, before, null));
        app.markDirty();
        this.#redraw(app);
        return true;
    }

    /** After the painting or the choices change: the overlay, and the panel (its counts and the Generate notice). */
    static #redraw(app) {
        ThematicView.render(app);
        app.view?.render(["context"]);
    }

    // ------------------------------------------------------------------ the panel

    /** What the panel shows (see tools-influences.hbs). */
    static context(app) {
        const influences = app.meshSession?.influences ?? null;
        const kind = this.kind(app);
        const base = this.#base(app, kind);
        return {
            ready: !!influences,
            kinds: INFLUENCE_KINDS.map((id) => ({ id, label: KIND_LABELS[id], hint: KIND_HINTS[id], chosen: id === kind, count: influences?.count(id) ?? 0, painted: !!influences?.any(id) })),
            kind,
            kindHint: KIND_HINTS[kind],
            legend: legendOf(kind),
            base: base.note,
            stale: !!app.modelRun && RunInputs.changed(app).includes("influences"),
        };
    }

    // ------------------------------------------------------------------ drawing

    /**
     * The overlay as the thematic layer draws it (see ThematicView.render): one byte per display
     * cell, the base shade and the painted value's tint together, with its colour lookup. Null while the map's mesh is
     * not ready.
     * @param {object} app
     * @param {number} opacity - The thematic layers' opacity.
     * @returns {{values: Uint8Array, lookup: Uint8Array, opacity: number}|null}
     */
    static display(app, opacity) {
        const session = app.meshSession;
        if (!session?.mesh || !session.influences) return null;
        const kind = this.kind(app);
        const base = this.#base(app, kind);
        const levels = session.influences.layer(kind).owners;
        const values = new Uint8Array(session.mesh.cellCount);
        for (let cell = 0; cell < values.length; cell++) values[cell] = combinedByte(base.bytes ? base.bytes[cell] : 0, levels[cell]);
        return { values, lookup: this.#lookup(app, base.layerId), opacity };
    }

    /**
     * What the painting of a kind is judged against: the bytes of a thematic layer per display
     * cell (see ThematicSource.displayBytes), the layer's id, and the note the panel shows. The
     * last run's layer when the map has one on this mesh. Otherwise, for capacity, the land's
     * capacity worked out without a run (started in the background, and drawn when it is ready);
     * for security, the Danger layer with no danger anywhere (only a run makes the realms danger
     * comes from), so the land is drawn as a layer of its own rather than showing the biomes.
     */
    static #base(app, kind) {
        const cellCount = app.meshSession?.mesh?.cellCount ?? 0;
        const layerId = RUN_LAYER[kind];
        const run = ThematicView.source(app);
        if (run?.has(layerId)) {
            const bytes = run.displayBytes(layerId);
            if (bytes.length === cellCount) return { bytes, layerId, note: BASE_NOTES[kind].run };
        }
        if (kind !== "capacity") return { bytes: this.#noDanger(app), layerId, note: BASE_NOTES[kind].none };
        const live = this.#liveCapacity(app);
        if (!live) return { bytes: null, layerId: null, note: BASE_NOTES.capacity.building };
        return { bytes: live.displayBytes(layerId), layerId, note: BASE_NOTES.capacity.live };
    }

    /** The Danger layer's bytes with no danger: every land display cell at the scale's start, the rest undrawn. */
    static #noDanger(app) {
        const land = app.meshSession?.aggregates?.land;
        if (!land) return null;
        const byte = stepOf(scalePosition(LAYERS.get(RUN_LAYER.security).scale, 0));
        return Uint8Array.from(land, (value) => (value === 1 ? byte : 0));
    }

    /**
     * The land's capacity without a run (see LandCapacity), as a thematic source on the map's
     * mesh; null while it is being worked out, which starts it. It is worked out again when what
     * it is built from changes: the mesh, the terrain, climate and rivers (counted in
     * `travelInputs`, as for Travel's network), the generator rules the map follows, and the world
     * settings (density scales what the land feeds).
     */
    static #liveCapacity(app) {
        const mesh = app.meshSession?.mesh;
        if (!mesh || !app.currentElevationData) return null;
        const inputs = `${app.travelInputs ?? 0}:${GeneratorRevision.of(app.uiState)}:${JSON.stringify(panelSettings(app.uiState.generatorSettings).world ?? {})}`;
        const cached = liveCapacity.get(app);
        if (cached?.mesh === mesh && cached.inputs === inputs) return cached.source;
        const entry = { mesh, inputs, source: null };
        liveCapacity.set(app, entry);
        capacityInBackground(() => Generation.payload(app, undefined, { influences: false }))
            .then((arrays) => {
                if (liveCapacity.get(app) !== entry) return;
                entry.source = ThematicSource.ofArrays(arrays, mesh);
                if (this.active(app)) this.#redraw(app);
            })
            .catch((error) => {
                console.error("FWMB | The land's capacity could not be worked out:", error);
                if (liveCapacity.get(app) === entry) liveCapacity.delete(app);
            });
        return null;
    }

    /** The lookup for a base layer (or none): the base ramp in BASE_LEVELS shades, each with the tints. */
    static #lookup(app, layerId) {
        const cached = lookups.get(app);
        if (cached?.layerId === layerId) return cached.lookup;
        const lookup = combinedLookup(layerId ? rampLookup(LAYERS.get(layerId).ramp) : null);
        lookups.set(app, { layerId, lookup });
        return lookup;
    }

    // ------------------------------------------------------------------ the information bar

    /**
     * The information bar's words for a display cell: what the painting there does ("Food
     * capacity: feeds 160%"), or that the cell holds none.
     * @param {object} app
     * @param {number} cell - -1 off the land.
     * @returns {string|null} Null off the land.
     */
    static readout(app, cell) {
        if (cell < 0) return null;
        const kind = this.kind(app);
        const level = app.meshSession?.influences?.levelAt(kind, cell) ?? NO_INFLUENCE;
        if (level === NO_INFLUENCE) return platform.i18n.format("FILRODENSWMB.UI.InfluenceReadoutNone", { kind: platform.i18n.localize(KIND_LABELS[kind]) });
        return platform.i18n.format(READOUTS[kind], { percent: percentOf(kind, level) });
    }
}

// ------------------------------------------------------------------ strings

const KIND_LABELS = Object.freeze({ capacity: "FILRODENSWMB.UI.InfluenceCapacity", security: "FILRODENSWMB.UI.InfluenceSecurity" });
const CLEAR_MESSAGES = Object.freeze({ capacity: "FILRODENSWMB.UI.InfluenceClearCapacity", security: "FILRODENSWMB.UI.InfluenceClearSecurity" });
const KIND_HINTS = Object.freeze({ capacity: "FILRODENSWMB.UI.InfluenceCapacityHint", security: "FILRODENSWMB.UI.InfluenceSecurityHint" });
const READOUTS = Object.freeze({ capacity: "FILRODENSWMB.UI.InfluenceReadoutCapacity", security: "FILRODENSWMB.UI.InfluenceReadoutSecurity" });
const SCALE_CAPTIONS = Object.freeze({ capacity: "FILRODENSWMB.UI.InfluenceScaleCapacity", security: "FILRODENSWMB.UI.InfluenceScaleSecurity" });

/**
 * What a value does, as a percentage: for food capacity, of the people the land feeds; for
 * security, of the strife felt there (a safer value divides it).
 */
function percentOf(kind, level) {
    const factor = FACTORS[(kind === "security" ? -level : level) + MAX_INFLUENCE_LEVEL];
    return Math.round(factor * PERCENT);
}

/**
 * The panel's key: a scale from the most lowered (red) through none (white) to the most raised
 * (blue), as the painting's tints run, with what the painting does at each end and at none.
 */
function legendOf(kind) {
    const label = (level) => platform.i18n.format("FILRODENSWMB.UI.ThematicPercent", { value: percentOf(kind, level) });
    return { caption: SCALE_CAPTIONS[kind], least: label(-MAX_INFLUENCE_LEVEL), none: label(NO_INFLUENCE), most: label(MAX_INFLUENCE_LEVEL) };
}
const BASE_NOTES = Object.freeze({
    capacity: { run: "FILRODENSWMB.UI.InfluenceBaseCapacityRun", live: "FILRODENSWMB.UI.InfluenceBaseCapacityLive", building: "FILRODENSWMB.UI.InfluenceBaseCapacityBuilding" },
    security: { run: "FILRODENSWMB.UI.InfluenceBaseDangerRun", none: "FILRODENSWMB.UI.InfluenceBaseDangerNone" },
});


// ------------------------------------------------------------------ colours

/** "#rrggbb" as [r, g, b]. */
function rgb(hex) {
    const number = Number.parseInt(hex.slice(1), 16);
    return [(number >> 16) & 0xff, (number >> 8) & 0xff, number & 0xff];
}

/**
 * A display cell's byte: 0 when it has neither a base value nor any painting; otherwise 1 + its
 * base shade (0 for no base value, then 1 to BASE_LEVELS) x TINTS_PER_LEVEL + its tint band (the
 * value's share of the most in TINT_BANDS bands either way, rounded away from none) + TINT_BANDS.
 * @param {number} baseByte - The base layer's byte (0 for no value, 1 to 255 its ramp step).
 * @param {number} level - The painted value, -MAX_LEVEL to MAX_LEVEL.
 */
export function combinedByte(baseByte, level) {
    // Rounded away from none, so the faintest painting still shows
    const share = Math.min(1, Math.abs(level) / MAX_INFLUENCE_LEVEL);
    const band = Math.sign(level) * Math.ceil(share * TINT_BANDS);
    if (!baseByte && band === 0) return 0;
    const shade = baseByte ? 1 + Math.min(BASE_LEVELS - 1, Math.floor(((baseByte - 1) * BASE_LEVELS) / RAMP_STEPS)) : 0;
    return 1 + shade * TINTS_PER_LEVEL + band + TINT_BANDS;
}

/**
 * The lookup for combinedByte's bytes: each base shade's ramp colour (from the middle of the ramp
 * steps it stands for), covered by each band's tint in proportion to its distance from none (up
 * to TINT_MIX); with no base value, the tint alone, as transparent as it is weak.
 * @param {Uint8Array|null} ramp - The base layer's lookup (see rampLookup), or null for none.
 * @returns {Uint8Array}
 */
export function combinedLookup(ramp) {
    const bytes = new Uint8Array(LOOKUP_SIZE * BYTES_PER_COLOUR);
    const up = rgb(TINTS.up);
    const down = rgb(TINTS.down);
    for (let shade = 0; shade <= BASE_LEVELS; shade++) {
        const base = shade && ramp ? baseColour(ramp, shade) : null;
        for (let band = -TINT_BANDS; band <= TINT_BANDS; band++) {
            const at = (1 + shade * TINTS_PER_LEVEL + band + TINT_BANDS) * BYTES_PER_COLOUR;
            const mix = (TINT_MIX * Math.abs(band)) / TINT_BANDS;
            const tint = band > 0 ? up : down;
            if (!base) {
                if (band !== 0) bytes.set([...tint, Math.round(mix * OPAQUE)], at);
                continue;
            }
            bytes.set([0, 1, 2].map((channel) => Math.round(base[channel] * (1 - mix) + tint[channel] * mix)), at);
            bytes[at + 3] = OPAQUE;
        }
    }
    return bytes;
}

/** A base shade's colour: the ramp's colour at the middle of the ramp steps the shade stands for. */
function baseColour(ramp, shade) {
    const step = 1 + Math.round(((shade - 0.5) / BASE_LEVELS) * (RAMP_STEPS - 1));
    const at = step * BYTES_PER_COLOUR;
    return [ramp[at], ramp[at + 1], ramp[at + 2]];
}
