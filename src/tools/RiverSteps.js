/**
 * Which steps of a procedural river's path are drawn, on the flat map and in the 3D view alike.
 *
 * A river that reaches a lake stops tracing at the pixel where it entered, the lake is filled
 * around it, and the trace carries on from the lake's outflow. Its path therefore holds steps
 * that run across or around the lake's water, and later rivers can run through an existing lake
 * too. The terrain draws a lake as water with its bed showing through, so those steps would show
 * as lines inside it.
 *
 * A step is drawn only if it joins neighbouring pixels (which drops the jump from where a river
 * entered a lake to where it flows out) and at least one of its ends is clear of the lake: dry,
 * and without lake water on any of its four sides. Counting the shore as part of the lake keeps
 * rivers off the odd dry pixels left inside a lake, where they would otherwise show as short
 * dashes; the river still meets the lake, since its step onto the shore starts on clear ground.
 */
export class RiverSteps {
    /**
     * @param {{x: number, y: number}} previous - The step's first point.
     * @param {{x: number, y: number}} point - The step's second point.
     * @param {Float32Array|null} waterMask - Each lake pixel's surface elevation, 0 elsewhere.
     * @param {number} width - Map pixel width.
     * @param {number} height - Map pixel height.
     * @returns {boolean}
     */
    static isShown(previous, point, waterMask, width, height) {
        const isNeighbourStep = Math.abs(point.x - previous.x) <= 1 && Math.abs(point.y - previous.y) <= 1;
        if (!isNeighbourStep) return false;
        if (!waterMask) return true;
        return RiverSteps.#isClear(previous, waterMask, width, height) || RiverSteps.#isClear(point, waterMask, width, height);
    }

    static #isClear({ x, y }, waterMask, width, height) {
        const isLake = (px, py) => px >= 0 && py >= 0 && px < width && py < height && waterMask[py * width + px] > 0;
        return !isLake(x, y) && !isLake(x - 1, y) && !isLake(x + 1, y) && !isLake(x, y - 1) && !isLake(x, y + 1);
    }
}
