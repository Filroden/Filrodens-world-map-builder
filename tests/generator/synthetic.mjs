// A small synthetic map for the generator's tests: an island with a ridge of hills down its middle,
// a wetter west and a warmer south, and one river running east from the hills to the sea. Its mesh
// is real (the module's own Mesh), so the generator reads it exactly as it reads a map's.
import { Mesh } from "../../src/mesh/MeshBuilder.js";
import { buildGeneratorPayload } from "../../src/generator/GeneratorInput.js";

export const WIDTH = 480;
export const HEIGHT = 360;
const SEA_LEVEL = 0.35;
const KM_PER_PX = 2;
const MODEL_SPACING_KM = 25;
const RIVER_START = { x: 250, y: 170 };
const RIVER_FLOW = 400;

let cached = null;

/** Elevation: a dome falling to the sea at the edges, with a north-south ridge. */
function elevationAt(x, y) {
    const dx = (x - WIDTH / 2) / (WIDTH / 2);
    const dy = (y - HEIGHT / 2) / (HEIGHT / 2);
    const dome = 0.62 - 0.4 * (dx * dx + dy * dy);
    const ridge = 0.12 * Math.exp(-(((x - WIDTH * 0.45) / 18) ** 2));
    return dome + ridge;
}

/** A river from the hills running east to the sea, one point per pixel, flow growing downstream. */
function river(elevation) {
    const path = [];
    for (let x = RIVER_START.x; x < WIDTH; x++) {
        path.push({ x, y: RIVER_START.y, isLake: false });
        if (elevation[RIVER_START.y * WIDTH + x] < SEA_LEVEL) break;
    }
    const flow = Float32Array.from(path, (_, index) => RIVER_FLOW * (1 + index / path.length));
    return { vectors: [{ id: "r1", mergeInto: null, path }], network: { flows: new Map([["r1", flow]]), pixelsPerBaseline: 1 } };
}

/** The synthetic map: its mesh, buffers, rivers, and a payload builder. */
export function syntheticMap() {
    if (cached) return cached;
    const mesh = new Mesh({ width: WIDTH, height: HEIGHT, spacing: 4, modelSpacing: MODEL_SPACING_KM / KM_PER_PX, seed: 7, kmPerPx: KM_PER_PX });
    const size = WIDTH * HEIGHT;
    const elevation = new Float32Array(size);
    const moisture = new Float32Array(size);
    const temperature = new Float32Array(size);
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const pixel = y * WIDTH + x;
            elevation[pixel] = elevationAt(x, y);
            moisture[pixel] = 0.65 - 0.35 * (x / WIDTH);
            temperature[pixel] = 0.45 + 0.3 * (y / HEIGHT);
        }
    }
    const buffers = { elevation, moisture, temperature, waterMask: new Float32Array(size) };
    const rivers = river(elevation);
    const makePayload = (settings = {}) => buildGeneratorPayload({ mesh, buffers, seaLevel: SEA_LEVEL, kmPerPx: KM_PER_PX, riverData: rivers, mapSeed: "SYNTH", settings });
    cached = { mesh, buffers, rivers, makePayload };
    return cached;
}
