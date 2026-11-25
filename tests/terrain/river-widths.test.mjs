// River widths on regional maps (terrain revision 4, RW): revision 4 changes nothing a map's
// terrain or rivers are traced from, only how a regional map draws its rivers; a top map's rivers
// are drawn exactly as at revision 3; a regional map's are drawn as a map symbol, as wide as on a
// top map of its pixel size (today's width over its magnification), along the same lines, with
// the same flows, the mouth and a delta's branches following; a regional map at revision 3 keeps
// its parent's width magnified; and on a ×16 regional map every drawn river still marks the
// pixels along it, which the mesh's river cells are read from (MeshSession.riverChannel).
import assert from "node:assert/strict";
import { test } from "node:test";
import { installPlatform, platform } from "../../src/platform/index.js";

installPlatform({ ...platform, i18n: { localize: (key) => key, format: (key) => key, lang: "en" } });
const { FILRODENSWMB } = await import("../../src/config.js");
const { MapStateManager } = await import("../../src/studios/world/app/MapStateManager.js");
const { RiverNetwork } = await import("../../src/studios/world/generation/RiverNetwork.js");
const { SymbolScale } = await import("../../src/kernel/util/SymbolScale.js");

const SIZE = 400;
// A regional map's top map is ROOT pixels across, as P0JBVA's is
const ROOT = 2000;
const SEA = 0.45;
const { REVISION_3, REVISION_4 } = FILRODENSWMB.TERRAIN_VERSION;
const { MIN_RADIUS, DELTA_BRANCH_WIDTH } = FILRODENSWMB.HYDROLOGY.CHANNELS;

/** Flat land falling very gently south to the sea, south of y = 333. */
const elevation = new Float32Array(SIZE * SIZE);
for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) elevation[y * SIZE + x] = 0.46 - 0.00003 * y;

/** A river (as one flowing into a crop carries its flow in), winding south into the sea. */
function river(inflow) {
    const path = [];
    for (let y = 0; y <= 335; y++) path.push({ x: 200 + Math.round(10 * Math.sin(y / 20)), y, isFrozen: false });
    return { id: "river_0", path, mergeInto: null, inflow };
}

/** A map's derived settings at a revision, on a top map or a regional map at a zoom. */
function paramsFor(terrainVersion, zoom = 1) {
    const world = zoom > 1 ? { zoom, originX: 600, originY: 600, rootW: ROOT, rootH: ROOT } : null;
    const state = { ...MapStateManager.buildDefaultUiState(SIZE, SIZE), terrainVersion, world, seaLevel: SEA, generationEngine: "advanced" };
    return MapStateManager.getDerivedMapParameters(state, {}).params;
}

/** The drawn network, as the orchestrator builds it (see ProceduralOrchestrator#drawRivers). */
function draw(terrainVersion, zoom = 1, inflow = 4000) {
    const params = paramsFor(terrainVersion, zoom);
    const map = { elevation, waterMask: new Float32Array(SIZE * SIZE), width: SIZE, height: SIZE, seaLevel: SEA, world: params.terrain.world };
    return { network: RiverNetwork.build([river(inflow)], map, RiverNetwork.optionsFrom(params)), world: params.terrain.world };
}

const points = (network) => network.channels.flatMap((channel) => channel.points);
const widest = (network) => points(network).reduce((most, point) => Math.max(most, point.r), 0);

test("revision 4 changes only how rivers are drawn: every other terrain rule is revision 3's", () => {
    for (const zoom of [1, 4]) {
        const { symbolRivers: before, ...rest3 } = paramsFor(REVISION_3, zoom).terrain;
        const { symbolRivers: after, ...rest4 } = paramsFor(REVISION_4, zoom).terrain;
        assert.equal(before, false);
        assert.equal(after, true);
        assert.deepEqual(rest4, rest3);
    }
    assert.equal(RiverNetwork.optionsFrom(paramsFor(REVISION_4)).SYMBOL_WIDTHS, true);
    assert.equal(RiverNetwork.optionsFrom(paramsFor(REVISION_3)).SYMBOL_WIDTHS, false);
});

test("a top map's channels are the same at revisions 3 and 4, every point and radius", () => {
    const before = draw(REVISION_3).network;
    const after = draw(REVISION_4).network;
    assert.ok(before.channels.length > 0);
    assert.deepEqual(after.channels, before.channels);
    assert.deepEqual([...after.flows.entries()], [...before.flows.entries()]);
    assert.equal(after.pixelsPerBaseline, before.pixelsPerBaseline);
});

for (const zoom of [4, 16]) {
    test(`on a ×${zoom} regional map at revision 4 every radius is today's over the magnification, along the same lines and flows`, () => {
        const before = draw(REVISION_3, zoom).network;
        const { network: after, world } = draw(REVISION_4, zoom);
        const share = 1 / SymbolScale.magnification(world, SIZE, SIZE);
        assert.equal(share, SIZE / (zoom * ROOT));
        assert.deepEqual([...after.flows.entries()], [...before.flows.entries()]);
        assert.equal(after.pixelsPerBaseline, before.pixelsPerBaseline);

        // The same lines (the bends worked from today's width), each point narrower
        assert.deepEqual(after.channels.map((channel) => [channel.id, !!channel.isDelta, channel.points.length]), before.channels.map((channel) => [channel.id, !!channel.isDelta, channel.points.length]));
        const [was, now] = [points(before), points(after)];
        let scaled = 0;
        now.forEach((point, i) => {
            if (!was[i].isDelta) {
                assert.equal(point.x, was[i].x);
                assert.equal(point.y, was[i].y);
            }
            const expected = Math.max(was[i].r * share, MIN_RADIUS);
            assert.ok(Math.abs(point.r - expected) <= 1e-3 * expected, `radius ${point.r} against ${expected}`);
            if (was[i].r * share > MIN_RADIUS) scaled++;
        });
        assert.ok(scaled > now.length / 2, "most of the river is wider than the minimum");
    });
}

test("the mouth widens, and a delta's branches set off, as a share of the narrower river", () => {
    // A river small enough for its delta to fork inside the map (the delta's length is geography)
    const { network } = draw(REVISION_4, 4, 230);
    const main = network.channels.find((channel) => !channel.isDelta);
    const upstream = main.points[Math.floor(main.points.length / 3)].r;
    // Widened towards the sea, over a flat coast
    assert.ok(widest(network) > upstream);
    const deltas = network.channels.filter((channel) => channel.isDelta);
    assert.ok(deltas.length > 0, "the river has a delta");
    for (const delta of deltas) {
        const apex = delta.points[0];
        const fork = main.points.find((point) => Math.abs(point.x - apex.x) < 1e-6 && Math.abs(point.y - apex.y) < 1e-6);
        assert.ok(fork, "the branch sets off from the river");
        assert.ok(Math.abs(apex.r - fork.r * DELTA_BRANCH_WIDTH) < 1e-6);
    }
});

test("a regional map at revision 3 keeps its parent's width magnified by the zoom", () => {
    const before = widest(draw(REVISION_3, 4).network);
    const after = widest(draw(REVISION_4, 4).network);
    // Magnified 20 times against this map's pixel size (×4 on a top map five times its size)
    assert.ok(Math.abs(before / after - 20) < 0.01, `${before} against ${after}`);
});

test("on a ×16 regional map at revision 4 every drawn river still marks the pixels along it", () => {
    const { network } = draw(REVISION_4, 16);
    const image = new Uint8Array(SIZE * SIZE * 4);
    RiverNetwork.rasterise(network, SIZE, SIZE, image);
    const margin = FILRODENSWMB.MESH.ROUTE.RIVER_CHANNEL_MARGIN;
    for (const channel of network.channels) {
        for (const { x, y } of channel.points) {
            if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
            assert.ok(RiverNetwork.isNearChannel(image, Math.floor(y) * SIZE + Math.floor(x), margin), `the river at ${x}, ${y}`);
        }
    }
    // The narrowest river drawn is still MIN_RADIUS either side
    assert.ok(points(network).every((point) => point.r >= MIN_RADIUS - 1e-6));
});
