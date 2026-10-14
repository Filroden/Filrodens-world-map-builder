import { FILRODENSWMB } from "../config.js";
import { ColorMath } from "../tools/ColorMath.js";
import { drawFlatPath } from "./RegionLevelLayers.js";

/**
 * The Routes tool's overlays on the map: the route being placed (its legs so far and the leg the
 * next click would add), the stroke being traced, and the waypoint handles of the route being
 * edited. Lines are drawn in the route's own colour and thickness; handles and the preview are in
 * screen-pixel sizes, so they are redrawn whenever the zoom changes (see redraw).
 */
export class RouteOverlays {
    #pixi;
    #draft;
    #handles;
    #draftState = null;
    #handleState = null;
    #scale = 1;

    /**
     * @param {object} pixi - The PIXI namespace.
     */
    constructor(pixi) {
        this.#pixi = pixi;
        this.#draft = new pixi.Graphics();
        this.#handles = new pixi.Graphics();
    }

    /** The display objects to add to the stage, lowest first. */
    get displayObjects() {
        return [this.#draft, this.#handles];
    }

    /**
     * Shows a route being placed or traced: the line of its legs so far, the dashed preview of
     * the next leg, and the stroke being traced; null hides it.
     * @param {{line: ArrayLike<number>|null, preview: ArrayLike<number>|null, stroke: ArrayLike<number>|null, color: string, thickness: number}|null} state
     *     Flat [x0, y0, ...] lines.
     */
    setDraft(state) {
        this.#draftState = state;
        this.#drawDraft();
    }

    /**
     * Shows the waypoint handles of a route: the sites of its waypoints, the one held (if any)
     * drawn larger; null hides them.
     * @param {{points: ArrayLike<number>, held: number}|null} state - Flat [x0, y0, ...] and the held index (or -1).
     */
    setHandles(state) {
        this.#handleState = state;
        this.#drawHandles();
    }

    /** Draws everything again for a new zoom (the stage's scale). */
    redraw(scale) {
        this.#scale = scale || 1;
        this.#drawDraft();
        this.#drawHandles();
    }

    #drawDraft() {
        const graphics = this.#draft;
        graphics.clear();
        const state = this.#draftState;
        if (!state) return;
        const { PREVIEW_DASH_PX } = FILRODENSWMB.MESH.PAINT;
        const color = ColorMath.hexToPackedInt(state.color || "#ffffff");
        const cap = this.#pixi.LINE_CAP.ROUND;
        const join = this.#pixi.LINE_JOIN.ROUND;
        if (state.line?.length >= 4) {
            graphics.lineStyle({ width: state.thickness + 1, color: 0x000000, alpha: 1, cap, join });
            drawFlatPath(graphics, state.line, null);
            graphics.lineStyle({ width: state.thickness, color, alpha: 1, cap, join });
            drawFlatPath(graphics, state.line, null);
        }
        if (state.preview?.length >= 4) {
            graphics.lineStyle({ width: state.thickness, color, alpha: 0.7, cap, join });
            drawFlatPath(graphics, state.preview, PREVIEW_DASH_PX.map((length) => length / this.#scale));
        }
        if (state.stroke?.length >= 4) {
            graphics.lineStyle({ width: state.thickness, color, alpha: 0.7, cap, join });
            drawFlatPath(graphics, state.stroke, null);
        }
    }

    #drawHandles() {
        const graphics = this.#handles;
        graphics.clear();
        const state = this.#handleState;
        if (!state?.points.length) return;
        const { HANDLE_PX, HANDLE_HELD_PX, HANDLE_LINE_PX } = FILRODENSWMB.MESH.ROUTE_HANDLES;
        const color = FILRODENSWMB.UI.HIGHLIGHT.COLOR;
        for (let i = 0; i + 1 < state.points.length; i += 2) {
            const held = state.held === i / 2;
            const radius = (held ? HANDLE_HELD_PX : HANDLE_PX) / this.#scale;
            graphics.lineStyle({ width: HANDLE_LINE_PX / this.#scale, color: 0x000000, alpha: 0.8 });
            graphics.beginFill(color, held ? 1 : 0.85);
            graphics.drawCircle(state.points[i], state.points[i + 1], radius);
            graphics.endFill();
        }
    }
}
