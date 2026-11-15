import { FILRODENSWMB } from "../config.js";
import { OwnerLayer, cellsInCircle, decodeOwners, encodeOwners, mergePatchList } from "./OwnerLayer.js";
import { cellLookup } from "./Resample.js";

/**
 * The influences painted on a map: for each kind (food capacity, security), a signed value per
 * display cell, from -MAX_LEVEL to MAX_LEVEL, 0 for none. A value is an intention relative to
 * whatever the generator works out ("more fertile here", "safer here"), not a figure, so nothing
 * has to exist under the brush and the painting keeps its meaning when the terrain, cultures or
 * ages change. The generator reads them per pixel (see InfluenceLevels and pixels below).
 *
 * Each kind is an OwnerLayer whose "owners" are values, so patches and undo work as a region
 * level's do, and it is saved as the level owners are (see encodeOwners): runs of equal values,
 * which a map painted in a few places packs into a few kB even where feathered edges vary from
 * cell to cell. A kind never painted (or cleared) is not saved at all, and a map saved without
 * the field has no influences.
 *
 * Values are raised and lowered on land only (the generator reads them over land), erased anywhere.
 */

const INFLUENCES = FILRODENSWMB.GENERATOR.INFLUENCES;

/** The kinds, in the order the Influences tool lists them. */
export const INFLUENCE_KINDS = INFLUENCES.KINDS;

/** The largest value either way: a full-strength stroke's. */
export const MAX_INFLUENCE_LEVEL = INFLUENCES.LEVELS;

/** No influence: the value of every cell never painted. */
export const NO_INFLUENCE = 0;

/** A value kept within the range (a whole number from -MAX_LEVEL to MAX_LEVEL), or none for anything not a number. */
export function validLevel(level) {
    const whole = Math.trunc(Number(level));
    return Number.isFinite(whole) ? Math.max(-MAX_INFLUENCE_LEVEL, Math.min(MAX_INFLUENCE_LEVEL, whole)) : NO_INFLUENCE;
}

export class Influences {
    /** @type {Map<string, OwnerLayer>} */
    #layers = new Map();
    #cellCount;

    /**
     * @param {number} cellCount - The display mesh's cells.
     * @param {object|null} [saved] - The map's saved `influences` ({ capacity?, security? }, each an
     *     encoded value array); a kind that does not decode, or whose length is not the mesh's, is
     *     left unpainted, so a damaged or foreign field never reaches the generator.
     */
    constructor(cellCount, saved = null) {
        this.#cellCount = cellCount;
        for (const kind of INFLUENCE_KINDS) this.#layers.set(kind, new OwnerLayer(decodeKind(saved?.[kind], cellCount)));
    }

    /** A kind's layer (for its values, patches and undo). */
    layer(kind) {
        return this.#layers.get(kind) ?? null;
    }

    /** A kind's value in a cell (0 off the mesh). */
    levelAt(kind, cell) {
        const layer = this.layer(kind);
        return layer && cell >= 0 && cell < this.#cellCount ? layer.owners[cell] : NO_INFLUENCE;
    }

    /** How many cells hold a value of a kind. */
    count(kind) {
        let painted = 0;
        for (const level of this.layer(kind)?.owners ?? []) if (level !== NO_INFLUENCE) painted++;
        return painted;
    }

    /** Whether any cell holds a value of any kind (or of one kind, when given). */
    any(kind = null) {
        const kinds = kind ? [kind] : INFLUENCE_KINDS;
        return kinds.some((each) => this.layer(each)?.owners.some((level) => level !== NO_INFLUENCE));
    }

    /**
     * The map's `influences` field: each kind with any value, encoded; null when none is painted,
     * so a map never painted saves no field.
     * @returns {{capacity?: string, security?: string}|null}
     */
    encode() {
        const saved = {};
        for (const kind of INFLUENCE_KINDS) if (this.any(kind)) saved[kind] = this.encodeKind(kind);
        return Object.keys(saved).length ? saved : null;
    }

    /** One kind's values encoded (for a whole-layer undo step). */
    encodeKind(kind) {
        return encodeOwners(this.layer(kind).owners);
    }

    /** Puts back one kind's values from encodeKind's text (or clears it for null). */
    restoreKind(kind, text) {
        this.#layers.set(kind, new OwnerLayer(decodeKind(text, this.#cellCount)));
    }

    /**
     * A kind's values per pixel, as the generator reads them (see GeneratorInput): each pixel the
     * value of the display cell it lies in. Null when the kind is not painted, so an unpainted
     * map's payload carries nothing. Values fit an Int8Array (MAX_LEVEL is below 128).
     * @param {import("./MeshBuilder.js").Mesh} mesh
     * @param {string} kind
     * @returns {Int8Array|null}
     */
    pixels(mesh, kind) {
        if (!this.any(kind)) return null;
        const levels = this.layer(kind).owners;
        const raster = mesh.cellRaster;
        const out = new Int8Array(raster.length);
        for (let pixel = 0; pixel < raster.length; pixel++) out[pixel] = levels[raster[pixel]];
        return out;
    }

    /**
     * The influences moved onto another mesh (the map's mesh rebuilt) or moved with the terrain
     * (the noise panned or rescaled): each cell takes the value of the cell under its source
     * point, and a cell whose source lies off the map has none.
     * @param {import("./MeshBuilder.js").Mesh} sourceMesh
     * @param {import("./MeshBuilder.js").Mesh} targetMesh
     * @param {function(number, number): [number, number]} [toSource]
     * @returns {Influences}
     */
    resampled(sourceMesh, targetMesh, toSource = (x, y) => [x, y]) {
        const moved = new Influences(targetMesh.cellCount);
        const lookup = cellLookup(sourceMesh);
        for (const kind of INFLUENCE_KINDS) {
            if (!this.any(kind)) continue;
            const source = this.layer(kind).owners;
            const target = moved.layer(kind).owners;
            for (let cell = 0; cell < targetMesh.cellCount; cell++) {
                const [x, y] = toSource(targetMesh.siteX(cell), targetMesh.siteY(cell));
                const from = lookup(x, y);
                if (from >= 0) target[cell] = source[from];
            }
        }
        return moved;
    }
}

/** A saved kind's values, or none: any text that does not decode to the mesh's cells is no painting. */
function decodeKind(text, cellCount) {
    const none = () => new Int32Array(cellCount);
    if (typeof text !== "string" || !text) return none();
    try {
        const levels = decodeOwners(text);
        if (levels.length !== cellCount) return none();
        for (let cell = 0; cell < cellCount; cell++) levels[cell] = validLevel(levels[cell]);
        return levels;
    } catch {
        return none();
    }
}

// ------------------------------------------------------------------ painting

/** The Influences tool's modes, in toolbar order. */
export const INFLUENCE_MODES = Object.freeze(["raise", "lower", "erase"]);

/** The feather is capped just below 1, as the terrain brush's, so the fading band never has no width. */
const MAX_FEATHER = 0.99;

/**
 * Brush dabs are laid along the pointer's path this share of the radius apart (never closer than
 * half a cell), so the fade has no gaps however fast the pointer moves, and what a stroke adds
 * depends on the ground it covers, not on how many pointer events arrive.
 */
const DAB_SPACING = 0.25;

/**
 * What one dab adds at full weight, as a share of the strength: a solid brush (feather 1) passing
 * straight over a point lays 2 / DAB_SPACING dabs on it, so one such pass adds the strength there;
 * a feathered brush adds less on one pass, since its dabs near the edge weigh less.
 */
const DAB_SHARE = DAB_SPACING / 2;

/**
 * The weight a brush gives a point at `distance` from its centre: 1 out to the solid core (the
 * feather's share of the radius, as the terrain brush), then falling linearly to 0 at its edge.
 * @param {number} distance
 * @param {number} radius
 * @param {number} feather - The solid share of the radius, 0 to 1.
 */
export function brushWeight(distance, radius, feather) {
    if (distance > radius) return 0;
    const core = radius * Math.min(Math.max(0, feather), MAX_FEATHER);
    if (distance <= core) return 1;
    return (radius - distance) / (radius - core);
}

/**
 * One stroke of a kind's values, collected as a single patch for one undo step.
 *
 * As the terrain brush, the stroke builds up as the brush moves: each dab adds the strength (as a
 * share of MAX_LEVEL, times DAB_SHARE) times the brush's weight, so going back and forth adds more,
 * and the strength is how quickly it builds. Raise adds, up to the most; Lower takes away, down to
 * the least; both on land only. Erase brings any value back towards none by as much, on land and
 * water alike. Shift held at the press swaps Raise and Lower.
 *
 * Each cell's value is kept as a fraction while the stroke lasts, so a weak strength still builds
 * up over many dabs; the saved value is the whole number nearest it.
 */
export class InfluenceStroke {
    #layer;
    #land;
    #mesh;
    #direction;
    #perDab;
    #feather;
    /** Each cell's value as the stroke has made it, unrounded. */
    #current = new Map();
    /** The distance the brush has moved since its last dab, or null before the first. */
    #travelled = null;
    #patches = [];

    /**
     * @param {Influences} influences
     * @param {import("./MeshBuilder.js").Mesh} mesh
     * @param {Uint8Array|null} land - 1 for a land display cell (the session's aggregates).
     * @param {object} options
     * @param {string} options.kind - One of INFLUENCE_KINDS.
     * @param {string} options.mode - One of INFLUENCE_MODES.
     * @param {number} options.strength - How quickly the stroke builds, 0 to 1 (see DAB_SHARE).
     * @param {number} options.feather - The solid share of the brush's radius, 0 to 1.
     * @param {boolean} [options.invert] - Shift held: Raise and Lower swap.
     */
    constructor(influences, mesh, land, { kind, mode, strength, feather, invert = false }) {
        this.#layer = influences.layer(kind);
        this.#land = land;
        this.#mesh = mesh;
        this.#direction = directionOf(mode, invert);
        this.#perDab = Math.max(0, Math.min(1, Number(strength) || 0)) * MAX_INFLUENCE_LEVEL * DAB_SHARE;
        this.#feather = Number(feather) || 0;
    }

    /** Whether the stroke brings values back towards none. */
    get erases() {
        return this.#direction === 0;
    }

    /**
     * The brush moved from one point to another: a dab where the stroke starts, then one every
     * DAB_SPACING of the radius along the way, carrying the distance left over to the next move.
     */
    brush(x0, y0, x1, y1, radius) {
        const spacing = Math.max(radius * DAB_SPACING, this.#mesh.spacing / 2);
        let changed = 0;
        if (this.#travelled === null) {
            changed += this.#dabAt(x0, y0, radius);
            this.#travelled = 0;
        }
        const length = Math.hypot(x1 - x0, y1 - y0);
        let along = spacing - this.#travelled;
        while (along <= length) {
            const t = along / length;
            changed += this.#dabAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius);
            along += spacing;
        }
        this.#travelled = length - (along - spacing);
        return changed;
    }

    /**
     * The stroke's changes as one patch (each cell's value before and after), or null for none.
     * @returns {import("./OwnerLayer.js").OwnerPatch|null}
     */
    end() {
        if (!this.#patches.length) return null;
        const patch = mergePatchList(this.#patches);
        this.#patches = [];
        return patch.cells.length ? patch : null;
    }

    /** One dab at a point: every cell under it moves by the dab's share, weighted by the brush. */
    #dabAt(px, py, radius) {
        const x = clampTo(px, this.#mesh.width);
        const y = clampTo(py, this.#mesh.height);
        const changedCells = [];
        const values = [];
        for (const cell of cellsInCircle(this.#mesh, x, y, radius)) {
            if (this.#direction !== 0 && this.#land && this.#land[cell] !== 1) continue;
            const weight = brushWeight(Math.hypot(this.#mesh.siteX(cell) - x, this.#mesh.siteY(cell) - y), radius, this.#feather);
            if (weight <= 0) continue;
            const value = this.#moved(this.#current.get(cell) ?? this.#layer.owners[cell], this.#perDab * weight);
            this.#current.set(cell, value);
            changedCells.push(cell);
            values.push(Math.round(value));
        }
        const patch = this.#layer.assign(changedCells, values);
        if (patch.cells.length) this.#patches.push(patch);
        return patch.cells.length;
    }

    /** A value moved by `change`: up or down within the range, or towards none for Erase. */
    #moved(value, change) {
        if (this.#direction !== 0) return Math.max(-MAX_INFLUENCE_LEVEL, Math.min(MAX_INFLUENCE_LEVEL, value + this.#direction * change));
        return Math.sign(value) * Math.max(0, Math.abs(value) - change);
    }
}

/** +1 to raise, -1 to lower (Shift swapping the two), 0 to erase. */
function directionOf(mode, invert) {
    if (mode === "erase") return 0;
    const raise = mode === "raise" ? 1 : -1;
    return invert ? -raise : raise;
}

/** A coordinate kept on the map, so a brush half off its edge still paints the cells inside. */
function clampTo(value, size) {
    return Math.max(0, Math.min(value, size - 1));
}
