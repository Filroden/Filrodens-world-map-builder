// The parent reader (claude/v5-l-surface-handoff.md §2, §8): the World studio's settlement source
// of the module's P0JBVA fixture, made after a revision 2 run as the towns prototype made its
// fixture, gives through the Local studio's inputFrom each promoted place's saved input exactly,
// so the inputs the engine's tests build from are the ones the module would give today; the source's
// supply plan (T2's checks on the plan, promoted); a pin's entered figure read before the run's;
// and a map with no run given a stand-in supply.
//
// The prototype's fixture stored the terrain in whole metres, the climate in 256 steps and the run
// rounded, so the source is rounded the same way before it is compared.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import { COUNTRY_DENSITY_WITHOUT_RUN, SUPPLY, ownShare, planSupply, supplyPlanOf } from "../../src/studios/local/engine/Supply.js";
import { setupApp } from "../support/pipeline-setup.mjs";
import { MATERIALISE_NAMES, materialiseStyles, readJson } from "../generator/helpers.mjs";
import { PLACES, inputOf } from "./helpers.mjs";

let app = null;
let source = null;

before(async () => {
    const mapData = readJson(new URL("../mesh/fixtures/p0jbva.json", import.meta.url));
    app = setupApp(mapData);
    app.markDirty = () => {};
    if (mapData.upwindMargin) app.upwindMargin = mapData.upwindMargin;
    await ProceduralOrchestrator.processTopographyPhase(app);
    await ProceduralOrchestrator.processClimatePhase(app, null);
    ProceduralOrchestrator.processFeaturePhase(app, false);
    // A revision 2 run, written onto the map as the prototype's tools/build-fixture.mjs wrote it
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
    source = asFixture(SettlementSource.of(app));
});

/** The source rounded as the prototype's fixture stored the map and its run. */
function asFixture(s) {
    const { seaLevel: sea, metresPerUnit: mpu } = s.map;
    const metres = (v) => {
        const m = Math.round((v - sea) * mpu);
        return Math.max(-32768, Math.min(32767, v < sea ? Math.min(-1, m) : Math.max(0, m)));
    };
    const steps = (a) => Float32Array.from(a, (v) => Math.round(Math.max(0, Math.min(1, v)) * 255) / 255);
    const round = (a, digits = 0) => Array.from(a, (v) => +v.toFixed(digits));
    const run = s.run;
    return {
        ...s,
        map: { ...s.map, elevation: Float32Array.from(s.map.elevation, (v) => sea + metres(v) / mpu), moisture: steps(s.map.moisture), temperature: steps(s.map.temperature) },
        run: { ...run, sites: round(run.sites, 1), people: round(run.people), capacity: round(run.capacity), landKm2: round(run.landKm2, 1), water: round(run.water), security: round(run.security, 3) },
    };
}

/** The paths at which two plain values differ. */
function differences(a, b, path = "", out = []) {
    if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) out.push(`${path}: ${JSON.stringify(a)} against ${JSON.stringify(b)}`);
    else if (a && typeof a === "object") for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) differences(a[key], b[key], `${path}.${key}`, out);
    else if (a !== b) out.push(`${path}: ${JSON.stringify(a)} against ${JSON.stringify(b)}`);
    return out;
}

const supply = () => supplyPlanOf(source);

test("the source gives each promoted place's saved input exactly", () => {
    for (const spec of PLACES) {
        const pin = SettlementSource.pin(app, spec.id);
        assert.ok(pin, `${spec.name}: no pin`);
        const made = JSON.parse(JSON.stringify(inputFrom(source, pin)));
        assert.deepEqual(differences(made, inputOf(spec.name)), [], spec.name);
    }
});

test("a pin's entered figure is read before the run's", () => {
    const spec = PLACES[0];
    const pin = app.mapPins.find((p) => p.id === spec.id);
    pin.userFigures = { population: 4321 };
    try {
        const fresh = SettlementSource.of(app);
        assert.equal(fresh.places.find((p) => p.id === spec.id).population, 4321);
        assert.equal(inputFrom(fresh, SettlementSource.pin(app, spec.id)).population, 4321);
    } finally {
        delete pin.userFigures;
    }
});

test("a map with no run gives its settlements a stand-in supply and the country at its stand-in density", () => {
    const spec = PLACES[0];
    const input = inputFrom({ ...source, run: null }, SettlementSource.pin(app, spec.id));
    assert.equal(input.countryDensity, COUNTRY_DENSITY_WITHOUT_RUN);
    assert.ok(input.supply && input.ownShare > 0, "a stand-in supply");
});

test("the balance closes for every place: production and purchases meet need and store, sales and exports", () => {
    const { plan } = supply();
    for (const ledger of plan.ledgers) {
        const into = ledger.own + ledger.country + ledger.fromPlaces.reduce((a, f) => a + f.amount, 0) + ledger.imports;
        const out = ledger.need + (ledger.out?.amount ?? 0) + ledger.exports;
        assert.ok(Math.abs(into - out) <= ledger.need * 0.01 + 1e-6, `${into} in, ${out} out`);
    }
});

test("flows between places on the run's routes keep to them (at least half their way, all but 0.5%)", () => {
    const { plan, prepared } = supply();
    const onNetwork = new Set();
    const trade = prepared.run.trade;
    for (let k = 0; k < trade.from.length; k++) {
        onNetwork.add(trade.from[k]);
        onNetwork.add(trade.to[k]);
    }
    let flows = 0;
    let off = 0;
    plan.ledgers.forEach((ledger, index) => {
        if (!ledger.out || !ledger.out.modes.km) return;
        if (!onNetwork.has(prepared.cellOfPlace[index]) || !onNetwork.has(prepared.cellOfPlace[ledger.out.to])) return;
        flows++;
        if (ledger.out.modes.onRouteKm < ledger.out.modes.km / 2) off++;
    });
    assert.ok(off <= flows * 0.005, `${off} of ${flows} flows off the routes`);
});

test("each place grows its tier's share of its food and its store against a poor harvest", () => {
    const { plan, places } = supply();
    plan.ledgers.forEach((ledger, index) => {
        const share = ownShare(places[index]);
        const people = places[index].population ?? 0;
        assert.ok(Math.abs(ledger.need - people * (1 + SUPPLY.RESERVE)) < 1e-6, `${places[index].name}: need and store`);
        // The store sees a poor harvest through
        assert.ok((1 + SUPPLY.RESERVE) * SUPPLY.POOR_YIELD >= 0.97, "the store covers a poor year");
        assert.ok(Math.abs(ledger.own - ledger.need * share) < 1e-6, `${places[index].name}`);
        assert.ok(share >= SUPPLY.OWN_SHARE[SUPPLY.OWN_SHARE.length - 1].share && share <= SUPPLY.OWN_SHARE[0].share);
    });
});

test("villages sell their surplus to markets, never to other villages", () => {
    const { plan, places } = supply();
    for (const ledger of plan.ledgers) if (ledger.out) assert.ok(!SUPPLY.VILLAGE_TIERS.includes(places[ledger.out.to].tier), `a village buys from ${places[ledger.out.from].name}`);
});

test("the same parent gives the same plan twice", () => {
    const { prepared, plan } = supply();
    const again = planSupply(prepared);
    const digest = (p) => createHash("sha256").update(JSON.stringify(p.ledgers.map((l) => [l.own, l.country, l.imports, l.exports, l.out?.to ?? -1, l.out?.amount ?? 0]))).digest("hex");
    assert.equal(digest(again), digest(plan));
});
