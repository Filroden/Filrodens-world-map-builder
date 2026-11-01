// Every checkbox of the inspector, clicked as a reader clicks it, keeps the state the object now
// holds once the inspector has drawn itself again: both the tick on screen and the saved value.
//
// This needs a real browser. A checkbox whose click is cancelled is put back by the browser once
// the click is over, and in a browser that comes after any work the click's handlers started that
// waits only on promises (the inspector's redraw, from a cached template); a scripted click in
// happy-dom puts it back first, so happy-dom cannot tell a box that keeps its tick from one that
// loses it. The page is the tutorial's regional map (samples/tutorial/11-a-regional-map.json),
// which has generated pins, routes and regions; a fault, a region style and a label style are
// added to it.
//
// Needs Chromium for Playwright (npx playwright install chromium, or FWMB_CHROMIUM); skipped,
// saying so, without it. It takes about fifteen minutes (every click waits for the regional map to
// redraw in SwiftShader); FWMB_BROWSER=0 skips it for a quick run.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { runActions } from "../tutorial/lib/actions.mjs";
import { findChromium, startStudioHost } from "../tutorial/lib/studio.mjs";
import { openMap } from "../tutorial/run.mjs";

const found = process.env.FWMB_BROWSER === "0" ? { reason: "FWMB_BROWSER=0" } : await findChromium();
const skip = found.reason ?? false;

/** How long a click's change and redraw may take on the regional map. */
const SETTLE_MS = 30000;

let host;
let page;
let ids;

before(async () => {
    if (skip) return;
    host = await startStudioHost(found);
    ({ browserPage: page } = await openMap(host, { start: "11-a-regional-map", seed: 8001 }));
    ids = await page.evaluate(() => {
        const app = globalThis.fwmbStudio;
        let region = null;
        for (const level of app.regionLevels) {
            const found = level.regions.find((candidate) => candidate.generated && candidate.fillColor !== "transparent");
            if (found) {
                region = { levelId: level.id, id: found.id };
                break;
            }
        }
        // A fault and a region style of the test's own, which the regional map has none of
        app.tectonicFaults.push({ id: "testFaultChecks01", name: "Fault", description: "", points: [{ x: 100, y: 100 }, { x: 300, y: 200 }], type: "range", style: "simple", thickness: 40, strength: 0.25, color: "#ef4444", visibility: "all", revision: 2 });
        (app.uiState.customRegionStyles ??= []).push({ id: "testRegionStyle01", name: "Test fill", fillColor: "#3366aa", fillStyle: "solid" });
        // A label style in a family with both Bold and Italic, so neither box is disabled
        const labelStyle = structuredClone(app.uiState.customLabelStyles[0]);
        app.uiState.customLabelStyles.push({ ...labelStyle, id: "testLabelStyle01", name: "Test label", fontFamily: "Atkinson Hyperlegible", bold: false, italic: false });
        const set = app.layerSets[0];
        return {
            pin: app.mapPins.find((pin) => pin.generated)?.id,
            route: app.mapRoutes.find((route) => route.generated)?.id,
            region,
            fault: "testFaultChecks01",
            set: set?.id,
            level: set?.levels[0]?.id,
            routeStyle: app.uiState.customRouteStyles?.[0]?.id,
            regionStyle: "testRegionStyle01",
            labelStyle: "testLabelStyle01",
        };
    });
});

after(async () => {
    await host?.close();
});

/** The tool each kind of inspector is opened in, and how to open it and find its object, in the page. */
const KINDS = {
    pin: { tool: "infrastructure", open: "(await import('/src/applications/PinEditor.js')).PinEditor.open(app, ids.pin)", object: "app.mapPins.find((each) => each.id === ids.pin)" },
    route: { tool: "infrastructure", open: "(await import('/src/applications/RouteEditor.js')).RouteEditor.open(app, ids.route)", object: "app.mapRoutes.find((each) => each.id === ids.route)" },
    region: {
        tool: "regions",
        open: "(await import('/src/applications/RegionEditor.js')).RegionEditor.open(app, ids.region.levelId, ids.region.id)",
        object: "app.regionLevels.find((level) => level.id === ids.region.levelId).regions.find((each) => each.id === ids.region.id)",
    },
    fault: { tool: "features", open: "(await import('/src/applications/FeatureEditors.js')).FaultEditor.open(app, ids.fault)", object: "app.tectonicFaults.find((each) => each.id === ids.fault)" },
    set: { tool: "regions", open: "(await import('/src/applications/LayerEditors.js')).LayerSetEditor.open(app, ids.set)", object: "app.layerSets.find((each) => each.id === ids.set)" },
    level: { tool: "regions", open: "(await import('/src/applications/LayerEditors.js')).LevelEditor.open(app, ids.level)", object: "app.layerSets.flatMap((set) => set.levels).find((each) => each.id === ids.level)" },
    routeStyle: { tool: "library", open: "(await import('/src/applications/StyleEditors.js')).StyleEditors.open(app, 'Route', ids.routeStyle)", object: "app.uiState.customRouteStyles.find((each) => each.id === ids.routeStyle)" },
    regionStyle: { tool: "library", open: "(await import('/src/applications/StyleEditors.js')).StyleEditors.open(app, 'Region', ids.regionStyle)", object: "app.uiState.customRegionStyles.find((each) => each.id === ids.regionStyle)" },
    labelStyle: { tool: "library", open: "(await import('/src/applications/StyleEditors.js')).StyleEditors.open(app, 'Label', ids.labelStyle)", object: "app.uiState.customLabelStyles.find((each) => each.id === ids.labelStyle)" },
};

/**
 * Every checkbox of the inspector: its kind, its box, and the saved value it stands for, as true
 * or false (a fill's No fill is its colour being "transparent").
 */
const BOXES = [
    ["pin", "Lock", '[data-inspector-action="lock"]', "object.generated.locked === true"],
    ["route", "Lock", '[data-inspector-action="lock"]', "object.generated.locked === true"],
    ["region", "Lock", '[data-inspector-action="lock"]', "object.generated.locked === true"],
    ["route", "Span water", '[name="routeSpanWater"]', "object.spanWater === true"],
    ["route", "Outline", '[name="routeOutline"]', "object.outline !== false"],
    ["route", "Smoothing", '[name="routeSmoothing"]', "object.smoothing === true"],
    ["region", "No fill", '[name="regionFillTransparent"]', "object.fillColor === 'transparent'"],
    ["fault", "Reversed", '[name="faultReverse"]', "object.reversed === true"],
    ["set", "Water tint", '[name="setWaterTint"]', "object.waterTint === true"],
    ["level", "Scale with map", '[name="levelScaleWithMap"]', "object.style?.scaleWithMap === true"],
    ["routeStyle", "Outline", '[name="styleOutline"]', "object.outline !== false"],
    ["routeStyle", "Smoothing", '[name="styleSmoothing"]', "object.smoothing === true"],
    ["regionStyle", "No fill", '[name="styleFillTransparent"]', "object.fillColor === 'transparent'"],
    ["labelStyle", "Bold", '[name="styleBold"]', "object.bold === true"],
    ["labelStyle", "Italic", '[name="styleItalic"]', "object.italic === true"],
];

let tool = null;

/** Opens the inspector on a kind's object, with its sections open so every box can be clicked. */
async function openInspector(kind) {
    const spec = KINDS[kind];
    if (tool !== spec.tool) {
        await runActions(page, { id: "tool", action: { do: "tool", tool: spec.tool } });
        tool = spec.tool;
    }
    await page.evaluate(`(async () => { const app = globalThis.fwmbStudio; const ids = ${JSON.stringify(ids)}; await ${spec.open}; })()`);
    await page.locator(".fwmb-inspector").filter({ visible: true }).first().waitFor({ timeout: SETTLE_MS });
    await page.evaluate(() => document.querySelectorAll(".fwmb-inspector details.fwmb-section:not([open])").forEach((details) => (details.open = true)));
}

/** The saved value a box stands for. */
function saved(kind, read) {
    return page.evaluate(`(() => { const app = globalThis.fwmbStudio; const ids = ${JSON.stringify(ids)}; const object = ${KINDS[kind].object}; return ${read}; })()`);
}

/** The colour a fill holds, to check No fill gives it back. */
function fillOf(kind) {
    return page.evaluate(`(() => { const app = globalThis.fwmbStudio; const ids = ${JSON.stringify(ids)}; return ${KINDS[kind].object}.fillColor ?? null; })()`);
}

for (const [kind, name, selector, read] of BOXES) {
    test(`the ${kind} inspector's ${name} box keeps its state after the inspector redraws`, { skip }, async () => {
        assert.ok(kind !== "region" || ids.region, "the regional map has a generated region");
        assert.ok(ids[kind], `the regional map has a ${kind} to inspect`);
        await openInspector(kind);
        const box = page.locator(`.fwmb-inspector ${selector}`).filter({ visible: true }).first();
        // The colour the fill shows before No fill is ticked, which clearing it should give back
        const colourBox = page.locator(`.fwmb-inspector [name="${kind === "region" ? "regionFillColor" : "styleFillColor"}"]`).filter({ visible: true }).first();
        const colour = name === "No fill" ? await colourBox.inputValue() : null;
        for (const click of [1, 2]) {
            const before = await saved(kind, read);
            await box.click();
            // The click's change, then the redraw, until the box shows the new state (a box that
            // loses its tick never does, and the checks below say which)
            await page.waitForFunction(
                ({ selector, expected }) => {
                    const element = [...document.querySelectorAll(`.fwmb-inspector ${selector}`)].find((each) => each.offsetParent);
                    return element && element.checked === expected;
                },
                { selector, expected: !before },
                { timeout: SETTLE_MS },
            ).catch(() => {});
            await page.waitForTimeout(500);
            assert.equal(await saved(kind, read), !before, `click ${click}: the ${kind} holds the new state`);
            assert.equal(await box.evaluate((element) => element.checked), !before, `click ${click}: the box still shows it after the redraw`);
        }
        if (colour) assert.equal((await fillOf(kind)).toLowerCase(), colour.toLowerCase(), "clearing No fill gives back the colour the fill had");
    });
}
