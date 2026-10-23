// Travel time (TravelTime, TravelGraph): each step's days by way of travel (the road at the speed,
// the wilds slower than farmland and rough ground slower again, rivers faster downstream, ships on
// sea routes and small boats elsewhere, waiting for passage when going aboard), the quickest times
// and way from a start, and the lines at each band's edge; and the network built from a map as a
// run builds it.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { FILRODENSWMB } = await import("../../src/config.js");
const { EDGE } = await import("../../src/generator/CellGraph.js");
const { dayRings, edgeBetween, edgeDays, flagRoute, groundPace, joinSegments, riverDirection, roadEdges, travelFrom, wayTo } = await import("../../src/travel/TravelTime.js");
const { buildTravelGraph } = await import("../../src/travel/TravelGraph.js");
const { travelGrid, travelCellOfPixels } = await import("../../src/travel/TravelGrid.js");
const { syntheticMap } = await import("../generator/synthetic.mjs");

const SPEEDS = { foot: 30, wagon: 25, mount: 60, riverDown: 60, riverUp: 20, sea: 150, boat: 40 };
const TT = FILRODENSWMB.TRAVEL_TIME;
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} against ${expected}`);

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

test("each step's days: roads, the wilds and farmland, rivers by direction and trade, ships and boats", () => {
    const graph = lineGraph();
    const { road, missing } = roadEdges(graph, [0, 9], [1, 3]);
    assert.equal(missing, 1, "a pair that is no edge is left out");
    assert.equal(road[edgeBetween(graph, 1, 0)], 1);
    const { out, back } = edgeDays(graph, { speeds: SPEEDS, mode: "foot", road });
    assert.equal(out[0], 1, "30 km of level road on foot is a day");
    const wild = 30 * TT.OFF_ROAD.foot.wild;
    near(out[2], (30 * 2 ** TT.TERRAIN) / wild, "off the road in the wilds, over ground of cost 2 slower again");
    near(groundPace(graph, { speeds: SPEEDS, mode: "foot", cleared: [0, 0, 1] }, 2), (30 * TT.OFF_ROAD.foot.cleared) / 2 ** TT.TERRAIN, "farmland is quicker than the wilds");
    assert.ok(groundPace(graph, { speeds: SPEEDS, mode: "mount" }, 0) < 30 * 0.7, "a mount in the wilds is little faster than a walker on the road");
    assert.ok(groundPace(graph, { speeds: SPEEDS, mode: "wagon" }, 0) < groundPace(graph, { speeds: SPEEDS, mode: "foot" }, 0), "a wagon in the wilds is slower than a walker");
    assert.equal(riverDirection(graph, 1, 2), 1);
    const traded = edgeDays(graph, { speeds: SPEEDS, mode: "foot", road, river: Uint8Array.from([0, 1, 0, 0]) });
    assert.equal(traded.out[1], 0.5, "a trading river downstream at 60 km a day");
    assert.equal(traded.back[1], 1.5, "upstream at 20 km a day");
    assert.equal(out[1], 0.75, "a river with no trade downstream at a small boat's 40 km a day");
    assert.equal(back[1], 1.5, "upstream no faster than the current allows");
    const ashore = (30 * 0.5 * 2 ** TT.TERRAIN) / wild;
    near(out[3], ashore + (30 * 0.5) / 40 + TT.SHORE_DAYS, "going aboard off the routes: half by land, half by small boat, and days to find one");
    near(back[3], ashore + (30 * 0.5) / 40, "coming ashore takes no wait");
    const port = edgeDays(graph, { speeds: SPEEDS, mode: "foot", road, towns: new Set([3]), lane: Uint8Array.from([0, 0, 0, 1]) });
    near(port.out[3], ashore + (30 * 0.5) / 150 + TT.HARBOUR_DAYS, "a town's harbour on a sea route: a ship, and passage soon found");
    assert.equal(edgeDays(graph, { speeds: SPEEDS, mode: "mount", road }).out[0], 0.5, "a fast mount covers the road in half a day");
});

test("times run one way from the start, with the way taken", () => {
    const graph = lineGraph();
    const days = edgeDays(graph, { speeds: SPEEDS, mode: "foot", road: roadEdges(graph, [0], [1]).road });
    const from0 = travelFrom(graph, days, 0);
    assert.deepEqual(Array.from(from0.days.slice(0, 3)), [0, 1, 1.75]);
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
    const wide = dayRings([0, 1, 2], (cell) => xs[cell], (cell) => ys[cell], Float64Array.from([0, 4, 4]), 2, 2);
    assert.deepEqual(wide.map((ring) => ring.day), [2, 4], "two-day bands are named by their last day");
    assert.deepEqual(wide[0].segments, [50, 0, 0, 50], "the first line at two days");
});

test("a route flags the edges it passes along, bridging a corner it clips; over-long edges are not travelled", () => {
    const graph = lineGraph();
    const flags = new Uint8Array(4);
    flagRoute(graph, [0, 0, -1, 2, 2], flags);
    assert.deepEqual(Array.from(flags), [1, 1, 0, 0], "0 and 2 are joined through 1, the neighbour they share");
    const far = new Uint8Array(4);
    flagRoute(graph, [0, 4], far);
    assert.deepEqual(Array.from(far), [0, 0, 0, 0], "cells with no neighbour in common are left apart");
    const days = edgeDays(graph, { speeds: SPEEDS, mode: "foot", maxKm: 20 });
    assert.ok(Array.from(days.out).every((value) => value === Infinity), "every 30 km edge is beyond a 20 km limit");
});

test("travel cells: the model cells on a coarse map, a finer set of display sites on a fine one", () => {
    const { mesh } = syntheticMap();
    const coarse = travelGrid(mesh, { cellPx: mesh.modelSpacing * 2, maxCells: 1e6 });
    assert.equal(coarse.coarse, true);
    assert.equal(coarse.count, mesh.modelCount);
    assert.equal(coarse.of, mesh.parentOf);
    const fine = travelGrid(mesh, { cellPx: mesh.modelSpacing / 3, maxCells: 1e6 });
    assert.equal(fine.coarse, false);
    assert.ok(fine.count > mesh.modelCount * 4, `${fine.count} travel cells against ${mesh.modelCount} model cells`);
    for (let cell = 0; cell < mesh.cellCount; cell += 7) {
        const own = fine.of[cell];
        const distance = (site) => Math.hypot(fine.sites[site * 2] - mesh.siteX(cell), fine.sites[site * 2 + 1] - mesh.siteY(cell));
        for (let site = 0; site < fine.count; site += 13) assert.ok(distance(own) <= distance(site) + 1e-9, "each display cell lies in its nearest travel cell");
    }
    fine.siteCell.forEach((cell, site) => assert.equal(fine.of[cell], site, "a travel site's own display cell is its own"));
    const most = mesh.modelCount * 4;
    const capped = travelGrid(mesh, { cellPx: 1, maxCells: most });
    assert.equal(capped.coarse, false);
    assert.ok(capped.count <= most, `${capped.count} travel cells, at most ${most}`);
    const pixels = travelCellOfPixels(mesh, fine);
    assert.equal(pixels.length, mesh.width * mesh.height);
});

test("a ring's segments are joined where they meet, open or closed", () => {
    // Three segments out of order and one reversed: (0,0)-(1,0), (2,1)-(1,0), (2,1)-(3,1); and a closed triangle
    const open = joinSegments([1, 0, 2, 1, 0, 0, 1, 0, 2, 1, 3, 1]);
    assert.equal(open.length, 1);
    const line = open[0];
    const ends = [line.slice(0, 2), line.slice(-2)].map(String).sort();
    assert.deepEqual(ends, ["0,0", "3,1"], "one line from end to end");
    assert.equal(line.length, 8);
    const closed = joinSegments([0, 0, 4, 0, 4, 0, 0, 3, 0, 3, 0, 0]);
    assert.equal(closed.length, 1);
    assert.deepEqual(closed[0].slice(0, 2), closed[0].slice(-2), "a closed ring ends where it began");
    assert.deepEqual(joinSegments([0, 0, 1, 0, 5, 5, 6, 5]).length, 2, "apart, two lines");
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
