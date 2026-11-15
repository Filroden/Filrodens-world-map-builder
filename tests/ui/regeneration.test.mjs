// Generate again and Remove generated content (Regeneration, Generation): what earlier runs made
// is replaced in the same Political set, except what the reader has made their own (an edited or
// locked item; a region keeps its whole realm; everything hand-made), as one undo step; and the
// edit paths that mark an item as the reader's own (GeneratedEdits) on the canvas and in lists.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { installPlatform, platform } = await import("../../src/platform/index.js");

let nextId = 0;
let confirmAnswer = true;
installPlatform({
    i18n: { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" },
    notify: { info() {}, warn() {}, error() {} },
    utils: { ...platform.utils, randomID: () => `g${String(++nextId).padStart(15, "0")}`, deepClone: (value) => structuredClone(value), mergeObject: (target, source) => Object.assign(target, source) },
    dialogs: { confirm: async () => confirmAnswer },
});

const { Generation } = await import("../../src/applications/Generation.js");
const { GeneratePanel } = await import("../../src/applications/GeneratePanel.js");
const { GeneratedDetails } = await import("../../src/applications/GeneratedDetails.js");
const { Regeneration } = await import("../../src/applications/Regeneration.js");
const { GeneratedEdits } = await import("../../src/applications/GeneratedEdits.js");
const { VectorHistory } = await import("../../src/applications/VectorHistory.js");
const { MassEdit } = await import("../../src/applications/MassEdit.js");
const { RegionPanel } = await import("../../src/applications/RegionPanel.js");
const { RunInputs } = await import("../../src/applications/RunInputs.js");
const { runGenerator } = await import("../../src/generator/Pipeline.js");
const { MeshSession } = await import("../../src/mesh/MeshSession.js");
const { UNCLAIMED } = await import("../../src/mesh/Schema.js");
const { HEIGHT, WIDTH, syntheticMap } = await import("../generator/synthetic.mjs");

let result = null;
async function islandResult() {
    result ??= await runGenerator(syntheticMap().makePayload(), { pause: () => Promise.resolve() });
    return result;
}

function studio() {
    const { mesh, buffers, makePayload } = syntheticMap();
    const aggregates = mesh.aggregate({ elevation: buffers.elevation, waterMask: buffers.waterMask, seaLevel: makePayload().seaLevel });
    const meshSession = new MeshSession({ mesh, meshBlock: { seed: 7, spacing: 4, cells: mesh.cellCount, width: WIDTH, height: HEIGHT, version: 1 }, layerSets: [], owners: {}, aggregates });
    return {
        meshSession,
        layerSets: [],
        tectonicFaults: [],
        manualRivers: [],
        landMasks: [],
        mapPins: [{ id: "own-pin", name: "My inn", icon: "dot", x: 1, y: 1 }],
        mapRoutes: [],
        mapLabels: [],
        mapDecorations: [],
        modelRun: null,
        uiState: { customBiomes: [], customRouteStyles: [], customPinStyles: [] },
        pinHistory: [],
        pinRedoStack: [],
        globalHistoryLedger: [],
        globalRedoLedger: [],
        get regionLevels() {
            return this.layerSets.flatMap((set) => set.levels);
        },
        _repaintVectors() {},
        markDirty() {},
    };
}

const political = (app) => app.layerSets.filter((set) => set.kind === "political");
const ownersOf = (app, level) => Array.from(app.meshSession.layer(level.id).owners);
const generatedPins = (app) => app.mapPins.filter((pin) => pin.generated);

test("Generate again replaces the earlier run's content in the same Political set, as one undo step", async () => {
    const app = studio();
    const run = await islandResult();
    Generation.apply(app, run);
    const first = { set: political(app)[0], realm: political(app)[0].levels[0].regions[0].id, pins: generatedPins(app).map((pin) => pin.id) };
    assert.deepEqual(Regeneration.plan(app).removed, { realms: 1, places: first.pins.length, routes: app.mapRoutes.length });

    Generation.apply(app, run);
    assert.equal(political(app).length, 1, "one Political set");
    assert.equal(political(app)[0].id, first.set.id, "the same set");
    const [realms] = political(app)[0].levels;
    assert.equal(realms.regions.length, 1);
    assert.notEqual(realms.regions[0].id, first.realm, "the realm is the new run's");
    assert.ok(generatedPins(app).every((pin) => !first.pins.includes(pin.id)), "the places are the new run's");
    assert.ok(app.mapPins.some((pin) => pin.id === "own-pin"), "a hand-made pin stays");
    const owners = ownersOf(app, realms);
    assert.ok(owners.every((owner) => owner === UNCLAIMED || realms.regions.some((region) => region.key === owner)), "every owned cell is a region's");

    VectorHistory.step(app, true);
    const restored = political(app)[0];
    assert.equal(restored.levels[0].regions[0].id, first.realm, "undo brings the first run back");
    assert.deepEqual(generatedPins(app).map((pin) => pin.id), first.pins);
    assert.ok(ownersOf(app, restored.levels[0]).some((owner) => owner === restored.levels[0].regions[0].key));
});

test("an edited county keeps its whole realm; a locked place and an edited route stay; nothing is put on a kept place", async () => {
    const app = studio();
    const run = await islandResult();
    Generation.apply(app, run);
    const set = political(app)[0];
    const [realms, duchies, counties] = set.levels;
    const keptIds = set.levels.flatMap((level) => level.regions.map((region) => region.id));
    const keptOwners = set.levels.map((level) => ownersOf(app, level));
    counties.regions[0].generated.edited = true;
    const lockedPin = generatedPins(app)[0];
    lockedPin.generated.locked = true;
    const editedRoute = app.mapRoutes[0];
    editedRoute.generated.edited = true;

    const plan = Regeneration.plan(app);
    assert.equal(plan.removed.realms, 0, "the realm is kept");
    Generation.apply(app, run);

    const after = political(app)[0];
    assert.deepEqual(after.levels.flatMap((level) => level.regions.map((region) => region.id)).filter((id) => keptIds.includes(id)).sort(), [...keptIds].sort(), "the realm, its duchies and counties are kept");
    after.levels.forEach((level, depth) => {
        const now = ownersOf(app, level);
        keptOwners[depth].forEach((owner, cell) => {
            if (owner !== UNCLAIMED) assert.equal(now[cell], owner, "a kept region's cells are its own still");
        });
    });
    assert.ok(app.mapPins.includes(lockedPin));
    assert.equal(app.mapPins.filter((pin) => pin.cell === lockedPin.cell).length, 1, "no new place on the kept one's cell");
    assert.ok(app.mapRoutes.includes(editedRoute));
    assert.equal(realms.regions.length + duchies.regions.length >= 2, true);
});

test("a port or river town standing off its cell's site is not put beside a kept pin on that site", async () => {
    const app = studio();
    Generation.apply(app, await islandResult());
    const { mesh } = app.meshSession;
    const shore = generatedPins(app).find((pin) => mesh.parentOf[pin.cell] !== pin.cell);
    assert.ok(shore, "a run on the island puts a port or river town off its site");
    const site = mesh.parentOf[shore.cell];
    const next = { ...shore, id: "next-run-pin" };
    app.mapPins = [];
    assert.deepEqual(Regeneration.placesBeside(app, [next]), [next], "with nothing kept, it stays");
    app.mapPins = [{ id: "kept", name: "Kept", x: mesh.siteX(site), y: mesh.siteY(site), cell: site }];
    assert.deepEqual(Regeneration.placesBeside(app, [next]), [], "a kept pin on its model cell's site");
    app.mapPins = [{ id: "kept", name: "Kept", x: shore.x, y: shore.y, cell: shore.cell }];
    assert.deepEqual(Regeneration.placesBeside(app, [next]), [], "a kept pin on its own cell");
});

test("settlement pins are seats: a hand-placed one gains the run's figures and stays the reader's, a kept generated one is refreshed, and neither gets a pin beside it", async () => {
    const app = studio();
    Generation.apply(app, await islandResult());
    const { mesh } = app.meshSession;
    const styleOf = (tier) => app.uiState.customPinStyles.find((style) => style.tier === tier);
    const kept = generatedPins(app).find((pin) => pin.generated.kind === "town");
    kept.generated.locked = true;
    const keptName = kept.name;
    // A city drawn by hand on empty land (no generated pin in its model cell)
    const taken = new Set(app.mapPins.filter((pin) => Number.isInteger(pin.cell)).map((pin) => mesh.parentOf[pin.cell]));
    const empty = Array.from({ length: mesh.modelCount }, (_, cell) => cell).find((cell) => !taken.has(cell) && app.meshSession.aggregates.land[cell] === 1);
    const mine = { id: "my-city", name: "Hightower", icon: "star", x: mesh.siteX(empty), y: mesh.siteY(empty), cell: empty, pinStyle: styleOf("city").id };
    const ruin = { id: "my-ruin", name: "Old", icon: "x", x: 1, y: 1, pinStyle: styleOf("ruin")?.id ?? null };
    app.mapPins.push(mine, ruin);

    const seats = Generation.seats(app);
    assert.deepEqual(seats.find((seat) => seat.pin === "my-city"), { cell: empty, kind: "city", pin: "my-city", x: mine.x, y: mine.y, land: true });
    assert.ok(seats.some((seat) => seat.pin === kept.id), "a kept generated settlement is a seat");
    assert.ok(!seats.some((seat) => seat.pin === "my-ruin" || seat.pin === "own-pin"), "a ruin and a pin of no settlement style are not");
    assert.ok(!seats.some((seat) => generatedPins(app).some((pin) => pin.id === seat.pin && !pin.generated.locked && !pin.generated.edited)), "a generated pin a run replaces is not");

    const result = await runGenerator(syntheticMap().makePayload({}, seats), { pause: () => Promise.resolve() });
    Generation.apply(app, result);
    const run = app.modelRun.run;
    assert.equal(mine.generated, undefined, "still the reader's own");
    assert.equal(mine.modelled.run, run);
    assert.ok(mine.modelled.population > 0 && ["city", "capital"].includes(mine.modelled.tier));
    assert.deepEqual([mine.x, mine.y, mine.name], [mesh.siteX(empty), mesh.siteY(empty), "Hightower"], "never moved or renamed");
    assert.equal(kept.generated.run, run, "the kept pin's figures are this run's");
    assert.equal(kept.name, keptName);
    assert.equal(app.mapPins.filter((pin) => Number.isInteger(pin.cell) && mesh.parentOf[pin.cell] === empty).length, 1, "no new pin beside the seat");
    assert.ok(app.modelRun.seats.used >= 2);
    assert.ok(GeneratePanel.results(app).rows.some((row) => row.label === "FILRODENSWMB.UI.GenerateResultSeats"));
    const rows = GeneratedDetails.forPin(app, mine);
    assert.ok(rows.some((row) => row.value === "FILRODENSWMB.UI.GeneratedKeptSeat"), "the inspector shows what the run made of it, and that it stays");

    assert.equal(await Generation.removeGenerated(app), true);
    assert.ok(app.mapPins.includes(mine) && app.mapPins.includes(kept), "Remove generated content leaves seats");
    assert.equal(mine.modelled, undefined, "and what the run gave them goes with it");
    VectorHistory.step(app, true);
    assert.equal(app.mapPins.find((pin) => pin.id === "my-city").modelled.run, run, "undo brings it back");
});

test("the map's own routes go to the run's trade: those drawn by hand and generated ones kept, by their model cells, but not an old road or one a run replaces", async () => {
    const app = studio();
    Generation.apply(app, await islandResult());
    const { mesh } = app.meshSession;
    const [edited, untouched, old] = app.mapRoutes;
    edited.generated.edited = true;
    old.generated.locked = true;
    old.generated.oldRoad = true;
    // A road drawn by hand along display cells, with a stretch in one model cell
    const line = [];
    for (let x = 150; x <= 260; x += 3) {
        const cell = app.meshSession.cellAt(x, 180);
        if (line.at(-1) !== cell) line.push(cell);
    }
    const mine = { id: "my-road", transport: "road", waypoints: [line[0], line.at(-1)], legs: [line] };
    const lone = { id: "short", transport: "sea", waypoints: [line[0]], legs: [] };
    app.mapRoutes.push(mine, lone);

    const routes = Generation.userRoutes(app);
    const expected = [];
    for (const cell of line) if (expected.at(-1) !== mesh.parentOf[cell]) expected.push(mesh.parentOf[cell]);
    assert.deepEqual(routes.at(-1), { transport: "road", cells: expected }, "a hand-drawn road by the model cells its line passes, repeats dropped");
    assert.equal(routes.length, 2, "the edited generated route and the hand-drawn road; not the untouched one, the old road, or one of a single cell");
    assert.equal(routes[0].transport, edited.transport);
    assert.ok(!routes.some((route) => route.cells.join() === untouched.waypoints.map((cell) => mesh.parentOf[cell]).join() && untouched !== edited));
});

test("a run is out of date once the routes, settlement pins, Political regions or rivers it read change, by any path, and no longer once undone", async () => {
    const app = studio();
    Generation.apply(app, await islandResult());
    const { mesh } = app.meshSession;
    assert.deepEqual(Object.keys(app.modelRun.inputs), RunInputs.KINDS, "the run keeps a fingerprint of each");
    assert.deepEqual(RunInputs.changed(app), [], "the map as the run left it");
    assert.equal(RunInputs.stale(app), false);
    assert.equal(GeneratePanel.context(app).stale, false);

    // A hand-drawn road: drawn, renamed and restyled (nothing the run reads), then deleted and undone
    const line = [];
    for (let x = 150; x <= 260; x += 3) {
        const cell = app.meshSession.cellAt(x, 180);
        if (line.at(-1) !== cell) line.push(cell);
    }
    VectorHistory.push(app, VectorHistory.snapshot(app));
    app.mapRoutes.push({ id: "my-road", name: "Old road", transport: "road", waypoints: [line[0], line.at(-1)], legs: [line] });
    assert.deepEqual(RunInputs.changed(app), ["routes"], "a route drawn");
    assert.equal(GeneratePanel.context(app).stale, true);
    assert.equal(GeneratePanel.context(app).runBadge, "FILRODENSWMB.UI.GenerateOutOfDate");
    VectorHistory.step(app, true);
    assert.deepEqual(RunInputs.changed(app), [], "and undone");
    const kept = app.mapRoutes[0];
    kept.generated.locked = true;
    assert.deepEqual(RunInputs.changed(app), ["routes"], "a generated route locked is the reader's, so read");
    app.modelRun.inputs = RunInputs.of(app);
    Object.assign(kept, { name: "Renamed", color: "#123456", visibility: "none" });
    assert.deepEqual(RunInputs.changed(app), [], "a name, look or visibility is not read");
    app.mapRoutes = app.mapRoutes.filter((route) => route !== kept);
    assert.deepEqual(RunInputs.changed(app), ["routes"], "a route deleted");
    app.mapRoutes.unshift(kept);

    // A settlement pin drawn on a city style, then moved
    const city = app.uiState.customPinStyles.find((style) => style.tier === "city");
    const site = Array.from({ length: mesh.modelCount }, (_, cell) => cell).find((cell) => app.meshSession.aggregates.land[cell] === 1);
    const pin = { id: "my-city", name: "Hightower", icon: "star", x: mesh.siteX(site), y: mesh.siteY(site), pinStyle: city.id };
    app.mapPins.push(pin);
    assert.deepEqual(RunInputs.changed(app), ["seats"]);
    app.modelRun.inputs = RunInputs.of(app);
    pin.x += 30;
    assert.deepEqual(RunInputs.changed(app), ["seats"], "a seat moved");
    pin.x -= 30;
    pin.name = "Lowtower";
    assert.deepEqual(RunInputs.changed(app), [], "a seat renamed is not read");

    // A Political region locked (kept, so read), then given the Independent choice
    const county = political(app)[0].levels[2].regions[0];
    county.generated.locked = true;
    assert.deepEqual(RunInputs.changed(app), ["regions"], "a kept region");
    app.modelRun.inputs = RunInputs.of(app);
    county.independent = true;
    assert.deepEqual(RunInputs.changed(app), ["regions"], "its Independent choice");
    county.independent = false;
    // Land made water where no kept region lies (a lake a river source makes) is not a change to the regions
    const owners = app.meshSession.layer(political(app)[0].levels[2].id).owners;
    const keptCounties = Regeneration.keptKeys(political(app)[0])[2];
    const land = app.meshSession.aggregates.land;
    const elsewhere = land.findIndex((value, cell) => value === 1 && !keptCounties.has(owners[cell]));
    land[elsewhere] = 0;
    assert.deepEqual(RunInputs.changed(app), [], "land changed outside the kept regions");
    land[elsewhere] = 1;

    // The rivers traced again differently (a spring added, a custom river drawn)
    app.currentRiverData = { vectors: [{ id: "r", mergeInto: null, path: [{ x: 10, y: 20 }, { x: 11, y: 21, isLake: true }] }], network: { flows: new Map([["r", Float32Array.of(1, 2)]]), pixelsPerBaseline: 1 } };
    assert.deepEqual(RunInputs.changed(app), ["rivers"]);
    app.modelRun.inputs = RunInputs.of(app);
    app.currentRiverData = { ...app.currentRiverData, network: { flows: new Map([["r", Float32Array.of(1, 3)]]), pixelsPerBaseline: 1 } };
    assert.deepEqual(RunInputs.changed(app), ["rivers"], "a river's flow");

    // The drawn features: a custom river and a river source drawn, renamed (not read), moved, and undone
    app.modelRun.inputs = RunInputs.of(app);
    assert.equal(RunInputs.tracksFeatures(app), true);
    app.manualRivers = [{ id: "river", name: "Brook", points: [{ x: 10, y: 10 }, { x: 40, y: 30 }], width: 2, visibility: "all" }];
    assert.deepEqual(RunInputs.changed(app), ["features"], "a custom river drawn");
    app.modelRun.inputs = RunInputs.of(app);
    Object.assign(app.manualRivers[0], { name: "Beck", visibility: "none" });
    assert.deepEqual(RunInputs.changed(app), [], "a custom river renamed or hidden");
    app.manualRivers[0].points[1].x = 45;
    assert.deepEqual(RunInputs.changed(app), ["features"], "and moved");
    app.manualRivers[0].points[1].x = 40;
    app.mapPins.push({ id: "spring", name: "River Source", x: 100, y: 80, type: "spring", radius: 6, visibility: "all" });
    assert.deepEqual(RunInputs.changed(app), ["features"], "a river source placed");
    app.mapPins.pop();
    app.tectonicFaults = [{ id: "fault", points: [{ x: 1, y: 1 }, { x: 9, y: 9 }], type: "ridge", thickness: 5, strength: 1 }];
    assert.deepEqual(RunInputs.changed(app), ["features"], "a fault");
    app.tectonicFaults = [];
    assert.deepEqual(RunInputs.changed(app), [], "each taken back");

    // The flag set by the terrain and settings still counts; a run saved without a fingerprint is never out of date by one
    delete app.modelRun.inputs;
    assert.equal(RunInputs.stale(app), false);
    app.uiState.generatorStale = true;
    assert.equal(RunInputs.stale(app), true);
    app.modelRun = null;
    assert.equal(RunInputs.stale(app), false, "no run, nothing out of date");
});

test("Remove generated content takes what is not kept, drops a set left empty, and is one undo step", async () => {
    const app = studio();
    Generation.apply(app, await islandResult());
    const levels = political(app)[0].levels.map((level) => level.id);
    confirmAnswer = false;
    assert.equal(await Generation.removeGenerated(app), false, "a confirmation first");
    confirmAnswer = true;
    assert.equal(await Generation.removeGenerated(app), true);
    assert.equal(political(app).length, 0, "the empty set goes");
    assert.deepEqual(app.mapPins.map((pin) => pin.id), ["own-pin"]);
    assert.equal(app.mapRoutes.length, 0);
    assert.equal(app.modelRun, null);
    VectorHistory.step(app, true);
    assert.equal(political(app).length, 1);
    assert.deepEqual(political(app)[0].levels.map((level) => level.id), levels);
    assert.ok(ownersOf(app, political(app)[0].levels[0]).some((owner) => owner !== UNCLAIMED), "its cells come back");
    assert.equal(await Generation.removeGenerated(app), true);
    assert.equal(await Generation.removeGenerated(app), false, "nothing left to remove");
});

test("a stroke that changes a generated region's cells marks it, and undo unmarks it", () => {
    const app = studio();
    const level = { id: "lv", regions: [{ id: "a", key: 0, generated: { edited: false } }, { id: "b", key: 1, generated: { edited: false } }, { id: "c", key: 2 }] };
    app.layerSets = [{ id: "s", kind: "political", levels: [level] }];
    app.meshSession.setLayerSets(app.layerSets);
    const marked = GeneratedEdits.markPatched(app, new Map([["lv", { cells: [5], before: [0], after: [2] }]]));
    assert.deepEqual(marked, ["a"], "the region that lost cells; a hand-made one is not generated");
    VectorHistory.push(app, VectorHistory.edited(marked));
    VectorHistory.step(app, true);
    assert.equal(level.regions[0].generated.edited, false);
    VectorHistory.step(app, false);
    assert.equal(level.regions[0].generated.edited, true);
});

test("Mass Edit marks only for changes other than visibility; a region renamed in its list is marked", () => {
    const app = studio();
    const pins = [{ id: "p", icon: "dot", generated: { edited: false } }];
    app.mapPins = pins;
    MassEdit.apply(app, "pin", pins, [{ store: "item", key: "visibility", value: "gm" }]);
    assert.equal(pins[0].generated.edited, false);
    MassEdit.apply(app, "pin", pins, [{ store: "item", key: "color", value: "#123456" }]);
    assert.equal(pins[0].generated.edited, true);

    const region = { id: "r", key: 0, name: "Old", generated: { edited: false } };
    app.layerSets = [{ id: "s", name: "Political", kind: "political", levels: [{ id: "lv", name: "Realms", regions: [region] }] }];
    app.meshSession.setLayerSets(app.layerSets);
    RegionPanel.rename(app, "region:r", "New");
    assert.equal(region.generated.edited, true);
});
