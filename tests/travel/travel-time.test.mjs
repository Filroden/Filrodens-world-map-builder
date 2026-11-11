// Travel time (TravelTime, TravelGraph): each step's days by way of travel (the road at the speed,
// the wilds slower than farmland and rough ground slower again, rivers faster downstream, ships on
// sea routes and small boats elsewhere, waiting for passage when going aboard), the quickest times
// and way from a start, and the lines at each band's edge; and the network built from a map as a
// run builds it. From generator revision 2: climbs, the winds at sea and the seasons.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { FILRODENSWMB } = await import("../../src/config.js");
const { EDGE } = await import("../../src/generator/CellGraph.js");
const { dayRings, edgeBetween, edgeDays, flagRoute, groundPace, joinSegments, riverDirection, roadEdges, travelConditions, travelFrom, travelTo, wayTo } = await import("../../src/travel/TravelTime.js");
const { buildTravelGraph } = await import("../../src/travel/TravelGraph.js");
const { GeneratorRevision } = await import("../../src/generator/GeneratorRevision.js");
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

/** The line graph (see lineGraph) with a climate: mild everywhere at the equator, no wind, sites 30 px apart along x. */
function climateGraph() {
    return Object.assign(lineGraph(), {
        siteX: Float32Array.from([0, 30, 60, 90, 120]),
        siteY: new Float32Array(5),
        temperature: Float32Array.from([0.6, 0.6, 0.6, 0.6, 0.6]),
        latitude: new Float32Array(5),
        windX: new Float32Array(5),
    });
}

test("revision 2's times: climbs are slower than descents, and no conditions give revision 1's times", () => {
    assert.equal(GeneratorRevision.rules(FILRODENSWMB.GENERATOR.REVISIONS.LEGACY).travelCosts, false, "revision 1 keeps today's times");
    assert.equal(GeneratorRevision.rules(FILRODENSWMB.GENERATOR.REVISIONS.REVISION_2).travelCosts, true);
    const graph = climateGraph();
    const road = new Uint8Array(4).fill(1);
    const legacy = edgeDays(graph, { speeds: SPEEDS, mode: "foot", road });
    assert.deepEqual(edgeDays(lineGraph(), { speeds: SPEEDS, mode: "foot", road, conditions: null }), legacy, "without conditions the times are revision 1's");
    const conditions = travelConditions(graph, { season: "year" });
    assert.ok(conditions.land.every((value) => value === 1) && conditions.water.every((value) => value === 1), "a mild map is not slowed");
    // Level ground and no wind: the conditions change nothing
    const flat = Object.assign(climateGraph(), { heightM: new Float32Array(5) });
    assert.deepEqual(edgeDays(flat, { speeds: SPEEDS, mode: "foot", road, conditions }), edgeDays(flat, { speeds: SPEEDS, mode: "foot", road }), "level ground, no wind, a mild season: the times are unchanged");
    // Cell 0 stands 1,800 m above cell 1
    graph.heightM[0] = 1840;
    const days = edgeDays(graph, { speeds: SPEEDS, mode: "foot", road, conditions });
    near(days.back[0], 1 + 1800 / TT.CLIMB_M.foot, "climbing 1,800 m on foot adds half a day");
    near(days.out[0], 1, "coming down costs nothing more");
    const wagon = edgeDays(graph, { speeds: SPEEDS, mode: "wagon", road, conditions });
    near(wagon.back[0] - wagon.out[0], 1800 / TT.CLIMB_M.wagon, "a wagon climbs twice as slowly");
    const from1 = travelFrom(graph, days, 1).days[0];
    const from0 = travelFrom(graph, days, 0).days[1];
    assert.ok(from1 > from0, "up the pass is slower than down it");
});

test("seasons: winter closes a snowbound pass and ice, slows snow and cold seas, freezes rivers; summer opens them", () => {
    const graph = climateGraph();
    // Far from the equator; cell 2 high and cold, cell 4 a cold sea
    graph.latitude.fill(60);
    graph.temperature.set([0.6, 0.6, 0.3, 0.6, 0.45]);
    const swing = TT.SEASON_SWING * (60 / 90);
    const winter = travelConditions(graph, { season: "winter" });
    assert.ok(0.3 - swing < FILRODENSWMB.CLIMATE.FREEZING_THRESHOLD);
    assert.equal(winter.land[2], Infinity, "the pass is snowbound in winter");
    assert.equal(winter.frozen[2], 1, "and its river frozen");
    const year = travelConditions(graph, { season: "year" });
    assert.equal(year.land[2], 1, "open all year");
    near(winter.land[0], 1, "the lowland stays open");
    const iced = travelConditions(Object.assign(climateGraph(), { temperature: Float32Array.from([0.6, 0.6, 0.6, 0.6, 0.1]) }), { season: "year" });
    assert.equal(iced.water[4], Infinity, "ice closes the sea");
    const cold = graph.temperature[4] - swing - FILRODENSWMB.CLIMATE.FREEZING_THRESHOLD;
    near(winter.water[4], 1 / (1 - TT.COLD_SEA_SLOW * (1 - cold / TT.COLD_SEA_BAND)), "a cold sea is slower in winter");
    const snowy = travelConditions(Object.assign(climateGraph(), { temperature: Float32Array.from([0.25, 0.6, 0.6, 0.6, 0.6]) }), { season: "year" });
    near(snowy.land[0], 1 / TT.SNOW_PACE, "snowy land goes at the snow's pace");
    const summer = travelConditions(graph, { season: "summer" });
    assert.equal(summer.land[2], 1, "summer opens the pass");
    const road = new Uint8Array(4).fill(1);
    const winterDays = edgeDays(graph, { speeds: SPEEDS, mode: "foot", road, conditions: winter });
    assert.equal(winterDays.out[1], Infinity, "no way into the snowbound cell, by river or by its bank");
    assert.equal(winterDays.out[2], Infinity);
    const reach = travelFrom(graph, winterDays, 0);
    assert.equal(reach.days[3], Infinity, "the pass cuts the way in winter");
    assert.ok(Number.isFinite(travelFrom(graph, edgeDays(graph, { speeds: SPEEDS, mode: "foot", road, conditions: summer }), 0).days[3]), "in summer the way is open");
    // A river whose upper cell freezes in winter only
    const north = Object.assign(climateGraph(), { temperature: Float32Array.from([0.6, 0.15, 0.6, 0.6, 0.6]) });
    north.latitude.fill(60);
    const river = Uint8Array.from([0, 1, 0, 0]);
    const thawed = edgeDays(north, { speeds: SPEEDS, mode: "foot", road, river, conditions: travelConditions(north, { season: "summer" }) });
    assert.equal(thawed.out[1], 0.5, "a trading river in summer has boats downstream");
    assert.equal(travelConditions(north, { season: "winter" }).frozen[1], 1, "and freezes in winter");
});

test("winds: ships sail faster with the prevailing wind than against it, small boats less so", () => {
    const graph = climateGraph();
    // Two water cells side by side, 30 km apart along x, joined by a sea edge (edge 0 made a sea step)
    graph.edgeKind[0] = EDGE.SEA;
    graph.water.set([1, 1, 0, 0, 1]);
    graph.windX.fill(1);
    const conditions = travelConditions(graph);
    const lane = Uint8Array.from([1, 0, 0, 0]);
    const ship = edgeDays(graph, { speeds: SPEEDS, mode: "foot", lane, conditions });
    near(ship.out[0], 30 / 150 / (1 + TT.WIND.WITH), "with the wind, a quarter faster");
    near(ship.back[0], 30 / 150 / (1 - TT.WIND.AGAINST), "against it, two fifths slower");
    const boat = edgeDays(graph, { speeds: SPEEDS, mode: "foot", conditions });
    near(boat.out[0], 30 / 40 / (1 + TT.WIND.WITH * TT.WIND.BOAT), "a small boat feels half of it");
    graph.windX.fill(0);
    const calm = edgeDays(graph, { speeds: SPEEDS, mode: "foot", lane, conditions });
    near(calm.out[0], calm.back[0], "no wind, no difference");
});

test("the network carries the climate: latitudes from the map's, a wind by band, temperatures over land and sea", () => {
    const { makePayload } = syntheticMap();
    const payload = makePayload();
    const graph = buildTravelGraph({ ...payload, travelClimate: { latTop: 60, latBottom: 0, windDistance: 40 } });
    const top = graph.siteY.indexOf(Math.min(...graph.siteY));
    assert.ok(graph.latitude[top] <= 60 && graph.latitude[top] > 30, "the top of the map near 60 degrees");
    for (let cell = 0; cell < graph.count; cell++) {
        const lat = Math.abs(graph.latitude[cell]);
        if (lat > 30 && lat < 60) assert.ok(graph.windX[cell] > 0, "the westerlies blow east");
        if (lat < 20) assert.ok(graph.windX[cell] < 0, "the easterlies blow west");
    }
    assert.ok([...graph.water.keys()].filter((cell) => graph.water[cell]).every((cell) => Number.isFinite(graph.temperature[cell])), "water has a temperature too");
    const still = buildTravelGraph({ ...payload, travelClimate: { latTop: 60, latBottom: 0, windDistance: 0 } });
    assert.ok(still.windX.every((value) => value === 0 || Object.is(value, -0)), "no wind distance, no wind");
});

test("the Travel tool follows the map's revision (a regional map its parent's), and its season is kept valid", async () => {
    const { TravelView } = await import("../../src/applications/TravelView.js");
    const { LEGACY, REVISION_2 } = FILRODENSWMB.GENERATOR.REVISIONS;
    const older = { uiState: { travel: { season: "winter" } } };
    assert.equal(TravelView.hasConditions(older), false, "a map saved before v4.3 keeps today's times");
    assert.equal(TravelView.season(older), "year", "and its season is all year whatever was saved");
    const current = { uiState: { generatorRevision: REVISION_2, travel: { season: "winter" } } };
    assert.equal(TravelView.hasConditions(current), true);
    assert.equal(TravelView.season(current), "winter");
    assert.equal(TravelView.setting({ uiState: { generatorRevision: REVISION_2, travel: { season: "monsoon" } } }).season, "year", "an unknown season reads as all year");
    for (const parent of [LEGACY, REVISION_2]) {
        const regional = { uiState: { generatorRevision: GeneratorRevision.forRegional({ generatorRevision: parent }) } };
        assert.equal(TravelView.hasConditions(regional), parent >= REVISION_2, "a regional map's times follow its parent's revision");
    }
});

test("the way back: each cell's time to the start, each step timed the way it is travelled", () => {
    const graph = lineGraph();
    const days = edgeDays(graph, { speeds: SPEEDS, mode: "foot", road: new Uint8Array(4).fill(1), river: Uint8Array.from([0, 1, 0, 0]) });
    const home = travelTo(graph, days, 0);
    for (let cell = 0; cell < graph.count; cell++) near(home.days[cell], travelFrom(graph, days, cell).days[0], `from cell ${cell} to the start`);
    // Down the river from 1 to 2 is quicker than back up it
    assert.ok(travelFrom(graph, days, 1).days[2] < travelTo(graph, days, 1).days[2], "the way out downstream is quicker than the way back");
    assert.equal(travelTo(graph, days, -1).days[0], Infinity, "no destination, no way");
});

test("the way to the pointer is hidden at first and toggled for the session", async () => {
    const { TravelView } = await import("../../src/applications/TravelView.js");
    const app = { uiState: {}, view: { render() {} } };
    assert.equal(TravelView.wayShown(app), false);
    TravelView.toggleWay(app);
    assert.equal(TravelView.wayShown(app), true);
    TravelView.toggleWay(app);
    assert.equal(TravelView.wayShown(app), false);
});
