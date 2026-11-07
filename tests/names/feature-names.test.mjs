// Natural features (src/names/FeatureDetection.js) found on a small synthetic map, and named on
// it (src/applications/FeatureNames.js): each kind found, footprints that find a feature again,
// labels in the geographic styles with a feature record, a second run placing untouched labels
// again and keeping edited ones, a gone feature's label kept and counted, a feature the reader
// named in a geographic style left alone, the Water style retired, and one undo step.
import assert from "node:assert/strict";
import { test } from "node:test";

const { installPlatform, platform } = await import("../../src/platform/index.js");
let nextId = 0;
installPlatform({
    i18n: { localize: (key) => ({ "FILRODENSWMB.UI.NameFormOcean": "{name} Ocean", "FILRODENSWMB.UI.NameFormLake": "Lake {name}", "FILRODENSWMB.UI.NameFormRiver": "River {name}", "FILRODENSWMB.UI.NameFormMountains": "{name} Mountains", "FILRODENSWMB.UI.NameFormForest": "{name} Forest", "FILRODENSWMB.UI.NameFormWeald": "{name} Weald" })[key] ?? key, format: (key) => key, lang: "en" },
    notify: { info: () => {}, warn: () => {}, error: () => {} },
    utils: { ...platform.utils, randomID: () => `label${String(++nextId).padStart(11, "0")}`, deepClone: (value) => structuredClone(value) },
});
const { FILRODENSWMB } = await import("../../src/config.js");
const { findFeatures, footprintCell, footprintOf, matchFeatures, overlap, footprintHas } = await import("../../src/names/FeatureDetection.js");
const { FeatureNames } = await import("../../src/applications/FeatureNames.js");
const { VectorHistory } = await import("../../src/applications/VectorHistory.js");

const W = 800;
const H = 600;

/**
 * Sea in the west, land elsewhere: a north to south ridge, a round lake, a forest in the east and
 * a river running down to the sea. `shift` moves the ridge east by that many pixels.
 */
function syntheticMap({ shift = 0, lake = true } = {}) {
    const elev = new Float32Array(W * H);
    const lakeMask = new Uint8Array(W * H);
    const biome = new Uint8Array(W * H);
    const moisture = new Float32Array(W * H).fill(0.5);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            if (x < 200) {
                elev[i] = 0.2;
                continue;
            }
            elev[i] = x >= 480 + shift && x < 540 + shift && y > 80 && y < 520 ? 0.9 : 0.45;
            biome[i] = x >= 620 ? 7 : 6;
            if (lake && (x - 350) ** 2 + (y - 450) ** 2 < 40 ** 2) lakeMask[i] = 1;
        }
    }
    const path = [];
    const flow = [];
    for (let k = 0; k <= 240; k++) {
        path.push([450 - k, 60 + k, 0]);
        flow.push(10 + k);
    }
    return { W, H, elev, lake: lakeMask, biome, moisture, seaLevel: 0.35, rivers: [{ id: 1, path, flow }] };
}

/** A studio stand-in: the map's labels, styles (with the old Water style) and its undo history. */
function studio() {
    const water = { id: "label-style-water", name: "Water", fontFamily: "EB Garamond", fontSize: 2.4, fillColor: "#E0F0FA", maxChars: 0, justify: "center", bold: false, italic: true };
    return {
        mapWidth: W,
        mapHeight: H,
        uiState: { mapSeed: "SEED", customLabelStyles: [water], generatorSettings: { nameBase: "English" } },
        mapLabels: [{ id: "harbour00000000", name: "Old Harbour", x: 100, y: 100, rotation: 0, quickStyle: "label-style-water", fontFamily: "EB Garamond", fontSize: 2.4, fillColor: "#E0F0FA", visibility: "all" }],
        mapPins: [{ id: "pin", name: "Port", x: 1, y: 1, label: { quickStyle: "label-style-water" } }],
        mapRoutes: [],
        layerSets: [],
        regionLevels: [],
        tectonicFaults: [],
        manualRivers: [],
        landMasks: [],
        mapDecorations: [],
        pinHistory: [],
        pinRedoStack: [],
        globalHistoryLedger: [],
        globalRedoLedger: [],
    };
}

const kinds = (features) => features.map((feature) => feature.kind).sort();

test("each kind on the synthetic map is found, with a label inside it", () => {
    const features = findFeatures(syntheticMap());
    for (const kind of ["ocean", "lake", "mountains", "forest", "river"]) assert.ok(kinds(features).includes(kind), `${kind} found (${kinds(features).join(", ")})`);
    const lake = features.find((feature) => feature.kind === "lake");
    assert.ok(Math.hypot(lake.label.x - 350, lake.label.y - 450) < 40, "the lake's name is inside it");
    const river = features.find((feature) => feature.kind === "river");
    assert.ok(river.label.angle < -30 && river.label.angle > -60, `the river's name rises with it to the north-east, read left to right (${river.label.angle})`);
});

test("a footprint finds its feature again after a small change, and not another", () => {
    const cell = footprintCell(W, H);
    const before = findFeatures(syntheticMap()).map((feature) => ({ kind: feature.kind, footprint: footprintOf(feature, cell) }));
    const after = findFeatures(syntheticMap({ shift: 8 })).map((feature) => ({ kind: feature.kind, footprint: footprintOf(feature, cell) }));
    for (const feature of before) assert.equal(overlap(feature.footprint, feature.footprint), 1);
    const matched = matchFeatures(after, before);
    const mountains = after.findIndex((feature) => feature.kind === "mountains");
    assert.equal(before[matched.get(mountains)].kind, "mountains", "the moved ridge is the same range");
    assert.ok(overlap(after[mountains].footprint, before.find((feature) => feature.kind === "forest").footprint) === 0);
    const lake = before.find((feature) => feature.kind === "lake").footprint;
    assert.ok(footprintHas(lake, 350, 450) && !footprintHas(lake, 100, 100));
});

test("Name natural features labels each feature in its geographic style, as one undo step, and retires Water", () => {
    const app = studio();
    const report = FeatureNames.apply(app, syntheticMap());
    const made = app.mapLabels.filter((label) => label.feature);
    assert.equal(report.added, made.length);
    assert.ok(made.length >= 5);
    for (const label of made) {
        const group = { ocean: "oceanSea", lake: "gulfBayLake", river: "river", mountains: "mountains", forest: "land" }[label.feature.kind];
        if (group) assert.equal(label.quickStyle, FILRODENSWMB.FEATURE_NAMES.STYLES[group]);
        assert.ok(!label.name.includes("{name}"));
        assert.equal(FeatureNames.edited(label), false);
    }
    assert.match(made.find((label) => label.feature.kind === "lake").name, /^Lake \S/);
    assert.match(made.find((label) => label.feature.kind === "river").name, /^River \S/);
    assert.match(made.find((label) => label.feature.kind === "ocean").name, / Ocean$/);
    // Water retired: its labels keep its look as Custom, and the style goes
    assert.equal(report.retired, 2);
    assert.deepEqual([app.mapLabels[0].quickStyle, app.mapLabels[0].fontFamily, app.mapPins[0].label.quickStyle, app.mapPins[0].label.fontFamily], ["custom", "EB Garamond", "custom", "EB Garamond"]);
    const styleIds = app.uiState.customLabelStyles.map((style) => style.id);
    assert.ok(!styleIds.includes("label-style-water"));
    for (const id of Object.values(FILRODENSWMB.FEATURE_NAMES.STYLES)) assert.ok(styleIds.includes(id), `${id} added`);
    // One undo step takes it all back
    assert.equal(app.pinHistory.length, 1);
    VectorHistory.step(app, true);
    assert.equal(app.mapLabels.length, 1);
    assert.equal(app.mapLabels[0].quickStyle, "label-style-water");
    assert.ok(app.uiState.customLabelStyles.some((style) => style.id === "label-style-water"));
});

test("names depend only on the map's seed and the label, so the same map gets the same names", () => {
    nextId = 100;
    const first = studio();
    FeatureNames.apply(first, syntheticMap());
    nextId = 100;
    const second = studio();
    FeatureNames.apply(second, syntheticMap());
    assert.deepEqual(first.mapLabels.map((label) => label.name), second.mapLabels.map((label) => label.name));
});

test("running again places untouched labels again, keeps edited ones, counts a gone feature and leaves the reader's own name", () => {
    const app = studio();
    FeatureNames.apply(app, syntheticMap());
    const made = () => app.mapLabels.filter((label) => label.feature);
    const count = made().length;
    const mountains = made().find((label) => label.feature.kind === "mountains");
    const forest = made().find((label) => label.feature.kind === "forest");
    forest.x += 40;
    forest.name = "The Greenwood";
    const lake = made().find((label) => label.feature.kind === "lake");
    const before = { mountains: [mountains.name, mountains.x], forestX: forest.x };

    const report = FeatureNames.apply(app, syntheticMap({ shift: 8, lake: false }));
    assert.equal(made().length, count, "nothing new: every feature found already has its label");
    assert.equal(report.added, 0);
    assert.equal(report.kept, 1, "the edited forest name is kept");
    assert.equal(report.gone, 1, "the lake has gone; its label stays");
    assert.ok(app.mapLabels.includes(lake));
    assert.deepEqual([forest.name, forest.x], ["The Greenwood", before.forestX]);
    assert.equal(mountains.name, before.mountains[0], "an untouched label keeps its name");
    assert.ok(mountains.x > before.mountains[1], "and follows its feature");

    // A name of the reader's own, in a geographic style, inside a feature found: left alone
    const fresh = studio();
    fresh.uiState.customLabelStyles.push({ id: "label-style-gulf-bay-lake", name: "Gulf, bay and lake", fontFamily: "Cormorant Garamond", fontSize: 1.8 });
    fresh.mapLabels.push({ id: "mine00000000000", name: "Mirror Mere", x: 350, y: 450, rotation: 0, quickStyle: "label-style-gulf-bay-lake", visibility: "all" });
    const own = FeatureNames.apply(fresh, syntheticMap());
    assert.equal(own.skipped, 1);
    assert.ok(!fresh.mapLabels.some((label) => label.feature?.kind === "lake"));
});

test("the last run's report belongs to its map: another map opening forgets it", async () => {
    const app = { ...studio(), mapWidth: 0 };
    platform.notify.warn = () => {};
    assert.equal(await FeatureNames.run(app), null, "no terrain yet: nothing to report");
    const studioSource = (await import("node:fs")).readFileSync(new URL("../../src/applications/MapStudio.js", import.meta.url), "utf8");
    assert.equal(studioSource.match(/FeatureNames\.forget\(this\)/g)?.length, 2, "forgotten when a map is read in and when a new map starts");
    const ready = studio();
    ready.currentElevationData = new Float32Array(W * H);
    FeatureNames.forget(ready);
    assert.equal(FeatureNames.lastReport(ready), null);
});
