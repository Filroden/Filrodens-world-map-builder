// The generator's engine (src/generator/) on small inputs: the cell graph and its searches, the
// settings, cultures, biomes, names and route chains, and whole runs on the synthetic island
// (determinism, progress, cancelling).
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { FILRODENSWMB } from "../../src/config.js";
import { buildModelCells } from "../../src/generator/CellValues.js";
import { CellGraph, EDGE, portCost, travelCost } from "../../src/generator/CellGraph.js";
import { affinity, closedness, habitatFit, resolveCultures, sharesOf, spreadCultures } from "../../src/generator/Cultures.js";
import { resolveSettings } from "../../src/generator/GeneratorSettings.js";
import { behavesLikeTable, modelBiomeRaster } from "../../src/generator/ModelBiomes.js";
import { nameBaseNames, nameEverything } from "../../src/generator/Names.js";
import { GenerationCancelled, runGenerator } from "../../src/generator/Pipeline.js";
import { hashString, stageRandom } from "../../src/generator/Random.js";
import { routeChains } from "../../src/generator/RouteChains.js";
import { SearchSpace, leastCostPerKm, searchAll } from "../../src/generator/Search.js";
import { syntheticMap } from "./synthetic.mjs";

const quick = { pause: () => Promise.resolve() };

let model = null;
/** The synthetic island's model cells and graph, built once. */
function islandGraph() {
    if (model) return model;
    const payload = syntheticMap().makePayload();
    const cells = buildModelCells({ ...payload, biome: modelBiomeRaster(payload) });
    model = { payload, cells, graph: new CellGraph(cells) };
    return model;
}

let firstRun = null;
function islandRun() {
    firstRun ??= runGenerator(syntheticMap().makePayload(), quick);
    return firstRun;
}

// ------------------------------------------------------------------ base layer and graph

test("the model cells are the mesh's model sites, with land, sea and a navigable river", () => {
    const { cells } = islandGraph();
    const { mesh } = syntheticMap();
    assert.equal(cells.count, mesh.modelCount);
    for (const cell of [0, 1, cells.count - 1]) {
        assert.equal(cells.x[cell], mesh.siteX(cell));
        assert.equal(cells.y[cell], mesh.siteY(cell));
    }
    const land = cells.water.filter((water) => !water).length;
    assert.ok(land > 0.3 * cells.count && land < 0.8 * cells.count, `${land} of ${cells.count} cells are land`);
    assert.ok(cells.navigable.some(Boolean), "the river is navigable");
    assert.ok(cells.mouthKm.some((km) => km > 0), "the river reaches the sea");
    for (let cell = 0; cell < cells.count; cell++) {
        if (cells.water[cell]) continue;
        assert.ok(cells.food[cell] >= 0 && Number.isFinite(cells.food[cell]));
        assert.ok(cells.landCost[cell] >= 1);
    }
});

test("every edge is listed from both of its cells, with a length and a kind", () => {
    const { graph } = islandGraph();
    for (let edge = 0; edge < graph.edgeCount; edge++) {
        const a = graph.edgeA[edge];
        const b = graph.edgeB[edge];
        assert.equal(graph.edge(a, b), edge);
        assert.equal(graph.edge(b, a), edge);
        assert.equal(graph.other(edge, a), b);
        assert.ok(graph.edgeKm[edge] > 0);
    }
    const kinds = new Set(graph.edgeKind);
    for (const kind of [EDGE.LAND, EDGE.SEA, EDGE.PORT]) assert.ok(kinds.has(kind));
});

test("a built road is cheaper than the ground it crosses", () => {
    const { graph, cells } = islandGraph();
    const road = new Uint8Array(graph.edgeCount);
    const open = graph.costs(travelCost(graph, { portKm: portCost(cells) }));
    road.fill(1);
    const built = graph.costs(travelCost(graph, { portKm: portCost(cells), road }));
    for (let edge = 0; edge < graph.edgeCount; edge++) assert.ok(built[edge] <= open[edge] + 1e-9);
});

// ------------------------------------------------------------------ searches

test("a multi-source search gives every reached cell to one source, each source's cells connected", () => {
    const { graph, cells } = islandGraph();
    const cost = graph.costs(travelCost(graph, { portKm: portCost(cells) }));
    const sources = [0, Math.floor(graph.count / 2), graph.count - 1];
    const { owner, best } = searchAll(graph, sources, cost);
    sources.forEach((cell, index) => {
        assert.equal(owner[cell], index);
        assert.equal(best[cell], 0);
    });
    for (let cell = 0; cell < graph.count; cell++) {
        assert.ok(owner[cell] >= 0, "every cell is reached on a connected map");
        if (best[cell] === 0) continue;
        // A cell is reached from a neighbour of the same source
        let fromSameSource = false;
        for (let slot = graph.adjStart[cell]; slot < graph.adjStart[cell + 1]; slot++) if (owner[graph.adjCell[slot]] === owner[cell]) fromSameSource = true;
        assert.ok(fromSameSource);
    }
});

test("a limit bounds the search, and the A* estimate finds the plain search's cost", () => {
    const { graph, cells } = islandGraph();
    const cost = graph.costs(travelCost(graph, { portKm: portCost(cells) }));
    const space = new SearchSpace(graph);
    space.run([0], cost, { limit: 100 });
    for (let cell = 0; cell < graph.count; cell++) assert.ok(space.costTo(cell) <= 100 || space.costTo(cell) === Infinity);
    const full = searchAll(graph, [0], cost).best;
    const perKm = leastCostPerKm(graph, cost);
    for (const target of [graph.count - 1, Math.floor(graph.count / 3), 17]) {
        space.run([0], cost, { target, estimatePerKm: perKm });
        assert.ok(Math.abs(space.costTo(target) - full[target]) < 1e-9, `the cost to ${target} matches`);
        const path = space.path(0, target);
        assert.ok(Math.abs(path.reduce((sum, edge) => sum + cost[edge], 0) - full[target]) < 1e-9);
    }
});

test("a reused search space forgets the cells of the search before", () => {
    const { graph, cells } = islandGraph();
    const cost = graph.costs(travelCost(graph, { portKm: portCost(cells) }));
    const space = new SearchSpace(graph);
    space.run([0], cost);
    space.run([graph.count - 1], cost, { limit: 1 });
    assert.equal(space.costTo(0), Infinity);
    assert.equal(space.ownerOf(0), -1);
});

// ------------------------------------------------------------------ settings, randomness, biomes

test("settings: defaults fill gaps, presets resolve, numbers are clamped", () => {
    const empty = resolveSettings({}, "MAPSEED");
    assert.equal(empty.seed, "MAPSEED");
    assert.equal(empty.nameBase, FILRODENSWMB.GENERATOR.DEFAULT_NAME_BASE);
    assert.deepEqual(empty.ages, [{ era: "highMedieval", development: 0.7, plague: 0, strifeName: "troubled", strife: 0.5, event: null }]);
    assert.deepEqual(empty.world, { density: 1, urbanisation: 1, realmSpacing: 1, fragmentation: 1 });

    const odd = resolveSettings({ seed: " X ", world: { density: 99, fragmentation: "lots" }, ages: [{ era: "afterPlague", strife: 3 }, { era: { development: 2 } }] }, "M");
    assert.equal(odd.seed, "X");
    assert.equal(odd.world.density, FILRODENSWMB.GENERATOR.WORLD.density.max);
    assert.equal(odd.world.fragmentation, 1);
    assert.deepEqual(odd.ages[0], { era: "afterPlague", development: 0.75, plague: 0.35, strifeName: "custom", strife: 1, event: null });
    const events = resolveSettings({ ages: [{ event: { kind: "invasion", culture: "elves" } }, { event: { kind: "conquest", culture: "x" } }, { event: { kind: "arrival", culture: 3 } }] }).ages;
    assert.deepEqual(events.map((age) => age.event), [{ kind: "invasion", culture: "elves" }, null, null]);
    assert.equal(odd.ages[1].development, 1);
    assert.equal(resolveSettings({ ages: new Array(20).fill({}) }).ages.length, FILRODENSWMB.GENERATOR.MAX_AGES);
});

test("each stage draws from its own seeded source", () => {
    assert.equal(hashString("P0JBVA:names"), hashString("P0JBVA:names"));
    const a = stageRandom("S", "names");
    const b = stageRandom("S", "names");
    const c = stageRandom("S", "other");
    const first = [a(), a(), a()];
    assert.deepEqual(first, [b(), b(), b()]);
    assert.notDeepEqual(first, [c(), c(), c()]);
});

test("a custom biome behaves as the biome beneath it until told otherwise", () => {
    const { buffers } = syntheticMap();
    const size = buffers.elevation.length;
    const base = { ...buffers, seaLevel: 0.35, biomeOverrides: null, biomeParams: {} };
    const plain = modelBiomeRaster(base);
    // Paint custom biome 200 everywhere; the palette and sides must know it for an override to count
    const sides = new Uint8Array(256);
    sides[200] = 0xff;
    const painted = { ...base, biomeOverrides: new Uint8Array(size).fill(200), biomeParams: { biomePalette: { 200: [1, 2, 3] }, biomeSides: sides } };
    assert.deepEqual(modelBiomeRaster({ ...painted, customBiomes: [{ id: 200 }] }), plain, "underlying biome: no change");
    assert.deepEqual(modelBiomeRaster({ ...painted, customBiomes: [{ id: 200, behavesLike: null }] }), plain, "The biome beneath, as saved by the dialogue: the same as before the field existed");
    const desert = modelBiomeRaster({ ...painted, customBiomes: [{ id: 200, behavesLike: "SUBTROPICAL_DESERT" }] });
    for (let pixel = 0; pixel < size; pixel++) assert.equal(desert[pixel], plain[pixel] ? FILRODENSWMB.BIOME_IDS.SUBTROPICAL_DESERT : 0);
    assert.equal(behavesLikeTable([{ id: 5, behavesLike: "DEEP_OCEAN" }]).get(5), 0, "only land biomes the model knows");
});

// ------------------------------------------------------------------ cultures

test("the default culture is neutral everywhere", () => {
    const { graph, cells } = islandGraph();
    const data = spreadCultures(graph, resolveCultures([]));
    for (let cell = 0; cell < cells.count; cell++) {
        assert.equal(data.popMult[cell], 1);
        if (!cells.water[cell] && cells.landKm2[cell] > 0) assert.deepEqual(sharesOf(data, cell), [[0, 1]]);
    }
    assert.equal(closedness(data.cultures, 0, 0), 0);
    assert.equal(affinity(data.cultures, [[0, 1]], [[0, 1]]), 1);
});

test("habitat bands lower the fit outside them, never below the floor", () => {
    const { cells } = islandGraph();
    const land = cells.water.findIndex((water) => !water);
    const generalist = resolveCultures([{ name: "All" }])[0];
    assert.equal(habitatFit(generalist, cells, land), 1);
    const misfit = { ...generalist, habitat: { temperature: [cells.temperature[land] + 0.5, 1] } };
    assert.equal(habitatFit(misfit, cells, land), FILRODENSWMB.GENERATOR.CULTURES.FIT_FLOOR);
});

test("two cultures share the island, each holding its homeland", () => {
    const { graph, cells } = islandGraph();
    const land = [];
    for (let cell = 0; cell < cells.count; cell++) if (!cells.water[cell] && cells.landKm2[cell] > 0) land.push(cell);
    const west = land.reduce((a, b) => (cells.x[a] < cells.x[b] ? a : b));
    const east = land.reduce((a, b) => (cells.x[a] > cells.x[b] ? a : b));
    const data = spreadCultures(graph, resolveCultures([{ name: "W", homelandCell: west, openness: 0.2 }, { name: "E", homelandCell: east, openness: 0.2 }]));
    assert.deepEqual(data.homelands.map((cells) => Array.from(cells)), [[west], [east]]);
    assert.equal(data.dominant[west], 0);
    assert.equal(data.dominant[east], 1);
    const listed = spreadCultures(graph, resolveCultures([{ name: "W", homelandCells: [west], openness: 0.2 }, { name: "E", homelandCells: [east], openness: 0.2 }]));
    assert.deepEqual(Array.from(listed.dominant), Array.from(data.dominant), "one homeland in a list is the single homeland of before");
});

test("a culture with two homelands spreads from both, and holds land at each", () => {
    const { graph, cells } = islandGraph();
    const land = [];
    for (let cell = 0; cell < cells.count; cell++) if (!cells.water[cell] && cells.landKm2[cell] > 0) land.push(cell);
    const by = (score) => land.reduce((a, b) => (score(a) < score(b) ? a : b));
    const west = by((cell) => cells.x[cell]);
    const east = by((cell) => -cells.x[cell]);
    const north = by((cell) => cells.y[cell]);
    const south = by((cell) => -cells.y[cell]);
    // A closed people at the far west and east; an open one at the north and south
    const data = spreadCultures(graph, resolveCultures([{ name: "Hill", homelandCells: [west, east], openness: 0.1 }, { name: "Plain", homelandCells: [north, south], openness: 0.1 }]));
    assert.deepEqual(data.homelands.map((cells) => Array.from(cells).sort((a, b) => a - b)), [[west, east].sort((a, b) => a - b), [north, south].sort((a, b) => a - b)]);
    for (const cell of [west, east]) assert.equal(data.dominant[cell], 0);
    for (const cell of [north, south]) assert.equal(data.dominant[cell], 1);
    const water = cells.water.findIndex((value) => value === 1);
    const placed = spreadCultures(graph, resolveCultures([{ name: "Sea", homelandCells: [water, -4, 1e9, 2.5] }]));
    assert.equal(placed.homelands[0].length, 1, "homelands off the land are skipped, and one is placed instead");
    assert.notEqual(placed.homelands[0][0], water);
});

test("automatic homelands: one each, apart, off the map's edge where there is room, and the narrowest habitat seated first", () => {
    const { graph, cells } = islandGraph();
    const land = [];
    for (let cell = 0; cell < cells.count; cell++) if (!cells.water[cell] && cells.landKm2[cell] > 0) land.push(cell);
    const four = ["A", "B", "C", "D"].map((name) => ({ name }));
    const data = spreadCultures(graph, resolveCultures(four));
    const homes = data.homelands.map((list) => list[0]);
    assert.equal(new Set(homes).size, 4, "four different homelands");
    for (let index = 0; index < 4; index++) assert.equal(data.dominant[homes[index]], index, "each holds its own homeland");
    // Every culture holds a share of the island worth the name
    for (let index = 0; index < 4; index++) assert.ok(land.filter((cell) => data.dominant[cell] === index).length >= land.length * 0.05, `culture ${index} holds land`);
    assert.ok(data.homelandNotes.every((note) => note.auto));

    // A people of the island's highest ground, listed last, is seated first and gets it
    const heights = land.map((cell) => cells.heightM[cell]).sort((a, b) => a - b);
    const high = heights[Math.floor(heights.length * 0.9)];
    const withHill = spreadCultures(graph, resolveCultures([...four.slice(0, 3), { name: "Hill", habitat: { heightM: [high, 99999] } }]));
    assert.ok(cells.heightM[withHill.homelands[3][0]] >= high * 0.9, "the hill people's homeland is high ground");

    // Given homelands are kept as given, and one culture alone is placed as it always was
    const west = land.reduce((a, b) => (cells.x[a] < cells.x[b] ? a : b));
    const mixed = spreadCultures(graph, resolveCultures([{ name: "W", homelandCell: west }, { name: "Auto" }]));
    assert.deepEqual(Array.from(mixed.homelands[0]), [west]);
    assert.notEqual(mixed.homelands[1][0], west);
    const single = spreadCultures(graph, resolveCultures([{ name: "Only" }]));
    const best = land.reduce((a, b) => ((cells.density[b] + 1) > (cells.density[a] + 1) ? b : a));
    assert.equal(single.homelands[0][0], best, "one culture with no habitat: the land that feeds the most");
});

// ------------------------------------------------------------------ names and routes

test("names are deterministic for a seed, and differ for another", () => {
    const realms = { counties: [{ seat: 1 }], duchies: [{ seat: 1 }], realms: [{ kind: "kingdom", seat: 1 }] };
    const cultures = { cultures: resolveCultures([]), dominant: new Int32Array(3) };
    const towns = [{ cell: 1, population: 2000 }, { cell: 2, population: 1000 }];
    const make = (seed) => nameEverything({ seed, nameBase: "German", cultures, towns, castles: [{ cell: 0 }], realms });
    const one = make("A");
    assert.deepEqual(make("A"), one);
    assert.notDeepEqual(make("B").towns, one.towns);
    assert.equal(one.counties[0], one.towns.get(1), "a county takes its seat's name");
    assert.ok(FILRODENSWMB.GENERATOR.CASTLE_WORDS.includes(one.castles[0].keep));
    assert.equal(nameBaseNames().length, 43);
    assert.ok(nameBaseNames().includes(FILRODENSWMB.GENERATOR.DEFAULT_NAME_BASE));
});

test("route chains run between towns and junctions, one transport and class each", () => {
    const { graph } = islandGraph();
    const traffic = new Float64Array(graph.edgeCount);
    // A straight run of edges from cell 0, each a little busier than the last
    let cell = 0;
    const visited = new Set([0]);
    for (let step = 0; step < 12; step++) {
        let next = -1;
        for (let slot = graph.adjStart[cell]; slot < graph.adjStart[cell + 1] && next < 0; slot++) if (!visited.has(graph.adjCell[slot])) next = slot;
        if (next < 0) break;
        traffic[graph.adjEdge[next]] = 1 + step;
        cell = graph.adjCell[next];
        visited.add(cell);
    }
    const chains = routeChains(graph, traffic, [0, cell]);
    const steps = chains.reduce((sum, chain) => sum + chain.cells.length - 1, 0);
    assert.equal(steps, traffic.filter((value) => value > 0).length, "every used edge is in exactly one chain");
    for (const chain of chains) {
        assert.ok(["road", "river", "sea"].includes(chain.transport));
        assert.ok(["trunk", "main", "minor"].includes(chain.class));
        for (let index = 1; index < chain.cells.length; index++) assert.ok(graph.edge(chain.cells[index - 1], chain.cells[index]) >= 0);
    }
});

// ------------------------------------------------------------------ whole runs

test("a run on the island gives realms, towns, routes and model-cell values that nest", async () => {
    const result = await islandRun();
    assert.equal(result.revision, FILRODENSWMB.GENERATOR.REVISION);
    assert.ok(result.realms.length >= 1);
    assert.ok(result.stats.cities >= 1 && result.stats.towns >= 1);
    const { modelCount } = syntheticMap().mesh;
    for (const array of Object.values(result.modelCells).filter((value) => value.length === modelCount)) assert.equal(array.length, modelCount);
    for (const place of result.places) {
        assert.ok(place.cell >= 0 && place.cell < modelCount);
        assert.ok(typeof place.name === "string" && place.name.length > 0);
    }
    const capitals = result.places.filter((place) => place.capital);
    assert.equal(capitals.length, result.realms.length, "each realm's seat is a capital");
    for (const realm of result.realms) assert.equal(result.modelCells.realm[realm.seat], result.realms.indexOf(realm));
    // Nesting: a cell's county belongs to its duchy, and its duchy to its realm
    const { county, duchy, realm } = result.modelCells;
    for (let cell = 0; cell < modelCount; cell++) {
        if (county[cell] < 0) continue;
        assert.equal(result.counties[county[cell]].duchy, duchy[cell]);
        if (duchy[cell] >= 0) assert.equal(result.duchies[duchy[cell]].realm, realm[cell]);
    }
    assert.ok(result.routes.length > 0);
});

test("the same seed and settings give the same output; another seed only renames", async () => {
    const again = await runGenerator(syntheticMap().makePayload(), quick);
    const first = await islandRun();
    assert.deepEqual(again.places, first.places);
    assert.deepEqual(again.routes, first.routes);
    assert.deepEqual(again.modelCells, first.modelCells);
    const reseeded = await runGenerator(syntheticMap().makePayload({ seed: "OTHER" }), quick);
    assert.deepEqual(reseeded.places.map((place) => place.cell), first.places.map((place) => place.cell));
    assert.notDeepEqual(reseeded.places.map((place) => place.name), first.places.map((place) => place.name));
});

test("progress runs through every stage in order, never going back", async () => {
    const reports = [];
    await runGenerator(syntheticMap().makePayload(), { ...quick, onProgress: (report) => reports.push(report) });
    const pcts = reports.map((report) => report.pct);
    assert.deepEqual(pcts, [...pcts].sort((a, b) => a - b));
    assert.equal(pcts.at(-1), 100);
    const order = FILRODENSWMB.GENERATOR.STAGES.map((stage) => stage.id);
    const seen = [...new Set(reports.map((report) => report.stage))];
    assert.deepEqual(seen, order);
});

test("a run stops when cancelled, between stages and inside one", async () => {
    // Pausing at every step, so a cancel inside the trade rounds is seen before they finish
    for (const [stopAt, inside] of [["cultures", false], ["trade", true]]) {
        let cancelled = false;
        const after = [];
        const run = runGenerator(syntheticMap().makePayload(), {
            pause: () => Promise.resolve(),
            breathMs: 0,
            onProgress: ({ stage, pct }) => {
                if (cancelled) after.push(stage);
                if (stage === stopAt && (!inside || pct > 30)) cancelled = true;
            },
            isCancelled: () => cancelled,
        });
        await assert.rejects(run, (error) => error instanceof GenerationCancelled && error.name === "AbortError", `stopped at ${stopAt}`);
        assert.deepEqual(after, [], "no progress after the cancel");
    }
});
