// Travel time (TravelTime, TravelGraph): each step's days by way of travel (the road at the speed,
// open ground slower and rough ground slower again, rivers faster downstream, the sea at its own
// speed, harbours loading), the
// quickest times and way from a start, and the lines at each whole day; and the network built from
// a map as a run builds it.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { FILRODENSWMB } = await import("../../src/config.js");
const { EDGE } = await import("../../src/generator/CellGraph.js");
const { dayRings, edgeBetween, edgeDays, riverDirection, roadEdges, travelFrom, wayTo } = await import("../../src/travel/TravelTime.js");
const { buildTravelGraph } = await import("../../src/travel/TravelGraph.js");
const { syntheticMap } = await import("../generator/synthetic.mjs");

const SPEEDS = { foot: 30, wagon: 25, mount: 60, riverDown: 60, riverUp: 20, sea: 150 };
const T = FILRODENSWMB.GENERATOR.TRAVEL;

/**
 * A line of five cells, 30 km apart: 0 -land- 1 -river- 2 -land- 3 -port- 4 (water). Cell 2 has the
 * longer river above it, so the river runs from 1 down to 2.
 */
function lineGraph() {
    const links = [[1], [0, 2], [1, 3], [2, 4], [3]];
    const adjStart = [0];
    const adjCell = [];
    for (const row of links) {
        adjCell.push(...row);
        adjStart.push(adjCell.length);
    }
    const pairs = [[0, 1], [1, 2], [2, 3], [3, 4]];
    const adjEdge = adjCell.map((cell, slot) => {
        const from = adjStart.findIndex((start, at) => slot >= start && slot < adjStart[at + 1]);
        return pairs.findIndex(([a, b]) => (a === from && b === cell) || (b === from && a === cell));
    });
    return {
        count: 5,
        edgeA: Int32Array.from(pairs, (pair) => pair[0]),
        edgeB: Int32Array.from(pairs, (pair) => pair[1]),
        edgeKm: Float64Array.from([30, 30, 30, 30]),
        edgeKind: Uint8Array.from([EDGE.LAND, EDGE.RIVER, EDGE.LAND, EDGE.PORT]),
        adjStart: Int32Array.from(adjStart),
        adjCell: Int32Array.from(adjCell),
        adjEdge: Int32Array.from(adjEdge),
        water: Uint8Array.from([0, 0, 0, 0, 1]),
        landCost: Float32Array.from([1, 1, 2, 2, 1]),
        reliefTerm: Float32Array.from([1, 1, 1, 1, 1]),
        riverKm: Float32Array.from([0, 100, 300, 0, 0]),
        heightM: Float32Array.from([50, 40, 30, 20, 0]),
        portKm: Float32Array.from([20, 20, 20, 20, 20]),
    };
}

test("each step's days: a road twice the pace of open ground, rivers by direction, harbours loading", () => {
    const graph = lineGraph();
    const { road, missing } = roadEdges(graph, [0, 9], [1, 3]);
    assert.equal(missing, 1, "a pair that is no edge is left out");
    assert.equal(road[edgeBetween(graph, 1, 0)], 1);
    const { out, back } = edgeDays(graph, { speeds: SPEEDS, mode: "foot", road });
    const { OFF_ROAD, TERRAIN } = FILRODENSWMB.TRAVEL_TIME;
    assert.equal(out[0], 1, "30 km of level road on foot is a day");
    assert.ok(Math.abs(out[2] - 2 ** TERRAIN / OFF_ROAD) < 1e-9, "open ground of cost 2: off the road, and slowed by its cost softened");
    assert.equal(riverDirection(graph, 1, 2), 1);
    assert.equal(out[1], 0.5, "downstream at 60 km a day");
    assert.equal(back[1], 1.5, "upstream at 20 km a day");
    const loading = (30 * 0.5 * 2 ** TERRAIN + T.PORT_KM) / (30 * OFF_ROAD) + (30 * 0.5) / 150;
    assert.ok(Math.abs(out[3] - loading) < 1e-9, "half by land, half by sea, and the loading");
    const town = edgeDays(graph, { speeds: SPEEDS, mode: "foot", road, towns: new Set([3]) });
    assert.ok(town.out[3] < out[3], "a town's harbour loads faster");
    assert.equal(edgeDays(graph, { speeds: SPEEDS, mode: "mount", road }).out[0], 0.5, "a fast mount covers the road in half a day");
});

test("times run one way from the start, with the way taken", () => {
    const graph = lineGraph();
    const days = edgeDays(graph, { speeds: SPEEDS, mode: "foot", road: roadEdges(graph, [0], [1]).road });
    const from0 = travelFrom(graph, days, 0);
    assert.deepEqual(Array.from(from0.days.slice(0, 3)), [0, 1, 1.5]);
    const from2 = travelFrom(graph, days, 2);
    assert.equal(from2.days[0], 2.5, "back up the river and along the road");
    assert.ok(from2.days[0] > from0.days[2], "a return journey against the current takes longer");
    const way = wayTo(graph, from0, 4);
    assert.deepEqual(way.cells, [0, 1, 2, 3, 4]);
    assert.deepEqual(way.steps, ["land", "river", "land", "sea"]);
    assert.deepEqual(wayTo(graph, travelFrom(graph, days, -1), 3).cells, [], "no start, no way");
});

test("day rings cross each triangle where the time passes a whole day", () => {
    const xs = [0, 100, 0, 100];
    const ys = [0, 0, 100, 100];
    const days = Float64Array.from([0, 2, 2, Infinity]);
    const rings = dayRings([0, 1, 2, 1, 3, 2], (cell) => xs[cell], (cell) => ys[cell], days, 3);
    assert.deepEqual(rings[0].segments, [50, 0, 0, 50], "day 1 halfway along both sides from the start");
    assert.deepEqual(rings[1].segments, [100, 0, 0, 100], "day 2 runs along the side whose corners are both at two days");
    assert.equal(rings[2].segments.length, 0, "a triangle with an unreached corner gives no line");
});

test("the travel network is built from a map as a run builds it, and reaches its land", () => {
    const { makePayload, mesh } = syntheticMap();
    const graph = buildTravelGraph(makePayload());
    assert.equal(graph.count, mesh.modelCount);
    assert.equal(graph.adjStart.length, graph.count + 1);
    assert.ok(graph.edgeA.length > graph.count, "every cell has several neighbours");
    const land = [...graph.water.keys()].filter((cell) => !graph.water[cell]);
    const reach = travelFrom(graph, edgeDays(graph, { speeds: SPEEDS, mode: "foot" }), land[Math.floor(land.length / 2)]);
    assert.ok(land.every((cell) => Number.isFinite(reach.days[cell])), "all of the island is reached");
    assert.ok(graph.edgeKind.includes(EDGE.RIVER), "the river is navigable");
});
