// Regional in-fill (src/generator/Infill.js, src/applications/InfillInput.js) on the synthetic
// island: the parent's people shared out and never more of them, market towns within a day's round
// trip of every village and none crowding a town, villages thinned by the area factor and capped,
// places only near the inherited network, lanes joining every place to it, names in each place's
// culture, and the same result for the same seed.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parentRunOf } from "./infill-helpers.mjs";
import { syntheticMap } from "./synthetic.mjs";

const { FILRODENSWMB } = await import("../../src/config.js");
const { runInfill } = await import("../../src/generator/Infill.js");
const { InfillInput } = await import("../../src/applications/InfillInput.js");

/** A village of either size (a large one has at least INFILL.LARGE_VILLAGE_POP). */
const isVillage = (place) => place.tier === "village" || place.tier === "largeVillage";

let cached = null;
function infill() {
    if (cached) return cached;
    const { mesh, makePayload } = syntheticMap();
    const payload = makePayload();
    const parentRun = parentRunOf(mesh, payload);
    // Two inherited towns and a road between them
    const townA = mesh.cellAt(180, 180);
    const townB = mesh.cellAt(300, 180);
    const road = [];
    for (let x = 180; x <= 300; x += 2) road.push(mesh.cellAt(x, 180));
    const pins = [
        { name: "Ashby", x: 180, y: 180, generated: { kind: "town", population: 5000 } },
        { name: "Brook", x: 300, y: 180, generated: { kind: "town", population: 3000 } },
    ];
    const routes = [{ transport: "road", waypoints: [townA, townB], legs: [road] }];
    const { input, grid } = InfillInput.gather({ mesh, parentRun, payload, pins, routes, speeds: FILRODENSWMB.TRAVEL_TIME.SPEEDS, seed: "SYNTH", nameBase: "English" });
    // Across the whole island, not only near its one road (the reach is tested on its own below)
    input.options = { ROUTE_REACH_KM: 1e9 };
    const result = runInfill(input);
    cached = { mesh, input, grid, result, parentRun };
    return cached;
}

test("in-fill shares out the parent's people and adds none", () => {
    const { input, result } = infill();
    const parentPeople = input.parent.population.reduce((sum, value) => sum + value, 0);
    const townPeople = input.towns.reduce((sum, town) => sum + town.population, 0);
    const villagePeople = result.places.filter((place) => isVillage(place)).reduce((sum, place) => sum + place.population, 0);
    const marketPeople = result.places.filter((place) => place.tier === "marketTown").reduce((sum, place) => sum + place.population, 0);
    const country = result.people.reduce((sum, value) => sum + value, 0);
    assert.ok(villagePeople <= country + 1, "villages hold the country people of their cells");
    assert.ok(country + marketPeople <= parentPeople - townPeople + result.stats.markets * FILRODENSWMB.INFILL.MARKET_MIN_POP + 1, "no more people than the parent had (bar a small market's minimum)");
    assert.ok(country + marketPeople > (parentPeople - townPeople) * 0.9, `most of the parent's country people are placed: ${Math.round(country + marketPeople)} of ${parentPeople - townPeople}`);
});

test("market towns serve every village within a day's round trip, apart from the towns", () => {
    const { result, input } = infill();
    const markets = result.places.filter((place) => place.tier === "marketTown");
    assert.ok(markets.length > 3, `${markets.length} market towns`);
    const towns = new Set(input.towns.map((town) => town.cell));
    for (const market of markets) {
        assert.ok(!towns.has(market.cell), "no market on an inherited town");
        assert.ok(market.population >= FILRODENSWMB.INFILL.MARKET_MIN_POP);
    }
    assert.equal(new Set(markets.map((market) => market.cell)).size, markets.length, "one market per cell");
});

test("villages: a share of the settled cells by the area factor, none on a town or market, capped", () => {
    const { result, input } = infill();
    const villages = result.places.filter((place) => isVillage(place));
    assert.ok(villages.length > 50, `${villages.length} villages`);
    assert.ok(villages.every((village) => village.population >= FILRODENSWMB.INFILL.VILLAGE_MIN_POP && village.population <= FILRODENSWMB.INFILL.VILLAGE_MAX_POP));
    assert.ok(villages.every((village) => (village.tier === "largeVillage") === village.population >= FILRODENSWMB.INFILL.LARGE_VILLAGE_POP), "large from LARGE_VILLAGE_POP");
    assert.ok(villages.every((village, index) => index === 0 || villages[index - 1].population >= village.population), "largest first");
    const markets = new Set(result.places.filter((place) => place.tier === "marketTown").map((place) => place.cell));
    assert.ok(villages.every((village) => !markets.has(village.cell)));
    const sparser = runInfill({ ...input, areaFactor: 40 }).places.filter((place) => isVillage(place));
    assert.ok(sparser.length < villages.length * 0.6, `a larger area factor shows fewer villages: ${sparser.length} against ${villages.length}`);
    const capped = runInfill({ ...input, options: { ...input.options, MAX_VILLAGES: 10 } });
    assert.equal(capped.places.filter((place) => isVillage(place)).length, 10);
    assert.ok(capped.stats.villagesLeftOut > 0);
});

test("market towns and villages stand only near the inherited roads and towns, a big town reaching further", () => {
    const { input, grid, mesh, result } = infill();
    const near = runInfill({ ...input, options: {} });
    const { ROUTE_REACH_KM: reachKm, TOWN_REACH_SCALE } = FILRODENSWMB.INFILL;
    const { TIERS } = FILRODENSWMB.GENERATOR.TOWNS;
    // Each town's reach by its tier (Ashby, 5,000 people, is a large town's tier; Brook is none)
    const townReachKm = (town) => {
        const tier = TIERS.findIndex((candidate) => town.population >= candidate.minPop);
        return reachKm * (tier >= 0 ? TOWN_REACH_SCALE[tier] : 1);
    };
    const network = [...new Set(input.routes.flatMap((route) => route.cells))].filter((cell) => cell >= 0).map((cell) => ({ cell, reach: reachKm }));
    for (const town of input.towns) network.push({ cell: town.cell, reach: townReachKm(town) });
    const km = (a, b) => Math.hypot(grid.sites[a * 2] - grid.sites[b * 2], grid.sites[a * 2 + 1] - grid.sites[b * 2 + 1]) * mesh.kmPerPx;
    assert.ok(near.places.length > 0);
    assert.ok(near.places.length < result.places.length / 2, `${near.places.length} near the road against ${result.places.length} across the island`);
    assert.ok(near.places.every((place) => network.some(({ cell, reach }) => km(place.cell, cell) <= reach + 1e-6)), "all within reach");

    const ashby = input.towns.find((town) => town.population === 5000);
    assert.equal(townReachKm(ashby), reachKm * TOWN_REACH_SCALE[1]);
    const plain = runInfill({ ...input, options: { TOWN_REACH_SCALE: [1, 1, 1] } });
    const beyond = (run) => run.places.filter((place) => km(place.cell, ashby.cell) > reachKm && !network.some(({ cell, reach }) => cell !== ashby.cell && km(place.cell, cell) <= reach)).length;
    assert.equal(beyond(plain), 0, "at the plain reach, nothing beyond it");
    assert.ok(beyond(near) > 0, "the large town's country reaches further");
});

test("lanes join every place to the network", () => {
    const { result, input } = infill();
    assert.ok(result.lanes.length > 0);
    const onLanes = new Set(result.lanes.flatMap((lane) => lane.cells));
    const roadCells = new Set(input.routes.flatMap((route) => route.cells));
    const towns = new Set(input.towns.map((town) => town.cell));
    const joined = result.places.filter((place) => onLanes.has(place.cell) || roadCells.has(place.cell) || towns.has(place.cell));
    assert.ok(joined.length / result.places.length > 0.95, `${joined.length} of ${result.places.length} places on a lane, road or town`);
    assert.ok(result.lanes.every((lane) => lane.cells.length >= 2 && lane.km > 0));
});

test("names follow each place's culture, avoid the map's names, and the run is repeatable", () => {
    const { result, input } = infill();
    assert.ok(result.places.every((place) => typeof place.name === "string" && place.name.length > 0));
    assert.ok(!result.places.some((place) => place.name === "Ashby" || place.name === "Brook"));
    const again = runInfill(input);
    assert.deepEqual(again.places, result.places, "the same seed gives the same places and names");
    assert.deepEqual(again.lanes.map((lane) => lane.cells), result.lanes.map((lane) => lane.cells));
});

test("a town of the generator's tiers draws its people from its reach, so the country round it keeps theirs", () => {
    const { mesh, makePayload } = syntheticMap();
    const payload = makePayload();
    const parentRun = parentRunOf(mesh, payload);
    // Three parent cells' people: as on a regional map cut close round a capital
    const big = { name: "Kingsport", x: 240, y: 180, generated: { kind: "town", population: 60000 } };
    const { input } = InfillInput.gather({ mesh, parentRun, payload, pins: [big], routes: [], speeds: FILRODENSWMB.TRAVEL_TIME.SPEEDS, seed: "SYNTH", nameBase: "English" });
    input.options = { ROUTE_REACH_KM: 1e9 };
    const result = runInfill(input);
    const own = input.parentOf[input.towns[0].cell];
    let ownPeople = 0;
    for (let cell = 0; cell < input.parentOf.length; cell++) if (input.parentOf[cell] === own) ownPeople += result.people[cell];
    assert.ok(ownPeople > 0, "its own cell keeps country people");
    assert.ok(result.places.some((place) => isVillage(place)), "with villages");

    // What it drew: the country people with no town, less those with it (before markets draw theirs)
    const countryOf = (run) => run.people.reduce((sum, value) => sum + value, 0) + run.places.filter((place) => place.tier === "marketTown").reduce((sum, place) => sum + place.population, 0);
    const none = runInfill({ ...input, towns: [] });
    const drawn = countryOf(none) - countryOf(result);
    const slack = (result.stats.markets + none.stats.markets) * FILRODENSWMB.INFILL.MARKET_MIN_POP + 1;
    assert.ok(drawn > -slack && drawn <= big.generated.population + slack, `the town draws no more than its own people: ${Math.round(drawn)} of ${big.generated.population}`);

    // Without where the parent cells lie, as before: all from its own cell
    const local = runInfill({ ...input, parent: { ...input.parent, sites: null } });
    let localOwn = 0;
    for (let cell = 0; cell < input.parentOf.length; cell++) if (input.parentOf[cell] === own) localOwn += local.people[cell];
    assert.equal(Math.round(localOwn), 0, "a town bigger than its cell empties it");
});
