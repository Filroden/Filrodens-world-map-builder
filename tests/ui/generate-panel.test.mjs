// The Generate tool's panel (GeneratePanel): its settings kept valid with the map, the fields that
// write them, the estimate, Out of date, the notices, and what the last run made; and the Output
// switches as a run writes them (Materialise on the synthetic island).
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { installPlatform, platform } = await import("../../src/platform/index.js");
let nextId = 0;
installPlatform({
    i18n: { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" },
    notify: { info() {}, warn() {}, error() {} },
    utils: { ...platform.utils, randomID: () => `g${String(++nextId).padStart(15, "0")}`, deepClone: (value) => structuredClone(value) },
});

const { FILRODENSWMB } = await import("../../src/config.js");
const { GeneratePanel } = await import("../../src/applications/GeneratePanel.js");
const { Generation } = await import("../../src/applications/Generation.js");
const { panelSettings, resolveOutput } = await import("../../src/generator/GeneratorSettings.js");
const { materialise } = await import("../../src/generator/Materialise.js");
const { runGenerator } = await import("../../src/generator/Pipeline.js");
const { MeshSession } = await import("../../src/mesh/MeshSession.js");
const { MATERIALISE_NAMES, materialiseStyles } = await import("../generator/helpers.mjs");
const { HEIGHT, WIDTH, syntheticMap } = await import("../generator/synthetic.mjs");

/** A studio stand-in: no run yet, no mesh, the default settings. */
function studio(extra = {}) {
    let renders = 0;
    return {
        uiState: { mapSeed: "MAPSEED", generatorSettings: null, generatorStale: false },
        layerSets: [],
        mapPins: [],
        mapRoutes: [],
        modelRun: null,
        currentParentId: null,
        meshSession: null,
        markDirty() {},
        view: { render: () => renders++ },
        get renders() {
            return renders;
        },
        ...extra,
    };
}

/** A field's event as the panel receives it. */
const fieldEvent = (type, target) => ({ type, target: { value: "", checked: false, ...target } });

// ------------------------------------------------------------------ settings and fields

test("the settings start at their defaults and stay valid however they arrive", () => {
    const settings = panelSettings();
    assert.equal(settings.seed, "");
    assert.equal(settings.nameBase, FILRODENSWMB.GENERATOR.DEFAULT_NAME_BASE);
    assert.deepEqual(settings.world, { density: 1, urbanisation: 1, realmSpacing: 1, fragmentation: 1 });
    assert.deepEqual(settings.output, resolveOutput());
    const odd = panelSettings({ seed: "  abc ", world: { density: 99, realmSpacing: "x" }, output: { duchies: false, counties: true, places: { town: false }, labels: "yes" } });
    assert.equal(odd.seed, "abc");
    assert.equal(odd.world.density, FILRODENSWMB.GENERATOR.WORLD.density.max);
    assert.equal(odd.world.realmSpacing, 1);
    assert.equal(odd.output.counties, false, "no counties without duchies");
    assert.equal(odd.output.places.town, false);
    assert.equal(odd.output.places.city, true);
    assert.equal(odd.output.labels, true);
});

test("a slider writes when let go, a text field when left, a tick at once; other fields are not the panel's", () => {
    const app = studio();
    const density = { name: "generator.world.density", type: "range", value: "2" };
    assert.equal(GeneratePanel.handleInput(app, fieldEvent("input", density)), true);
    assert.equal(GeneratePanel.settings(app).world.density, 1, "dragging writes nothing");
    GeneratePanel.handleInput(app, fieldEvent("change", density));
    assert.equal(GeneratePanel.settings(app).world.density, 2);
    GeneratePanel.handleInput(app, fieldEvent("change", { name: "generator.seed", type: "text", value: "Avalon" }));
    assert.equal(GeneratePanel.settings(app).seed, "Avalon");
    GeneratePanel.handleInput(app, fieldEvent("change", { name: "generator.output.duchies", type: "checkbox", checked: false }));
    assert.equal(GeneratePanel.settings(app).output.counties, false);
    assert.ok(app.renders > 0, "the panel redraws an Output change");
    assert.equal(GeneratePanel.handleInput(app, fieldEvent("change", { name: "seaLevel", type: "range", value: "0.5" })), false);
    GeneratePanel.handleInput(app, fieldEvent("change", { name: "generator.__proto__.polluted", type: "text", value: "x" }));
    assert.equal({}.polluted, undefined);
});

test("the Ages section: add copies the present, remove, move earlier and later, an era, strife and event per age; a run made before is out of date", () => {
    let stale = 0;
    const app = studio({ uiState: { mapSeed: "M", generatorSettings: null, generatorStale: false, cultures: [{ id: "elves", name: "Elves" }] }, markGeneratorStale: () => stale++ });
    GeneratePanel.handleInput(app, fieldEvent("change", { name: "generator.ages.0.era", type: "select-one", value: "afterPlague" }));
    GeneratePanel.editAges(app, "add");
    assert.deepEqual(GeneratePanel.settings(app).ages.map((age) => age.era), ["afterPlague", "afterPlague"], "a new age copies the present");
    GeneratePanel.handleInput(app, fieldEvent("change", { name: "generator.ages.1.strife", type: "select-one", value: "warTorn" }));
    GeneratePanel.handleInput(app, fieldEvent("change", { name: "generator.ages.1.event", type: "select-one", value: "invasion:elves" }));
    assert.deepEqual(GeneratePanel.settings(app).ages[1], { era: "afterPlague", strife: "warTorn", event: { kind: "invasion", culture: "elves" } });
    GeneratePanel.editAges(app, "up", 1);
    assert.equal(GeneratePanel.settings(app).ages[0].strife, "warTorn");
    GeneratePanel.editAges(app, "down", 0);
    assert.equal(GeneratePanel.settings(app).ages[1].strife, "warTorn");
    GeneratePanel.handleInput(app, fieldEvent("change", { name: "generator.ages.1.event", type: "select-one", value: "" }));
    assert.equal(GeneratePanel.settings(app).ages[1].event, null);
    const rows = GeneratePanel.context(app).ages.rows;
    assert.match(rows[1].label, /GenerateAgePresent/);
    assert.deepEqual(rows[0].events.map((event) => event.value), ["", "arrival:elves", "invasion:elves"]);
    assert.deepEqual([rows[0].canUp, rows[0].canDown, rows[1].canDown], [false, true, false]);
    GeneratePanel.editAges(app, "remove", 0);
    GeneratePanel.editAges(app, "remove", 0);
    assert.equal(GeneratePanel.settings(app).ages.length, 1, "at least one age");
    assert.ok(stale >= 6);
    assert.equal(GeneratePanel.context(studio()).ages.rows[0].events, null, "no events without cultures");
});

// ------------------------------------------------------------------ estimate, staleness, notices, results

test("each World slider double-clicks back to its default", () => {
    const { world } = GeneratePanel.context(studio());
    assert.equal(world.length, 4);
    for (const field of world) assert.equal(field.resetTo, String(FILRODENSWMB.GENERATOR.WORLD[field.name.split(".").at(-1)].default), field.name);
});

test("the estimate grows with the map and warns past a minute", () => {
    const small = GeneratePanel.estimateSeconds({ width: 1000, height: 1000, modelCount: 2000, cellCount: 60000 });
    const large = GeneratePanel.estimateSeconds({ width: 2000, height: 1600, modelCount: 14293, cellCount: 200000 });
    assert.ok(small < large);
    assert.ok(large > 2 && large < 6, `P0JBVA is about 3 s (${large.toFixed(1)})`);
    assert.equal(GeneratePanel.estimateSeconds(null), null);
    const huge = studio({ meshSession: { mesh: { width: 4000, height: 4000, modelCount: 120000, cellCount: 1e6 } } });
    const estimate = GeneratePanel.context(huge).estimate;
    assert.equal(estimate.unit, "FILRODENSWMB.UI.UnitMinutes");
    assert.equal(estimate.long, true);
    const mesh = { width: 2000, height: 1600, modelCount: 14293, cellCount: 200000 };
    const three = studio({ meshSession: { mesh }, uiState: { mapSeed: "M", generatorSettings: { ages: [{}, {}, {}] }, generatorStale: false } });
    assert.ok(Math.abs(GeneratePanel.context(three).estimate.seconds - 3 * large) < 1e-9, "each age adds a run's time");
});

test("Out of date shows only for a map with a run, and the notices follow the map", () => {
    const app = studio({ uiState: { mapSeed: "S", generatorStale: true } });
    assert.equal(GeneratePanel.context(app).stale, false, "no run, nothing to be out of date");
    app.modelRun = { run: "mine", stats: {} };
    const context = GeneratePanel.context(app);
    assert.equal(context.stale, true);
    assert.equal(context.runBadge, "FILRODENSWMB.UI.GenerateOutOfDate");

    const regional = studio({ currentParentId: "parent", mapPins: [{ generated: { run: "parents" } }] });
    assert.deepEqual(GeneratePanel.context(regional).notices, ["FILRODENSWMB.UI.GenerateInheritedNotice"]);
    regional.mapPins = [{ name: "hand-made" }];
    assert.deepEqual(GeneratePanel.context(regional).notices, []);

    const land = new Uint8Array(100).fill(1);
    const small = studio({ meshSession: { mesh: { width: 10, height: 10, modelCount: 100, cellCount: 100 }, aggregates: { land } } });
    assert.ok(GeneratePanel.context(small).notices.includes("FILRODENSWMB.UI.GenerateSmallWorldNotice"));
});

test("the results count what the last run left on the map", () => {
    const run = "last";
    const app = studio({
        modelRun: { run, stats: { population: 12345 } },
        layerSets: [{ levels: [{ regions: [{ generated: { run, kind: "realm" } }, { generated: { run: "older", kind: "realm" } }] }, { regions: [{ generated: { run, kind: "duchy" } }] }] }],
        mapPins: [{ generated: { run, tier: "capital", kind: "town" } }, { generated: { run, tier: "town", kind: "town" } }, { generated: { run, tier: "castle", kind: "castle" } }, { name: "mine" }],
        mapRoutes: [{ transport: "road", generated: { run } }, { transport: "sea", generated: { run } }, { transport: "road" }],
    });
    const results = Object.fromEntries(GeneratePanel.results(app).rows.map((row) => [row.label.replace("FILRODENSWMB.UI.GenerateResult", ""), row.value]));
    assert.deepEqual(results, { Realms: "1", Duchies: "1", Counties: "0", Capitals: "1", Cities: "0", Towns: "1", Castles: "1", Roads: "1", RiverTrade: "0", SeaLanes: "1" });
    assert.equal(GeneratePanel.results(app).population, "12,345");
    assert.deepEqual(Generation.counts(app), { realms: 2, places: 3, routes: 2 });
});

// ------------------------------------------------------------------ the Output switches

let island = null;
async function islandRun() {
    if (island) return island;
    const { mesh, buffers, makePayload } = syntheticMap();
    const aggregates = mesh.aggregate({ elevation: buffers.elevation, waterMask: buffers.waterMask, seaLevel: makePayload().seaLevel });
    const result = await runGenerator(makePayload(), { pause: () => Promise.resolve() });
    island = { mesh, aggregates, result };
    return island;
}

async function materialiseWith(output) {
    const { mesh, aggregates, result } = await islandRun();
    const session = new MeshSession({ mesh, meshBlock: { seed: 7, spacing: 4, cells: mesh.cellCount, width: WIDTH, height: HEIGHT, version: 1 }, layerSets: [], owners: {}, aggregates });
    let next = 0;
    return { result, made: materialise(session, result, { runId: "run", idFactory: () => `id${++next}`, layerSets: [], names: MATERIALISE_NAMES, watersPx: 24, ...materialiseStyles(), output }) };
}

test("Output decides the levels, the places, the routes and the names a run writes", async () => {
    const all = (await materialiseWith({})).made;
    assert.equal(all.set.levels.length, 3);

    const { made, result } = await materialiseWith({ duchies: false, places: { town: false, castle: false }, routes: { sea: false }, labels: false });
    assert.deepEqual(made.set.levels.map((level) => level.name), ["Realms"], "realms only");
    assert.equal(Object.keys(made.owners).length, 1);
    assert.ok(made.pins.every((pin) => pin.generated.kind !== "castle"));
    assert.ok(made.pins.every((pin) => result.places[pin.generated.sourceId].tier !== 2 || result.places[pin.generated.sourceId].capital), "no towns but capitals");
    assert.ok(made.pins.some((pin) => pin.generated.tier === "capital"), "capitals always");
    assert.ok(made.routes.every((route) => route.transport !== "sea"));
    assert.ok(made.pins.every((pin) => pin.label.visibility === "none"));
    assert.ok(made.set.levels[0].regions.every((region) => region.label.visibility === "none"));
    const unnamed = (await materialiseWith({ labels: false })).made;
    assert.ok(unnamed.set.levels.every((level) => level.regions.every((region) => region.label.visibility === "none")), "no level's names");

    const noCounties = (await materialiseWith({ counties: false })).made;
    assert.deepEqual(noCounties.set.levels.map((level) => level.name), ["Realms", "Duchies"]);
});

test("the results count ruins, abandoned castles and old roads apart from the present's places and roads; the history switch shows with more than one age", () => {
    const gen = (kind, extra = {}) => ({ generated: { run: "r", kind, ...extra } });
    const app = studio({
        modelRun: { run: "r", stats: { population: 10 } },
        mapPins: [gen("town", { tier: "town" }), gen("ruin", { tier: "ruin" }), gen("ruin", { tier: "ruin" }), gen("abandonedCastle", { tier: "abandonedCastle" })],
        mapRoutes: [{ transport: "road", ...gen("route") }, { transport: "road", ...gen("route", { oldRoad: true }) }],
    });
    const rows = Object.fromEntries(GeneratePanel.results(app).rows.map((row) => [row.label.replace("FILRODENSWMB.UI.GenerateResult", ""), row.value]));
    assert.equal(rows.Towns, "1");
    assert.equal(rows.Ruins, "2");
    assert.equal(rows.AbandonedCastles, "1");
    assert.equal(rows.Roads, "1");
    assert.equal(rows.OldRoads, "1");
    assert.equal(GeneratePanel.context(app).output.showHistory, false);
    GeneratePanel.editAges(app, "add");
    assert.equal(GeneratePanel.context(app).output.showHistory, true);
    assert.equal(GeneratePanel.context(app).output.history, true);
});
