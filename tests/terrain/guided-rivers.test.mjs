// Guided custom rivers (terrain revision 3, RiverCorridor): a revision 2 or legacy map's custom
// rivers are traced exactly as before; a revision 3 map's river stays within its corridor,
// reaches the sea or another river, starts as a stream and widens along its line, cuts through
// high ground only when asked to, and on a x4 regional map follows its parent's course, carried
// over with the way it runs and the flow it enters the crop with.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { installPlatform, platform } from "../../src/platform/index.js";

installPlatform({ ...platform, i18n: { localize: (key) => key, format: (key) => key, lang: "en" } });
const { FILRODENSWMB } = await import("../../src/config.js");
const { MapStateManager } = await import("../../src/applications/MapStateManager.js");
const { ProceduralEngine } = await import("../../src/generation/ProceduralEngine.js");
const { HydrologyEngine } = await import("../../src/generation/HydrologyEngine.js");
const { RiverNetwork } = await import("../../src/generation/RiverNetwork.js");
const { RiverCorridor } = await import("../../src/generation/RiverCorridor.js");
const { RegionalExtractor } = await import("../../src/applications/RegionalExtractor.js");

const SIZE = 400;
const SEA = 0.4;
const { LEGACY, REVISION_2, REVISION_3 } = FILRODENSWMB.TERRAIN_VERSION;
const simplex = new ProceduralEngine("RIVERS").simplex;

/** A river drawn from high ground in the north to the sea in the south. */
const drawn = (extra = {}) => ({
    id: "testRiverAAAAAA1",
    name: "River",
    width: 4,
    visibility: "all",
    points: [
        { x: 120, y: 30 },
        { x: 150, y: 120 },
        { x: 130, y: 210 },
        { x: 190, y: 300 },
        { x: 210, y: 390 },
    ],
    ...extra,
});

/** The land at a point of the world (top map pixels): falling south to the sea, with low hills, and a ridge across the river if asked. */
function landAt(x, y, ridge) {
    let height = 0.85 - 0.55 * (y / SIZE) + 0.06 * simplex.noise2D(x / 60, y / 60) + 0.02 * simplex.noise2D(x / 15, y / 15);
    if (ridge) height += 0.2 * Math.exp(-(((y - 170) / 14) ** 2));
    return height;
}

/** The map's derived settings at a terrain version, in the frame given. */
function paramsFor(terrainVersion, world = null) {
    const state = { ...MapStateManager.buildDefaultUiState(SIZE, SIZE), terrainVersion, world, seaLevel: SEA, generationEngine: "advanced" };
    return MapStateManager.getDerivedMapParameters(state, {}).params;
}

/**
 * Carves and traces the rivers on the land, as the orchestrator does, on the top map or a crop of
 * it (`frame`: the crop's corner in top map pixels and its zoom).
 */
function run(terrainVersion, rivers, { ridge = false, frame = null } = {}) {
    const world = frame ? { zoom: frame.zoom, originX: frame.x, originY: frame.y, rootW: SIZE, rootH: SIZE } : null;
    const params = paramsFor(terrainVersion, world);
    const zoom = frame?.zoom ?? 1;
    const elevation = new Float32Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) elevation[y * SIZE + x] = landAt((frame?.x ?? 0) + x / zoom, (frame?.y ?? 0) + y / zoom, ridge);

    RiverCorridor.clearCache();
    HydrologyEngine.carveManualRivers(elevation, SIZE, SIZE, rivers, simplex, SEA, null, params.terrain.currentRivers === true, params.terrain);
    const scale = RiverNetwork.pixelsPerBaseline(SIZE, SIZE, params.terrain.world);
    const authored = HydrologyEngine.authoredRivers(elevation, SIZE, SIZE, rivers, scale, params.terrain, SEA);
    const temperature = new Float32Array(SIZE * SIZE).fill(1);
    const moisture = new Float32Array(SIZE * SIZE).fill(0.5);
    const waterMask = new Float32Array(SIZE * SIZE);
    const data = new ProceduralEngine("RIVERS").generateRivers(elevation, moisture, temperature, [], SIZE, SIZE, params, new Uint8Array(SIZE * SIZE), waterMask, authored);
    const network = RiverNetwork.build(data.vectors, { elevation, waterMask, width: SIZE, height: SIZE, seaLevel: SEA, world: params.terrain.world }, RiverNetwork.optionsFrom(params));
    return { elevation, data, network, authored, scale };
}

function fingerprint({ elevation, data, network }) {
    const hash = createHash("sha256");
    hash.update(Buffer.from(elevation.buffer));
    hash.update(JSON.stringify(data.vectors.map((river) => ({ path: river.path, inflow: river.inflow, authored: river.authored, mergeInto: river.mergeInto }))));
    hash.update(JSON.stringify(network.channels.map((channel) => channel.points.map((p) => [p.x.toFixed(4), p.y.toFixed(4), p.r.toFixed(4)]))));
    return hash.digest("hex").slice(0, 16);
}

/** The guided river's traced course, and how far each step lies from its corridor's line. */
function course(result) {
    const river = result.data.vectors.find((vector) => vector.customId);
    const { corridor } = result.authored[0];
    const away = river.path.slice(0, river.guided).map(({ x, y }) => {
        const at = (y - corridor.box.minY) * corridor.boxWidth + (x - corridor.box.minX);
        return { distance: corridor.distance[at], limit: corridor.limits[corridor.nearest[at]] };
    });
    return { river, away };
}

test("a revision 2 or legacy map's custom river is traced exactly as before", () => {
    // Taken from the module before terrain revision 3
    assert.equal(fingerprint(run(REVISION_2, [drawn()])), "63328e3beec31ae6");
    assert.equal(fingerprint(run(LEGACY, [drawn()])), "038ca70659bdbd88");
    // The corridor's settings change nothing there
    assert.equal(fingerprint(run(REVISION_2, [drawn({ corridor: 3, cutThrough: true })])), "63328e3beec31ae6");
});

test("a revision 3 map's river stays within its corridor, at any corridor width", () => {
    for (const corridor of [3, 10, 15]) {
        const result = run(REVISION_3, [drawn({ corridor })]);
        const { away } = course(result);
        assert.ok(away.length > 100, `corridor ${corridor}: ${away.length} steps within it`);
        const worst = Math.max(...away.map((step) => step.distance - step.limit));
        assert.ok(worst <= 1.5, `corridor ${corridor}: strays ${worst.toFixed(2)} pixels beyond it`);
        // And it does wander from the line, rather than following it
        const mean = away.reduce((sum, step) => sum + step.distance, 0) / away.length;
        assert.ok(mean > 1, `corridor ${corridor}: ${mean.toFixed(2)} pixels from the line on average`);
    }
});

test("a revision 3 map's river reaches the sea or another river", () => {
    for (const corridor of [3, 10, 15]) {
        const result = run(REVISION_3, [drawn({ corridor })]);
        const { river } = course(result);
        const end = river.path.at(-1);
        assert.ok(river.mergeInto || result.elevation[end.y * SIZE + end.x] <= SEA, `corridor ${corridor}: ends at ${JSON.stringify(end)}`);
    }
});

test("a revision 3 map's river starts as a stream and widens to its Width along its line", () => {
    const today = run(REVISION_2, [drawn()]);
    const guided = run(REVISION_3, [drawn()]);
    const widths = (result) => result.network.channels.filter((channel) => !channel.isDelta).flatMap((channel) => channel.points.map((p) => p.r));
    const before = widths(today);
    const after = widths(guided);
    assert.ok(after[0] < before[0] * 0.6, `starts ${after[0].toFixed(2)} wide against ${before[0].toFixed(2)}`);
    const { river } = course(guided);
    const flow = guided.network.flows.get(river.id);
    assert.ok(flow[river.guided - 1] >= RiverNetwork.inflowForWidth(4 * FILRODENSWMB.HYDROLOGY.MANUAL_RIVER_START_SHARE, guided.scale), "by the line's end it carries at least the flow a revision 2 river starts with");
});

test("a river cuts through high ground only when asked to", () => {
    // The highest the river climbs above the lowest it has been, along its course in the corridor
    const climb = (result) => {
        const { river } = course(result);
        let lowest = Infinity;
        let worst = 0;
        for (const { x, y } of river.path.slice(0, river.guided)) {
            const height = result.elevation[y * SIZE + x];
            worst = Math.max(worst, height - lowest);
            lowest = Math.min(lowest, height);
        }
        return worst;
    };
    const over = climb(run(REVISION_3, [drawn()], { ridge: true }));
    const through = climb(run(REVISION_3, [drawn({ cutThrough: true })], { ridge: true }));
    assert.ok(over > 0.05, `without the gorge it climbs ${over.toFixed(3)} over the ridge`);
    assert.ok(through < over * 0.4, `with the gorge it climbs ${through.toFixed(3)} against ${over.toFixed(3)}`);
});

test("a x4 regional map's river follows its parent's course", () => {
    const parent = run(REVISION_3, [drawn()]);
    const { river } = course(parent);
    const frame = { x: 100, y: 120, zoom: 4 };
    const crop = SIZE / frame.zoom;
    const inside = (p) => p.x >= frame.x && p.x < frame.x + crop && p.y >= frame.y && p.y < frame.y + crop;

    // As RegionalExtractor carries it over: moved and scaled, its way and the flow it enters with
    const entry = river.path.findIndex((p, i) => i > 0 && inside(p) && !inside(river.path[i - 1]));
    assert.ok(entry > 0 && entry < river.guided, "the river enters the crop along its corridor");
    const regional = drawn({
        points: drawn().points.map((p) => ({ x: (p.x - frame.x) * frame.zoom, y: (p.y - frame.y) * frame.zoom })),
        widthScale: frame.zoom,
        reversed: false,
        inflow: parent.network.flows.get(river.id)[entry],
    });
    const child = run(REVISION_3, [regional], { frame });
    const own = course(child).river;

    // Its course, back in the parent's pixels, keeps close to the parent's within the crop
    const parentSteps = river.path.slice(0, river.guided).filter(inside);
    const nearest = (p) => Math.min(...parentSteps.map((q) => Math.hypot(q.x + 0.5 - p.x, q.y + 0.5 - p.y)));
    const steps = own.path.slice(0, own.guided).map((p) => ({ x: frame.x + (p.x + 0.5) / frame.zoom, y: frame.y + (p.y + 0.5) / frame.zoom }));
    const mean = steps.reduce((sum, p) => sum + nearest(p), 0) / steps.length;
    const limit = RiverCorridor.halfWidth(drawn(), parent.scale);
    assert.ok(mean < limit * 0.25, `the regional river runs ${mean.toFixed(2)} parent pixels from the parent's on average (corridor ${limit})`);

    // And enters as wide as the parent's is there
    const points = (result, id) => result.network.channels.filter((channel) => channel.id === id && !channel.isDelta).flatMap((channel) => channel.points);
    const width = (result, id) => points(result, id).find((p) => p.index !== undefined).r;
    const parentWidth = points(parent, river.id).find((p) => p.index >= entry).r;
    assert.ok(Math.abs(width(child, own.id) / frame.zoom - parentWidth) < parentWidth * 0.35, `enters ${(width(child, own.id) / frame.zoom).toFixed(2)} wide against ${parentWidth.toFixed(2)}`);
});

test("a regional map's custom river carries over the way it runs and the flow it enters with", () => {
    const parent = run(REVISION_3, [drawn({ points: [...drawn().points].reverse() })]);
    const { river } = course(parent);
    const app = { uiState: { terrainVersion: REVISION_3 }, manualRivers: [drawn({ points: [...drawn().points].reverse() })], currentRiverData: { vectors: parent.data.vectors, network: parent.network } };
    const cropBox = { x: 100, y: 120, width: 100, height: 100 };
    const [carried] = RegionalExtractor.guideRivers(app, [structuredClone(app.manualRivers[0])], cropBox);
    // Drawn from the sea up, it runs from its last point to its first
    assert.equal(carried.reversed, true);
    const inside = (p) => p.x >= cropBox.x && p.x < cropBox.x + cropBox.width && p.y >= cropBox.y && p.y < cropBox.y + cropBox.height;
    const entry = river.path.findIndex((p, i) => i > 0 && inside(p) && !inside(river.path[i - 1]));
    assert.equal(carried.inflow, parent.network.flows.get(river.id)[entry]);

    // A map before revision 3 carries nothing over
    const [plain] = RegionalExtractor.guideRivers({ ...app, uiState: { terrainVersion: REVISION_2 } }, [structuredClone(app.manualRivers[0])], cropBox);
    assert.equal(plain.reversed, undefined);
    assert.equal(plain.inflow, undefined);
});

test("a corridor's line passes through every point drawn and never loops, however unevenly they are spaced", () => {
    // Two clicks close together between long stretches, where a uniform Catmull-Rom curve loops
    const points = [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 203, y: 2 },
        { x: 206, y: 0 },
        { x: 400, y: 10 },
    ];
    const line = RiverCorridor.spline(points);
    for (const point of points) assert.ok(Math.min(...line.map((p) => Math.hypot(p.x - point.x, p.y - point.y))) < 0.3, `passes through ${JSON.stringify(point)}`);
    // It always moves on along the line: no sample runs back on the one before
    for (let i = 2; i < line.length; i++) {
        const a = { x: line[i - 1].x - line[i - 2].x, y: line[i - 1].y - line[i - 2].y };
        const b = { x: line[i].x - line[i - 1].x, y: line[i].y - line[i - 1].y };
        assert.ok(a.x * b.x + a.y * b.y >= 0, `turns back at ${i}`);
    }
});
