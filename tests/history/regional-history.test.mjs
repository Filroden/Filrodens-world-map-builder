// A regional map's History before it is generated itself (stage 9d): the cut carries its parent
// run's settings and earlier ages on the cells it keeps (ParentRun.cropRun, ModelRun.cropHistory),
// and HistoryView reads them through the parent run's cells: the same ages, realms, places and
// roads as on the parent where the regional map covers it all, and only what lies on it where it
// covers part.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { installPlatform, platform } = await import("../../src/platform/index.js");
installPlatform({ i18n: { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" }, utils: { ...platform.utils, deepClone: (value) => structuredClone(value) } });

const { runGenerator } = await import("../../src/generator/Pipeline.js");
const { decodeAge, encodeModelRun } = await import("../../src/generator/ModelRun.js");
const { cropRun } = await import("../../src/generator/ParentRun.js");
const { RULES, clean, cleanContext } = await import("../../src/data/MapRules.js");
const { HistoryView } = await import("../../src/applications/HistoryView.js");
const { MeshSession } = await import("../../src/mesh/MeshSession.js");
const { HEIGHT, WIDTH, syntheticMap } = await import("../generator/synthetic.mjs");

const map = syntheticMap();
const payload = map.makePayload({ ages: [{ strife: "warTorn" }, {}] });
const result = await runGenerator(payload, { pause: () => Promise.resolve() });
const modelRun = JSON.parse(JSON.stringify(encodeModelRun(result, "runAAAAAAAAAAAAA")));
const { mesh } = map;
const aggregates = mesh.aggregate({ elevation: map.buffers.elevation, waterMask: map.buffers.waterMask, seaLevel: payload.seaLevel });
const sites = mesh.sites.subarray(0, 2 * mesh.modelCount);
const frame = (crop) => ({ sites, spacingPx: mesh.modelSpacing, spacingKm: mesh.modelSpacing * mesh.kmPerPx, crop, zoomScale: 1 });
const WHOLE = { x: 0, y: 0, width: WIDTH, height: HEIGHT };

function studio(extra) {
    const meshSession = new MeshSession({ mesh, meshBlock: { seed: 7, spacing: 4, cells: mesh.cellCount, width: WIDTH, height: HEIGHT, version: 1 }, layerSets: [], owners: {}, aggregates });
    return { meshSession, layerSets: [], mapPins: [], mapRoutes: [], modelRun: null, parentRun: null, currentParentId: null, activeTool: "history", mapWidth: WIDTH, mapHeight: HEIGHT, uiState: { customPinStyles: [], customRouteStyles: [], customLabelStyles: [], historyAge: 1 }, ...extra };
}

test("the cut keeps its parent run's settings and earlier ages on the cells it keeps, and they pass the importer's rules", () => {
    assert.equal(modelRun.history.length, 1, "two ages: one earlier");
    const whole = cropRun(modelRun, frame(WHOLE));
    assert.equal(whole.history.length, 1);
    assert.deepEqual(whole.settings.ages.map((age) => age.strifeName), modelRun.settings.ages.map((age) => age.strifeName));
    // The whole map kept: the same age
    const [kept] = whole.history;
    const [own] = modelRun.history;
    assert.deepEqual(kept.places.length, own.places.length);
    assert.deepEqual(kept.placeNames, own.placeNames);
    assert.equal(decodeAge(kept).realm.length, whole.cellCount);
    // A quarter of the map: only its places and realms' cells, seats off it as -1
    const part = cropRun(modelRun, frame({ x: 0, y: 0, width: WIDTH / 2, height: HEIGHT / 2 }));
    const [quarter] = part.history;
    assert.ok(quarter.places.length < own.places.length && quarter.places.length > 0, `${quarter.places.length / 3} of ${own.places.length / 3} places`);
    assert.equal(quarter.placeNames.length, quarter.places.length / 3, "names go with their places");
    assert.equal(quarter.seats.length, own.seats.length, "each realm keeps its index");
    assert.ok(quarter.places.every((value, index) => index % 3 !== 0 || (value >= 0 && value < part.cellCount)));
    const saved = JSON.parse(JSON.stringify(part));
    const context = cleanContext(() => "x");
    const cleaned = clean(saved, RULES.map.fields.parentRun, context);
    assert.deepEqual(cleaned.history, saved.history, "kept by the rules");
    assert.deepEqual(cleaned.settings.ages, saved.settings.ages);
    assert.equal(context.corrected, 0);
});

test("History on a regional map not generated itself reads its parent's ages: the whole map as the parent's own run, part of it only what lies on it", () => {
    const own = studio({ modelRun });
    const inherited = studio({ parentRun: cropRun(modelRun, frame(WHOLE)), currentParentId: "parentAAAAAAAAAA" });
    assert.equal(HistoryView.ageCount(own), 2);
    assert.equal(HistoryView.ageCount(inherited), 2, "its parent's ages");
    assert.equal(HistoryView.isPast(inherited), true);
    const ownPins = HistoryView.pastContent(own).pins;
    const inheritedPins = HistoryView.pastContent(inherited).pins;
    assert.equal(inheritedPins.length, ownPins.length, "every place of the age");
    assert.deepEqual(inheritedPins.map((pin) => pin.name).sort(), ownPins.map((pin) => pin.name).sort());
    const ownRealms = HistoryView.context(own).realms.length;
    assert.equal(HistoryView.context(inherited).realms.length, ownRealms, "every realm");
    // Its past realms laid out much as the parent's
    const a = HistoryView.pastMap(own).session.layer("history-realms").owners;
    const b = HistoryView.pastMap(inherited).session.layer("history-realms").owners;
    let same = 0;
    let land = 0;
    for (let cell = 0; cell < a.length; cell++) {
        if (aggregates.land[cell] !== 1) continue;
        land++;
        if (a[cell] === b[cell]) same++;
    }
    assert.ok(same / land > 0.9, `${Math.round((same / land) * 100)}% of the land in the same realm`);

    // A regional map of a quarter of it, at twice the zoom: only the places on it, inside it
    const quarter = studio({ parentRun: cropRun(modelRun, { ...frame({ x: 0, y: 0, width: WIDTH / 2, height: HEIGHT / 2 }), zoomScale: 2 }), currentParentId: "parentAAAAAAAAAA" });
    const pins = HistoryView.pastContent(quarter).pins;
    assert.ok(pins.length > 0 && pins.length < ownPins.length, `${pins.length} of ${ownPins.length} places`);
    assert.ok(pins.every((pin) => pin.x >= 0 && pin.y >= 0 && pin.x < WIDTH && pin.y < HEIGHT), "on the map");
    const brief = HistoryView.context(quarter).brief;
    assert.ok(!brief.some((row) => row.label === "FILRODENSWMB.UI.GenerateResultPopulation"), "no count of people: a realm's spans beyond the regional map");

    // A copy made before the cut carried ages: no run to show
    const { history: _history, ...older } = cropRun(modelRun, frame(WHOLE));
    assert.equal(HistoryView.ageCount(studio({ parentRun: older, currentParentId: "parentAAAAAAAAAA" })), 0);
});
