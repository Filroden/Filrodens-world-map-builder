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
import { runGenerator } from "../../src/generator/Pipeline.js";
import { BASELINE, GENERATOR_SKIP, loadP0Generator } from "./helpers.mjs";

const PARITY = 0.1;
const AGE_BUDGET_MS = 30000;
const CI_SKIP = process.env.CI && !process.env.FWMB_PERF ? "performance budgets are not checked on CI runners (set FWMB_PERF to run)" : false;
const HIDDEN_REALM_RADIUS_PX = 90;

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

test("a realm of its own holds the hidden mountain basin", { skip: GENERATOR_SKIP, todo: "the prototype's mountain realm depends on its own mesh: the prototype on three other meshes of the same map never forms it" }, () => {
    const { mesh } = loadP0Generator();
    const { x, y } = BASELINE.hiddenRealm;
    const found = run.result.realms.find((realm) => Math.hypot(mesh.siteX(realm.seat) - x, mesh.siteY(realm.seat) - y) < HIDDEN_REALM_RADIUS_PX);
    assert.ok(found, "a realm is seated in the basin");
});

test(`a run takes under ${AGE_BUDGET_MS / 1000} s per age`, { skip: GENERATOR_SKIP || CI_SKIP }, (t) => {
    t.diagnostic(`${(run.ms / 1000).toFixed(1)} s (${Object.entries(run.result.timings).map(([stage, ms]) => `${stage} ${ms}`).join(", ")} ms)`);
    assert.ok(run.ms < AGE_BUDGET_MS);
});
