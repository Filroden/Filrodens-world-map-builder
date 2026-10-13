// The studio's life cycle as its host sees it (canClose, destroy), and the Foundry window that
// hosts it: the window closes only once the studio agrees. Drawing the studio needs a browser and
// is covered by the studio smoke check.
import assert from "node:assert/strict";
import { test } from "node:test";

const { installPlatform, platform } = await import("../../src/platform/index.js");
const foundryServices = { ...platform };
// Enough of a host for the studio to be built (its state) without Foundry
installPlatform({
    i18n: { localize: (key) => key, format: (key) => key, lang: "en" },
    utils: {
        ...platform.utils,
        randomID: () => Math.random().toString(36).slice(2, 18),
        deepClone: (value) => structuredClone(value),
        debounce: (fn) => fn,
        mergeObject: (target, source) => Object.assign(target, source),
    },
});

const { MapStudio } = await import("../../src/applications/MapStudio.js");

/** A studio whose unsaved-changes question answers `choice`, counting how often it is asked. */
function studioAnswering(choice) {
    const asked = { count: 0 };
    installPlatform({
        dialogs: {
            ...foundryServices.dialogs,
            choose: async () => {
                asked.count++;
                return choice;
            },
        },
    });
    return { studio: new MapStudio(), asked };
}

test("a studio with no unsaved changes may close, once", async () => {
    const studio = new MapStudio();
    assert.equal(await studio.canClose(), true);
    assert.equal(await studio.canClose(), false, "a second request while closing is refused");
});

test("unsaved changes are asked about; Cancel keeps the studio open and asks again next time", async () => {
    const { studio, asked } = studioAnswering("cancel");
    studio.markDirty();
    assert.equal(await studio.canClose(), false);
    assert.equal(await studio.canClose(), false);
    assert.equal(asked.count, 2);
});

test("the host's title shows the saved map and its id, and (unsaved) while there are unsaved changes", () => {
    const strings = { "FILRODENSWMB.UI.ControlTitle": "FWMB", "FILRODENSWMB.UI.WindowTitleMap": "{title}: {name} ({id})", "FILRODENSWMB.UI.WindowTitleUnsaved": "{title} (unsaved)" };
    const titles = [];
    installPlatform({
        i18n: { localize: (key) => strings[key], format: (key, data) => strings[key].replace(/\{(\w+)\}/g, (_, name) => data[name]), lang: "en" },
        frame: { idLength: 4, setTitle: (text) => titles.push(text) },
    });
    const studio = new MapStudio();
    assert.deepEqual(titles, [], "nothing is shown before the studio is mounted");
    studio.root = { querySelector: () => null };

    studio.markDirty();
    studio.markDirty();
    studio.currentSaveName = "Harbour";
    studio.currentSaveId = "abcdefgh";
    studio.isDirty = false;
    studio.currentSaveName = "Old Harbour";
    studio.currentSaveId = null;
    assert.deepEqual(
        titles,
        ["FWMB (unsaved)", "FWMB (unsaved)", "FWMB: Harbour (abcd) (unsaved)", "FWMB: Harbour (abcd)", "FWMB: Old Harbour (abcd)", "FWMB"],
        "shown again on each change (marking an unsaved map again is not one), with the id cut to the host's length",
    );
});

test("destroy lets go of the root", () => {
    const studio = new MapStudio();
    studio.root = { querySelector: () => null };
    studio.destroy();
    assert.equal(studio.root, null);
});

test("the Foundry window closes only when the studio agrees, and destroys it first", async () => {
    const closed = [];
    class ApplicationV2 {
        constructor(options) {
            this.options = options;
        }
        async close() {
            closed.push("window");
            return this;
        }
    }
    globalThis.window ??= { innerWidth: 1000, innerHeight: 800 };
    globalThis.foundry = { applications: { api: { ApplicationV2, HandlebarsApplicationMixin: (base) => base } }, utils: { mergeObject: (target, source) => Object.assign(target, source) } };
    const { MapStudioWindow } = await import("../../src/platform/foundry/MapStudioWindow.js");

    const frame = new MapStudioWindow();
    let answer = false;
    frame.studio = { canClose: async () => answer, destroy: () => closed.push("studio") };

    await frame.close();
    assert.deepEqual(closed, [], "kept open when the studio says no");

    answer = true;
    await frame.close();
    assert.deepEqual(closed, ["studio", "window"]);
    assert.equal(frame.options.position.width, 700, "opens at most of the browser window's width");
});
