// The 3D view's Relief Emphasis: a per-map setting with a default, saved in params.display, and
// the scale its broad slope is measured at.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const { installPlatform, platform } = await import("../../src/platform/index.js");
installPlatform({ i18n: { localize: (key) => key, format: (key) => key, lang: "en" }, utils: { ...platform.utils, deepClone: (value) => structuredClone(value) } });
const { FILRODENSWMB } = await import("../../src/config.js");
const { setupApp } = await import("../support/pipeline-setup.mjs");
const { MapStateManager } = await import("../../src/applications/MapStateManager.js");
const { ProceduralEngine } = await import("../../src/generation/ProceduralEngine.js");

const fixture = JSON.parse(readFileSync(new URL("../mesh/fixtures/p0jbva.json", import.meta.url)));

test("a map starts at the default Relief Emphasis and saves it with its display settings", () => {
    // An older map has no Relief Emphasis saved, and takes the default when loaded
    const older = structuredClone(fixture);
    delete older.params.display?.reliefEmphasis;
    const app = setupApp(older);
    assert.equal(app.uiState.reliefEmphasis, FILRODENSWMB.DISPLAY.THREE_D.RELIEF.EMPHASIS);
    app.uiState.reliefEmphasis = 7;
    const { params } = MapStateManager.getMapParameters(app);
    assert.equal(params.display.reliefEmphasis, 7);
});

test("the broad slope's scale follows the map's place in its chain of crops", () => {
    const baseline = FILRODENSWMB.LIMITS.BASELINE_DIMENSION;
    assert.equal(ProceduralEngine.pixelsPerBaseline(null, baseline, baseline / 2), 1);
    assert.equal(ProceduralEngine.pixelsPerBaseline(null, baseline * 2, baseline), 2);
    assert.equal(ProceduralEngine.pixelsPerBaseline({ zoom: 4, rootW: baseline, rootH: baseline }, 500, 500), 4, "a ×4 crop of a baseline map");
});
