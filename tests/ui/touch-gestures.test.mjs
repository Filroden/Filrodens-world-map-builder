// Touch input on the map canvas (src/canvas/TouchGestures.js): what each finger gesture turns into
// in the mouse's terms, with a recorder standing in for the canvas and a clock moved by hand.
import assert from "node:assert/strict";
import { test } from "node:test";

const { TouchGestures } = await import("../../src/canvas/TouchGestures.js");

/** A clock whose time and timers move only when told to. */
function manualClock() {
    let now = 0;
    let timers = [];
    return {
        performance: { now: () => now },
        setTimeout: (fn, ms) => {
            const timer = { fn, at: now + ms };
            timers.push(timer);
            return timer;
        },
        clearTimeout: (timer) => {
            timers = timers.filter((other) => other !== timer);
        },
        advance(ms) {
            now += ms;
            const due = timers.filter((timer) => timer.at <= now);
            timers = timers.filter((timer) => timer.at > now);
            for (const timer of due) timer.fn();
        },
    };
}

/** Touch gestures over a recorder of what the canvas is asked to do. */
function setUp({ turnable = false, holdingTurnable = false, panByDefault = false } = {}) {
    const calls = [];
    const clock = manualClock();
    const record = (name) => (...args) => calls.push([name, ...args.map((arg) => (arg?.pointerId === undefined ? arg : `#${arg.pointerId}@${arg.clientX},${arg.clientY}`))]);
    const touch = new TouchGestures(
        {
            press: record("press"),
            move: record("move"),
            release: record("release"),
            rightClick: record("rightClick"),
            doubleClick: record("doubleClick"),
            isTurnableAt: () => turnable,
            isHoldingTurnable: () => holdingTurnable,
            panByDefault: () => panByDefault,
            cameraStart: record("cameraStart"),
            camera: (from, to, ratio) => calls.push(["camera", from, to, Math.round(ratio * 100) / 100]),
            turnHeld: record("turnHeld"),
        },
        clock,
    );
    return { touch, calls, clock };
}

const finger = (pointerId, clientX, clientY) => ({ pointerId, clientX, clientY });
const names = (calls) => calls.map(([name]) => name);

test("a tap is a click where the finger landed", () => {
    const { touch, calls } = setUp();
    touch.down(finger(1, 100, 100));
    assert.deepEqual(calls, [], "nothing happens until the finger moves or lifts");
    touch.up(finger(1, 102, 101));
    assert.deepEqual(calls, [["press", "#1@100,100"], ["release", "#1@102,101"]]);
});

test("a drag presses where the finger landed, then follows it", () => {
    const { touch, calls } = setUp();
    touch.down(finger(1, 100, 100));
    touch.move(finger(1, 104, 100));
    assert.deepEqual(calls, [], "small wobbles are not a drag");
    touch.move(finger(1, 120, 100));
    touch.move(finger(1, 140, 100));
    touch.up(finger(1, 140, 100));
    assert.deepEqual(calls, [["press", "#1@100,100"], ["move", "#1@120,100"], ["move", "#1@140,100"], ["release", "#1@140,100"]]);
});

test("two taps close together are a double-click; far apart or slow they are not", () => {
    const { touch, calls, clock } = setUp();
    touch.down(finger(1, 100, 100));
    touch.up(finger(1, 100, 100));
    clock.advance(200);
    touch.down(finger(2, 105, 103));
    touch.up(finger(2, 105, 103));
    assert.deepEqual(names(calls), ["press", "release", "press", "release", "doubleClick"]);

    calls.length = 0;
    clock.advance(1000);
    touch.down(finger(3, 100, 100));
    touch.up(finger(3, 100, 100));
    clock.advance(500);
    touch.down(finger(4, 100, 100));
    touch.up(finger(4, 100, 100));
    assert.equal(names(calls).includes("doubleClick"), false, "too slow");
});

test("a long press is a right-click, and the finger does nothing more until it lifts", () => {
    const { touch, calls, clock } = setUp();
    touch.down(finger(1, 100, 100));
    clock.advance(500);
    assert.deepEqual(names(calls), ["rightClick"]);
    touch.move(finger(1, 160, 100));
    touch.up(finger(1, 160, 100));
    assert.deepEqual(names(calls), ["rightClick"]);
});

test("a long press on an item that turns is held for a second finger, not a right-click", () => {
    const { touch, calls, clock } = setUp({ turnable: true });
    touch.down(finger(1, 100, 100));
    clock.advance(800);
    assert.deepEqual(calls, []);
});

test("two fingers pinch and pan the camera, and the tool never sees the first finger", () => {
    const { touch, calls } = setUp();
    touch.down(finger(1, 100, 100));
    touch.down(finger(2, 200, 100));
    touch.move(finger(2, 300, 100));
    touch.move(finger(1, 100, 150));
    touch.up(finger(1, 100, 150));
    touch.move(finger(2, 400, 100));
    touch.up(finger(2, 400, 100));
    assert.deepEqual(calls, [
        ["cameraStart"],
        ["camera", { x: 150, y: 100 }, { x: 200, y: 100 }, 2],
        ["camera", { x: 150, y: 100 }, { x: 200, y: 125 }, 2.06],
    ]);
});

test("a second finger during a drag ends the drag, then moves the camera", () => {
    const { touch, calls } = setUp();
    touch.down(finger(1, 100, 100));
    touch.move(finger(1, 130, 100));
    touch.down(finger(2, 230, 100));
    assert.deepEqual(names(calls), ["press", "move", "release", "cameraStart"]);
});

test("a second finger on a held item twists to turn it and pinches to resize it", () => {
    const { touch, calls } = setUp({ turnable: true });
    touch.down(finger(1, 100, 100));
    touch.down(finger(2, 200, 100));
    // A quarter turn clockwise (screen y grows downwards), spread unchanged
    touch.move(finger(2, 100, 200));
    // Spread doubled: four whole steps of 15%
    touch.move(finger(2, 100, 300));
    touch.up(finger(2, 100, 300));
    touch.up(finger(1, 100, 100));
    assert.deepEqual(calls, [["press", "#1@100,100"], ["turnHeld", 90, 0], ["turnHeld", 0, 4], ["release"]]);
});

test("where one finger pans by default, a one-finger drag moves the camera", () => {
    const { touch, calls } = setUp({ panByDefault: true });
    touch.down(finger(1, 100, 100));
    touch.move(finger(1, 130, 120));
    touch.up(finger(1, 130, 120));
    assert.deepEqual(calls, [["cameraStart"], ["camera", { x: 100, y: 100 }, { x: 130, y: 120 }, 1]]);
});

test("a cancelled finger is not a tap", () => {
    const { touch, calls } = setUp();
    touch.down(finger(1, 100, 100));
    touch.up(finger(1, 100, 100), true);
    assert.deepEqual(calls, []);
});
