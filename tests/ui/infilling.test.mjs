// Fill in on a regional map (Infilling): what in-fill works out is written onto the map as market
// towns and villages in their own styles and lanes in the Lane style, marked as in-fill's, as one
// undo step; filling in again replaces the last fill-in except what the reader has made their own,
// and never touches what the map inherited; and the Generate panel's section says whether it is
// offered and what the last fill-in added.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { installPlatform, platform } = await import("../../src/platform/index.js");

let nextId = 0;
installPlatform({
    i18n: { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" },
    notify: { info() {}, warn() {}, error() {} },
    utils: { ...platform.utils, randomID: () => `f${String(++nextId).padStart(15, "0")}`, deepClone: (value) => structuredClone(value), mergeObject: (target, source) => Object.assign(target, source) },
    dialogs: { confirm: async () => true },
});

const { FILRODENSWMB } = await import("../../src/config.js");
const { Infilling } = await import("../../src/applications/Infilling.js");
const { InfillInput } = await import("../../src/applications/InfillInput.js");
const { VectorHistory } = await import("../../src/applications/VectorHistory.js");
const { runInfill } = await import("../../src/generator/Infill.js");
const { MeshSession } = await import("../../src/mesh/MeshSession.js");
const { HEIGHT, WIDTH, syntheticMap } = await import("../generator/synthetic.mjs");
const { parentRunOf } = await import("../generator/infill-helpers.mjs");

/** A regional map's studio on the synthetic island, with an inherited town and road and a pin of the reader's own. */
function studio() {
    const { mesh, buffers, makePayload } = syntheticMap();
    const payload = makePayload();
    const aggregates = mesh.aggregate({ elevation: buffers.elevation, waterMask: buffers.waterMask, seaLevel: payload.seaLevel });
    const meshSession = new MeshSession({ mesh, meshBlock: { seed: 7, spacing: 4, cells: mesh.cellCount, width: WIDTH, height: HEIGHT, version: 1 }, layerSets: [], owners: {}, aggregates });
    return {
        meshSession,
        payload,
        parentRun: parentRunOf(mesh, payload),
        currentParentId: "parentAAAAAAAAAA",
        layerSets: [],
        tectonicFaults: [],
        manualRivers: [],
        landMasks: [],
        mapPins: [
            { id: "inherited-town", name: "Ashby", icon: "dot", x: 180, y: 180, generated: { run: "runAAAAAAAAAAAAA", kind: "town", tier: "town", population: 5000, edited: false, locked: false } },
            { id: "own-pin", name: "My inn", icon: "dot", x: 1, y: 1 },
        ],
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

let worked = null;
/** In-fill on the studio's map, worked out once (the pure model is tested in infill.test.mjs). */
function infillOf(app) {
    if (worked) return worked;
    const mesh = app.meshSession.mesh;
    const grid = InfillInput.grid(mesh);
    const { input } = InfillInput.gather({ mesh, grid, parentRun: app.parentRun, payload: app.payload, pins: app.mapPins, routes: app.mapRoutes, speeds: FILRODENSWMB.TRAVEL_TIME.SPEEDS, seed: "SYNTH", nameBase: "English" });
    // Across the whole island, not only near its one town
    worked = { result: runInfill({ ...input, options: { ROUTE_REACH_KM: 1e9 } }), grid };
    return worked;
}

const infillPins = (app) => app.mapPins.filter((pin) => Infilling.isInfill(pin));
const infillRoutes = (app) => app.mapRoutes.filter((route) => Infilling.isInfill(route));

test("a fill-in is written as market towns, villages and lanes in their styles, as one undo step", () => {
    const app = studio();
    const { result, grid } = infillOf(app);
    const made = Infilling.apply(app, result, grid);

    const pins = infillPins(app);
    assert.equal(pins.length, result.places.length);
    assert.equal(made.markets + made.villages, pins.length);
    assert.ok(made.markets > 0 && made.villages > 0, `${made.markets} markets, ${made.villages} villages`);
    for (const pin of pins) {
        assert.ok(["marketTown", "largeVillage", "village"].includes(pin.generated.tier));
        assert.equal(pin.generated.kind, "town");
        assert.equal(pin.generated.edited, false);
        assert.ok(pin.pinStyle, "a style of the map's");
        assert.ok(Number.isInteger(pin.cell));
    }
    const marketStyle = app.uiState.customPinStyles.find((style) => style.tier === "marketTown");
    assert.equal(marketStyle?.icon, "dot");
    assert.ok(pins.filter((pin) => pin.generated.tier === "marketTown").every((pin) => pin.pinStyle === marketStyle.id));

    const lanes = infillRoutes(app);
    assert.equal(lanes.length, made.lanes);
    assert.ok(lanes.length > 0);
    assert.equal(lanes.length, app.mapRoutes.length, "every route on the map is a lane");
    assert.ok(lanes.every((lane) => lane.quickStyle === "route-style-lane" && lane.transport === "road" && lane.waypoints.length >= 2));
    assert.ok(app.uiState.customRouteStyles.some((style) => style.id === "route-style-lane"), "the Lane style is added to the map");

    // Each place stands on a land cell of its own in-fill cell (the island's in-fill cells are its
    // display cells, so here that is the site; a regional map's hold several)
    const byCell = new Map(result.places.map((place) => [place.name, place.cell]));
    const land = app.meshSession.aggregates.land;
    assert.ok(pins.every((pin) => grid.of[pin.cell] === byCell.get(pin.name) && land[pin.cell] === 1), "within its in-fill cell, on land");

    assert.ok(app.mapPins.some((pin) => pin.id === "inherited-town") && app.mapPins.some((pin) => pin.id === "own-pin"));
    assert.equal(app.pinHistory.length, 1, "one undo step");
    VectorHistory.step(app, true);
    assert.equal(infillPins(app).length + infillRoutes(app).length, 0, "undo takes the fill-in away");
    assert.equal(app.mapPins.length, 2);
});

test("filling in again replaces the last fill-in, keeping what the reader made their own and what the map inherited", () => {
    const app = studio();
    const { result, grid } = infillOf(app);
    Infilling.apply(app, result, grid);
    const [edited, locked] = infillPins(app);
    edited.generated.edited = true;
    locked.generated.locked = true;
    const firstIds = new Set(infillPins(app).map((pin) => pin.id));

    Infilling.apply(app, result, grid);
    const pins = infillPins(app);
    assert.ok(pins.some((pin) => pin.id === edited.id) && pins.some((pin) => pin.id === locked.id), "the edited and locked places stay");
    assert.equal(pins.filter((pin) => firstIds.has(pin.id)).length, 2, "nothing else of the first fill-in is left");
    assert.ok(app.mapPins.some((pin) => pin.id === "inherited-town"), "the inherited town stays");
    assert.equal(infillRoutes(app).length, app.mapRoutes.length);
});

test("the Fill in section: shown on regional maps, offered when the parent's cells are far enough apart, with the last fill-in's counts", () => {
    const app = studio();
    assert.equal(Infilling.context({ ...app, currentParentId: null, parentRun: null }), null, "not on a map that was not cut from another");

    const coarse = Infilling.context(app);
    assert.equal(coarse.offered, false, `the island's cells are ${app.parentRun.spacingPx} px apart`);
    assert.equal(coarse.reason, "FILRODENSWMB.UI.InfillTooCoarse");
    assert.equal(Infilling.context({ ...app, parentRun: null }).reason, "FILRODENSWMB.UI.InfillNoParentRun");

    const fine = { ...app, parentRun: { ...app.parentRun, spacingPx: FILRODENSWMB.INFILL.MIN_PARENT_PX } };
    assert.deepEqual(Infilling.context(fine), { offered: true, reason: null, counts: { markets: 0, villages: 0, lanes: 0 }, shown: { markets: "0", villages: "0", lanes: "0" }, again: false });

    const { result, grid } = infillOf(app);
    const made = Infilling.apply(app, result, grid);
    const after = Infilling.context(app);
    assert.deepEqual(after.counts, made);
    assert.equal(after.shown.villages, made.villages.toLocaleString("en"));
    assert.equal(after.again, true);
});

test("a place keeps out of a drawn river and a few pixels from its edge", async () => {
    const { RiverNetwork } = await import("../../src/generation/RiverNetwork.js");
    const range = RiverNetwork.FIELD_RANGE;
    // The image's red byte at a distance from the channel's edge (negative inside)
    const pixel = (distance) => Uint8Array.of(Math.round(((range - distance) / (2 * range)) * 255), 0, 0, 0);
    assert.equal(RiverNetwork.isNearChannel(pixel(-2), 0, 3), true, "in the channel");
    assert.equal(RiverNetwork.isNearChannel(pixel(2), 0, 3), true, "two pixels from the edge");
    assert.equal(RiverNetwork.isNearChannel(pixel(3.5), 0, 3), false, "beyond the margin");
    assert.equal(RiverNetwork.isNearChannel(new Uint8Array(4), 0, 3), false, "no river near");
});

test("a fill-in starts the map at the most detailed level whose new places stand far enough apart", () => {
    const app = studio();
    const { DETAIL } = FILRODENSWMB;
    const { count, land } = app.meshSession.aggregates;
    let landPx = 0;
    for (let cell = 0; cell < land.length; cell++) if (land[cell]) landPx += count[cell];
    // How many places stand exactly MIN_SPACING_PX apart on average over the land
    const fits = Math.floor(landPx / DETAIL.MIN_SPACING_PX ** 2);
    const places = (tier, n) => Array.from({ length: n }, () => ({ pinStyle: null, generated: { tier } }));
    assert.equal(Infilling.startLevel(app, []), DETAIL.EVERYTHING);
    assert.equal(Infilling.startLevel(app, places("village", fits)), DETAIL.EVERYTHING, "all far enough apart");
    assert.equal(Infilling.startLevel(app, [...places("village", fits * 4), ...places("marketTown", fits)]), DETAIL.LOCAL, "only the market towns and large villages");
    assert.ok(Infilling.startLevel(app, [...places("village", fits * 4), ...places("largeVillage", fits * 2)]) < DETAIL.LOCAL, "not even those");
});
