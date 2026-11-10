import { FILRODENSWMB } from "../config.js";
import { INFLUENCE_MODES, InfluenceStroke } from "../mesh/Influences.js";
import { InfluenceView } from "./InfluenceView.js";
import { ThematicView } from "./ThematicView.js";
import { VectorHistory } from "./VectorHistory.js";

/** The canvas cursor while the pointer is over the map. */
const CURSOR = "crosshair";

/** The toolbar tooltip of each mode. */
const MODE_LABELS = Object.freeze({
    raise: "FILRODENSWMB.UI.InfluenceModeRaise",
    lower: "FILRODENSWMB.UI.InfluenceModeLower",
    erase: "FILRODENSWMB.UI.InfluenceModeErase",
});

/** The toolbar icon for each mode (Terrain's for Raise and Lower). */
const MODE_ICONS = Object.freeze({ raise: "edit-arrow-up", lower: "edit-arrow-down", erase: "ink-eraser" });

const BRUSH = FILRODENSWMB.GENERATOR.INFLUENCES.BRUSH;

/** The brush radius when none has been chosen (the studio's own default brush size). */
const DEFAULT_BRUSH_RADIUS = 20;

/**
 * The Influences tool's work on the map while editing: the edit toolbar's modes (Raise, Lower,
 * Erase) with the brush's size, strength and feather, as the terrain brush has them; each press,
 * drag and release of the primary button; and one undo step for each stroke. The brush size is
 * the studio's shared one, Shift held at the press swaps Raise and Lower, and the work on the
 * cells is done by InfluenceStroke.
 *
 * The canvas hands the primary button to this tool while the Influences tool is editing (see
 * StudioCanvas.pointerToolProvider). The overlay is drawn again once per frame while a stroke is
 * under way, and the panel (its counts and whether the run is out of date) when it ends.
 */
export class InfluencePainter {
    /** Per-studio painting state: the stroke under way, the last brush point, the pending frame. */
    static #states = new WeakMap();

    static #state(app) {
        if (!this.#states.has(app)) this.#states.set(app, { stroke: null, kind: null, last: null, frame: 0, tool: null });
        return this.#states.get(app);
    }

    /** The mode in use (one of INFLUENCE_MODES). */
    static mode(app) {
        const mode = app.uiState.influencePaintMode;
        return INFLUENCE_MODES.includes(mode) ? mode : INFLUENCE_MODES[0];
    }

    /** A mode button in the edit toolbar. */
    static setMode(app, target) {
        const mode = target?.dataset.mode;
        if (!INFLUENCE_MODES.includes(mode)) return;
        this.cancel(app);
        app.uiState.influencePaintMode = mode;
        app.canvasEngine?.updateBrushCursor(null, null, 0, false);
        app.view?.render(["editToolbar"]);
    }

    /** What the edit toolbar shows (see toolbar-influences.hbs). */
    static toolbarContext(app) {
        const mode = this.mode(app);
        return {
            modes: INFLUENCE_MODES.map((value) => ({ value, active: value === mode, icon: MODE_ICONS[value], label: MODE_LABELS[value] })),
            strength: { value: this.strength(app), ...BRUSH.STRENGTH },
            feather: { value: this.feather(app), ...BRUSH.FEATHER },
        };
    }

    /** The brush's strength: the share of the most a stroke adds at its core (INFLUENCES.BRUSH.STRENGTH). */
    static strength(app) {
        return inRange(app.uiState.influenceStrength, BRUSH.STRENGTH);
    }

    /** The brush's feather: the solid share of its radius (INFLUENCES.BRUSH.FEATHER). */
    static feather(app) {
        return inRange(app.uiState.influenceFeather, BRUSH.FEATHER);
    }

    /** The canvas's pointer tool for a studio (see StudioCanvas.pointerToolProvider): one object per studio. */
    static tool(app) {
        const state = this.#state(app);
        state.tool ??= {
            down: (x, y, event) => this.#down(app, x, y, event),
            move: (x, y) => this.#move(app, x, y),
            up: () => this.#up(app),
            hover: (x, y) => this.#hover(app, x, y),
            doubleClick: () => {},
            leave: () => app.canvasEngine?.updateBrushCursor(null, null, 0, false),
        };
        return state.tool;
    }

    /**
     * Escape ends a stroke whose release never arrived.
     * @returns {boolean} Whether the key was used.
     */
    static handleKey(app, event) {
        if (event.key !== "Escape" || !this.#state(app).stroke) return false;
        this.cancel(app);
        return true;
    }

    /**
     * Ends any stroke still under way, keeping what it painted as an undo step (its cells have
     * already changed). Called when the mode, the tool or edit mode changes.
     */
    static cancel(app) {
        const state = this.#state(app);
        if (state.stroke) this.#commit(app, state);
    }

    // ------------------------------------------------------------------ pointer input

    static #down(app, x, y, event) {
        const state = this.#state(app);
        const stroke = this.#startStroke(app, !!event?.shiftKey);
        if (!stroke) return;
        state.stroke = stroke;
        state.kind = InfluenceView.kind(app);
        state.last = { x, y };
        stroke.brush(x, y, x, y, this.#radius(app));
        this.#scheduleDraw(app, state);
    }

    static #move(app, x, y) {
        const state = this.#state(app);
        this.#hover(app, x, y);
        if (!state.stroke || !state.last) return;
        state.stroke.brush(state.last.x, state.last.y, x, y, this.#radius(app));
        state.last = { x, y };
        this.#scheduleDraw(app, state);
    }

    static #up(app) {
        const state = this.#state(app);
        if (state.stroke) this.#commit(app, state);
    }

    static #hover(app, x, y) {
        const engine = app.canvasEngine;
        if (!engine) return;
        engine.updateBrushCursor(x, y, this.#radius(app), true);
        const canvas = engine.app?.canvas ?? engine.app?.view;
        if (canvas && canvas.style.cursor !== CURSOR) canvas.style.cursor = CURSOR;
    }

    // ------------------------------------------------------------------ strokes

    /** A stroke of the chosen kind with the bar's brush, or null while the map's mesh is not ready. */
    static #startStroke(app, invert) {
        const session = app.meshSession;
        if (!session?.mesh || !session.influences) return null;
        return new InfluenceStroke(session.influences, session.mesh, session.aggregates?.land ?? null, { kind: InfluenceView.kind(app), mode: this.mode(app), strength: this.strength(app), feather: this.feather(app), invert });
    }

    /** Ends the stroke as one undo step, and draws the overlay and the panel. */
    static #commit(app, state) {
        const patch = state.stroke.end();
        state.stroke = null;
        state.last = null;
        const view = app.root?.ownerDocument.defaultView;
        if (state.frame && view) view.cancelAnimationFrame(state.frame);
        state.frame = 0;
        ThematicView.render(app);
        if (!patch) return;
        VectorHistory.push(app, VectorHistory.influence(state.kind, patch));
        app.markDirty();
        app.view?.render(["context"]);
    }

    /** Draws the overlay once per frame while a stroke is under way, however many moves arrive. */
    static #scheduleDraw(app, state) {
        if (state.frame) return;
        const view = app.root?.ownerDocument.defaultView;
        if (!view) {
            ThematicView.render(app);
            return;
        }
        state.frame = view.requestAnimationFrame(() => {
            state.frame = 0;
            if (app.meshSession && app.canvasEngine) ThematicView.render(app);
        });
    }

    /** The brush radius in map pixels. */
    static #radius(app) {
        return Number(app.uiState.brushSize) || DEFAULT_BRUSH_RADIUS;
    }
}

/** A setting kept within its range, its default when it is not a number. */
function inRange(value, { MIN, MAX, DEFAULT }) {
    const number = Number(value);
    return Number.isFinite(number) && value !== null && value !== "" ? Math.max(MIN, Math.min(MAX, number)) : DEFAULT;
}
