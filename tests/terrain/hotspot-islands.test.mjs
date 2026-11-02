// Hotspot islands with the look of the map's land (terrain revision 3, IslandLook): a revision 2
// map's chains are drawn exactly as before; a revision 3 map's summits stay within the land's
// heights, its seabed round the islands is smooth, its islands stay where the chain is drawn, and
// a x4 regional map's islands match its parent's.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installPlatform, platform } from "../../src/platform/index.js";

installPlatform({ ...platform, i18n: { localize: (key) => key, format: (key) => key, lang: "en" } });
const { FILRODENSWMB } = await import("../../src/config.js");
const { MapStateManager } = await import("../../src/applications/MapStateManager.js");
const { ProceduralEngine } = await import("../../src/generation/ProceduralEngine.js");
const { TectonicFeatureEngine } = await import("../../src/generation/TectonicFeatureEngine.js");

const SIZE = 600;
const SEA = 0.4;
const FLOOR = 0.12;
const simplex = new ProceduralEngine("HOTSPOTS").simplex;
const chain = (scale = 1, offset = 0) => ({
    id: "chain",
    type: FILRODENSWMB.TECTONICS.FEATURES.TYPES.HOTSPOT,
    revision: FILRODENSWMB.TECTONICS.FEATURES.REVISION,
    thickness: 80 * scale,
    strength: 0.5,
    points: [
        { x: (80 - offset) * scale, y: (100 - offset) * scale },
        { x: (300 - offset) * scale, y: (300 - offset) * scale },
        { x: (480 - offset) * scale, y: (480 - offset) * scale },
    ],
});

/** The map's derived settings at a terrain version, with the sea level and frame given. */
function paramsFor(terrainVersion, world = null) {
    const state = { ...MapStateManager.buildDefaultUiState(SIZE, SIZE), terrainVersion, world, seaLevel: SEA, generationEngine: "advanced" };
    return MapStateManager.getDerivedMapParameters(state, {}).params;
}

/** A deep, even seabed with the chain's features on it. */
function render(params, { fault = chain(), frame = { zoom: 1, originX: 0, originY: 0, rootSize: SIZE } } = {}) {
    const elevation = new Float32Array(SIZE * SIZE).fill(FLOOR);
    TectonicFeatureEngine.apply(elevation, elevation, [fault], { width: SIZE, height: SIZE, simplex, seaLevel: SEA, frame, params });
    return elevation;
}

/** The mean size of the second differences (how rough the ground is) where it lies deep under the sea. */
function seabedRoughness(elevation) {
    let total = 0;
    let count = 0;
    for (let y = 1; y < SIZE - 1; y++) {
        for (let x = 1; x < SIZE - 1; x++) {
            const i = y * SIZE + x;
            const here = elevation[i];
            if (here > SEA - 0.05 || here <= FLOOR + 1e-6) continue;
            total += Math.abs(elevation[i - 1] + elevation[i + 1] + elevation[i - SIZE] + elevation[i + SIZE] - 4 * here);
            count++;
        }
    }
    return total / count;
}

test("a revision 2 map's chain is drawn exactly as before, whatever its settings", () => {
    const before = render(null);
    const revision2 = render(paramsFor(FILRODENSWMB.TERRAIN_VERSION.REVISION_2));
    assert.deepEqual(revision2, before);
});

test("a revision 3 map's summits stay within the land's heights", () => {
    const revision2 = render(paramsFor(FILRODENSWMB.TERRAIN_VERSION.REVISION_2));
    const revision3 = render(paramsFor(FILRODENSWMB.TERRAIN_VERSION.REVISION_3));
    const highest = (elevation) => elevation.reduce((top, value) => Math.max(top, value), 0);
    assert.ok(highest(revision2) > SEA + (1 - SEA) * 0.6, "the revision 2 chain stands higher than the cap (or this test shows nothing)");
    assert.ok(highest(revision3) <= SEA + (1 - SEA) * 0.6 + 1e-4, `highest summit ${highest(revision3)}`);
    assert.ok(highest(revision3) > SEA + 0.05, "the young volcanoes still rise well above the sea");
});

test("a revision 3 map's seabed round the islands is smooth", () => {
    const revision2 = seabedRoughness(render(paramsFor(FILRODENSWMB.TERRAIN_VERSION.REVISION_2)));
    const revision3 = seabedRoughness(render(paramsFor(FILRODENSWMB.TERRAIN_VERSION.REVISION_3)));
    assert.ok(revision3 < revision2 * 0.4, `roughness ${revision3} against ${revision2}`);
});

test("a revision 3 map's islands stay where the chain is drawn", () => {
    const elevation = render(paramsFor(FILRODENSWMB.TERRAIN_VERSION.REVISION_3));
    let land = 0;
    let stray = 0;
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            if (elevation[y * SIZE + x] <= SEA) continue;
            land++;
            // The chain runs close to the line y = x; its volcanoes lie within its thickness of it
            if (Math.abs(x - y) / Math.SQRT2 > 80 * 1.5) stray++;
        }
    }
    assert.ok(land > 500, `land pixels ${land}`);
    assert.equal(stray, 0);
});

test("a x4 regional map's islands match its parent's", () => {
    const parentParams = paramsFor(FILRODENSWMB.TERRAIN_VERSION.REVISION_3);
    const parent = render(parentParams);

    // The crop of the parent from (380, 380), 150 pixels across (the chain's young islands), at four times the scale, with
    // its settings as RegionalExtractor makes them
    const zoom = 4;
    const origin = 380;
    const world = { zoom, originX: origin, originY: origin, rootW: SIZE, rootH: SIZE };
    const cropParams = paramsFor(FILRODENSWMB.TERRAIN_VERSION.REVISION_3, world);
    cropParams.noise = { ...parentParams.noise, offsetX: (parentParams.noise.offsetX + origin) * zoom, offsetY: (parentParams.noise.offsetY + origin) * zoom, elevation: { ...parentParams.noise.elevation, scale: parentParams.noise.elevation.scale / zoom } };
    const crop = render(cropParams, { fault: chain(zoom, origin), frame: { zoom, originX: origin, originY: origin, rootSize: SIZE } });

    let agree = 0;
    let land = 0;
    let difference = 0;
    let count = 0;
    for (let y = 0; y < SIZE; y += 2) {
        for (let x = 0; x < SIZE; x += 2) {
            const fromParent = parent[Math.round(origin + y / zoom) * SIZE + Math.round(origin + x / zoom)];
            const here = crop[y * SIZE + x];
            if (fromParent > SEA || here > SEA) {
                land++;
                if (fromParent > SEA === here > SEA) agree++;
            }
            difference += Math.abs(fromParent - here);
            count++;
        }
    }
    assert.ok(land > 1000, `land samples ${land}`);
    assert.ok(agree / land > 0.9, `land and sea agree at ${((agree / land) * 100).toFixed(1)}% of land samples`);
    assert.ok(difference / count < 0.015, `mean difference ${difference / count}`);
});

test("a revision 3 chain is worked out again when a setting its islands read changes", () => {
    const cache = {};
    const params = paramsFor(FILRODENSWMB.TERRAIN_VERSION.REVISION_3);
    const options = (settings) => ({ width: SIZE, height: SIZE, simplex, seaLevel: SEA, frame: { zoom: 1, originX: 0, originY: 0, rootSize: SIZE }, params: settings, cache });
    const draw = (settings) => {
        const elevation = new Float32Array(SIZE * SIZE).fill(FLOOR);
        TectonicFeatureEngine.apply(elevation, elevation, [chain()], options(settings));
        return elevation;
    };
    const first = draw(params);
    const again = draw(params);
    assert.deepEqual(again, first);
    const fractured = draw({ ...params, coastlineFracture: 0.8 });
    assert.notDeepEqual(fractured, first);
});
