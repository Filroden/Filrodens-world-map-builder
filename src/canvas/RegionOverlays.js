import { FILRODENSWMB } from "../config.js";
import { drawFlatPath } from "./RegionLevelLayers.js";

/**
 * The Regions tool's overlays on the map: the outline of the region being edited, and the dashed
 * outline of the area a Fill would take. Both are drawn in screen-pixel widths, so they are redrawn
 * whenever the zoom changes (see redraw); what they show is kept here between draws.
 */
export class RegionOverlays {
    #outline;
    #preview;
    #arcs = [];
    #previewArcs = [];
    #scale = 1;

    /**
     * @param {object} pixi - The PIXI namespace.
     */
    constructor(pixi) {
        this.#outline = new pixi.Graphics();
        this.#preview = new pixi.Graphics();
    }

    /** The display objects to add to the stage, lowest first. */
    get displayObjects() {
        return [this.#outline, this.#preview];
    }

    /**
     * Outlines a region: its border arcs (flat point arrays), or nothing for an empty list.
     * @param {Array<{points: number[]}>} arcs
     */
    setOutline(arcs) {
        this.#arcs = arcs ?? [];
        this.#drawOutline();
    }

    /**
     * Shows the area a Fill would take as a dashed outline (its border arcs), or nothing.
     * @param {Array<{points: number[]}>} arcs
     */
    setPreview(arcs) {
        this.#previewArcs = arcs ?? [];
        this.#drawPreview();
    }

    /** Draws both again for a new zoom (the stage's scale). */
    redraw(scale) {
        this.#scale = scale || 1;
        this.#drawOutline();
        this.#drawPreview();
    }

    #drawOutline() {
        const { OUTLINE_WIDTH_PX, OUTLINE_HALO_PX, OUTLINE_HALO_ALPHA } = FILRODENSWMB.MESH.PAINT;
        const graphics = this.#outline;
        graphics.clear();
        if (!this.#arcs.length) return;
        const pass = (width, color, alpha) => {
            graphics.lineStyle({ width: width / this.#scale, color, alpha });
            for (const arc of this.#arcs) drawFlatPath(graphics, arc.points, null);
        };
        pass(OUTLINE_HALO_PX, 0x000000, OUTLINE_HALO_ALPHA);
        pass(OUTLINE_WIDTH_PX, FILRODENSWMB.UI.HIGHLIGHT.COLOR, 1);
    }

    #drawPreview() {
        const { PREVIEW_WIDTH_PX, PREVIEW_DASH_PX } = FILRODENSWMB.MESH.PAINT;
        const graphics = this.#preview;
        graphics.clear();
        if (!this.#previewArcs.length) return;
        const width = PREVIEW_WIDTH_PX / this.#scale;
        const pattern = PREVIEW_DASH_PX.map((length) => length / this.#scale);
        graphics.lineStyle({ width, color: FILRODENSWMB.UI.HIGHLIGHT.COLOR, alpha: 1 });
        for (const arc of this.#previewArcs) drawFlatPath(graphics, arc.points, pattern);
    }
}
