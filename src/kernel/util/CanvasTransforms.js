/**
 * Pure maths behind the canvas's direct-manipulation gestures: moving a whole shape (a region or
 * land mask dragged by one of its nodes with Shift held) and stepping a held item's size with the
 * mouse wheel. Kept free of PIXI and Foundry so it can be checked outside Foundry, and so
 * StudioCanvas only has to deal with pointer events and drawing.
 */
export class CanvasTransforms {
    /**
     * The axis-aligned box around a list of points, or null when there are none.
     *
     * @param {Array<{x: number, y: number}>} points
     * @returns {{minX: number, minY: number, maxX: number, maxY: number}|null}
     */
    static getBounds(points) {
        if (!points?.length) return null;

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const pt of points) {
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.y > maxY) maxY = pt.y;
        }

        return { minX, minY, maxX, maxY };
    }

    /**
     * Records where a shape's points start, so every later move is worked out from these
     * starting positions rather than added on to the last one. Adding up many small moves would
     * let rounding errors build up, and would let the shape's outline change once clamping stops
     * some points but not others at the edge of the allowed area.
     *
     * Only the points move. A label that has been placed keeps its position: once placed, a
     * label is positioned only in the Labels tool or its edit dialogue, never as a side effect of
     * moving what it belongs to. A label not yet placed is drawn at the shape's centre, so it
     * follows the shape without being moved here.
     *
     * @param {{points: Array<{x: number, y: number}>}} shape  A region or land mask.
     * @param {{x: number, y: number}} start  Where the pointer pressed, in map coordinates.
     * @returns {object}  The drag record passed to moveShape.
     */
    static beginShapeDrag(shape, start) {
        return {
            start: { x: start.x, y: start.y },
            points: shape.points,
            origins: shape.points.map((pt) => ({ x: pt.x, y: pt.y })),
            bounds: CanvasTransforms.getBounds(shape.points),
        };
    }

    /**
     * Limits a move so the whole shape stays inside the allowed area. The move itself is limited,
     * not each point, so a shape pushed against the edge stops there with its outline unchanged.
     * A shape already wider than the area (possible only if it was drawn under different limits)
     * is not pushed by the limit on that axis.
     *
     * @param {{minX: number, minY: number, maxX: number, maxY: number}} bounds  The shape's starting box.
     * @param {number} dx
     * @param {number} dy
     * @param {{minX: number, minY: number, maxX: number, maxY: number}} limits  The allowed area.
     * @returns {{dx: number, dy: number}}
     */
    static clampOffset(bounds, dx, dy, limits) {
        return {
            dx: CanvasTransforms.#clampAxis(dx, bounds.minX, bounds.maxX, limits.minX, limits.maxX),
            dy: CanvasTransforms.#clampAxis(dy, bounds.minY, bounds.maxY, limits.minY, limits.maxY),
        };
    }

    static #clampAxis(delta, low, high, limitLow, limitHigh) {
        const lowest = limitLow - low;
        const highest = limitHigh - high;
        if (lowest > highest) return 0;
        return Math.max(lowest, Math.min(delta, highest));
    }

    /**
     * Moves a dragged shape to its starting position plus the pointer's movement since the
     * press, limited to the allowed area.
     *
     * @param {object} drag  The record from beginShapeDrag.
     * @param {{x: number, y: number}} pointer  The pointer now, in map coordinates.
     * @param {{minX: number, minY: number, maxX: number, maxY: number}} limits  The allowed area.
     * @returns {{dx: number, dy: number}}  The move applied.
     */
    static moveShape(drag, pointer, limits) {
        const offset = CanvasTransforms.clampOffset(drag.bounds, pointer.x - drag.start.x, pointer.y - drag.start.y, limits);

        drag.points.forEach((pt, index) => {
            pt.x = drag.origins[index].x + offset.dx;
            pt.y = drag.origins[index].y + offset.dy;
        });

        return offset;
    }

    /**
     * Steps a value up or down by whole steps, keeping it on the step grid and inside its range.
     * The result is rounded to the step's decimal places, since adding 0.1 repeatedly in binary
     * floating point drifts (0.30000000000000004), and the value is shown and saved as is.
     *
     * @param {number} value  The current value (need not be on the grid; it is snapped).
     * @param {number} steps  Whole steps to move: positive to grow, negative to shrink.
     * @param {{MIN: number, MAX: number, STEP: number}} range
     * @returns {number}
     */
    static stepValue(value, steps, range) {
        const { MIN, MAX, STEP } = range;
        const onGrid = Math.round(value / STEP) + steps;
        const clamped = Math.max(MIN, Math.min(onGrid * STEP, MAX));
        const decimals = CanvasTransforms.#decimalPlaces(STEP);
        return Number(clamped.toFixed(decimals));
    }

    /**
     * Brings an angle in degrees into the range -180 (exclusive) to 180 (inclusive) without
     * changing the direction it points. Repeated wheel turns would otherwise store angles such
     * as -725, which draw correctly but cannot be shown on a slider. Rounded to a thousandth of
     * a degree, so floating point remainders from the wrap never show as a long decimal.
     *
     * @param {number} degrees
     * @returns {number}
     */
    static normalizeAngle(degrees) {
        const FULL_TURN = 360;
        const HALF_TURN = 180;
        const PRECISION = 1000;
        const value = Number(degrees) || 0;
        let wrapped = ((value % FULL_TURN) + FULL_TURN) % FULL_TURN;
        if (wrapped > HALF_TURN) wrapped -= FULL_TURN;
        return Math.round(wrapped * PRECISION) / PRECISION;
    }

    static #decimalPlaces(step) {
        const text = String(step);
        const point = text.indexOf(".");
        return point < 0 ? 0 : text.length - point - 1;
    }
}
