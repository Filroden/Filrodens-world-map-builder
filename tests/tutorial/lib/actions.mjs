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

/** How long to wait for a control or a dialogue before the step fails. */
const FIND_MS = 15000;

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

/** Clicks a control, failing (rather than forcing it) if something covers it. */
async function clickControl(page, target, options = {}) {
    const element = locate(page, target);
    await element.waitFor({ state: "visible", timeout: FIND_MS });
    await element.click({ timeout: FIND_MS, ...options });
}

/** Clicks a map pixel, failing if the point is off the screen or under an overlay. */
async function clickMap(page, [x, y], { button = "left", modifiers = [] } = {}) {
    const at = await mapToScreen(page, x, y);
    if (!at.onMap) throw new Error(`map point ${x}, ${y} is not clickable: ${at.covering ? `"${at.covering}" covers it` : "it is off the screen"}; move the camera first`);
    for (const key of modifiers) await page.keyboard.down(key);
    await page.mouse.click(at.x, at.y, { button });
    for (const key of modifiers.toReversed()) await page.keyboard.up(key);
}

/** Moves the pointer along map points with the button held (a drag or a brush stroke). */
async function strokeMap(page, points, { button = "left", modifiers = [], steps = 4 } = {}) {
    const screen = [];
    for (const [x, y] of points) {
        const at = await mapToScreen(page, x, y);
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

    /** Chooses a mode on the bar, unless it is already the mode in use (choosing it again can end the drawing). */
    mode: {
        async run(page, { action, mode, attr = "mode" }) {
            const button = page.locator(`.fwmb-mode[data-action="${action}"][data-${attr}="${mode}"]`).filter({ visible: true }).first();
            await button.waitFor({ state: "visible", timeout: FIND_MS });
            if ((await button.getAttribute("aria-checked")) === "true") return;
            await button.click({ timeout: FIND_MS });
        },
        describe: ({ mode, label }) => `Choose ${label ?? mode} on the bar.`,
    },

    /** Clicks a control. */
    click: {
        run: (page, { target, button, modifiers }) => clickControl(page, target, { button, modifiers }),
        describe: ({ target, label }) => `Click ${label ?? describeTarget(target)}.`,
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
     * is when the studio reads it); a select is chosen from; a checkbox is ticked or cleared.
     */
    set: {
        async run(page, { field, value }) {
            const element = locate(page, field);
            await element.waitFor({ state: "visible", timeout: FIND_MS });
            const kind = await element.evaluate((input) => (input.tagName === "SELECT" ? "select" : input.type));
            if (kind === "select") {
                await element.selectOption(String(value), { timeout: FIND_MS });
            } else if (kind === "checkbox") {
                await element.setChecked(!!value, { timeout: FIND_MS });
            } else {
                await element.click({ clickCount: 3, timeout: FIND_MS });
                await element.fill(String(value), { timeout: FIND_MS });
                await element.press("Tab");
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
                const at = await mapToScreen(page, point[0], point[1]);
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

    /** Drags on the map from one point to another. */
    drag: {
        run: (page, { from, to, button, modifiers }) => strokeMap(page, [from, to], { button, modifiers }),
        describe: ({ label }) => label ?? "Drag on the map.",
    },

    /** A brush stroke along map points. */
    brush: {
        run: (page, { path, modifiers, steps }) => strokeMap(page, path, { modifiers, steps }),
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
            const point = await mapToScreen(page, at[0], at[1]);
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
     */
    expect: {
        async run(page, { check, args = null, message }) {
            const result = await page.evaluate(([source, values]) => {
                const fn = new Function(`return (${source});`)();
                try {
                    return fn(globalThis.fwmbStudio, values);
                } catch (error) {
                    return error.message;
                }
            }, [check.toString(), args]);
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
