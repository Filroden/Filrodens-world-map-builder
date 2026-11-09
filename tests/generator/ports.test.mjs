// Ports from revision 2 (see GeneratorRevision.rules) on the synthetic island: a land cell loads
// ships only with enough water of its own, trade walks overland to one that can, long sea passages
// put in at ports of call, coastal fishing feeds more, and a port's pin stands on its own shore and a
// river town's beside its river. With every rule at its legacy setting the run is revision 1's.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { FILRODENSWMB } from "../../src/config.js";
import { buildModelCells } from "../../src/generator/CellValues.js";
import { portCost } from "../../src/generator/CellGraph.js";
import { GeneratorRevision } from "../../src/generator/GeneratorRevision.js";
import { materialise } from "../../src/generator/Materialise.js";
import { modelBiomeRaster } from "../../src/generator/ModelBiomes.js";
import { runGenerator } from "../../src/generator/Pipeline.js";
import { MeshSession } from "../../src/mesh/MeshSession.js";
import { MATERIALISE_NAMES, materialiseStyles } from "./helpers.mjs";
import { HEIGHT, WIDTH, syntheticMap } from "./synthetic.mjs";

const { LEGACY, REVISION_2 } = FILRODENSWMB.GENERATOR.REVISIONS;
const quick = { pause: () => Promise.resolve() };
const runs = new Map();
/** One run on the island per set of rules, kept. */
function islandRun(label, rules) {
    if (!runs.has(label)) runs.set(label, runGenerator(syntheticMap().makePayload(), { ...quick, rules }));
    return runs.get(label);
}
const current = () => islandRun("current", GeneratorRevision.rules(REVISION_2));

/** The island's model cells at the current rules (their water shares and shore pixels). */
function islandCells() {
    const payload = syntheticMap().makePayload();
    return buildModelCells({ ...payload, biome: modelBiomeRaster(payload) }, {}, GeneratorRevision.rules(REVISION_2));
}

test("revision 1 keeps the old rules, and the legacy settings of revision 2's rules give its run exactly", async () => {
    const old = GeneratorRevision.rules(LEGACY);
    assert.deepEqual({ ...old }, { portWaterShare: null, fishingDensity: 8, callKm: null, callShare: 0.25, shorePins: false });
    const now = GeneratorRevision.rules(REVISION_2);
    assert.deepEqual({ ...now }, { portWaterShare: 0.02, fishingDensity: 30, callKm: 150, callShare: 0.25, shorePins: true });

    const legacy = await runGenerator({ ...syntheticMap().makePayload(), revision: LEGACY }, quick);
    // Every cell wet (a share of 0), fishing as before, no calls, pins on their sites
    const identity = await islandRun("identity", { ...now, portWaterShare: 0, fishingDensity: old.fishingDensity, callKm: null, shorePins: false });
    assert.deepEqual({ ...identity, revision: LEGACY, timings: null }, { ...legacy, timings: null });
    assert.notDeepEqual((await current()).stats, legacy.stats, "revision 2 changes the run");
});

test("a land cell with too little water of its own cannot load ships, and no port stands on one", async () => {
    const cells = islandCells();
    cells.wet = Uint8Array.from(cells.water, (water, cell) => (water || cells.waterShare[cell] >= 0.02 ? 1 : 0));
    const cost = portCost(cells);
    const dry = cells.wet.findIndex((wet, cell) => !wet && !cells.water[cell]);
    assert.ok(dry >= 0);
    assert.equal(cost(dry), Infinity);
    const wet = cells.wet.findIndex((wet, cell) => wet && !cells.water[cell] && cells.coastal[cell]);
    assert.ok(Number.isFinite(cost(wet)));

    const ports = (await current()).places.filter((place) => place.port);
    assert.ok(ports.length > 0);
    for (const port of ports) assert.ok(cells.waterShare[port.cell] >= FILRODENSWMB.GENERATOR.PORTS.WATER_SHARE, `port at ${port.cell} holds ${cells.waterShare[port.cell]}`);
});

test("coastal fishing feeds more from revision 2", () => {
    const payload = syntheticMap().makePayload();
    const input = { ...payload, biome: modelBiomeRaster(payload) };
    const before = buildModelCells(input, {}, GeneratorRevision.rules(LEGACY));
    const after = buildModelCells(input, {}, GeneratorRevision.rules(REVISION_2));
    const coast = after.coastal.findIndex((coastal) => coastal === 1);
    assert.ok(coast >= 0);
    assert.ok(Math.abs(after.food[coast] - before.food[coast] - (30 - 8) * after.landKm2[coast]) < 1e-6);
});

test("a long passage by sea puts in at ports of call, making ports of shore towns it would sail past", async () => {
    const now = GeneratorRevision.rules(REVISION_2);
    const without = await islandRun("no calls", { ...now, callKm: null });
    const withCalls = await current();
    const portsWithout = new Set(without.places.filter((place) => place.port).map((place) => place.cell));
    const townsWithout = new Set(without.places.filter((place) => place.kind === "town").map((place) => place.cell));
    const portsWith = withCalls.places.filter((place) => place.port);
    assert.ok(portsWith.length > portsWithout.size, `${portsWith.length} ports against ${portsWithout.size}`);
    // A call puts in at a town first; only a busy enough call would found a town on empty shore,
    // which the island's short passages never are
    assert.ok(portsWith.some((place) => townsWithout.has(place.cell) && !portsWithout.has(place.cell)), "a shore town that was no port becomes one");
});

test("a port's pin stands on its own shore and a river town's beside its river, both inside their model cell", async () => {
    const { mesh, buffers, rivers, makePayload } = syntheticMap();
    const seaLevel = makePayload().seaLevel;
    const aggregates = mesh.aggregate({ elevation: buffers.elevation, waterMask: buffers.waterMask, seaLevel });
    const session = new MeshSession({ mesh, meshBlock: { seed: 7, spacing: 4, cells: mesh.cellCount, width: WIDTH, height: HEIGHT, version: 1 }, layerSets: [], owners: {}, aggregates });
    const result = await current();
    let ids = 0;
    const made = materialise(session, result, { runId: "run", idFactory: () => `pin${String(++ids).padStart(13, "0")}`, layerSets: [], names: MATERIALISE_NAMES, watersPx: 24, ...materialiseStyles() });

    // Distance from a point to the nearest sea pixel, and to the river (which runs along one row)
    const sea = (x, y) => buffers.elevation[Math.round(y) * WIDTH + Math.round(x)] < seaLevel;
    const toSea = (x, y) => {
        for (let r = 0; r < 60; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && sea(Math.min(WIDTH - 1, Math.max(0, x + dx)), Math.min(HEIGHT - 1, Math.max(0, y + dy)))) return r;
        return 60;
    };
    const path = rivers.vectors[0].path;
    const toRiver = (x, y) => Math.min(...path.map((point) => Math.hypot(point.x - x, point.y - y)));
    const near = mesh.spacing * 2;

    let ports = 0;
    let riverTowns = 0;
    made.pins.forEach((pin, index) => {
        const place = result.places[index];
        if (place.kind !== "town" || (!place.port && !place.navigable)) return;
        assert.equal(mesh.parentOf[pin.cell], place.cell, "inside its model cell");
        assert.equal(aggregates.land[pin.cell], 1, "on land");
        const site = [mesh.siteX(place.cell), mesh.siteY(place.cell)];
        if (place.port) {
            ports++;
            assert.ok(toSea(pin.x, pin.y) <= near, `port ${index} is ${toSea(pin.x, pin.y)} px from the sea (its site ${toSea(...site)})`);
        } else {
            riverTowns++;
            assert.ok(toRiver(pin.x, pin.y) <= near, `river town ${index} is ${toRiver(pin.x, pin.y).toFixed(1)} px from its river (its site ${toRiver(...site).toFixed(1)})`);
        }
    });
    assert.ok(ports > 0, "the island has ports");
    assert.ok(riverTowns > 0, "the island's river has a town on it");
});
