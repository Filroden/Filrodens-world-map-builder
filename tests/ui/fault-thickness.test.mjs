// Fault line thickness's range follows the map's width: up to 15% of it, a new fault at 5% of
// it, and a fault already thicker than that keeping its thickness (the range stretches to hold it).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installPlatform, platform } from "../../src/platform/index.js";

installPlatform({ ...platform, i18n: { localize: (key) => key, format: (key) => key, lang: "en" } });
const { FaultThickness } = await import("../../src/tools/FaultThickness.js");
const { MapStateManager } = await import("../../src/applications/MapStateManager.js");

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("the range runs to 15% of the map's width, with a new fault at 5%", () => {
    assert.deepEqual(FaultThickness.limits(2000), { min: 10, max: 300, step: 5, default: 100 });
    assert.deepEqual(FaultThickness.limits(1000), { min: 10, max: 150, step: 5, default: 50 });
    // Rounded to the step, and never below the smallest thickness
    assert.equal(FaultThickness.limits(1234).max, 185);
    assert.equal(FaultThickness.limits(100).default, 10);
});

test("a fault thicker than the range keeps its thickness", () => {
    assert.equal(FaultThickness.limits(2000, 500).max, 500);
    assert.equal(FaultThickness.limits(2000, 120).max, 300);
});

test("a new map's faults start at its own default thickness", () => {
    assert.equal(MapStateManager.buildDefaultUiState(2000, 1600).faultThickness, 100);
    assert.equal(MapStateManager.buildDefaultUiState(4000, 2000).faultThickness, 200);
});

test("the inspector and the bar take their range from the map", () => {
    assert.match(read("templates/parts/inspector-fault.hbs"), /name="faultThickness"[^}]*min=thickness\.min max=thickness\.max step=thickness\.step/);
    assert.match(read("templates/parts/toolbar-features.hbs"), /name="faultThickness"[^}]*min=faultThickness\.min max=faultThickness\.max step=faultThickness\.step/);
});
