// What a tutorial step can do in the studio, and how each is described in the video script.
//
// Every action works the studio the way a reader does, through its controls and the map, and
// fails with a message naming the step when it cannot: a control that is missing, hidden or
// covered, a map point under an overlay, a dialogue that does not open. That is the runner's
// point: a change to the interface that breaks a tutorial step breaks the run.
//
// An action is a plain object, { do: "<kind>", ...its fields, label? }. `label` is the reader's
// name for the control (the video script says "Click Create new map" from it); without one the
// script falls back to a description built from the fields.
import { mapToScreen, settle } from "./studio.mjs";

/** Longer than the studio's shortest time between two brush stamps (100 ms). */
const BRUSH_STAMP_MS = 160;

/** The studio's zoom per wheel notch, and how much of the map a framed rectangle fills. */
const WHEEL_FACTOR = 1.1;
const FRAME_FILL = 0.9;

/** How long to wait for a control or a dialogue before the step fails. */
const FIND_MS = 60000;

/** The first visible element a target names: a CSS selector, { role, name }, or { text }. */
function locate(page, target) {
    let locator;
    if (typeof target === "string") locator = page.locator(target);
    else if (target?.role) locator = page.getByRole(target.role, { name: target.name, exact: target.exact ?? true });
    else if (target?.text) locator = page.getByText(target.text, { exact: target.exact ?? true });
    else throw new Error(`cannot find ${JSON.stringify(target)}: give a selector, { role, name } or { text }`);
    return locator.filter({ visible: true }).first();
}

function describeTarget(target) {
    if (typeof target === "string") return target;
    return target?.name ?? target?.text ?? JSON.stringify(target);
}

/** Clicks a control once the studio's work overlay has gone, failing (rather than forcing it) if something else covers it. */
async function clickControl(page, target, options = {}) {
    await noWorkShowing(page);
    const element = locate(page, target);
    await element.waitFor({ state: "visible", timeout: FIND_MS });
    await element.click({ timeout: FIND_MS, ...options });
}

/** Waits while the studio's work overlay covers the map (a reader waits for it too). */
function noWorkShowing(page) {
    return page.locator(".fwmb-processing-overlay").waitFor({ state: "hidden", timeout: 180000 });
}

/**
 * Where a map pixel is on the screen, once no work overlay covers it: the overlay comes and goes
 * as the studio works, and a reader simply waits for it. Anything else covering the point is
 * reported as it is.
 */
async function reachMap(page, x, y) {
    for (;;) {
        const at = await mapToScreen(page, x, y);
        if (at.onMap || !at.covering?.includes("fwmb-processing")) return at;
        await noWorkShowing(page);
    }
}

/** Clicks a map pixel, failing if the point is off the screen or under an overlay. */
async function clickMap(page, [x, y], { button = "left", modifiers = [] } = {}) {
    const at = await reachMap(page, x, y);
    if (!at.onMap) throw new Error(`map point ${x}, ${y} is not clickable: ${at.covering ? `"${at.covering}" covers it` : "it is off the screen"}; move the camera first`);
    for (const key of modifiers) await page.keyboard.down(key);
    await page.mouse.click(at.x, at.y, { button });
    for (const key of modifiers.toReversed()) await page.keyboard.up(key);
}

/** Moves the pointer along map points with the button held (a drag or a brush stroke). */
async function strokeMap(page, points, { button = "left", modifiers = [], steps = 4 } = {}) {
    const screen = [];
    for (const [x, y] of points) {
        const at = await reachMap(page, x, y);
        if (!at.onMap) throw new Error(`map point ${x}, ${y} is not reachable on the screen; move the camera first`);
        screen.push(at);
    }
    for (const key of modifiers) await page.keyboard.down(key);
    await page.mouse.move(screen[0].x, screen[0].y);
    await page.mouse.down({ button });
    for (const at of screen.slice(1)) await page.mouse.move(at.x, at.y, { steps });
    await page.mouse.up({ button });
    for (const key of modifiers.toReversed()) await page.keyboard.up(key);
}

/** The open modal dialogue (not a docked inspector). */
function modal(page) {
    return page.locator("dialog.fwmb-overlay-modal[open]").last();
}

const CAMERA_BUTTONS = Object.freeze({ fit: "resetZoom", zoomIn: "zoomIn", zoomOut: "zoomOut" });
const CAMERA_WORDS = Object.freeze({ fit: "Reset view", zoomIn: "Zoom in", zoomOut: "Zoom out" });

/**
 * The actions, by kind: run(page, action, context) performs it; describe(action) is what the
 * video script says happens on screen.
 */
export const ACTIONS = Object.freeze({
    /** Chooses a tool on the rail (or in More, when the rail has folded it). */
    tool: {
        async run(page, { tool }) {
            const onRail = page.locator(`.fwmb-rail-btn[data-action="changeTool"][data-tool="${tool}"]`).filter({ visible: true });
            if (await onRail.count()) return onRail.first().click({ timeout: FIND_MS });
            await clickControl(page, ".fwmb-rail-more > .fwmb-rail-btn");
            await clickControl(page, `[role="menuitem"][data-action="changeTool"][data-tool="${tool}"]`);
        },
        describe: ({ tool, label }) => `Click ${label ?? tool} on the rail.`,
    },

    /**
     * Chooses a mode on the bar, unless it is already the mode in use (choosing it again can end
     * the drawing). A mode the bar has folded into More is chosen from there.
     */
    mode: {
        async run(page, { action, mode, attr = "mode" }) {
            const selector = `[data-action="${action}"][data-${attr}="${mode}"]`;
            const button = page.locator(`.fwmb-mode${selector}`).filter({ visible: true });
            if (await button.count()) {
                if ((await button.first().getAttribute("aria-checked")) === "true") return;
                return button.first().click({ timeout: FIND_MS });
            }
            const item = page.locator(`[role="menuitemradio"]${selector}`);
            if (!(await item.count())) throw new Error(`no mode ${mode} on the bar or in its More menu`);
            if ((await item.first().getAttribute("aria-checked")) === "true") return;
            await clickControl(page, ".fwmb-bar-more-btn");
            await clickControl(page, `[role="menuitemradio"]${selector}`);
        },
        describe: ({ mode, label }) => `Choose ${label ?? mode} on the bar.`,
    },

    /** Clicks a control. */
    click: {
        run: (page, { target, button, modifiers }) => clickControl(page, target, { button, modifiers }),
        describe: ({ target, label }) => `Click ${label ?? describeTarget(target)}.`,
    },

    /** Rests the pointer on a control (a list row, whose actions show only under the pointer on a narrower studio). */
    point: {
        async run(page, { target }) {
            const element = locate(page, target);
            await element.waitFor({ state: "visible", timeout: FIND_MS });
            await element.hover({ timeout: FIND_MS });
        },
        describe: ({ target, label }) => `Point at ${label ?? describeTarget(target)}.`,
    },

    /** Opens a section of the panel if it is closed. */
    openSection: {
        async run(page, { section }) {
            const details = page.locator(`details.fwmb-section[data-section="${section}"]`).filter({ visible: true }).first();
            await details.waitFor({ state: "visible", timeout: FIND_MS });
            if (await details.evaluate((element) => element.open)) return;
            await details.locator("summary").first().click({ timeout: FIND_MS });
        },
        describe: ({ section, label }) => `Open the ${label ?? section} section.`,
    },

    /**
     * Sets a field: a text or number box is cleared and typed into, then left with Tab (which
     * is when the studio reads it; `commit: "Enter"` for a naming row, which Enter confirms); a
     * select is chosen from; a slider is moved to the value; a checkbox is ticked or cleared.
     */
    set: {
        async run(page, { field, value, commit = "Tab" }) {
            const element = locate(page, field);
            await element.waitFor({ state: "visible", timeout: FIND_MS });
            const kind = await element.evaluate((input) => (input.tagName === "SELECT" ? "select" : input.type));
            if (kind === "select") {
                await element.selectOption(String(value), { timeout: FIND_MS });
            } else if (kind === "range") {
                // A slider is dragged to its value: one input as the handle lands, then the
                // change a release sends
                await element.evaluate((input, next) => {
                    input.value = next;
                    if (Number(input.value) !== Number(next)) throw new Error(`slider ${input.name} cannot take ${next} (from ${input.min} to ${input.max} in steps of ${input.step})`);
                    input.dispatchEvent(new Event("input", { bubbles: true }));
                    input.dispatchEvent(new Event("change", { bubbles: true }));
                }, String(value));
            } else if (kind === "color") {
                // The colour is typed as a reader would in the picker's hex field
                await element.fill(String(value), { timeout: FIND_MS });
            } else if (kind === "checkbox") {
                await element.setChecked(!!value, { timeout: FIND_MS });
            } else {
                await element.click({ clickCount: 3, timeout: FIND_MS });
                await element.fill(String(value), { timeout: FIND_MS });
                await element.press(commit);
            }
        },
        describe: ({ field, value, valueLabel, label }) => `Set ${label ?? describeTarget(field)} to ${valueLabel ?? value}.`,
    },

    /** Answers the open dialogue: types into its box if asked, then presses a button by its text, or ok/cancel. */
    dialog: {
        async run(page, { button = "ok", input }) {
            const dialog = modal(page);
            await dialog.waitFor({ state: "visible", timeout: FIND_MS });
            if (input !== undefined) {
                const box = dialog.locator("input[type=text], input:not([type])").first();
                await box.fill(String(input), { timeout: FIND_MS });
            }
            const choice = ["ok", "cancel"].includes(button) ? dialog.locator(`[data-overlay-action="${button}"]`) : dialog.getByRole("button", { name: button, exact: true });
            await choice.first().click({ timeout: FIND_MS });
            await dialog.waitFor({ state: "detached", timeout: FIND_MS }).catch(() => dialog.waitFor({ state: "hidden", timeout: FIND_MS }));
        },
        describe: ({ button = "ok", input, label }) => (input !== undefined ? `Type "${input}" in the dialogue and click ${label ?? button}.` : `Click ${label ?? button} in the dialogue.`),
    },

    /** Waits for a dialogue to open (to photograph it before answering). */
    waitForDialog: {
        run: (page) => modal(page).waitFor({ state: "visible", timeout: FIND_MS }),
        describe: () => "The dialogue opens.",
    },

    /** Clicks a map pixel. */
    mapClick: {
        run: (page, { at, button, modifiers }) => clickMap(page, at, { button, modifiers }),
        describe: ({ at, button, label }) => label ?? `${button === "right" ? "Right-click" : "Click"} the map at ${at[0]}, ${at[1]}.`,
    },

    /**
     * Draws a shape point by point (a land mask, a region's outline), then right-clicks an empty
     * part of the map to finish it. `fitAfterFirst` resets the view after the first point, when
     * the inspector that opens with a new shape narrows the map; a point out of view is brought
     * back the same way before it is clicked.
     */
    shape: {
        async run(page, { points, finishAt, fitAfterFirst = false, camera = ["fit"] }) {
            for (const [index, point] of points.entries()) {
                // A point the view has lost (the inspector opening or closing changes the map's
                // width) is brought back as a reader would, with Reset view, once
                const at = await reachMap(page, point[0], point[1]);
                if (!at.onMap) await ACTIONS.camera.run(page, { view: camera });
                await clickMap(page, point);
                if (index === 0 && fitAfterFirst) await ACTIONS.camera.run(page, { view: camera });
            }
            if (finishAt) await clickMap(page, finishAt, { button: "right" });
        },
        describe: ({ points, label }) => label ?? `Click ${points.length} points on the map, then right-click to finish the shape.`,
    },

    /** Moves the map's camera with its own buttons: "fit" (Reset view), "zoomIn", "zoomOut", or a list of them. */
    camera: {
        async run(page, { view }) {
            for (const move of [view].flat()) {
                const action = CAMERA_BUTTONS[move];
                if (!action) throw new Error(`unknown camera move "${move}"`);
                await clickControl(page, `.fwmb-map-btn[data-action="${action}"]`);
            }
            await page.waitForTimeout(250);
        },
        describe: ({ view, label }) => label ?? `${[view].flat().map((move) => CAMERA_WORDS[move]).join(", then ")}.`,
    },

    /**
     * Zooms with the mouse wheel over a map point, a notch at a time (positive notches zoom in),
     * so that point stays under the pointer as a reader's scrolling keeps it.
     */
    zoom: {
        async run(page, { at, notches }) {
            const point = await reachMap(page, at[0], at[1]);
            if (!point.onMap) throw new Error(`map point ${at[0]}, ${at[1]} is not on the screen to zoom on`);
            await page.mouse.move(point.x, point.y);
            for (let notch = 0; notch < Math.abs(notches); notch++) {
                await page.mouse.wheel(0, notches > 0 ? -100 : 100);
                await page.waitForTimeout(50);
            }
            await page.waitForTimeout(250);
        },
        describe: ({ notches, label }) => label ?? `Scroll to zoom ${notches > 0 ? "in" : "out"} on the map.`,
    },

    /**
     * Drags a handle along its track to a share of the track's length (0 to 1): the range
     * handles of the biome rule editor and the culture inspector. `handle` is a selector; the
     * track is the handle's parent.
     */
    slide: {
        async run(page, { handle, to }) {
            const grip = locate(page, handle);
            await grip.waitFor({ state: "visible", timeout: FIND_MS });
            const from = await grip.boundingBox();
            const track = await grip.locator("xpath=..").boundingBox();
            const y = from.y + from.height / 2;
            await page.mouse.move(from.x + from.width / 2, y);
            await page.mouse.down();
            await page.mouse.move(track.x + to * track.width, y, { steps: 4 });
            await page.mouse.up();
        },
        describe: ({ to, label }) => label ?? `Drag the handle to ${to}.`,
    },

    /**
     * Frames a rectangle of the map, [x0, y0, x1, y1], as a reader zooms in on a place: Reset
     * view, a right-drag that brings the rectangle's centre to the middle of the map, then the
     * mouse wheel, a notch at a time, until the rectangle nearly fills the map. Used before a
     * close-up, so its picture is the same size on every run.
     */
    frame: {
        async run(page, { rect }) {
            await ACTIONS.camera.run(page, { view: "fit" });
            await settle(page, { settleMs: 1000 });
            const [x0, y0, x1, y1] = rect;
            const view = await page.evaluate(() => {
                const engine = globalThis.fwmbStudio.canvasEngine;
                const box = (engine.app.canvas ?? engine.app.view).getBoundingClientRect();
                return { left: box.left, top: box.top, width: box.width, height: box.height, scale: engine.stage.scale.x };
            });
            const centre = await reachMap(page, (x0 + x1) / 2, (y0 + y1) / 2);
            const middle = { x: view.left + view.width / 2, y: view.top + view.height / 2 };
            // Right-drag: the map moves with the pointer
            await page.mouse.move(centre.x, centre.y);
            await page.mouse.down({ button: "right" });
            await page.mouse.move(middle.x, middle.y, { steps: 8 });
            await page.mouse.up({ button: "right" });
            const wanted = Math.min((view.width * FRAME_FILL) / (x1 - x0), (view.height * FRAME_FILL) / (y1 - y0));
            const notches = Math.max(0, Math.floor(Math.log(wanted / view.scale) / Math.log(WHEEL_FACTOR)));
            await page.mouse.move(middle.x, middle.y);
            for (let notch = 0; notch < notches; notch++) {
                await page.mouse.wheel(0, -100);
                await page.waitForTimeout(50);
            }
            await page.waitForTimeout(250);
        },
        describe: ({ label }) => label ?? "Zoom in on the place.",
    },

    /** Drags on the map from one point to another. */
    drag: {
        run: (page, { from, to, button, modifiers }) => strokeMap(page, [from, to], { button, modifiers }),
        describe: ({ label }) => label ?? "Drag on the map.",
    },

    /**
     * A brush stroke along map points. The studio paints at most one stamp every 100 ms, so the
     * pointer rests longer than that at each point: every point is one stamp, whatever the
     * machine's speed, and the stroke (and the terrain it makes) is the same on every run.
     */
    brush: {
        async run(page, { path, modifiers = [] }) {
            await settle(page);
            const screen = [];
            for (const [x, y] of path) {
                const at = await reachMap(page, x, y);
                if (!at.onMap) throw new Error(`brush point ${x}, ${y} is not on the map: ${at.covering ? `"${at.covering}" covers it` : "it is off the screen"}`);
                screen.push(at);
            }
            for (const key of modifiers) await page.keyboard.down(key);
            await page.mouse.move(screen[0].x, screen[0].y);
            await page.mouse.down();
            await page.waitForTimeout(BRUSH_STAMP_MS);
            for (const at of screen.slice(1)) {
                await page.mouse.move(at.x, at.y);
                await page.waitForTimeout(BRUSH_STAMP_MS);
            }
            await page.mouse.up();
            for (const key of modifiers.toReversed()) await page.keyboard.up(key);
        },
        describe: ({ label }) => label ?? "Brush across the map.",
    },

    /** Presses a key (or a combination, "Control+Z"). */
    key: {
        run: (page, { key }) => page.keyboard.press(key),
        describe: ({ key, label }) => label ?? `Press ${key}.`,
    },

    /** Rests the pointer on a map pixel (so the information bar reads it). */
    hover: {
        async run(page, { at }) {
            const point = await reachMap(page, at[0], at[1]);
            if (!point.onMap) throw new Error(`map point ${at[0]}, ${at[1]} is not visible to hover`);
            await page.mouse.move(point.x, point.y);
        },
        describe: ({ label }) => label ?? "Point at the map.",
    },

    /** Imports a map file through the Maps tool's Import JSON, as a reader does with a checkpoint. */
    importMap: {
        async run(page, { file }) {
            await ACTIONS.tool.run(page, { tool: "manage" });
            const chooser = page.waitForEvent("filechooser", { timeout: FIND_MS });
            await clickControl(page, '[data-action="importMapJson"]');
            await (await chooser).setFiles(file);
            await page.locator(".fwmb-map-card").first().waitFor({ state: "visible", timeout: 60000 });
        },
        describe: ({ label }) => label ?? "Import the map file in Maps.",
    },

    /** Waits for the map to settle (the runner also does this after every step). */
    settle: {
        run: (page) => settle(page),
        describe: ({ label }) => label ?? "Wait for the map to update.",
    },

    /**
     * Checks the studio's state; not shown to the reader. `check` is a function run in the page
     * with the studio (fwmbStudio) and `args`; it returns true, or a message saying what is wrong.
     * `within` (ms) keeps asking until it comes true or the time is up.
     */
    expect: {
        async run(page, { check, args = null, message, within = 0 }) {
            const evaluate = () =>
                page.evaluate(
                    ([source, values]) => {
                        const fn = new Function(`return (${source});`)();
                        try {
                            return fn(globalThis.fwmbStudio, values);
                        } catch (error) {
                            return error.message;
                        }
                    },
                    [check.toString(), args],
                );
            // `within` gives a check that waits on the studio (a save finishing) time to come true
            const until = performance.now() + within;
            let result = await evaluate();
            while (result !== true && performance.now() < until) {
                await page.waitForTimeout(100);
                result = await evaluate();
            }
            if (result !== true) throw new Error(`${message ?? "check failed"}${typeof result === "string" ? `: ${result}` : ""}`);
        },
        describe: () => null,
        hidden: true,
    },
});

/** Performs a step's actions in order, naming the step in any failure. */
export async function runActions(page, step, context) {
    for (const action of [step.action ?? []].flat()) {
        const kind = ACTIONS[action.do];
        if (!kind) throw new Error(`step "${step.id}": unknown action "${action.do}"`);
        try {
            await kind.run(page, action, context);
        } catch (error) {
            throw new Error(`step "${step.id}", action ${action.do}${action.label ? ` (${action.label})` : ""}: ${error.message}`, { cause: error });
        }
    }
}

/** What happens on screen in a step, for the video script. */
export function describeActions(step) {
    return [step.action ?? []]
        .flat()
        .map((action) => ACTIONS[action.do]?.describe(action))
        .filter(Boolean);
}
