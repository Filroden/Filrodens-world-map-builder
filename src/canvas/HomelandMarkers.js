import { ColorMath } from "../tools/ColorMath.js";

/** A marker's radius and outline, in screen pixels (redrawn at each zoom, so they keep their size). */
const RADIUS_PX = 7;
const RING_PX = 3;
const OUTLINE_PX = 1.5;

/**
 * The cultures' homelands on the map while the Generate tool is open (see CultureMarkers): each a
 * round marker in its culture's colour, filled where the reader put it and hollow where the last
 * run placed it. Drawn at a fixed screen size over everything else, and never exported.
 */
export class HomelandMarkers {
    #graphics;
    #markers = [];
    #scale = 1;

    /** @param {object} pixi - The PIXI namespace. */
    constructor(pixi) {
        this.#graphics = new pixi.Graphics();
    }

    /** The display objects to add to the stage. */
    get displayObjects() {
        return [this.#graphics];
    }

    /**
     * Shows these markers (none hides them).
     * @param {{x: number, y: number, color: string, filled: boolean}[]} markers
     */
    set(markers) {
        this.#markers = markers ?? [];
        this.#draw();
    }

    /** Draws them again for a new zoom (the stage's scale). */
    redraw(scale) {
        this.#scale = scale || 1;
        this.#draw();
    }

    #draw() {
        const graphics = this.#graphics;
        graphics.clear();
        const size = (px) => px / this.#scale;
        for (const marker of this.#markers) {
            const color = ColorMath.hexToPackedInt(marker.color || "#ffffff");
            // A dark rim, so a marker reads on any ground
            graphics.lineStyle({ width: size(OUTLINE_PX), color: 0x000000, alpha: 0.9 });
            if (marker.filled) {
                graphics.beginFill(color, 1);
                graphics.drawCircle(marker.x, marker.y, size(RADIUS_PX));
                graphics.endFill();
            } else {
                graphics.drawCircle(marker.x, marker.y, size(RADIUS_PX + RING_PX / 2));
                graphics.drawCircle(marker.x, marker.y, size(RADIUS_PX - RING_PX / 2));
                graphics.lineStyle({ width: size(RING_PX), color, alpha: 1 });
                graphics.drawCircle(marker.x, marker.y, size(RADIUS_PX));
            }
        }
    }
}
