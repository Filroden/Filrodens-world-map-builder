// The generator on P0JBVA against the settlement prototype's figures on the same map
// (fixtures/prototype-baseline.json), and its speed.
//
// The generator runs on the module's mesh, whose model cells are sampled differently from the
// prototype's own (about 5% fewer, so a little larger), so its places and realms are not the
// prototype's, and parity is statistical: the counts of realms, duchies, counties, settlements by
// tier and the road network's length must be within PARITY of the prototype's. The model's code is
// checked for exactness elsewhere: run on the prototype's own cells it gives the prototype's output.
//
// The speed budget describes a developer's machine, so it is skipped where CI is set (unless
// FWMB_PERF is set too), as tests/mesh/performance.test.mjs does.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { materialise } from "../../src/generator/Materialise.js";
import { runGenerator } from "../../src/generator/Pipeline.js";
import { MeshSession } from "../../src/mesh/MeshSession.js";
import { UNCLAIMED } from "../../src/mesh/Schema.js";
import { loadP0 } from "../mesh/helpers.mjs";
import { BASELINE, GENERATOR_SKIP, MATERIALISE_NAMES, loadP0Generator, materialiseStyles } from "./helpers.mjs";

const PARITY = 0.1;
const AGE_BUDGET_MS = 30000;
const MATERIALISE_BUDGET_MS = 3000;
const CI_SKIP = process.env.CI && !process.env.FWMB_PERF ? "performance budgets are not checked on CI runners (set FWMB_PERF to run)" : false;

let run = null;

before(async () => {
    if (GENERATOR_SKIP) return;
    const { makePayload } = loadP0Generator();
    const payload = makePayload();
    const started = performance.now();
    const result = await runGenerator(payload, { pause: () => Promise.resolve() });
    run = { result, ms: performance.now() - started };
});

test("counts are within 10% of the prototype's", { skip: GENERATOR_SKIP }, (t) => {
    const { stats } = run.result;
    const pairs = {
        realms: [stats.kingdoms + stats.independents, BASELINE.kingdoms + BASELINE.independents],
        duchies: [stats.duchies, BASELINE.duchies],
        counties: [stats.counties, BASELINE.counties],
        cities: [stats.cities, BASELINE.cities],
        largeTowns: [stats.largeTowns, BASELINE.largeTowns],
        towns: [stats.towns, BASELINE.towns],
        roadKm: [stats.roadKm, BASELINE.roadKm],
    };
    for (const [name, [value, baseline]] of Object.entries(pairs)) {
        const change = value / baseline - 1;
        t.diagnostic(`${name}: ${value} against ${baseline} (${(100 * change).toFixed(1)}%)`);
        assert.ok(Math.abs(change) <= PARITY, `${name} ${value} is within ${100 * PARITY}% of ${baseline}`);
    }
    for (const name of ["population", "kingdoms", "independents", "castles", "fortified", "riverKm", "seaKm"]) {
        t.diagnostic(`(not compared) ${name}: ${stats[name]} against ${BASELINE[name]}`);
    }
});

test(`a run takes under ${AGE_BUDGET_MS / 1000} s per age`, { skip: GENERATOR_SKIP || CI_SKIP }, (t) => {
    t.diagnostic(`${(run.ms / 1000).toFixed(1)} s (${Object.entries(run.result.timings).map(([stage, ms]) => `${stage} ${ms}`).join(", ")} ms)`);
    assert.ok(run.ms < AGE_BUDGET_MS);
});

// ------------------------------------------------------------------ written onto the map

let written = null;
/** The run written onto P0JBVA's display mesh (see Materialise), once. */
function materialised() {
    if (written) return written;
    const { mesh, aggregates, mapData } = loadP0();
    const session = new MeshSession({ mesh, meshBlock: mapData.mesh, layerSets: [], owners: {}, aggregates });
    let next = 0;
    const started = performance.now();
    const made = materialise(session, run.result, { runId: "run", idFactory: () => `id${++next}`, layerSets: [], names: MATERIALISE_NAMES, watersPx: 24, ...materialiseStyles() });
    written = { session, made, ms: performance.now() - started };
    return written;
}

test("written onto the map, the realms nest their duchies and counties, every region keeps ground, and neighbours differ in colour", { skip: GENERATOR_SKIP }, () => {
    const { session, made } = materialised();
    const levels = made.set.levels;
    for (let depth = 1; depth < levels.length; depth++) {
        const parentOwners = session.layer(levels[depth - 1].id).owners;
        const owners = session.layer(levels[depth].id).owners;
        const parentOf = new Map(levels[depth].regions.map((region) => [region.key, region.parentKey]));
        const outside = owners.filter((owner, cell) => owner !== UNCLAIMED && parentOf.get(owner) !== parentOwners[cell]).length;
        assert.equal(outside, 0, `${levels[depth].name}: cells outside their parent`);
    }
    const realms = levels[0];
    const owners = session.layer(realms.id).owners;
    const colour = new Map(realms.regions.map((region) => [region.key, region.fillColor]));
    let clashes = 0;
    for (let cell = 0; cell < owners.length; cell++) {
        if (owners[cell] === UNCLAIMED) continue;
        for (const other of session.mesh.neighbours(cell)) if (owners[other] !== UNCLAIMED && owners[other] !== owners[cell] && colour.get(owners[other]) === colour.get(owners[cell])) clashes++;
    }
    assert.equal(clashes, 0, "neighbouring realms share a colour");
    for (const level of levels) {
        const owned = new Set(session.layer(level.id).owners);
        assert.deepEqual(level.regions.filter((region) => !owned.has(region.key)).map((region) => region.name), [], `${level.name} without ground`);
    }
    assert.equal(made.pins.length, run.result.places.length);
});

test(`writing a run onto the map takes under ${MATERIALISE_BUDGET_MS / 1000} s`, { skip: GENERATOR_SKIP || CI_SKIP }, (t) => {
    const { made, ms } = materialised();
    t.diagnostic(`${Math.round(ms)} ms: ${made.set.levels.map((level) => `${level.regions.length} ${level.name.toLowerCase()}`).join(", ")}, ${made.routes.length} routes, ${made.pins.length} pins`);
    assert.ok(ms < MATERIALISE_BUDGET_MS);
});
