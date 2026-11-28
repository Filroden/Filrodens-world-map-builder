import { FILRODENSWMB } from "../../../config.js";
import { ColorMath } from "../../../kernel/util/ColorMath.js";
import { drawFlatPath } from "./RegionLevelLayers.js";

/** The marker's sizes, in screen pixels (redrawn at each zoom, so they keep their size; the Map card's). */
const MARKER = Object.freeze({ RADIUS_PX: 9.5, RING_PX: 3, RIM_PX: 2, DOT_PX: 3 });

/**
 * Inspect's marks on the map (EX1): the marker at the held point (the design system's Map card:
 * a ring in the secondary accent with a dot, on a dark rim), and the outline of the feature whose
 * fold is hovered: a pin's ring, a route's or river's line, a region's border, a natural feature's
 * box. Drawn at a fixed screen size over the map, never exported.
 */
export class InspectOverlay {
    #outline;
    #marker;
    #scale = 1;
    #held = null;
    #shape = null;

    /** @param {object} pixi - The PIXI namespace. */
    constructor(pixi) {
        this.#outline = new pixi.Graphics();
        this.#marker = new pixi.Graphics();
    }

    /** The display objects to add to the stage, lowest first. */
    get displayObjects() {
        return [this.#outline, this.#marker];
    }

    /**
     * The marker at a held point, or none.
     * @param {{x: number, y: number, color: string}|null} held
     */
    setMarker(held) {
        this.#held = held;
        this.#drawMarker();
    }

    /**
     * The outline of a hovered fold's feature (see InspectKind.outline), or none.
     * @param {{ring?: {x: number, y: number, radius: number}, lines?: number[][], box?: {minX: number, minY: number, maxX: number, maxY: number}}|null} shape
     */
    setOutline(shape) {
        this.#shape = shape;
        this.#drawOutline();
    }

    /** What is marked now, for the checks: the held point and the outline's shape. */
    get marked() {
        return { held: this.#held, outline: this.#shape };
    }

    /** Draws both again for a new zoom (the stage's scale). */
    redraw(scale) {
        this.#scale = scale || 1;
        this.#drawMarker();
        this.#drawOutline();
    }

    #drawMarker() {
        const graphics = this.#marker;
        // The canvas may already be gone (the studio closing)
        if (graphics.destroyed) return;
        graphics.clear();
        const held = this.#held;
        if (!held) return;
        const size = (px) => px / this.#scale;
        const color = ColorMath.hexToPackedInt(held.color || "#f0a8ea");
        graphics.lineStyle({ width: size(MARKER.RING_PX + 2 * MARKER.RIM_PX), color: 0x000000, alpha: 0.6 });
        graphics.drawCircle(held.x, held.y, size(MARKER.RADIUS_PX));
        graphics.lineStyle({ width: size(MARKER.RING_PX), color, alpha: 1 });
        graphics.drawCircle(held.x, held.y, size(MARKER.RADIUS_PX));
        graphics.lineStyle(0);
        graphics.beginFill(color, 1);
        graphics.drawCircle(held.x, held.y, size(MARKER.DOT_PX));
        graphics.endFill();
    }

    #drawOutline() {
        const graphics = this.#outline;
        if (graphics.destroyed) return;
        graphics.clear();
        const shape = this.#shape;
        if (!shape) return;
        const { OUTLINE_WIDTH_PX, OUTLINE_HALO_PX, OUTLINE_HALO_ALPHA } = FILRODENSWMB.MESH.PAINT;
        const pass = (width, color, alpha) => {
            graphics.lineStyle({ width: width / this.#scale, color, alpha });
            for (const line of shape.lines ?? []) drawFlatPath(graphics, line, null);
            if (shape.ring) graphics.drawCircle(shape.ring.x, shape.ring.y, shape.ring.radius + 4 / this.#scale);
            if (shape.box) graphics.drawRect(shape.box.minX, shape.box.minY, shape.box.maxX - shape.box.minX, shape.box.maxY - shape.box.minY);
        };
        pass(OUTLINE_HALO_PX, 0x000000, OUTLINE_HALO_ALPHA);
        pass(OUTLINE_WIDTH_PX, FILRODENSWMB.UI.HIGHLIGHT.COLOR, 1);
    }
}
