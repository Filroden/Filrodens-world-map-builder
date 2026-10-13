/**
 * Touch input on the map canvas, turned into what the mouse does there.
 *
 * - One finger does what the left mouse button does: a tap is a click, a drag is a drag. Its
 *   press is held back until the finger moves or lifts, so that a second finger landing first
 *   turns the touch into a two-finger gesture without the tool having done anything.
 * - Two fingers pinch to zoom and drag to pan the map. While one finger holds an item that the
 *   mouse wheel turns and resizes (a label, decoration or pin), the second finger twists to turn
 *   it and pinches to resize it instead.
 * - A long press with one finger, without moving, is a right-click (which finishes a line or
 *   shape being drawn). A press on an item that can be turned is left alone, so it can be held
 *   for a second finger.
 * - Two taps close together are a double-click.
 * - Where the left button does nothing on the map (outside edit mode, with no crop or reference
 *   image taking the pointer), one finger pans the map.
 *
 * The canvas hands every touch pointer event here and its own handlers are called back through
 * `actions`, so mouse and pen input never pass through this class.
 */

/** How far (screen pixels) a finger may wander before a press counts as a drag. */
const TOUCH_SLOP_PX = 8;

/** How long a still finger is held (milliseconds) before it counts as a right-click. */
const LONG_PRESS_MS = 500;

/** How close in time (milliseconds) and place (screen pixels) two taps are to count as a double-click. */
const DOUBLE_TAP = Object.freeze({ MS: 300, PX: 24 });

/** How much a pinch on a held item grows or shrinks (as a ratio of the fingers' spread) for each resize step. */
const RESIZE_STEP_RATIO = 1.15;

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const angleDegrees = (a, b) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

/** The smallest turn (degrees, -180 to 180) from one angle to another. */
function turnBetween(from, to) {
    return ((((to - from + 180) % 360) + 360) % 360) - 180;
}

export class TouchGestures {
    /** The fingers on the canvas: pointer id to its current position. */
    #fingers = new Map();

    /** Fingers whose remaining moves are ignored until they lift (a long press, or a finger left over from a gesture). */
    #ignored = new Set();

    /** The one-finger press held back until it moves or lifts: { event, start }. */
    #pending = null;

    /** Whether a one-finger press has been passed on to the canvas and is under way. */
    #pressing = false;

    /** The two-finger (or one-finger pan) gesture under way: { kind: "camera"|"item", ... }. */
    #gesture = null;

    #longPressTimer = null;
    #lastTap = null;
    #actions;
    #clock;

    /**
     * @param {object} actions - What the canvas does for each kind of input.
     * @param {(event: PointerEvent) => void} actions.press - The left button pressed (at the event's place).
     * @param {(event: PointerEvent) => void} actions.move - The pointer moved with the button down.
     * @param {(event?: PointerEvent) => void} actions.release - The left button released (also when a
     *     second finger turns a press under way into a gesture).
     * @param {(event: PointerEvent) => void} actions.rightClick
     * @param {(event: PointerEvent) => void} actions.doubleClick
     * @param {(event: PointerEvent) => boolean} actions.isTurnableAt - Whether an item the wheel turns is under the event.
     * @param {() => boolean} actions.isHoldingTurnable - Whether the press under way holds such an item.
     * @param {() => boolean} actions.panByDefault - Whether one finger should pan the map.
     * @param {() => void} actions.cameraStart - A camera gesture starts.
     * @param {(from: {x, y}, to: {x, y}, ratio: number) => void} actions.camera - Moves the camera so the map point
     *     under screen point `from` (where the gesture started) is under `to`, zoomed by `ratio` since the start.
     * @param {(degrees: number, steps: number) => void} actions.turnHeld - Turns the held item by `degrees` and
     *     resizes it by `steps` (each since the last call).
     * @param {object} [clock] - Timers (the page's own by default; replaced in tests).
     */
    constructor(actions, clock = globalThis) {
        this.#actions = actions;
        this.#clock = clock;
    }

    /** A finger lands. */
    down(event) {
        this.#fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (this.#fingers.size === 1) {
            this.#hold(event);
        } else if (this.#fingers.size === 2) {
            this.#startTwoFingerGesture();
        } else {
            this.#ignored.add(event.pointerId);
        }
    }

    /** A finger moves. */
    move(event) {
        const finger = this.#fingers.get(event.pointerId);
        if (!finger || this.#ignored.has(event.pointerId)) return;
        finger.x = event.clientX;
        finger.y = event.clientY;

        if (this.#pending && distance(this.#pending.start, finger) >= TOUCH_SLOP_PX) this.#beginDrag(event);
        if (this.#gesture) this.#continueGesture();
        else if (this.#pressing) this.#actions.move(event);
    }

    /** A finger lifts (or the browser cancels it). */
    up(event, cancelled = false) {
        if (!this.#fingers.has(event.pointerId)) return;
        this.#fingers.delete(event.pointerId);

        if (this.#ignored.delete(event.pointerId)) {
            // A long press, or a finger left over from a gesture: nothing more to do
        } else if (this.#gesture) {
            this.#endGesture();
        } else if (this.#pending && !cancelled) {
            this.#tap(event);
        } else if (this.#pressing) {
            this.#pressing = false;
            this.#actions.release(event);
        }
        if (this.#fingers.size === 0) this.#reset();
    }

    /** Holds back a one-finger press, and starts the long-press timer. */
    #hold(event) {
        this.#pending = { event, start: { x: event.clientX, y: event.clientY } };
        this.#longPressTimer = this.#clock.setTimeout(() => this.#longPress(), LONG_PRESS_MS);
    }

    /** The held-back press moved: it becomes a drag (or a pan, where one finger pans). */
    #beginDrag(event) {
        const { event: press } = this.#pending;
        this.#clearPending();
        if (this.#actions.panByDefault()) {
            this.#gesture = { kind: "camera", fingers: [event.pointerId], from: { x: press.clientX, y: press.clientY }, spread: 1 };
            this.#actions.cameraStart();
            return;
        }
        this.#pressing = true;
        this.#actions.press(press);
    }

    /** The held-back press lifted without moving: a click, and with the tap before it maybe a double-click. */
    #tap(event) {
        const { event: press } = this.#pending;
        this.#clearPending();
        this.#actions.press(press);
        this.#actions.release(event);

        const now = this.#clock.performance?.now?.() ?? Date.now();
        const here = { x: event.clientX, y: event.clientY };
        const last = this.#lastTap;
        if (last && now - last.time <= DOUBLE_TAP.MS && distance(last.at, here) <= DOUBLE_TAP.PX) {
            this.#lastTap = null;
            this.#actions.doubleClick(event);
        } else {
            this.#lastTap = { time: now, at: here };
        }
    }

    #longPress() {
        this.#longPressTimer = null;
        if (!this.#pending || this.#fingers.size !== 1) return;
        const { event } = this.#pending;
        if (this.#actions.isTurnableAt(event)) return;
        this.#clearPending();
        this.#ignored.add(event.pointerId);
        this.#actions.rightClick(event);
    }

    /**
     * A second finger landed. A finger holding (or about to hold) an item the wheel turns makes it
     * a twist and pinch of that item; otherwise any one-finger press under way ends and the two
     * fingers move the camera.
     */
    #startTwoFingerGesture() {
        const pending = this.#pending;
        this.#clearPending();
        let turnsItem = false;
        if (pending && this.#actions.isTurnableAt(pending.event)) {
            this.#actions.press(pending.event);
            this.#pressing = true;
            turnsItem = true;
        } else if (this.#pressing) {
            turnsItem = this.#actions.isHoldingTurnable();
            if (!turnsItem) this.#abandonPress();
        } else if (this.#gesture) {
            // A one-finger pan becomes a two-finger pan and pinch
            this.#gesture = null;
        }

        const fingers = [...this.#fingers.keys()];
        const [a, b] = fingers.map((id) => this.#fingers.get(id));
        if (turnsItem) {
            this.#gesture = { kind: "item", fingers, angle: angleDegrees(a, b), spread: distance(a, b), steps: 0 };
        } else {
            this.#gesture = { kind: "camera", fingers, from: midpoint(a, b), spread: distance(a, b) || 1 };
            this.#actions.cameraStart();
        }
    }

    #continueGesture() {
        const points = this.#gesture.fingers.map((id) => this.#fingers.get(id));
        if (this.#gesture.kind === "camera") this.#continueCamera(points);
        else this.#continueItemTurn(points);
    }

    #continueCamera([a, b]) {
        const gesture = this.#gesture;
        if (!b) {
            this.#actions.camera(gesture.from, a, 1);
            return;
        }
        this.#actions.camera(gesture.from, midpoint(a, b), distance(a, b) / gesture.spread);
    }

    #continueItemTurn([a, b]) {
        const gesture = this.#gesture;
        const angle = angleDegrees(a, b);
        const turn = Math.round(turnBetween(gesture.angle, angle));
        const steps = Math.trunc(Math.log(distance(a, b) / gesture.spread) / Math.log(RESIZE_STEP_RATIO));
        const newSteps = steps - gesture.steps;
        if (turn === 0 && newSteps === 0) return;
        gesture.angle += turn;
        gesture.steps = steps;
        this.#actions.turnHeld(turn, newSteps);
    }

    /** A finger of the gesture lifted: the gesture ends, and any finger still down is ignored until it lifts. */
    #endGesture() {
        const wasItem = this.#gesture.kind === "item";
        this.#gesture = null;
        for (const id of this.#fingers.keys()) this.#ignored.add(id);
        if (wasItem) this.#abandonPress();
    }

    /** Ends the one-finger press under way as if the button were released. */
    #abandonPress() {
        if (!this.#pressing) return;
        this.#pressing = false;
        this.#actions.release();
    }

    #clearPending() {
        this.#pending = null;
        if (this.#longPressTimer !== null) this.#clock.clearTimeout(this.#longPressTimer);
        this.#longPressTimer = null;
    }

    #reset() {
        this.#clearPending();
        this.#ignored.clear();
        this.#gesture = null;
        this.#pressing = false;
    }
}
