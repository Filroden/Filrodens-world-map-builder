// A run written onto the map (Materialise and its parts) on the synthetic island: the political
// set's nesting and waters, the routes' legs, the pins and their generated details, coincident
// route stretches drawn once (RouteMerge) and the saved model run's codec. The island holds one
// realm, so the realms' colouring is checked on P0JBVA (p0jbva.test.mjs).
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { FILRODENSWMB } from "../../src/config.js";
import { materialise, placeTier } from "../../src/generator/Materialise.js";
import { MODEL_RUN_ARRAYS, decodeModelRun, encodeModelRun, packArray, unpackArray } from "../../src/generator/ModelRun.js";
import { runGenerator } from "../../src/generator/Pipeline.js";
import { MeshSession } from "../../src/mesh/MeshSession.js";
import { routeRuns } from "../../src/mesh/RouteMerge.js";
import { UNCLAIMED } from "../../src/mesh/Schema.js";
import { MATERIALISE_NAMES, materialiseStyles } from "./helpers.mjs";
import { HEIGHT, WIDTH, syntheticMap } from "./synthetic.mjs";

const SEA_LEVEL_OF_PAYLOAD = () => syntheticMap().makePayload().seaLevel;

let ids = 0;
const nextId = () => `id${String(++ids).padStart(14, "0")}`;

/** The synthetic island's session (its terrain summaries, river pixels marked) and one run on it. */
let built = null;
async function islandRun() {
    if (built) return built;
    const { mesh, buffers, rivers, makePayload } = syntheticMap();
    const riverMap = new Uint8Array(WIDTH * HEIGHT);
    for (const point of rivers.vectors[0].path) riverMap[point.y * WIDTH + point.x] = 1;
    const aggregates = mesh.aggregate({ elevation: buffers.elevation, waterMask: buffers.waterMask, riverMap, seaLevel: SEA_LEVEL_OF_PAYLOAD() });
    const meshBlock = { seed: 7, spacing: 4, cells: mesh.cellCount, width: WIDTH, height: HEIGHT, version: 1 };
    const session = new MeshSession({ mesh, meshBlock, layerSets: [], owners: {}, aggregates });
    const result = await runGenerator(makePayload(), { pause: () => Promise.resolve() });
    built = { session, result };
    return built;
}

let output = null;
async function materialised() {
    if (output) return output;
    const { session, result } = await islandRun();
    const made = materialise(session, result, { runId: "run", idFactory: nextId, layerSets: [], names: MATERIALISE_NAMES, watersPx: 24, ...materialiseStyles() });
    output = { session, result, made };
    return output;
}

// ------------------------------------------------------------------ the political set

test("the political set has three nested levels with the run's units, titled by their templates", async () => {
    const { result, made } = await materialised();
    const [realms, duchies, counties] = made.set.levels;
    assert.deepEqual(made.set.levels.map((level) => level.name), MATERIALISE_NAMES.levels);
    assert.equal(duchies.parentLevelId, realms.id);
    assert.equal(counties.parentLevelId, duchies.id);
    assert.equal(realms.regions.length, result.realms.length);
    assert.equal(duchies.regions.length, result.duchies.length);
    assert.equal(counties.regions.length, result.counties.length);
    assert.ok(realms.regions.every((region) => region.generated?.run === "run" && region.generated.kind === "realm"));
    const titled = duchies.regions.filter((region) => region.name.startsWith("Duchy of "));
    assert.equal(titled.length, duchies.regions.length, "every duchy takes the duchy title");
});

test("every child cell lies inside its region's parent, and the realms claim their waters", async () => {
    const { session, made } = await materialised();
    const levels = made.set.levels;
    for (let depth = 1; depth < levels.length; depth++) {
        const parentOwners = session.layer(levels[depth - 1].id).owners;
        const owners = session.layer(levels[depth].id).owners;
        const parentOf = new Map(levels[depth].regions.map((region) => [region.key, region.parentKey]));
        let outside = 0;
        for (let cell = 0; cell < owners.length; cell++) {
            if (owners[cell] !== UNCLAIMED && parentOf.get(owners[cell]) !== parentOwners[cell]) outside++;
        }
        assert.equal(outside, 0, `${levels[depth].name}: cells outside their parent`);
    }
    const realmOwners = session.layer(levels[0].id).owners;
    const land = session.aggregates.land;
    const waters = realmOwners.filter((owner, cell) => owner !== UNCLAIMED && !land[cell]).length;
    assert.ok(waters > 0, "some sea is claimed as territorial waters");
    assert.equal(Object.keys(made.owners).length, 3, "each level's owners come back encoded");
});

test("each region has a label of its own, so moving one moves no other", async () => {
    const { made } = await materialised();
    for (const level of made.set.levels) {
        const labels = new Set(level.regions.map((region) => region.label));
        assert.equal(labels.size, level.regions.length, `${level.name}: labels shared`);
    }
});

test("every region keeps ground and every county holds its seat", async () => {
    const { session, result, made } = await materialised();
    for (const level of made.set.levels) {
        const owned = new Set(session.layer(level.id).owners);
        const empty = level.regions.filter((region) => !owned.has(region.key));
        assert.deepEqual(empty.map((region) => region.name), [], `${level.name} without ground`);
    }
    const counties = made.set.levels[2];
    const owners = session.layer(counties.id).owners;
    for (const region of counties.regions) {
        const seat = result.counties[region.generated.sourceId].seat;
        if (session.aggregates.land[seat]) assert.equal(owners[seat], region.key, `${region.name} holds its seat`);
    }
});

// ------------------------------------------------------------------ routes and pins

test("routes join their waypoints with contiguous legs, carry class and transport, and take their style", async () => {
    const { session, made } = await materialised();
    assert.ok(made.routes.length > 0);
    const { mesh } = session;
    let straight = 0;
    for (const route of made.routes) {
        assert.ok(["road", "river", "sea"].includes(route.transport));
        assert.ok(["trunk", "main", "minor"].includes(route.class));
        assert.equal(route.legs.length, route.waypoints.length - 1);
        route.legs.forEach((leg, k) => {
            assert.equal(leg[0], route.waypoints[k]);
            assert.equal(leg.at(-1), route.waypoints[k + 1]);
            for (let i = 1; i < leg.length; i++) if (!mesh.neighbours(leg[i - 1]).includes(leg[i])) straight++;
        });
        assert.equal(route.quickStyle, FILRODENSWMB.GENERATOR.ROUTE_STYLES[route.transport][route.class]);
        assert.equal(route.generated.run, "run");
    }
    assert.ok(straight <= made.routes.length * 0.05, `${straight} straight steps`);
});

test("every place has one pin on its tier's style, with only capitals' and cities' labels shown", async () => {
    const { result, made } = await materialised();
    assert.equal(made.pins.length, result.places.length);
    const labelled = new Set(FILRODENSWMB.GENERATOR.LABELLED_TIERS);
    made.pins.forEach((pin, index) => {
        const place = result.places[index];
        assert.equal(pin.cell, place.cell);
        assert.equal(pin.generated.tier, placeTier(place));
        assert.equal(pin.generated.sourceId, index);
        assert.equal(pin.generated.edited, false);
        assert.equal(pin.label.visibility === "none", !labelled.has(pin.generated.tier));
    });
    const castle = made.pins.find((pin) => pin.generated.kind === "castle");
    if (castle) assert.match(castle.name, / (Castle|Keep|Hold|Tower)$/);
});

// ------------------------------------------------------------------ coincident stretches

test("a stretch two routes share is drawn by the higher class only", () => {
    const trunk = { id: "b", transport: "road", class: "trunk", thickness: 2, legs: [[1, 2, 3, 4]] };
    const minor = { id: "a", transport: "road", class: "minor", thickness: 1, legs: [[0, 1, 2, 3], [3, 9]] };
    const sea = { id: "c", transport: "sea", class: "minor", thickness: 1, legs: [[1, 2]] };
    const runs = routeRuns([minor, trunk, sea], 100);
    assert.equal(runs.get("b"), null, "the trunk road draws whole");
    assert.deepEqual(runs.get("a"), [[0, 1], [3, 9]], "the minor road draws only its own stretches");
    assert.equal(runs.get("c"), null, "another transport is not merged");
    assert.deepEqual(routeRuns([{ ...minor, legs: [[1, 2]] }, trunk], 100).get("a"), [], "a route wholly under another draws nothing");
});

test("the session's draw lines are cached until a route changes", async () => {
    const { session, made } = await materialised();
    const first = session.routeDrawLines(made.routes);
    assert.equal(session.routeDrawLines(made.routes), first);
    const merged = made.routes.filter((route) => first.get(route.id).length !== 1 || first.get(route.id)[0] !== session.routeLine(route));
    assert.ok(merged.length > 0, "some generated routes share stretches");
    const changed = [...made.routes];
    changed[0] = { ...changed[0], thickness: changed[0].thickness + 1 };
    assert.notEqual(session.routeDrawLines(changed), first);
});

// ------------------------------------------------------------------ the saved model run

test("an array packs to its type and unpacks to its quantised values", () => {
    const packed = packArray([0, 0.5, 1, 2], { type: "u8", scale: 255 });
    assert.equal(packed.type, "u8");
    assert.deepEqual(Array.from(unpackArray(packed), (value) => Math.round(value * 255)), [0, 128, 255, 255]);
    assert.equal(packArray([-1, 300], { type: "index", offset: 1 }).type, "u16");
    assert.deepEqual(Array.from(unpackArray(packArray([-1, 70000], { type: "index", offset: 1 }))), [-1, 70000]);
});

test("a run's model cells survive the codec within their quantisation", async () => {
    const { result } = await islandRun();
    const saved = JSON.parse(JSON.stringify(encodeModelRun(result, "run")));
    assert.equal(saved.cellCount, result.cellCount);
    const arrays = decodeModelRun(saved);
    assert.deepEqual(Object.keys(arrays).sort(), [...MODEL_RUN_ARRAYS].sort());
    for (const name of ["population", "capacity", "realm", "duchy", "county", "culture", "water"]) {
        assert.deepEqual(Array.from(arrays[name]), Array.from(result.modelCells[name], (value) => Math.round(value)), name);
    }
    for (let cell = 0; cell < result.cellCount; cell++) assert.ok(Math.abs(arrays.security[cell] - result.modelCells.security[cell]) <= 0.5 / 255 + 1e-9);
});
