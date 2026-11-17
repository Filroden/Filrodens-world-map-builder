import { UNCLAIMED } from "./Schema.js";
import { cellsInCircle, connectedCells } from "./OwnerLayer.js";
import { clearBelow, paintAllow, settleParentKey } from "./RegionEdits.js";

/**
 * Painting regions onto a level's land: a brush (Paint and Erase) and a bucket fill, each run as a
 * stroke (see RegionStroke) so that whatever it changes, at its own level and at the levels below,
 * ends up as one undo step.
 *
 * Regions are painted on land only. Paint and Fill give land to the region and leave water alone,
 * so a stroke along a shore never spills into the sea; what a region owns at sea follows from its
 * coast by the level's territorial waters rule (see RegionEdits.claimWaters), worked out after
 * each stroke. Erase takes cells away from any region of the level, on land and water alike, so
 * water a level no longer claims can still be cleared by hand. Shift turns Paint and Fill into
 * erasing, and Erase into painting land.
 *
 * On a constrained child level, a region only ever gains cells inside its parent region (see
 * RegionEdits.paintAllow), and the parent region is fixed the first time the region is painted
 * (see RegionEdits.settleParentKey). Every cell that changes owner clears the cells under it at the
 * constrained levels below (see RegionEdits.clearBelow), since a child region there now lies
 * outside its parent.
 */

/** The Regions tool's modes, in toolbar order. */
export const PAINT_MODES = Object.freeze(["select", "paint", "erase", "fill"]);

/** The modes that paint with the brush circle. */
export const BRUSH_MODES = Object.freeze(new Set(["paint", "erase"]));

/** Why a stroke could not start (see RegionStroke.begin). */
export const STROKE_REFUSALS = Object.freeze({ NO_REGION: "noRegion", OUTSIDE_PARENT: "outsideParent", OFF_MAP: "offMap" });

/**
 * What a mode does with Shift held or not.
 * @param {string} mode - One of PAINT_MODES other than select.
 * @param {boolean} invert - Shift held.
 * @returns {{erase: boolean}}
 */
export function paintAction(mode, invert) {
    return { erase: mode === "erase" ? !invert : invert };
}

/**
 * The cells a brush covers moving from one point to another: discs along the segment, close
 * enough together that a fast drag leaves no gaps. A brush smaller than a cell still covers the
 * cell under each disc's centre (see cellsInCircle).
 *
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number} radius - In map pixels.
 * @returns {Set<number>}
 */
export function cellsAlong(mesh, x0, y0, x1, y1, radius) {
    // Discs half a radius apart (never closer than half a cell) overlap enough to leave no gap
    const step = Math.max(radius / 2, mesh.spacing / 2);
    const length = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(length / step));
    const cells = new Set();
    let hint = mesh.cellAt(clampTo(x0, mesh.width), clampTo(y0, mesh.height));
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = clampTo(x0 + (x1 - x0) * t, mesh.width);
        const y = clampTo(y0 + (y1 - y0) * t, mesh.height);
        const disc = cellsInCircle(mesh, x, y, radius, hint);
        hint = disc[0];
        for (const cell of disc) cells.add(cell);
    }
    return cells;
}

/** A coordinate kept on the map, so a brush half off its edge still paints the cells inside. */
function clampTo(value, size) {
    return Math.max(0, Math.min(value, size - 1));
}

/**
 * The land a Fill from a point would take: the land cells connected to the cell under the point
 * through cells of the same owner (the ones a fill into `region` may change; see RegionStroke.fill).
 * Empty over water, off the map, or when the cell already belongs to the region (or is unclaimed
 * while erasing).
 *
 * @param {import("./MeshSession.js").MeshSession} session
 * @param {object} level
 * @param {object|null} region - The region being painted (null when erasing).
 * @param {number} x
 * @param {number} y
 * @param {boolean} [erase]
 * @returns {Int32Array}
 */
export function fillExtent(session, level, region, x, y, erase = false) {
    const start = session.cellAt(x, y);
    const land = session.aggregates?.land;
    if (start < 0 || !land || land[start] !== 1) return new Int32Array(0);
    const owners = session.layer(level.id).owners;
    const target = owners[start];
    const owner = erase ? UNCLAIMED : (region?.key ?? UNCLAIMED);
    if (target === owner) return new Int32Array(0);
    const allow = erase || !region ? null : paintAllow(session, level, region, start);
    const matches = (cell) => owners[cell] === target && land[cell] === 1 && (!allow || allow(cell));
    return connectedCells(session.mesh, start, matches);
}

/**
 * One paint or fill on a level: begin it at the point pressed, apply cells as the pointer moves
 * (or all at once), and end it to collect what changed for one undo step. The session records it
 * as a stroke, so borders and labels are rebuilt once at the end while the fill follows every move.
 */
export class RegionStroke {
    #session;
    #layerSets;
    #level;
    #region;
    #erase;
    #allow = null;
    #owner = UNCLAIMED;
    #cleared = 0;
    #parentKeyChanged = false;
    #started = false;

    /**
     * @param {import("./MeshSession.js").MeshSession} session
     * @param {Array} layerSets
     * @param {object} options
     * @param {object} options.level - The level painted.
     * @param {object|null} options.region - The region painted into (not needed to erase).
     * @param {string} options.mode - One of PAINT_MODES other than select.
     * @param {boolean} [options.invert] - Shift held (see paintAction).
     */
    constructor(session, layerSets, { level, region, mode, invert = false }) {
        this.#session = session;
        this.#layerSets = layerSets;
        this.#level = level;
        this.#region = region;
        this.#erase = paintAction(mode, invert).erase;
    }

    /** Whether the stroke takes cells away rather than giving them to the region. */
    get erases() {
        return this.#erase;
    }

    /**
     * Starts the stroke at a map point. A region that has never been painted on a constrained
     * child level takes the parent region under this point as its parent.
     * @returns {{ok: boolean, reason?: string}} reason is one of STROKE_REFUSALS.
     */
    begin(x, y) {
        const start = this.#session.cellAt(x, y);
        if (start < 0) return { ok: false, reason: STROKE_REFUSALS.OFF_MAP };
        if (!this.#erase && !this.#region) return { ok: false, reason: STROKE_REFUSALS.NO_REGION };

        if (!this.#erase) {
            const settled = settleParentKey(this.#session, this.#level, this.#region, start);
            if (!settled.allowed) return { ok: false, reason: STROKE_REFUSALS.OUTSIDE_PARENT };
            this.#parentKeyChanged = settled.changed;
            this.#owner = this.#region.key;
        }
        this.#allow = this.#cellTest();
        this.#session.beginStroke();
        this.#started = true;
        return { ok: true };
    }

    /** Gives (or takes away) the cells a brush covers between two points. */
    brush(x0, y0, x1, y1, radius) {
        if (!this.#started) return 0;
        return this.#apply(cellsAlong(this.#session.mesh, x0, y0, x1, y1, radius));
    }

    /** Gives (or takes away) the land a fill from a point takes (see fillExtent). */
    fill(x, y) {
        if (!this.#started) return 0;
        return this.#apply(fillExtent(this.#session, this.#level, this.#region, x, y, this.#erase));
    }

    /**
     * Ends the stroke.
     * @returns {{patches: Map<string, import("./OwnerLayer.js").OwnerPatch>, parentKeyChanged: boolean, cleared: number}}
     *     The changed cells by level (the painted level and any level below it that was cleared),
     *     whether the region was given its parent region, and how many child cells were cleared.
     */
    end() {
        if (!this.#started) return { patches: new Map(), parentKeyChanged: false, cleared: 0 };
        this.#started = false;
        return { patches: this.#session.endStroke(), parentKeyChanged: this.#parentKeyChanged, cleared: this.#cleared };
    }

    #apply(cells) {
        const layer = this.#session.layer(this.#level.id);
        const patch = layer.set(cells, this.#owner, this.#allow);
        if (!patch.cells.length) return 0;
        const record = (levelId, edit) => this.#session.strokeEdit(levelId, edit);
        record(this.#level.id, patch);
        this.#cleared += clearBelow(this.#session, this.#layerSets, this.#level.id, patch.cells, record);
        return patch.cells.length;
    }

    /** Which cells the stroke may change: land only when painting (inside the parent region on a child level); anything when erasing. */
    #cellTest() {
        if (this.#erase) return null;
        const land = this.#session.aggregates?.land;
        const nesting = paintAllow(this.#session, this.#level, this.#region);
        if (!land) return nesting;
        const isLand = (cell) => land[cell] === 1;
        return nesting ? (cell) => isLand(cell) && nesting(cell) : isLand;
    }
}
