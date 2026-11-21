import { ExportArea } from "./ExportScale.js";

/**
 * The export dialogue's Area (S0 step 7; board X1a): the part of the map an export draws, over the
 * dialogue's preview of the whole map, drawn in the crop's look (`fwmb-crop fwmb-crop--cutting
 * fwmb-crop--area`) as Cut regional world…'s crop is on the canvas. Drag on the preview to draw a
 * new area, inside the area to move it (inside one that fills the map, to draw anew), a corner (or on touch an edge) to resize it; with focus on
 * it, the arrow keys move it and Shift with them resizes it. A fixed aspect holds through every
 * change. The area is in map pixels, kept on the map (see ExportArea.clip).
 */
export class AreaControl {
    /** Map pixels an arrow key moves the area or resizes it by, as a share of the map's longer side. */
    static KEY_STEP = 0.01;

    /** The smallest area, as a share of the map's shorter side (and two pixels at least). */
    static MIN_SHARE = 0.02;

    #preview;
    #map;
    #area;
    #ratio = null;
    #onChange;
    #crop;
    #label;
    #drag = null;

    /**
     * @param {HTMLElement} preview - The preview of the whole map (`fwmb-export-preview`).
     * @param {object} options
     * @param {{width: number, height: number}} options.map - The map's size in pixels.
     * @param {{x: number, y: number, width: number, height: number}} options.area
     * @param {string} options.label - The area's accessible name.
     * @param {(area: object, how: {drawn: boolean, final: boolean}) => void} options.onChange -
     *     Called as the area changes: `drawn` when the reader changed it, `final` when a drag or
     *     key press has finished.
     */
    constructor(preview, { map, area, label, onChange }) {
        this.#preview = preview;
        this.#map = map;
        this.#area = ExportArea.clip(area, map);
        this.#onChange = onChange;
        const doc = preview.ownerDocument;
        this.#crop = doc.createElement("div");
        this.#crop.className = "fwmb-crop fwmb-crop--cutting fwmb-crop--area";
        this.#crop.tabIndex = 0;
        this.#crop.setAttribute("role", "group");
        this.#crop.setAttribute("aria-label", label);
        for (const corner of ["nw", "ne", "sw", "se"]) {
            const handle = doc.createElement("i");
            handle.dataset.corner = corner;
            this.#crop.append(handle);
        }
        for (const edge of ["n", "s", "w", "e"]) {
            const handle = doc.createElement("b");
            handle.className = `fwmb-crop-edge fwmb-crop-edge--${edge}`;
            handle.dataset.edge = edge;
            this.#crop.append(handle);
        }
        this.#label = doc.createElement("span");
        this.#label.className = "fwmb-crop-label";
        this.#crop.append(this.#label);
        preview.append(this.#crop);
        preview.addEventListener("pointerdown", this.#onPointerDown);
        this.#crop.addEventListener("keydown", this.#onKeyDown);
        this.#draw();
    }

    /** The area, in map pixels. */
    get area() {
        return { ...this.#area };
    }

    /** Sets the area (a preset, a nearest fit, an aspect chosen), without calling onChange. */
    set area(area) {
        this.#area = ExportArea.clip(area, this.#map);
        this.#draw();
    }

    /** The aspect held through changes (width over height), or null for Free. */
    set ratio(ratio) {
        this.#ratio = ratio || null;
    }

    /** The text in the area's corner (its size on the ground). */
    setLabel(text) {
        this.#label.textContent = text;
    }

    /** Marks the area as too large to draw (the warning edge). */
    setOver(over) {
        this.#crop.classList.toggle("fwmb-crop--over", !!over);
    }

    /** Whether the area can be changed (not while an export draws). */
    set disabled(disabled) {
        this.#preview.classList.toggle("fwmb-is-locked", !!disabled);
        this.#crop.tabIndex = disabled ? -1 : 0;
    }

    destroy() {
        this.#preview.removeEventListener("pointerdown", this.#onPointerDown);
        this.#crop.removeEventListener("keydown", this.#onKeyDown);
        this.#crop.remove();
    }

    #draw() {
        const { x, y, width, height } = this.#area;
        const map = this.#map;
        Object.assign(this.#crop.style, {
            left: `${(x / map.width) * 100}%`,
            top: `${(y / map.height) * 100}%`,
            width: `${(width / map.width) * 100}%`,
            height: `${(height / map.height) * 100}%`,
        });
        // A label low in an area at the map's foot would leave the preview: it goes to the top
        this.#crop.classList.toggle("fwmb-crop--whole", width >= map.width * 0.98 && height >= map.height * 0.98);
    }

    /** Whether the area has room to move: one that fills the map is drawn afresh by a drag inside it. */
    #movable() {
        return this.#area.width < this.#map.width || this.#area.height < this.#map.height;
    }

    #min() {
        return Math.max(2, Math.round(Math.min(this.#map.width, this.#map.height) * AreaControl.MIN_SHARE));
    }

    /** A point on the preview, in map pixels (kept on the map). */
    #toMap(event) {
        const box = this.#preview.getBoundingClientRect();
        const x = ((event.clientX - box.left) / Math.max(box.width, 1)) * this.#map.width;
        const y = ((event.clientY - box.top) / Math.max(box.height, 1)) * this.#map.height;
        return { x: Math.min(Math.max(x, 0), this.#map.width), y: Math.min(Math.max(y, 0), this.#map.height) };
    }

    #onPointerDown = (event) => {
        if (event.button !== 0 || this.#preview.classList.contains("fwmb-is-locked")) return;
        event.preventDefault();
        const point = this.#toMap(event);
        const { x, y, width, height } = this.#area;
        const corner = event.target.dataset?.corner;
        const edge = event.target.dataset?.edge;
        if (corner) {
            // The corner opposite the one held stays where it is
            this.#drag = { kind: "resize", anchor: { x: corner.includes("w") ? x + width : x, y: corner.includes("n") ? y + height : y } };
        } else if (edge) {
            this.#drag = { kind: "edge", edge, start: { ...this.#area } };
        } else if (this.#movable() && point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height) {
            this.#drag = { kind: "move", offset: { x: point.x - x, y: point.y - y } };
        } else {
            this.#drag = { kind: "resize", anchor: point, fresh: true };
        }
        this.#crop.focus({ preventScroll: true });
        this.#preview.setPointerCapture?.(event.pointerId);
        this.#preview.addEventListener("pointermove", this.#onPointerMove);
        this.#preview.addEventListener("pointerup", this.#onPointerUp);
        this.#preview.addEventListener("pointercancel", this.#onPointerUp);
    };

    #onPointerMove = (event) => {
        if (!this.#drag) return;
        const point = this.#toMap(event);
        const drag = this.#drag;
        if (drag.kind === "move") {
            this.#area = ExportArea.clip({ ...this.#area, x: point.x - drag.offset.x, y: point.y - drag.offset.y }, this.#map);
        } else if (drag.kind === "edge") {
            this.#area = this.#fromEdge(drag, point);
        } else {
            // A fresh drawing starts only once the pointer has moved: a click leaves the area alone
            if (drag.fresh && Math.hypot(point.x - drag.anchor.x, point.y - drag.anchor.y) < this.#min() / 2) return;
            drag.fresh = false;
            this.#area = this.#fromCorners(drag.anchor, point);
        }
        this.#draw();
        this.#onChange(this.area, { drawn: true, final: false });
    };

    #onPointerUp = (event) => {
        const changed = this.#drag && !this.#drag.fresh;
        this.#drag = null;
        this.#preview.releasePointerCapture?.(event.pointerId);
        this.#preview.removeEventListener("pointermove", this.#onPointerMove);
        this.#preview.removeEventListener("pointerup", this.#onPointerUp);
        this.#preview.removeEventListener("pointercancel", this.#onPointerUp);
        if (changed) this.#onChange(this.area, { drawn: true, final: true });
    };

    /** The area between a fixed corner and the pointer, at the aspect held, kept on the map. */
    #fromCorners(anchor, point) {
        const min = this.#min();
        const signX = point.x >= anchor.x ? 1 : -1;
        const signY = point.y >= anchor.y ? 1 : -1;
        // How far the area can reach from the anchor towards the pointer
        const roomX = signX > 0 ? this.#map.width - anchor.x : anchor.x;
        const roomY = signY > 0 ? this.#map.height - anchor.y : anchor.y;
        let width = Math.min(Math.max(Math.abs(point.x - anchor.x), min), Math.max(roomX, min));
        let height = Math.min(Math.max(Math.abs(point.y - anchor.y), min), Math.max(roomY, min));
        if (this.#ratio) {
            // The longer of the two pulls, then cut back to the room there is
            if (width / height > this.#ratio) height = width / this.#ratio;
            else width = height * this.#ratio;
            const fit = Math.min(1, roomX / width, roomY / height);
            width = Math.max(width * fit, min);
            height = Math.max(height * fit, min / this.#ratio);
        }
        const x = signX > 0 ? anchor.x : anchor.x - width;
        const y = signY > 0 ? anchor.y : anchor.y - height;
        return ExportArea.clip({ x, y, width, height }, this.#map);
    }

    /** The area with one edge dragged (touch), the aspect held about the other axis's centre. */
    #fromEdge({ edge, start }, point) {
        const min = this.#min();
        let { x, y, width, height } = start;
        if (edge === "e") width = Math.max(point.x - x, min);
        if (edge === "w") {
            width = Math.max(x + width - point.x, min);
            x = start.x + start.width - width;
        }
        if (edge === "s") height = Math.max(point.y - y, min);
        if (edge === "n") {
            height = Math.max(y + height - point.y, min);
            y = start.y + start.height - height;
        }
        if (this.#ratio) {
            if (edge === "e" || edge === "w") {
                const cy = start.y + start.height / 2;
                height = width / this.#ratio;
                y = cy - height / 2;
            } else {
                const cx = start.x + start.width / 2;
                width = height * this.#ratio;
                x = cx - width / 2;
            }
        }
        return ExportArea.clip({ x, y, width, height }, this.#map);
    }

    #onKeyDown = (event) => {
        const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const move = moves[event.key];
        if (!move) return;
        event.preventDefault();
        event.stopPropagation();
        const step = Math.max(1, Math.round(Math.max(this.#map.width, this.#map.height) * AreaControl.KEY_STEP));
        const area = { ...this.#area };
        if (event.shiftKey) {
            // Right and Down make it larger, Left and Up smaller, from its top-left corner
            const min = this.#min();
            area.width = Math.max(min, area.width + move[0] * step);
            area.height = Math.max(min, area.height + move[1] * step);
            if (this.#ratio) {
                if (move[0]) area.height = area.width / this.#ratio;
                else area.width = area.height * this.#ratio;
            }
            if (this.#ratio && (area.width > this.#map.width || area.height > this.#map.height)) return;
        } else {
            area.x += move[0] * step;
            area.y += move[1] * step;
        }
        this.#area = ExportArea.clip(area, this.#map);
        this.#draw();
        this.#onChange(this.area, { drawn: true, final: true });
    };
}
