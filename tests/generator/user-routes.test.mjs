// The map's own routes in the trade model (UserRoutes, from revision 2), on the synthetic island:
// what each transport makes of the edges its line follows; trade on a hand-placed road and river
// between two cities the run without them does not join that way, with no route of the run's own
// laid along them; and the run without routes, and revision 1 with them, unchanged.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { FILRODENSWMB } from "../../src/config.js";
import { buildModelCells } from "../../src/generator/CellValues.js";
import { CellGraph, EDGE } from "../../src/generator/CellGraph.js";
import { buildGeneratorPayload } from "../../src/generator/GeneratorInput.js";
import { GeneratorRevision } from "../../src/generator/GeneratorRevision.js";
import { modelBiomeRaster } from "../../src/generator/ModelBiomes.js";
import { runGenerator } from "../../src/generator/Pipeline.js";
import { applyUserRivers, uncoveredTraffic, userRoutes } from "../../src/generator/UserRoutes.js";
import { syntheticMap } from "./synthetic.mjs";

const { LEGACY, REVISION_2 } = FILRODENSWMB.GENERATOR.REVISIONS;
const quick = { pause: () => Promise.resolve() };
const run = (routes, revision = REVISION_2) => runGenerator({ ...syntheticMap().makePayload(), routes, revision }, quick);

let base = null;
let cells = null;
async function setup() {
    if (base) return;
    base = await run([]);
    const payload = syntheticMap().makePayload();
    cells = buildModelCells({ ...payload, biome: modelBiomeRaster(payload) }, {}, GeneratorRevision.rules(REVISION_2));
}

/** A fresh graph of the island's model cells (a river route changes its edges' kinds). */
const graphOf = () => new CellGraph(cells);

/** The shortest way between two cells by km, over the cells `allowed` accepts. */
function shortestPath(graph, from, to, allowed) {
    const km = new Float64Array(graph.count).fill(Infinity);
    const back = new Int32Array(graph.count).fill(-1);
    const done = new Uint8Array(graph.count);
    km[from] = 0;
    for (;;) {
        let cell = -1;
        for (let at = 0; at < graph.count; at++) if (!done[at] && km[at] < (cell < 0 ? Infinity : km[cell])) cell = at;
        if (cell < 0 || cell === to) break;
        done[cell] = 1;
        for (let slot = graph.adjStart[cell]; slot < graph.adjStart[cell + 1]; slot++) {
            const next = graph.adjCell[slot];
            const reach = km[cell] + graph.edgeKm[graph.adjEdge[slot]];
            if (allowed(next) && reach < km[next]) {
                km[next] = reach;
                back[next] = cell;
            }
        }
    }
    const path = [];
    for (let cell = to; cell >= 0; cell = back[cell]) path.push(cell);
    return path.reverse();
}

const edgesOf = (graph, path) => path.slice(1).map((cell, at) => graph.edge(path[at], cell));
const tradeOn = (result, a, b) => {
    for (let at = 0; at < result.trade.from.length; at++) {
        const [from, to] = [result.trade.from[at], result.trade.to[at]];
        if ((from === a && to === b) || (from === b && to === a)) return { value: result.trade.value[at], kind: result.trade.kind[at] };
    }
    return null;
};

/** Two cities a land way joins that the run without routes trades along on almost none of it. */
function unjoinedCities(graph) {
    const used = new Set();
    for (let at = 0; at < base.trade.from.length; at++) used.add(graph.edge(base.trade.from[at], base.trade.to[at]));
    const cities = base.places.filter((place) => place.kind === "town" && place.tier === 0);
    for (let i = 0; i < cities.length; i++) {
        for (let j = i + 1; j < cities.length; j++) {
            const path = shortestPath(graph, cities[i].cell, cities[j].cell, (cell) => !cells.water[cell]);
            const unused = edgesOf(graph, path).filter((edge) => !used.has(edge)).length;
            if (path.length >= 5 && unused >= path.length - 2) return path;
        }
    }
    return null;
}

test("revision 1 has no such rule; with no routes the run is the run without them, and revision 1 ignores them", async () => {
    await setup();
    assert.equal(GeneratorRevision.rules(LEGACY).userRoutes, false);
    assert.equal(GeneratorRevision.rules(REVISION_2).userRoutes, true);
    const { mesh, buffers } = syntheticMap();
    const given = [{ transport: "river", cells: [1, 2], extra: true }];
    const payload = buildGeneratorPayload({ mesh, buffers, seaLevel: 0.35, kmPerPx: 2, mapSeed: "SYNTH", routes: given });
    assert.deepEqual(payload.routes, [{ transport: "river", cells: [1, 2] }], "the payload carries a copy of each route's transport and cells");
    assert.notEqual(payload.routes[0].cells, given[0].cells);
    assert.deepEqual(buildGeneratorPayload({ mesh, buffers, seaLevel: 0.35, kmPerPx: 2, mapSeed: "SYNTH" }).routes, []);
    const { routes: _routes, ...noField } = syntheticMap().makePayload();
    const none = await runGenerator(noField, quick);
    assert.deepEqual({ ...none, timings: null }, { ...base, timings: null });
    const path = unjoinedCities(graphOf());
    const legacy = await run([{ transport: "road", cells: path }], LEGACY);
    const legacyNone = await run([], LEGACY);
    assert.deepEqual({ ...legacy, timings: null }, { ...legacyNone, timings: null }, "revision 1 reads no routes");
});

test("each transport makes its own of the edges it follows, a road keeping to land and a corner cell bridged", async () => {
    await setup();
    const graph = graphOf();
    const land = (cell) => !cells.water[cell];
    // A coast: a land cell beside water, and a water cell beside it
    const shore = [...Array(graph.count).keys()].find((cell) => land(cell) && graph.adjCell.slice(graph.adjStart[cell], graph.adjStart[cell + 1]).some((next) => !land(next)));
    const sea = graph.adjCell.slice(graph.adjStart[shore], graph.adjStart[shore + 1]).find((next) => !land(next));
    const inland = graph.adjCell.slice(graph.adjStart[shore], graph.adjStart[shore + 1]).find(land);
    const far = [...Array(graph.count).keys()].find((cell) => land(cell) && graph.edge(shore, cell) < 0 && graph.edge(inland, cell) >= 0);

    // A road over the coast's water cell reads as land to land; two cells not neighbours meet through the one they share
    const road = userRoutes([{ transport: "road", cells: [inland, sea, shore] }, { transport: "road", cells: [shore, far] }], graph);
    assert.equal(road.built[graph.edge(inland, shore)], 1, "the water cell between is left out");
    assert.equal(road.built[graph.edge(shore, sea)], 0, "a road is no landing");
    assert.equal(edgesOf(graph, shortestPath(graph, shore, far, land)).every((edge) => road.covered[edge]), true, "bridged through a shared neighbour");
    assert.deepEqual(road.rivers, []);

    const lane = userRoutes([{ transport: "sea", cells: [inland, shore, sea] }], graph);
    assert.equal(lane.built[graph.edge(shore, sea)], 1, "a landing");
    assert.equal(lane.built[graph.edge(inland, shore)], 0, "a sea route builds no road");

    const river = userRoutes([{ transport: "river", cells: [inland, shore, sea] }], graph);
    const edge = graph.edge(inland, shore);
    assert.ok(graph.edgeKind[edge] === EDGE.LAND || graph.edgeKind[edge] === EDGE.RIVER);
    if (graph.edgeKind[edge] === EDGE.LAND) assert.deepEqual(river.rivers, [edge], "a land edge becomes a river");
    assert.equal(river.built[edge], 0, "a river is not built");
    assert.equal(river.built[graph.edge(shore, sea)], 1, "its mouth a landing");
    applyUserRivers(graph, river.rivers);
    assert.equal(graph.edgeKind[edge], EDGE.RIVER);

    assert.equal(userRoutes([{ transport: "canal", cells: [inland, shore] }, { transport: "road", cells: [shore, -4, 1e9] }], graphOf()), null, "nothing to act on");
    assert.equal(userRoutes([], graphOf()), null);
    const traffic = Float64Array.of(1, 2, 3);
    assert.deepEqual([...uncoveredTraffic(traffic, Uint8Array.of(0, 1, 0))], [1, 0, 3]);
    assert.equal(uncoveredTraffic(traffic, null), traffic);
});

test("trade takes a hand-placed road between two cities, and the run lays no route of its own along it", async () => {
    await setup();
    const graph = graphOf();
    const path = unjoinedCities(graph);
    assert.ok(path, "two cities the run without routes trades between some other way");
    const result = await run([{ transport: "road", cells: path }]);
    for (let at = 1; at < path.length; at++) {
        const trade = tradeOn(result, path[at - 1], path[at]);
        assert.ok(trade?.value > 0, "trade on each step of the road");
        assert.equal(trade.kind, 0, "as road trade");
    }
    const covered = new Set(edgesOf(graph, path));
    for (const chain of result.routes) {
        for (let at = 1; at < chain.cells.length; at++) assert.ok(!covered.has(graph.edge(chain.cells[at - 1], chain.cells[at])), "no generated route on the map's own");
    }
});

test("a hand-placed river route is a navigable river: trade takes it as river trade", async () => {
    await setup();
    const path = unjoinedCities(graphOf());
    const result = await run([{ transport: "river", cells: path }]);
    for (let at = 1; at < path.length; at++) {
        const trade = tradeOn(result, path[at - 1], path[at]);
        assert.ok(trade?.value > 0);
        assert.equal(trade.kind, 1, "as river trade");
    }
    assert.ok(result.stats.riverKm > base.stats.riverKm);
});
