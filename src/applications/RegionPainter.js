import { FILRODENSWMB } from "../config.js";
import { MeshIntegration } from "./MeshIntegration.js";
import { Inspector } from "./Inspector.js";
import { RegionEditor } from "./RegionEditor.js";
import { RegionPanel } from "./RegionPanel.js";
import { VectorHistory } from "./VectorHistory.js";
import { arcsForLevel } from "../mesh/BorderArcs.js";
import { BRUSH_MODES, PAINT_MODES, RegionStroke, STROKE_REFUSALS, fillExtent } from "../mesh/RegionPaint.js";
import { UNCLAIMED, regionFillColor } from "../mesh/Schema.js";
import { platform } from "../platform/index.js";

/** What each refusal to start a stroke tells the user (see RegionStroke.begin). */
const REFUSAL_MESSAGES = Object.freeze({
    [STROKE_REFUSALS.NO_REGION]: "FILRODENSWMB.UI.WarnNoActiveRegion",
    [STROKE_REFUSALS.OUTSIDE_PARENT]: "FILRODENSWMB.UI.WarnOutsideParent",
});

/** The canvas cursor for each mode while the pointer is over the map. */
const MODE_CURSORS = Object.freeze({ select: "pointer", paint: "crosshair", erase: "crosshair", fill: "cell" });

/** The toolbar label (and tooltip) of each mode. */
const MODE_LABELS = Object.freeze({
    select: "FILRODENSWMB.UI.RegionModeSelect",
    paint: "FILRODENSWMB.UI.RegionModePaint",
    erase: "FILRODENSWMB.UI.RegionModeErase",
    fill: "FILRODENSWMB.UI.RegionModeFill",
});

/** The toolbar icon for each mode. */
const MODE_ICONS = Object.freeze({ select: "select", paint: "brush", erase: "ink-eraser", fill: "format-paint" });

/** The brush radius when none has been chosen (the studio's own default brush size). */
const DEFAULT_BRUSH_RADIUS = 20;

/**
 * The Regions tool's work on the map while editing: the edit toolbar's modes (Select, Paint,
 * Erase, Fill), each press, drag and release of the primary button in them, the preview of what a
 * Fill would take, and the waters that follow each stroke.
 *
 * The canvas hands the primary button to this tool while the Regions tool is editing (see
 * StudioCanvas.pointerToolProvider), so no other canvas gesture competes with painting. The work
 * on the cells is RegionPaint's; this class turns pointer input into strokes, keeps the map drawn
 * while a stroke is under way, and records each stroke or fill as one undo step, together with the
 * territorial waters it changed (see RegionEdits.claimWaters).
 *
 * Shift held at the press inverts the mode (see RegionPaint.paintAction).
 */
export class RegionPainter {
    /** Per-studio painting state: the stroke under way, the last brush point, the pending preview. */
    static #states = new WeakMap();

    static #state(app) {
        if (!this.#states.has(app)) this.#states.set(app, { stroke: null, last: null, before: null, frame: 0, previewTimer: 0, previewShown: false, allLand: null, tool: null });
        return this.#states.get(app);
    }

    /** The mode in use (one of RegionPaint.PAINT_MODES). */
    static mode(app) {
        const mode = app.uiState.regionPaintMode;
        return PAINT_MODES.includes(mode) ? mode : "select";
    }

    /** A mode button in the edit toolbar. */
    static setMode(app, target) {
        const mode = target?.dataset.mode;
        if (!PAINT_MODES.includes(mode)) return;
        this.cancel(app);
        app.uiState.regionPaintMode = mode;
        app.canvasEngine?.updateBrushCursor(null, null, 0, false);
        app.view?.render(["editToolbar"]);
    }

    /** The toolbar's Show Everything toggle: draw every level while editing, not just the one being painted (see MeshIntegration.renderRegions). */
    static toggleShowAll(app) {
        app.uiState.regionShowAll = !app.uiState.regionShowAll;
        app._repaintVectors();
        app.view?.render(["editToolbar"]);
    }

    /** What the edit toolbar shows (see toolbar-regions.hbs). */
    static toolbarContext(app) {
        const mode = this.mode(app);
        const region = RegionPanel.activeRegion(app);
        return {
            modes: PAINT_MODES.map((value) => ({ value, active: value === mode, icon: MODE_ICONS[value], label: MODE_LABELS[value] })),
            usesBrush: BRUSH_MODES.has(mode),
            activeRegion: region ? { name: region.name, swatch: regionFillColor(region) } : null,
            activeLevel: RegionPanel.activeLevel(app)?.name ?? null,
            showAll: !!app.uiState.regionShowAll,
        };
    }

    /**
     * The canvas's pointer tool for a studio (see StudioCanvas.pointerToolProvider): one object per
     * studio, whose methods read the mode on every event.
     */
    static tool(app) {
        const state = this.#state(app);
        state.tool ??= {
            down: (x, y, event) => this.#down(app, x, y, event),
            move: (x, y, event) => this.#move(app, x, y, event),
            up: () => this.#up(app),
            hover: (x, y, event) => this.#hover(app, x, y, event),
            doubleClick: (x, y) => this.#doubleClick(app, x, y),
            leave: () => this.#leave(app),
        };
        return state.tool;
    }

    /**
     * Escape ends a stroke whose release never arrived, or else lets go of the region being edited.
     * @returns {boolean} Whether the key was used.
     */
    static handleKey(app, event) {
        if (event.key !== "Escape") return false;
        const state = this.#state(app);
        if (state.stroke) {
            this.cancel(app);
            return true;
        }
        if (!app.activeRegionId) return false;
        if (Inspector.current(app)?.kind.id === "region") Inspector.close(app);
        RegionPanel.selectRegionById(app, null, null);
        return true;
    }

    /**
     * Ends any stroke still under way, keeping what it painted as an undo step (its cells have
     * already changed), and clears the Fill preview. Called when the mode, the tool or edit mode changes.
     */
    static cancel(app) {
        const state = this.#state(app);
        if (state.stroke) this.#commit(app, state);
        this.#clearPreview(app, state);
    }

    // ------------------------------------------------------------------ pointer input

    static #down(app, x, y, event) {
        const mode = this.mode(app);
        if (mode === "select") this.#select(app, x, y);
        else if (mode === "fill") this.#fill(app, x, y, event.shiftKey);
        else this.#beginBrush(app, mode, x, y, event.shiftKey);
    }

    static #move(app, x, y, event) {
        const state = this.#state(app);
        this.#hover(app, x, y, event);
        if (!state.stroke || !state.last) return;
        state.stroke.brush(state.last.x, state.last.y, x, y, this.#radius(app));
        state.last = { x, y };
        this.#scheduleDraw(app, state);
    }

    static #up(app) {
        const state = this.#state(app);
        if (state.stroke) this.#commit(app, state);
    }

    static #hover(app, x, y, event) {
        const mode = this.mode(app);
        const engine = app.canvasEngine;
        if (!engine) return;
        engine.updateBrushCursor(x, y, this.#radius(app), BRUSH_MODES.has(mode));
        this.#setCursor(engine, MODE_CURSORS[mode]);
        if (mode === "fill") this.#schedulePreview(app, x, y, !!event?.shiftKey);
    }

    static #leave(app) {
        app.canvasEngine?.updateBrushCursor(null, null, 0, false);
        this.#clearPreview(app, this.#state(app));
    }

    /** Select mode opens the region under the pointer in the inspector (as a click does). */
    static #doubleClick(app, x, y) {
        if (this.mode(app) !== "select") return;
        const hit = this.#regionAt(app, x, y);
        if (hit) RegionEditor.open(app, hit.level.id, hit.region.id);
    }

    // ------------------------------------------------------------------ the modes

    /** The region of the level being edited under a point (or of the topmost visible level when none is being edited). */
    static #regionAt(app, x, y) {
        const session = app.meshSession;
        if (!session) return null;
        const active = RegionPanel.activeLevel(app);
        const levels = active ? [active] : [...session.levels()].filter((level) => level.visibility !== "none").reverse();
        for (const level of levels) {
            const region = session.regionAt(level.id, x, y);
            if (region) return { level, region };
        }
        return null;
    }

    /**
     * Select mode: the region under the pointer becomes the region being edited and opens in the
     * inspector; a click on unclaimed ground lets go of it and closes the inspector.
     */
    static #select(app, x, y) {
        const hit = this.#regionAt(app, x, y);
        if (hit) {
            RegionEditor.open(app, hit.level.id, hit.region.id);
            return;
        }
        if (Inspector.current(app)?.kind.id === "region") Inspector.close(app);
        RegionPanel.selectRegionById(app, null, null);
    }

    static #beginBrush(app, mode, x, y, invert) {
        const state = this.#state(app);
        const stroke = this.#startStroke(app, state, mode, x, y, invert);
        if (!stroke) return;
        state.last = { x, y };
        stroke.brush(x, y, x, y, this.#radius(app));
        this.#scheduleDraw(app, state);
    }

    static #fill(app, x, y, invert) {
        const state = this.#state(app);
        this.#clearPreview(app, state);
        const stroke = this.#startStroke(app, state, "fill", x, y, invert);
        if (!stroke) return;
        stroke.fill(x, y);
        this.#commit(app, state);
    }

    /**
     * Starts a stroke on the level being edited, into the region being edited. A refusal (no
     * region, or a child region started outside every parent region) is explained and nothing starts.
     */
    static #startStroke(app, state, mode, x, y, invert) {
        const session = app.meshSession;
        const level = RegionPanel.activeLevel(app);
        if (!session || !level) {
            platform.notify.warn(platform.i18n.localize("FILRODENSWMB.UI.WarnNoLevel"));
            return null;
        }
        const region = RegionPanel.activeRegion(app);
        const stroke = new RegionStroke(session, app.layerSets, { level, region, mode, invert });
        // A first paint of a region on a constrained child level gives it a parent region, a change
        // to the layer sets that the undo step has to bring back as well as the cells
        state.before = !stroke.erases && level.parentLevelId && level.nestingMode !== "free" ? VectorHistory.snapshot(app) : null;
        const started = stroke.begin(x, y);
        if (!started.ok) {
            const message = REFUSAL_MESSAGES[started.reason];
            if (message) platform.notify.warn(platform.i18n.localize(message));
            return null;
        }
        state.stroke = stroke;
        return stroke;
    }

    /** Ends the stroke as one undo step (with the waters that follow it), and draws what it changed. */
    static #commit(app, state) {
        const result = state.stroke.end();
        state.stroke = null;
        state.last = null;
        const entries = [...result.patches].map(([levelId, patch]) => VectorHistory.owners(levelId, patch));
        if (result.parentKeyChanged) entries.unshift(state.before);
        state.before = null;
        if (!entries.length) return;
        for (const levelId of result.patches.keys()) entries.push(RegionPanel.watersEntry(app, levelId));

        VectorHistory.push(app, VectorHistory.composite(entries));
        app.markDirty();
        app._repaintVectors();
        app.view?.render(["context"]);
        if (result.cleared) platform.notify.info(platform.i18n.format("FILRODENSWMB.UI.ChildCellsCleared", { count: result.cleared }));
    }

    // ------------------------------------------------------------------ the fill preview

    /**
     * Shows what a Fill at the pointer would take, once the pointer has rested for a moment (the
     * flood and its outline cost a few milliseconds on a large level, too much for every move).
     */
    static #schedulePreview(app, x, y, invert) {
        const state = this.#state(app);
        const view = app.root?.ownerDocument.defaultView;
        if (!view) return;
        view.clearTimeout(state.previewTimer);
        state.previewTimer = view.setTimeout(() => {
            state.previewTimer = 0;
            if (this.mode(app) !== "fill" || state.stroke) return;
            this.#showPreview(app, state, x, y, invert);
        }, FILRODENSWMB.MESH.PAINT.PREVIEW_DELAY_MS);
    }

    static #showPreview(app, state, x, y, invert) {
        const session = app.meshSession;
        const level = RegionPanel.activeLevel(app);
        const overlays = app.canvasEngine?.regionOverlays;
        if (!session || !level || !overlays) return;
        const region = RegionPanel.activeRegion(app);
        const cells = fillExtent(session, level, invert ? null : region, x, y, invert);
        if (!cells.length) {
            this.#clearPreview(app, state);
            return;
        }
        // The area's outline is its border against everything else: a two-owner level, the area
        // and the rest, traced like a level's own borders. Every cell counts as land for the
        // tracing, so the outline runs along the coast too (a level's own coast is never drawn,
        // and a fill that takes a whole island would otherwise show nothing).
        const owners = new Int32Array(session.mesh.cellCount).fill(UNCLAIMED);
        for (const cell of cells) owners[cell] = 0;
        if (state.allLand?.length !== session.mesh.cellCount) state.allLand = new Uint8Array(session.mesh.cellCount).fill(1);
        overlays.setPreview(arcsForLevel(session.mesh, owners, state.allLand));
        state.previewShown = true;
    }

    static #clearPreview(app, state) {
        const view = app.root?.ownerDocument.defaultView;
        if (view && state.previewTimer) view.clearTimeout(state.previewTimer);
        state.previewTimer = 0;
        if (!state.previewShown) return;
        state.previewShown = false;
        app.canvasEngine?.regionOverlays.setPreview([]);
    }

    // ------------------------------------------------------------------ drawing

    /** Draws the fill once per frame while a stroke is under way, however many moves arrive. */
    static #scheduleDraw(app, state) {
        if (state.frame) return;
        const view = app.root?.ownerDocument.defaultView;
        if (!view) {
            MeshIntegration.renderRegions(app);
            return;
        }
        state.frame = view.requestAnimationFrame(() => {
            state.frame = 0;
            if (app.meshSession && app.canvasEngine) MeshIntegration.renderRegions(app);
        });
    }

    /** The brush radius in map pixels. */
    static #radius(app) {
        return Number(app.uiState.brushSize) || DEFAULT_BRUSH_RADIUS;
    }

    static #setCursor(engine, cursor) {
        const canvas = engine.app?.canvas ?? engine.app?.view;
        if (canvas && canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    }
}
