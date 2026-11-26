// Out of date (L-surface step 2b; claude/v5-l-surface-step2-plan.md §6.1): a settlement map's parts
// against its pin as it is now, on the module's P0JBVA fixture after a revision 2 run (as the
// parent-reader test builds it): a map made now is up to date; its pin's population changing marks
// people (with the figures, and the supply with them), the roads reaching it routes; renaming the pin marks nothing; undoing
// the change clears it; a pin gone is said so; and the controller's states follow the source.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { SettlementSource } from "../../src/studios/world/settlement/SettlementSource.js";
import { ProceduralOrchestrator } from "../../src/studios/world/ProceduralOrchestrator.js";
import { MeshBuilder } from "../../src/studios/world/mesh/MeshBuilder.js";
import { MeshSession } from "../../src/studios/world/mesh/MeshSession.js";
import { effectiveKmPerPx } from "../../src/studios/world/mesh/Schema.js";
import { buildGeneratorPayload } from "../../src/studios/world/generator/GeneratorInput.js";
import { materialise } from "../../src/studios/world/generator/Materialise.js";
import { encodeModelRun } from "../../src/studios/world/generator/ModelRun.js";
import { runGenerator } from "../../src/studios/world/generator/Pipeline.js";
import { inputFrom } from "../../src/studios/local/engine/LocalInput.js";
import { OutOfDate } from "../../src/studios/local/app/OutOfDate.js";
import { SettlementRecord } from "../../src/studios/local/data/SettlementRecord.js";
import { setupApp } from "../support/pipeline-setup.mjs";
import { MATERIALISE_NAMES, materialiseStyles, readJson } from "../generator/helpers.mjs";

let app = null;
let pin = null;
let card = null;

before(async () => {
    const mapData = readJson(new URL("../mesh/fixtures/p0jbva.json", import.meta.url));
    app = setupApp(mapData);
    app.markDirty = () => {};
    if (mapData.upwindMargin) app.upwindMargin = mapData.upwindMargin;
    await ProceduralOrchestrator.processTopographyPhase(app);
    await ProceduralOrchestrator.processClimatePhase(app, null);
    ProceduralOrchestrator.processFeaturePhase(app, false);
    const mesh = MeshBuilder.fromMapData(mapData);
    const buffers = { elevation: app.currentElevationData, moisture: app.currentMoistureData, temperature: app.currentTemperatureData, waterMask: app.bufferWaterMask };
    const payload = buildGeneratorPayload({ mesh, buffers, seaLevel: app.uiState.seaLevel, kmPerPx: effectiveKmPerPx(mapData), riverData: app.currentRiverData, mapSeed: mapData.seed, settings: mapData.generatorSettings ?? {}, revision: 2 });
    const result = await runGenerator(payload, { pause: () => Promise.resolve() });
    const aggregates = mesh.aggregate({ elevation: buffers.elevation, waterMask: buffers.waterMask, riverMap: app.bufferRiverMap, seaLevel: app.uiState.seaLevel });
    const session = new MeshSession({ mesh, meshBlock: mapData.mesh, layerSets: [], owners: {}, aggregates });
    let ids = 0;
    const made = materialise(session, result, { runId: "fixtureRun000000", idFactory: () => `fx${String(++ids).padStart(14, "0")}`, layerSets: [], names: MATERIALISE_NAMES, watersPx: 24, ...materialiseStyles() });
    Object.assign(app, { meshSession: session, mapPins: made.pins, mapRoutes: made.routes, modelRun: encodeModelRun(result, "fixtureRun000000") });
    app.uiState.cultures = mapData.cultures ?? [];
    app.uiState.generatorSettings = mapData.generatorSettings ?? {};
    // A town with a road, so a road's change shows
    const source = SettlementSource.of(app);
    pin = app.mapPins.find((each) => each.generated?.kind === "town" && (each.generated.population ?? 0) > 2000 && inputFrom(source, SettlementSource.pin(app, each.id), { seed: "s" }).roads.length > 0);
    const input = inputFrom(source, SettlementSource.pin(app, pin.id), { seed: "kept" });
    card = SettlementRecord.card(SettlementRecord.create({ id: "map1", pinId: pin.id, name: pin.name, input }));
});

/** The card's state against the map as it is now. */
const stateNow = (cards = [card]) => OutOfDate.of({ source: SettlementSource.of(app), cards, pinFor: (pinId) => SettlementSource.pin(app, pinId), inputFrom }).get(cards[0].id);

test("a settlement map made from its pin as it is now is up to date", () => {
    assert.deepEqual(stateNow(), { changed: [], pinGone: false, people: null });
});

test("its pin's population changing marks its people, with the figures; putting it back clears it", () => {
    const was = card.people;
    pin.userFigures = { population: was + 500 };
    try {
        const state = stateNow();
        // More people need more food: the supply (the run's part) moves with them
        assert.ok(state.changed.includes("people"), JSON.stringify(state.changed));
        assert.deepEqual(state.people, { was, now: was + 500 });
    } finally {
        delete pin.userFigures;
    }
    assert.deepEqual(stateNow().changed, []);
});

test("the roads reaching it changing marks its routes", () => {
    const routes = app.mapRoutes;
    app.mapRoutes = [];
    try {
        assert.ok(stateNow().changed.includes("routes"), JSON.stringify(stateNow().changed));
    } finally {
        app.mapRoutes = routes;
    }
    assert.deepEqual(stateNow().changed, []);
});

test("renaming its pin marks nothing (the map's name follows the pin)", () => {
    const name = pin.name;
    pin.name = `${name} Renamed`;
    try {
        assert.deepEqual(stateNow().changed, []);
    } finally {
        pin.name = name;
    }
});

test("a pin gone is said so, and nothing is compared", () => {
    const gone = { ...card, id: "map2", pinId: "noSuchPin000000" };
    assert.deepEqual(stateNow([gone]), { changed: [], pinGone: true, people: null });
});

test("with no source (the mesh still loading) nothing is known", () => {
    assert.equal(OutOfDate.of({ source: null, cards: [card], pinFor: () => null, inputFrom }).size, 0);
});

test("a culture's names settings (N3): none on Automatic gives the input it always gave; one chosen marks cultures, and Automatic again clears it", () => {
    // The fixture's run has no cultures: the pin is given one of the world's, as a place of a run with cultures is
    const westmark = { id: "cultureWestmark", name: "Westmark", color: "#5b7fa6", openness: 0.4, nameBase: "English" };
    const sourceWith = (culture) => {
        app.uiState.cultures = [culture];
        return SettlementSource.of(app);
    };
    const pinFor = (pinId) => SettlementSource.pin(app, pinId);
    const generated = pin.generated;
    pin.generated = { ...generated, mix: [{ culture: westmark.id, share: 1 }] };
    try {
        const plain = inputFrom(sourceWith(westmark), pinFor(pin.id), { seed: "kept" });
        assert.deepEqual(plain.cultures.map((c) => c.name), ["Westmark"]);
        assert.ok(!("names" in plain.cultures[0]) && !("heads" in plain.cultures[0]));
        // Every setting on Automatic, as the culture inspector keeps them: the same input
        const automatic = { ...westmark, names: { form: null, order: null, lineage: null, wife: null }, households: { heads: null } };
        assert.deepEqual(inputFrom(sourceWith(automatic), pinFor(pin.id), { seed: "kept" }), plain);
        const kept = SettlementRecord.card(SettlementRecord.create({ id: "map3", pinId: pin.id, name: pin.name, input: plain }));
        const stateWith = (culture) => OutOfDate.of({ source: sourceWith(culture), cards: [kept], pinFor, inputFrom }).get(kept.id);
        assert.deepEqual(stateWith(automatic).changed, []);
        // Patronymic and Mostly women: only the chosen settings join the input, and Out of date names the cultures
        const chosen = { ...westmark, names: { form: "patronymic", order: null, lineage: null, wife: null }, households: { heads: "women" } };
        const input = inputFrom(sourceWith(chosen), pinFor(pin.id), { seed: "kept" });
        assert.deepEqual(input.cultures[0].names, { form: "patronymic" });
        assert.equal(input.cultures[0].heads, "women");
        assert.deepEqual(stateWith(chosen).changed, ["cultures"]);
        assert.deepEqual(stateWith(automatic).changed, []);
    } finally {
        app.uiState.cultures = [];
        pin.generated = generated;
    }
});
