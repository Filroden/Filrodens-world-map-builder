// Sliders on a power curve (RangeCurve, RangeDisplay, MapStateManager.getMapParameters, the
// shared-range partial): Coastline Fracture's slider moves evenly over its position while its
// value is the position squared; the value is shown, read and saved from data-value; a value no
// step lands on (0.1) is kept exactly while the slider is not moved off it, so opening and saving
// a map changes nothing; a move works out the new position's value, rounded to the setting's step.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { Window } from "happy-dom";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const window = new Window({ url: "http://localhost/" });
const document = window.document;
after(() => window.happyDOM.close());

const { installPlatform, platform } = await import("../../src/platform/index.js");
installPlatform({ ...platform, i18n: { localize: (key) => key, format: (key) => key, lang: "en" } });
const { FILRODENSWMB } = await import("../../src/config.js");
const { RangeCurve } = await import("../../src/tools/RangeCurve.js");
const { RangeDisplay } = await import("../../src/tools/RangeDisplay.js");
const { MapStateManager } = await import("../../src/applications/MapStateManager.js");

const CURVE = FILRODENSWMB.GENERATION.COASTLINE_FRACTURE_CURVE;

/** The shared-range partial drawn for a curved slider, as tools-terrain.hbs draws Coastline Fracture. */
function drawSlider(value) {
    const handlebars = Handlebars.create();
    handlebars.registerHelper("localize", (key) => key);
    const template = handlebars.compile(readFileSync(join(ROOT, "templates/parts/shared-range.hbs"), "utf8"));
    const host = document.createElement("div");
    host.innerHTML = template({ name: "coastlineFracture", label: "L", value, curve: CURVE, position: RangeCurve.positionOf(value, CURVE), min: 0, max: 1, step: 0.01 });
    document.body.replaceChildren(host);
    return host.querySelector("input");
}

test("the value is the position squared, rounded to the setting's precision; the position is its root", () => {
    assert.equal(CURVE, 2);
    assert.equal(RangeCurve.valueAt(0.5, CURVE), 0.25);
    assert.equal(RangeCurve.valueAt(0.1, CURVE), 0.01);
    assert.equal(RangeCurve.valueAt(1, CURVE), 1);
    assert.equal(RangeCurve.valueAt(0, CURVE), 0);
    assert.equal(RangeCurve.valueAt(0.33, CURVE), 0.109);
    assert.ok(Math.abs(RangeCurve.positionOf(0.25, CURVE) - 0.5) < 1e-12);
    assert.equal(10 ** -RangeCurve.DECIMALS, FILRODENSWMB.GENERATION.COASTLINE_FRACTURE_STEP, "values worked out in code keep the slider's precision");
});

test("the low end takes half the slider: the middle position is 0.25", () => {
    const input = drawSlider(0.25);
    assert.equal(input.dataset.curve, String(CURVE));
    assert.equal(Number(input.value), 0.5);
    assert.equal(input.closest(".fwmb-range").querySelector("output").textContent, "0.25", "the value is shown, not the position");
});

test("a value no step lands on is kept exactly until the slider moves, then the new position's value is taken", () => {
    const input = drawSlider(0.1);
    // Opened and saved without moving: the value is read back as it was
    assert.equal(RangeCurve.read(input), "0.1");
    RangeDisplay.sync(input);
    assert.equal(input.dataset.value, "0.1", "an input event at the same position keeps the stored value");
    // One step up
    input.value = String(Number(input.value) + 0.01);
    RangeDisplay.sync(input);
    assert.equal(input.dataset.value, String(RangeCurve.valueAt(Number(input.value), CURVE)));
    assert.notEqual(input.dataset.value, "0.1");
    assert.equal(input.closest(".fwmb-range").querySelector("output").value, input.dataset.value);
});

test("a reset goes to the exact default, not the nearest step's value", () => {
    const input = drawSlider(0.5);
    RangeCurve.setValue(input, FILRODENSWMB.GENERATION.COASTLINE_FRACTURE);
    RangeDisplay.sync(input);
    assert.equal(input.dataset.value, String(FILRODENSWMB.GENERATION.COASTLINE_FRACTURE));
});

test("reading the panel takes a curved slider's value, not its position", () => {
    const input = drawSlider(0.04);
    const app = { root: document.body, uiState: { coastlineFracture: 0.2 }, customBiomeColors: {} };
    try {
        MapStateManager.getMapParameters(app);
    } catch {
        // Deriving the full parameters needs a whole state; only the read matters here
    }
    assert.equal(app.uiState.coastlineFracture, 0.04);
    assert.equal(Number(input.value), 0.2, "the position the slider sits at");
});

test("every Coastline Fracture slider is on the curve, in steps of 0.01 of its position", () => {
    const template = readFileSync(join(ROOT, "templates/tools-terrain.hbs"), "utf8");
    const sliders = [...template.matchAll(/name="coastlineFracture"[^}]*\}\}/g)].map((match) => match[0]);
    assert.equal(sliders.length, 3);
    for (const slider of sliders) assert.match(slider, /curve=fractureCurve position=fracturePosition min=0 max=1 step=0\.01/);
});
