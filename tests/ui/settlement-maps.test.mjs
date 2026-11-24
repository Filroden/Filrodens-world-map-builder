// Make settlement map (L-surface step 2a): the Local studio's controller with its workers stood in
// for. The four versions, the Default first; Keep only once the chosen one is drawn; keeping makes
// a record that joins the world unsaved and Save world writes; Cancel keeps nothing and releases
// every version.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/" });
Object.assign(globalThis, { window, document: window.document, requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: (id) => clearTimeout(id) });
after(() => window.happyDOM.close());

const { installPlatform } = await import("../../src/platform/index.js");
let ids = 0;
installPlatform({
    i18n: { localize: (key) => key, format: (key, data) => `${key}${data ? JSON.stringify(data) : ""}`, lang: "en" },
    utils: { randomID: () => `rec${++ids}` },
    notify: { warn() {}, error() {}, info() {} },
});
const { LocalController } = await import("../../src/studios/local/app/LocalController.js");
const { LOCAL_DEFINITION } = await import("../../src/studios/local/LocalStudio.js");

/** Workers stood in for: each build waits to be finished by the test. */
function fakeWorkers(size = 1) {
    const builds = [];
    const log = [];
    return {
        size,
        builds,
        log,
        build(id, input) {
            log.push(["build", id, input.seed]);
            return new Promise((resolve, reject) => builds.push({ id, input, resolve, reject }));
        },
        async keep(id) {
            log.push(["keep", id]);
            return { town: {}, households: {} };
        },
        cancel(id) {
            log.push(["cancel", id]);
            builds.find((b) => b.id === id)?.reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
        },
        async release(list) {
            log.push(["release", ...list]);
        },
        async tile() {
            return null;
        },
        close() {
            log.push(["close"]);
        },
    };
}

const result = (id) => ({ id, frame: { width: 6000, height: 4500 }, kind: "town", townView: { rect: [-500, -400, 500, 400], width: 1000, height: 800 }, hinterlandView: { rect: [-3000, -2250, 3000, 2250] }, thumbnail: null });
const finish = async (build) => {
    build.resolve(result(build.id));
    await new Promise((done) => setTimeout(done, 5));
};

function setup() {
    const workers = fakeWorkers(1);
    const rendered = [];
    const went = [];
    let changed = 0;
    const world = { id: "w1", settlements: [] };
    const host = {
        source: () => ({ mapSeed: "P0JBVA" }),
        pin: (pinId) => ({ id: pinId, biome: "GRASSLAND" }),
        pinOf: (pinId) => ({ id: pinId, name: "Castford" }),
        world: () => world,
        surfaceMapId: () => "m1",
        mapName: () => "the Surface map",
        changed: () => changed++,
        render: (regions) => rendered.push(regions),
        goToPin: (pinId) => went.push(pinId),
        leave() {},
    };
    const input = (_source, pin, { seed }) => ({ id: pin.id, name: "Castford", seed, population: 2900, tier: "town", kind: "town", roads: [], cultures: [{ name: "Local", share: 1 }], relief: { lie: "level" }, biome: "GRASSLAND", frame: { width: 6000, height: 4500 } });
    const controller = new LocalController({ registry: null }, host, LOCAL_DEFINITION, { workers, inputFrom: input });
    return { controller, workers, rendered, went, world, changes: () => changed };
}

test("Make settlement map draws four versions, the Default from the map's seed first, the rest waiting for a worker", async () => {
    const { controller, workers } = setup();
    assert.equal(await controller.make("pin1"), true);
    assert.equal(controller.mode, "choosing");
    assert.deepEqual(workers.log.map((entry) => entry[0]), ["build", "build", "build", "build"]);
    assert.equal(workers.log[0][2], "P0JBVA:pin1", "the Default is the map's seed and the pin's id");
    assert.ok(workers.log.slice(1).every((entry) => /^[2-9A-HJ-NP-Z]{4}:pin1$/.test(entry[2])), "the alternatives from random seeds");
    const local = controller.panelContext().local;
    assert.equal(local.choosing, true);
    assert.ok(local.keep.off, "Keep waits for the chosen version");
    assert.equal(controller.panelContext().panelFootPartial.endsWith("tools-mapSetup-foot.hbs"), true);
    // Only Map setup while choosing; Export and Households and supply are later steps'
    assert.deepEqual(controller.railContext().railStages.flatMap((stage) => stage.tools.filter((tool) => !tool.disabled).map((tool) => tool.id)), ["mapSetup"]);
    controller.close();
});

test("Keep: once the chosen version is drawn, its record joins the world unsaved; Save world writes it", async () => {
    const { controller, workers, world, changes } = setup();
    await controller.make("pin1");
    await finish(workers.builds[0]);
    assert.equal(controller.panelContext().local.keep.off, null, "the Default is ready to keep");
    await controller.act("keep", { dataset: {} });
    assert.equal(controller.mode, "open");
    assert.ok(workers.log.some((entry) => entry[0] === "keep" && entry[1] === workers.builds[0].id), "its households worked out in its worker");
    assert.ok(workers.log.some((entry) => entry[0] === "cancel"), "the others, still drawing, cancelled");
    assert.equal(controller.isDirty, true);
    assert.ok(changes() > 0, "Save world is marked");
    const [card] = controller.cards();
    assert.deepEqual([card.pinId, card.sourceMapId, card.name, card.tier, card.people], ["pin1", "m1", "Castford", "town", 2900]);
    const { saved, deleted } = await controller.changes(async (record) => ({ name: record.name, html: "<p></p>" }));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].record.seed, "P0JBVA:pin1");
    assert.equal(saved[0].record.format, "fwmb-settlement");
    assert.deepEqual(deleted, []);
    // Saved (Save as gives it a new id): the open map follows its record
    controller.saved([{ from: card.id, id: "renamed1" }]);
    assert.equal(controller.isDirty, false);
    assert.equal(controller.openCard.id, "renamed1");
    world.settlements = [controller.openCard];
    assert.deepEqual(controller.cards().map((each) => each.id), ["renamed1"]);
    assert.equal(controller.cardOfPin("pin1").id, "renamed1");
    controller.destroy();
});

test("Cancel keeps nothing, releases every version, and goes back to the pin", async () => {
    const { controller, workers, went } = setup();
    await controller.make("pin1");
    await finish(workers.builds[0]);
    await controller.act("cancel", { dataset: {} });
    assert.deepEqual(went, ["pin1"]);
    controller.close();
    assert.equal(controller.isOpen, false);
    assert.equal(controller.isDirty, false);
    assert.deepEqual(controller.cards(), []);
    assert.ok(workers.log.some((entry) => entry[0] === "release" && entry.includes(workers.builds[0].id)), "the drawn version released");
    assert.equal(workers.log.filter((entry) => entry[0] === "cancel").length, 3, "the three still drawing cancelled");
});

test("a seed typed for the Default draws it again; Three new alternatives draws the three again", async () => {
    const { controller, workers } = setup();
    await controller.make("pin1");
    controller.field({ type: "change", target: { name: "settlementSeed", value: "MYSEED" } });
    assert.equal(workers.log.at(-1)[2], "MYSEED");
    const before = workers.log.length;
    await controller.act("newAlternatives", { dataset: {} });
    assert.equal(workers.log.slice(before).filter((entry) => entry[0] === "build").length, 3);
    controller.close();
});

test("forgetting the world's changes drops the kept settlement maps not yet saved", async () => {
    const { controller, workers } = setup();
    await controller.make("pin1");
    await finish(workers.builds[0]);
    await controller.act("keep", { dataset: {} });
    controller.forgetChanges();
    assert.equal(controller.isDirty, false);
    controller.destroy();
    assert.ok(workers.log.some((entry) => entry[0] === "close"), "the workers end with the world");
});
