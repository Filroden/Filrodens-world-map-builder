// Make settlement map (L-surface step 2a): the Local studio's controller with its workers stood in
// for. The four versions, the Default first; Keep only once the chosen one is drawn; keeping makes
// a record that joins the world unsaved and Save world writes; Cancel keeps nothing and releases
// every version. Keeping it in step (2b): Out of date in the panel's notice and at Save world;
// Generate again as one undo step on the settlement map, Undo and Redo; Generate all's part on a
// map not open; Delete settlement map… after its confirmation; a pin gone; a held world's parent's
// map, read only.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/" });
Object.assign(globalThis, { window, document: window.document, requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: (id) => clearTimeout(id) });
after(() => window.happyDOM.close());

const { installPlatform } = await import("../../src/platform/index.js");
const confirmations = [];
let confirmAnswer = true;
const stored = new Map();
let ids = 0;
installPlatform({
    i18n: { localize: (key) => key, format: (key, data) => `${key}${data ? JSON.stringify(data) : ""}`, lang: "en" },
    utils: { randomID: () => `rec${++ids}` },
    notify: { warn() {}, error() {}, info() {} },
    // Delete settlement map…'s confirmation (answered by the test), and a saved map's record
    dialogs: { confirm: async (options) => (confirmations.push(options), confirmAnswer) },
    store: { loadSettlementMap: async (worldId, id) => stored.get(`${worldId}/${id}`) ?? null },
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
    const pins = new Map([["pin1", { id: "pin1", name: "Castford", population: 2900 }]]);
    host.pin = (pinId) => (pins.has(pinId) ? { id: pinId, biome: "GRASSLAND" } : null);
    host.pinOf = (pinId) => pins.get(pinId) ?? null;
    host.worldName = () => "Tutorial world";
    host.openOwner = (owner, id) => went.push(`${owner.worldId}/${id}`);
    const input = (_source, pin, { seed }) => ({ id: pin.id, name: pins.get(pin.id)?.name ?? "Castford", seed, population: pins.get(pin.id)?.population ?? 2900, tier: "town", kind: "town", roads: [], cultures: [{ name: "Local", share: 1 }], relief: { lie: "level" }, biome: "GRASSLAND", frame: { width: 6000, height: 4500 } });
    const controller = new LocalController({ registry: null }, host, LOCAL_DEFINITION, { workers, inputFrom: input });
    return { controller, workers, rendered, went, world, pins, changes: () => changed };
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

// ------------------------------------------------------------------ keeping it in step (2b)

/** A settlement map kept and opened, its version drawn. */
async function kept() {
    const setupped = setup();
    const { controller, workers } = setupped;
    await controller.make("pin1");
    await finish(workers.builds[0]);
    await controller.act("keep", { dataset: {} });
    return setupped;
}

/** The build the controller asked for last, finished. */
const finishLast = async (workers) => finish(workers.builds.at(-1));

test("Out of date: its pin's population changing puts the notice at the head of its panel, naming it, with Generate again", async () => {
    const { controller, pins } = await kept();
    assert.equal(controller.panelContext().panel.notice, null, "made now, up to date");
    pins.get("pin1").population = 3400;
    controller.sourceChanged();
    const notice = controller.panelContext().panel.notice;
    assert.equal(notice.title, "FILRODENSWMB.UI.MarkOutOfDate");
    assert.ok(notice.lines[0].includes("SettlementChangedPeople") && notice.lines[0].includes("2,900") && notice.lines[0].includes("3,400"), notice.lines[0]);
    assert.deepEqual(notice.actions.map((action) => action.data.local), ["generateAgain"]);
    // Save world keeps what is Out of date on the card
    const { saved, stale } = await controller.changes();
    assert.deepEqual(saved[0].card.stale, ["people"]);
    assert.deepEqual(Object.values(stale), [["people"]]);
    controller.destroy();
});

test("Generate again is one undo step on the settlement map: drawn again from the pin as it is now, its seed kept; Undo and Redo", async () => {
    const { controller, workers, pins } = await kept();
    const seed = controller.openCard && (await controller.changes()).saved[0].record.seed;
    pins.get("pin1").population = 3400;
    controller.sourceChanged();
    assert.equal(controller.canUndo, false);
    const again = controller.act("generateAgain", { dataset: {} });
    await new Promise((done) => setTimeout(done, 5));
    assert.equal(controller.mode, "building", "drawn again in its worker");
    await finishLast(workers);
    await again;
    assert.equal(controller.mode, "open");
    const record = (await controller.changes()).saved[0].record;
    assert.equal(record.input.population, 3400);
    assert.equal(record.seed, seed, "the kept seed");
    assert.equal(controller.panelContext().panel.notice, null, "up to date again");
    assert.deepEqual(controller.historyCounts, { undo: 1, redo: 0 });
    const undone = controller.undo();
    await new Promise((done) => setTimeout(done, 5));
    await finishLast(workers);
    await undone;
    assert.equal((await controller.changes()).saved[0].record.input.population, 2900);
    assert.equal(controller.panelContext().panel.notice?.title, "FILRODENSWMB.UI.MarkOutOfDate", "Out of date once more");
    assert.deepEqual(controller.historyCounts, { undo: 0, redo: 1 });
    const redone = controller.redo();
    await new Promise((done) => setTimeout(done, 5));
    await finishLast(workers);
    await redone;
    assert.equal((await controller.changes()).saved[0].record.input.population, 3400);
    controller.destroy();
});

test("Generate all's part: a settlement map not open is made again from its pin without being built", async () => {
    const { controller, workers, pins, world } = await kept();
    const id = controller.openCard.id;
    // Saved, then closed: the record is the store's
    const record = (await controller.changes()).saved[0].record;
    controller.saved([]);
    world.settlements = [controller.openCard];
    stored.set(`w1/${id}`, record);
    controller.close();
    pins.get("pin1").population = 3400;
    controller.sourceChanged();
    assert.deepEqual(controller.states().get(id).changed, ["people"]);
    const builds = workers.builds.length;
    assert.equal(await controller.regenerate([id]), 1);
    assert.equal(workers.builds.length, builds, "nothing built");
    const after = (await controller.changes()).saved[0];
    assert.equal(after.record.input.population, 3400);
    assert.deepEqual(controller.stateOf(id).changed, [], "up to date");
    assert.equal(controller.isDirty, true, "Save world saves it");
    stored.clear();
    controller.destroy();
});

test("Delete settlement map…: after its confirmation, gone from the world at the next save; Cancel keeps it", async () => {
    const { controller, world } = await kept();
    const id = controller.openCard.id;
    controller.saved([]);
    world.settlements = [controller.openCard];
    confirmAnswer = false;
    assert.equal(await controller.deleteMap(id), false);
    assert.equal(controller.cards().length, 1);
    const asked = confirmations.at(-1);
    assert.match(asked.title, /DeleteSettlementMapTitle/);
    assert.equal(asked.destructive, true);
    confirmAnswer = true;
    assert.equal(await controller.deleteMap(id), true);
    assert.deepEqual(controller.cards(), []);
    assert.deepEqual((await controller.changes()).deleted, [id]);
    controller.destroy();
});

test("its pin gone: the notice says so, with Delete settlement map…, and Generate again has nothing to make it from", async () => {
    const { controller, pins } = await kept();
    pins.delete("pin1");
    controller.sourceChanged();
    const notice = controller.panelContext().panel.notice;
    assert.equal(notice.title, "FILRODENSWMB.UI.MarkPinGone");
    assert.deepEqual(notice.actions.map((action) => action.data.local), ["deleteMap"]);
    assert.equal(await controller.generateAgain(), false);
    controller.destroy();
});

test("a held regional world's parent's settlement map opens read only: the held notice, Open in <parent world>, no Generate again", async () => {
    const { controller, workers, went } = setup();
    const record = { format: "fwmb-settlement", version: 1, id: "parentMap", pinId: "pin1", name: "Castford", seed: "P0JBVA:pin1", input: { id: "pin1", name: "Castford", seed: "P0JBVA:pin1", population: 2900, tier: "town", kind: "town", roads: [], cultures: [{ name: "Local", share: 1 }], relief: { lie: "level" }, biome: "GRASSLAND", frame: { width: 6000, height: 4500 } }, parts: {}, revision: 1 };
    stored.set("parentWorld/parentMap", record);
    const opening = controller.open("parentMap", { owner: { worldId: "parentWorld", name: "Parent world", stale: ["people"] } });
    await new Promise((done) => setTimeout(done, 5));
    await finishLast(workers);
    await opening;
    assert.equal(controller.canChange, false);
    const notice = controller.panelContext().panel.notice;
    assert.match(notice.title, /SettlementHeldTitle/);
    assert.equal(notice.lines.length, 2, "what was Out of date at the parent's last save");
    assert.deepEqual(notice.actions.map((action) => action.data.local), ["openInOwner"]);
    assert.equal(await controller.generateAgain(), false);
    await controller.act("openInOwner", { dataset: {} });
    assert.deepEqual(went, ["parentWorld/parentMap"]);
    assert.equal(controller.isDirty, false, "nothing of the parent's joins this world");
    stored.clear();
    controller.destroy();
});

