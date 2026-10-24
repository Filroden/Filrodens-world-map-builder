// River routes and the river as drawn: the cells a drawn river covers (MeshSession.riverChannel),
// river routes preferring them (RouteEdits.transportCost), and a regional map's inherited river
// trade routes laid again over its own rivers once (RiverRelay), with what has no river removed.
import "./foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { FILRODENSWMB } = await import("../../src/config.js");
const { MeshSession } = await import("../../src/mesh/MeshSession.js");
const { transportCost } = await import("../../src/mesh/RouteEdits.js");
const { RiverRelay } = await import("../../src/applications/RiverRelay.js");
const { HEIGHT, WIDTH, syntheticMap } = await import("../generator/synthetic.mjs");

/** The drawn river's middle line across the island. */
const riverY = (x) => 160 + 25 * Math.sin(x / 40);

/** A river image (red byte as the map's: 255 inside the channel, 0 well away) drawn 4 px wide along riverY. */
function riverImage() {
    const image = new Uint8Array(WIDTH * HEIGHT * 4);
    for (let x = 120; x <= 360; x++) {
        for (let y = 0; y < HEIGHT; y++) if (Math.abs(y - riverY(x)) <= 2) image[(y * WIDTH + x) * 4] = 255;
    }
    return image;
}

function session() {
    const { mesh, buffers, makePayload } = syntheticMap();
    const aggregates = mesh.aggregate({ elevation: buffers.elevation, waterMask: buffers.waterMask, seaLevel: makePayload().seaLevel });
    return new MeshSession({ mesh, meshBlock: { seed: 7, spacing: 4, cells: mesh.cellCount, width: WIDTH, height: HEIGHT, version: 1 }, layerSets: [], owners: {}, aggregates });
}

test("the cells a drawn river covers, worked out again when the image is drawn again", () => {
    const meshSession = session();
    const { mesh } = meshSession;
    assert.equal(meshSession.riverChannel(), null, "no image yet");
    meshSession.setRiverImage(new Uint8Array(WIDTH * HEIGHT * 4));
    assert.equal(meshSession.riverChannel(), null, "an image with no river drawn");
    meshSession.setRiverImage(riverImage());
    const channel = meshSession.riverChannel();
    assert.equal(channel[mesh.cellAt(240, Math.round(riverY(240)))], 1, "a cell on the river");
    assert.equal(channel[mesh.cellAt(240, Math.round(riverY(240)) + 20)], 0, "a cell well beside it");
    assert.equal(meshSession.riverChannel(), channel, "kept until the image changes");
    meshSession.setRiverImage(new Uint8Array(WIDTH * HEIGHT * 4));
    assert.equal(meshSession.riverChannel(), null, "worked out again");
});

test("a river route keeps to the river as drawn rather than to the traced course", () => {
    const meshSession = session();
    meshSession.setRiverImage(riverImage());
    const { mesh } = meshSession;
    const { cost } = transportCost(meshSession, "river", []);
    const on = mesh.cellAt(240, Math.round(riverY(240)));
    const beside = mesh.cellAt(240, Math.round(riverY(240)) + 20);
    const [neighbourOn] = [...mesh.neighbours(on)].filter((cell) => meshSession.riverChannel()[cell]);
    const [neighbourOff] = [...mesh.neighbours(beside)];
    const [onStep, offStep] = [cost(neighbourOn, on) / mesh.distance(neighbourOn, on), cost(neighbourOff, beside) / mesh.distance(neighbourOff, beside)];
    assert.ok(offStep > onStep * FILRODENSWMB.MESH.ROUTE.RIVER_LAND_STEP * 0.8, `a step beside the river costs about RIVER_LAND_STEP times one on it: ${offStep / onStep}`);
});

test("a regional map's inherited river trade routes are laid again over its rivers; edited and road routes stay, one with no river goes", () => {
    const meshSession = session();
    meshSession.setRiverImage(riverImage());
    const { mesh } = meshSession;
    const off = (x, by) => mesh.cellAt(x, Math.round(riverY(x)) + by);
    const generated = (extra = {}) => ({ run: "run", kind: "route", edited: false, locked: false, ...extra });
    const along = { id: "along", transport: "river", generated: generated(), waypoints: [off(130, 12), off(240, 12), off(350, 12)] };
    along.legs = [[along.waypoints[0], along.waypoints[1]], [along.waypoints[1], along.waypoints[2]]];
    const edited = { id: "edited", transport: "river", generated: generated({ edited: true }), waypoints: [off(150, 30), off(200, 30)], legs: [[off(150, 30), off(200, 30)]] };
    const dry = { id: "dry", transport: "river", generated: generated(), waypoints: [mesh.cellAt(180, 250), mesh.cellAt(300, 250)], legs: [[mesh.cellAt(180, 250), mesh.cellAt(300, 250)]] };
    const road = { id: "road", transport: "road", generated: generated(), waypoints: [off(150, 40), off(250, 40)], legs: [[off(150, 40), off(250, 40)]] };
    const app = { currentParentId: "parentAAAAAAAAAA", riverRoutesLaid: false, meshSession, mapRoutes: [along, edited, dry, road] };
    const before = { edited: structuredClone(edited.legs), road: structuredClone(road.legs) };

    assert.equal(RiverRelay.needed(app), true);
    assert.deepEqual(RiverRelay.run(app), { laid: 1, removed: 1 });
    assert.deepEqual(app.mapRoutes.map((route) => route.id), ["along", "edited", "road"], "the route with no river is removed");
    const channel = meshSession.riverChannel();
    const cells = along.legs.flat();
    assert.ok(cells.filter((cell) => channel[cell]).length > cells.length * 0.6, "laid along the drawn river");
    assert.equal(along.waypoints[0], off(130, 12), "its ends stay at their towns");
    assert.equal(along.waypoints.at(-1), off(350, 12));
    assert.equal(channel[along.waypoints[1]], 1, "a waypoint between moves onto the river");
    assert.deepEqual(edited.legs, before.edited, "an edited route is the reader's");
    assert.deepEqual(road.legs, before.road);
    assert.equal(RiverRelay.needed({ ...app, riverRoutesLaid: true }), false, "once");
    assert.equal(RiverRelay.needed({ ...app, currentParentId: null }), false, "regional maps only");
});
