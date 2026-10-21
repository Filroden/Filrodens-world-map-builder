import { FILRODENSWMB } from "../config.js";
import { ColorMath } from "../tools/ColorMath.js";
import { FILL_STYLE, RegionMeshLayer, createCellIdTexture } from "./RegionMeshLayer.js";
import { regionFillColor } from "../mesh/Schema.js";

/**
 * Draws a map's region levels from its mesh session: for each visible level, its fill (a
 * RegionMeshLayer) under its borders (one PIXI.Graphics of the level's border arcs), in the level
 * order of the layer sets, in the canvas's regions layer.
 *
 * The display objects are kept between redraws and only what changed is redone: a level's owners
 * texture uploads only the cells changed since the last draw (see MeshSession.takeOwnerChanges),
 * its palette is rewritten (a few kB), and its borders are rebuilt only when the arcs or their
 * style change. Arcs are cached by the session until the owners or the coastline change, so a
 * redraw for any other reason (a label moved, a pin added) costs almost nothing here.
 *
 * Which levels and regions show is decided by the canvas (it knows the render pass: the
 * interactive view, the player export or the GM overlay) and passed in as `isVisible`, called the
 * same way as StudioCanvas#isVisibleInCurrentPass.
 */
export class RegionLevelLayers {
    #pixi;
    #container;
    #auxProvider;
    #levels = new Map();
    #mesh = null;
    #cellIdTexture = null;
    #fillUnavailable = false;

    /**
     * @param {object} pixi - The PIXI namespace.
     * @param {object} container - The canvas's regions layer.
     * @param {object} options
     * @param {function(): object|null} options.auxProvider - The terrain's packed texture (see TerrainCompositor.auxTexture).
     * @param {function(): number} options.maxTextureSize - The GPU's largest texture side.
     */
    constructor(pixi, container, { auxProvider, maxTextureSize }) {
        this.#pixi = pixi;
        this.#container = container;
        this.#auxProvider = auxProvider;
        this.maxTextureSize = maxTextureSize;
    }

    /**
     * Draws the levels.
     * @param {import("../mesh/MeshSession.js").MeshSession|null} session
     * @param {object} options
     * @param {function(string, string, boolean): boolean} options.isVisible - (visibility, parentVisibility, isContainer).
     * @param {number} [options.resScale] - The map's resolution scale (for levels whose borders scale with it).
     * @param {string|null} [options.focusLevelId] - A level being painted: it and its ancestors are
     *     drawn for the task, and nothing else (see describeLevels).
     */
    render(session, { isVisible, showsLevel = () => true, resScale = 1, focusLevelId = null }) {
        if (!session) {
            this.clear();
            return;
        }
        this.#adoptMesh(session.mesh);
        const drawn = describeLevels(session, isVisible, focusLevelId, showsLevel);
        const keep = new Set(drawn.map((entry) => entry.level.id));
        for (const id of [...this.#levels.keys()]) if (!keep.has(id)) this.#dropLevel(id);

        this.#container.removeChildren();
        for (const entry of drawn) {
            const view = this.#levelView(session, entry.level.id);
            this.#drawFill(session, view, entry);
            this.#drawArcs(session, view, entry, resScale);
            this.#container.addChild(view.container);
        }
    }

    /** Removes every level's display objects (another map opened, or the canvas closing). */
    clear() {
        for (const id of [...this.#levels.keys()]) this.#dropLevel(id);
        this.#container.removeChildren();
        this.#cellIdTexture?.destroy(true);
        this.#cellIdTexture = null;
        this.#mesh = null;
    }

    /** The cell-id texture belongs to one mesh; a new mesh (another map) starts afresh. */
    #adoptMesh(mesh) {
        if (this.#mesh === mesh) return;
        this.clear();
        this.#mesh = mesh;
        const limit = this.maxTextureSize();
        this.#fillUnavailable = mesh.width > limit || mesh.height > limit;
        if (this.#fillUnavailable) {
            console.warn(`FWMB | This map (${mesh.width} x ${mesh.height}) is larger than the largest texture this GPU supports (${limit}); region fills are not drawn, only their borders.`);
            return;
        }
        this.#cellIdTexture = createCellIdTexture(this.#pixi, mesh);
    }

    #levelView(session, levelId) {
        if (this.#levels.has(levelId)) return this.#levels.get(levelId);
        const PIXI = this.#pixi;
        const view = { container: new PIXI.Container(), fill: null, arcs: new PIXI.Graphics(), arcsSource: null, arcsSignature: null };
        if (!this.#fillUnavailable) {
            const { width, height, cellCount } = session.mesh;
            view.fill = new RegionMeshLayer(PIXI, { width, height, cellCount, cellIdTexture: this.#cellIdTexture, auxProvider: this.#auxProvider });
            view.fill.setOwners(session.layer(levelId).owners, "all");
            session.takeOwnerChanges(levelId);
            view.container.addChild(view.fill.displayObject);
        }
        view.container.addChild(view.arcs);
        this.#levels.set(levelId, view);
        return view;
    }

    #dropLevel(id) {
        const view = this.#levels.get(id);
        // Taken out of the container first, so destroying the container cannot destroy them twice
        view.container.removeChildren();
        view.fill?.destroy();
        view.arcs.destroy();
        view.container.destroy();
        this.#levels.delete(id);
    }

    #drawFill(session, view, { level, set, palette, opacity }) {
        if (!view.fill) return;
        const changes = session.takeOwnerChanges(level.id);
        if (changes) view.fill.setOwners(session.layer(level.id).owners, changes);
        view.fill.setPalette(palette);
        const tint = set.waterTint === false ? 0 : FILRODENSWMB.MESH.FILL.WATER_TINT_ALPHA;
        view.fill.setOpacity(opacity.fill, tint);
    }

    #drawArcs(session, view, { level, visibleKeys, exclude, opacity }, resScale) {
        const arcs = session.arcsFor(level.id, exclude);
        const style = arcStyle(level.style, resScale);
        const signature = JSON.stringify([style, [...visibleKeys].sort((a, b) => a - b)]);
        view.arcs.alpha = opacity.arcs;
        if (view.arcsSource === arcs && view.arcsSignature === signature) return;

        view.arcsSource = arcs;
        view.arcsSignature = signature;
        view.arcs.clear();
        for (const arc of arcs) {
            if (!visibleKeys.has(arc.a) && !visibleKeys.has(arc.b)) continue;
            const line = arc.cls === "land" ? style.land : style.sea;
            if (line.width <= 0) continue;
            view.arcs.lineStyle({ width: line.width, color: style.color, alpha: 1, cap: this.#pixi.LINE_CAP.ROUND, join: this.#pixi.LINE_JOIN.ROUND });
            drawFlatPath(view.arcs, arc.points, line.pattern);
        }
    }
}

// ------------------------------------------------------------------ what to draw

/**
 * The levels to draw, in order, each with its layer set, its palette (the visible regions'
 * colours and styles by key), the keys of its visible regions (borders of hidden regions are left
 * out), the levels whose borders it leaves out (its visible ancestors; see MeshSession.arcsFor)
 * and the opacity of its fill and borders.
 *
 * A level shows when its layer set and it are visible in the pass; a region when it is, under its
 * level. The visibility rules are the canvas's own (a GM-only container makes everything inside it
 * GM-only).
 *
 * While a level is being painted (`focusLevelId`), the map is drawn for that task instead: the
 * painted level at a working fill opacity (its own, or at least EDIT_FILL_OPACITY, so a
 * borders-only level still shows its regions), its ancestors as borders only (the parent region's
 * outline is there to paint inside), and nothing else, so what a stroke changes is never hidden
 * under or blended with another level. Hidden levels stay hidden.
 *
 * @param {import("../mesh/MeshSession.js").MeshSession} session
 * @param {function(string, string, boolean): boolean} isVisible
 * @param {string|null} [focusLevelId]
 * @param {function(object, object): boolean} [showsLevel] - Whether the map's detail level shows a
 *     set's level (see DetailLevel). A level being painted is shown whatever the detail level.
 */
export function describeLevels(session, isVisible, focusLevelId = null, showsLevel = () => true) {
    // A level the session no longer holds (deleted a moment ago) focuses nothing: the map is drawn as viewed
    const focus = focusLevelId && session.level(focusLevelId) ? focusLineage(session, focusLevelId) : null;
    const drawn = [];
    const shown = new Set();
    for (const set of session.layerSets) {
        if (!isVisible(set.visibility, "all", true)) continue;
        for (const level of set.levels) {
            if (focus && !focus.has(level.id)) continue;
            if (!focus && !showsLevel(set, level)) continue;
            const levelVisibility = combinedVisibility(level.visibility, set.visibility);
            if (!isVisible(levelVisibility, "all", true)) continue;
            shown.add(level.id);
            const { palette, visibleKeys } = regionPalette(level, levelVisibility, isVisible);
            const opacity = focus ? focusOpacity(level, set, level.id === focusLevelId) : viewOpacity(level, set);
            drawn.push({ level, set, palette, visibleKeys, exclude: visibleAncestors(session, level, shown), opacity });
        }
    }
    return drawn;
}

/** The level being painted and its ancestors, the only levels drawn while it is painted. */
function focusLineage(session, levelId) {
    const lineage = new Set();
    for (let id = levelId; id && !lineage.has(id); id = session.level(id)?.parentLevelId ?? null) lineage.add(id);
    return lineage;
}

/** How a level is drawn when the map is viewed: fill and borders at its own opacity times its set's. */
function viewOpacity(level, set) {
    const opacity = drawnOpacity(level, set);
    return { fill: opacity, arcs: opacity };
}

/** How a level is drawn while one is painted: the painted level at a working fill, its ancestors as borders only. */
function focusOpacity(level, set, isPainted) {
    const opacity = drawnOpacity(level, set);
    if (!isPainted) return { fill: 0, arcs: Math.max(opacity, FILRODENSWMB.MESH.PAINT.EDIT_FILL_OPACITY) };
    return { fill: Math.max(opacity, FILRODENSWMB.MESH.PAINT.EDIT_FILL_OPACITY), arcs: Math.max(opacity, FILRODENSWMB.MESH.PAINT.EDIT_FILL_OPACITY) };
}

/** A GM-only parent makes a child GM-only; hidden stays hidden. */
function combinedVisibility(visibility, parentVisibility) {
    const own = visibility || "all";
    return own !== "none" && parentVisibility === "gm" ? "gm" : own;
}

function visibleAncestors(session, level, shown) {
    const ancestors = [];
    let parentId = level.parentLevelId;
    while (parentId) {
        if (shown.has(parentId)) ancestors.push(parentId);
        parentId = session.level(parentId)?.parentLevelId ?? null;
    }
    return ancestors;
}

/**
 * The palette of a level's visible regions. A region's colour is its fill colour, or one of the
 * preset colours chosen by its key when it has none; "transparent" draws no fill (its borders
 * still show). The fill style is the region's own, or the one it was migrated with.
 */
function regionPalette(level, levelVisibility, isVisible) {
    const palette = new Map();
    const visibleKeys = new Set();
    for (const region of level.regions) {
        if (!isVisible(region.visibility, levelVisibility, false)) continue;
        visibleKeys.add(region.key);
        const fill = regionFillColor(region);
        const transparent = fill === "transparent";
        const style = FILL_STYLE[region.fillStyle ?? region.legacy?.fillStyle] ?? FILL_STYLE.solid;
        palette.set(region.key, { color: transparent ? 0 : ColorMath.hexToPackedInt(fill), alpha: transparent ? 0 : 1, style });
    }
    return { palette, visibleKeys };
}

/**
 * The opacity a level is drawn at: its own, multiplied by its layer set's, so a whole set can be
 * faded without changing the balance between its levels.
 */
function drawnOpacity(level, set) {
    const own = Number.isFinite(level.opacity) ? level.opacity : 1;
    const ofSet = Number.isFinite(set?.opacity) ? set.opacity : FILRODENSWMB.DISPLAY.REGION_OPACITY;
    return own * ofSet;
}

// ------------------------------------------------------------------ borders

/**
 * A level's border style as line widths and dash patterns (in map pixels): land borders in the
 * level's line style, sea and shore borders in its sea style. Widths are rounded to the
 * thickness step, and multiplied by the map's resolution scale when the level asks for it.
 */
export function arcStyle(style = {}, resScale = 1) {
    const { THICKNESS_STEP } = FILRODENSWMB.MESH.ARCS;
    const scale = style.scaleWithMap ? resScale : 1;
    const width = (value, fallback) => Math.max(0, Math.round((Number.isFinite(value) ? value : fallback) / THICKNESS_STEP) * THICKNESS_STEP) * scale;
    const landWidth = width(style.lineThickness, 1.5);
    const seaWidth = width(style.seaLineThickness, 0.75);
    return {
        color: ColorMath.hexToPackedInt(style.lineColor || "#ffffff"),
        land: { width: landWidth, pattern: dashPattern(style.lineStyle, landWidth) },
        sea: { width: seaWidth, pattern: dashPattern(style.seaLineStyle ?? "dashed", seaWidth) },
    };
}

/** Dash lengths (on, off, on...) for a line style, or null for a solid line. */
function dashPattern(lineStyle, lineWidth) {
    const pattern = FILRODENSWMB.MESH.ARCS.DASH[lineStyle];
    return pattern && lineWidth > 0 ? pattern.map((length) => length * lineWidth) : null;
}

/**
 * Draws a flat [x0, y0, x1, y1, ...] polyline on a Graphics, dashed when given a pattern. The dash
 * sequence carries on across the polyline's corners rather than restarting at each.
 */
export function drawFlatPath(graphics, points, pattern) {
    if (points.length < 4) return;
    graphics.moveTo(points[0], points[1]);
    if (!pattern) {
        for (let i = 2; i < points.length; i += 2) graphics.lineTo(points[i], points[i + 1]);
        return;
    }
    const dash = { index: 0, left: pattern[0], drawing: true };
    for (let i = 2; i < points.length; i += 2) dashSegment(graphics, points[i - 2], points[i - 1], points[i], points[i + 1], pattern, dash);
}

function dashSegment(graphics, x0, y0, x1, y1, pattern, dash) {
    let x = x0;
    let y = y0;
    let remaining = Math.hypot(x1 - x0, y1 - y0);
    while (remaining > 0) {
        const step = Math.min(remaining, dash.left);
        const share = step / remaining;
        x += (x1 - x) * share;
        y += (y1 - y) * share;
        if (dash.drawing) graphics.lineTo(x, y);
        else graphics.moveTo(x, y);
        remaining -= step;
        dash.left -= step;
        if (dash.left <= 0) {
            dash.index = (dash.index + 1) % pattern.length;
            dash.left = pattern[dash.index];
            dash.drawing = !dash.drawing;
        }
    }
}
