// Draw thumbnails (WorldThumbnails, S0 step 8d) over a web store in memory, with the studio's part
// stubbed: which worlds it opens and in what order, the open world drawn from its canvas or opened
// again, Cancel between worlds, a world that cannot be opened, and what it says at the end.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { installPlatform, platform } from "../../src/platform/index.js";
import { createWebStore, MemoryRecords } from "../../src/platform/web/store.js";

let next = 0;
const newId = () => `id${String(++next).padStart(4, "0")}`;
const notices = [];
const dialogs = [];
const confirms = [];
let confirmAnswer = true;
function install() {
    notices.length = 0;
    dialogs.length = 0;
    confirms.length = 0;
    confirmAnswer = true;
    installPlatform({
        ...platform,
        i18n: { localize: (key) => key.replace("FILRODENSWMB.UI.", ""), format: (key, data) => `${key.replace("FILRODENSWMB.UI.", "")} ${Object.values(data).join(",")}`, lang: "en" },
        store: createWebStore(new MemoryRecords(), { newId }),
        notify: { info: (text) => notices.push(text), warn: () => {}, error: () => {} },
        dialogs: { choose: async (options) => (dialogs.push(options), "close"), confirm: async (options) => (confirms.push(options), confirmAnswer) },
        utils: { ...platform.utils, randomID: newId },
    });
}
install();

const { Worlds } = await import("../../src/kernel/worlds/Worlds.js");
const { WorldThumbnails } = await import("../../src/studios/world/app/WorldThumbnails.js");

const THUMB = "data:image/webp;base64,UklGRg==";
const surface = (card) => ({ id: null, type: "surface", data: { mapWidth: 10, mapHeight: 10 }, owners: {}, modelRun: null, changed: true, card });

/** Aethoria (a thumbnail) with Westmarch held under it, Old Map and Bare (no thumbnails), and Empty (no maps). */
async function worlds() {
    const top = await Worlds.save({ world: null, name: "Aethoria", settings: {}, maps: [surface({ thumbnail: THUMB })] });
    const region = await Worlds.save({ world: null, name: "Westmarch", settings: {}, maps: [surface({})] });
    await platform.store.saveWorld({ ...region.world, parentWorldId: top.world.id, held: true });
    const old = await Worlds.save({ world: null, name: "Old Map", settings: {}, maps: [surface({})] });
    const bare = await Worlds.save({ world: null, name: "Bare", settings: {}, maps: [surface({})] });
    await Worlds.save({ world: null, name: "Empty", settings: {}, maps: [] });
    return { top: top.world, region: region.world, old: old.world, bare: bare.world };
}

/** The studio's part, writing a thumbnail for each world opened unless it is in `failing`. */
function stub({ open = null, dirty = false, gate = true, failing = [], cancelAfter = null } = {}) {
    const log = [];
    const held = [];
    const overlay = { details: [], progress: [] };
    let opened = 0;
    const controller = new AbortController();
    const app = {
        isDirty: dirty,
        runCancellable: async (message, work) => {
            log.push(["run", message]);
            return work(controller.signal, { text: () => {}, detail: (text) => overlay.details.push(text), progress: (value) => overlay.progress.push(value), keep: () => {} });
        },
    };
    const studio = {
        gate: async () => (log.push(["gate"]), gate),
        open: () => open,
        drawOpen: async () => {
            log.push(["drawOpen"]);
            return !!(await Worlds.setThumbnail(open.worldId, open.mapId, THUMB));
        },
        openQuietly: async (mapId, name) => {
            log.push(["open", name]);
            if (++opened === cancelAfter) controller.abort();
            if (failing.includes(name)) throw new Error("cannot open");
            const world = await Worlds.ofMap(mapId);
            return !!(await Worlds.setThumbnail(world.id, mapId, THUMB));
        },
        hold: (text) => held.push(text),
        restore: async (world, left) => log.push(["restore", world?.name ?? null, left]),
    };
    return { app, studio, log, held, overlay };
}

const missingNames = async () => WorldThumbnails.missing(await Worlds.tree()).map((world) => world.name);

beforeEach(() => install());

test("the worlds missing a thumbnail: those with a Surface map and none, regional worlds included, in Worlds' order", async () => {
    await worlds();
    assert.deepEqual(await missingNames(), ["Westmarch", "Bare", "Old Map"]);
});

test("with no world open, each is opened in turn under one overlay, then Worlds shown with no world, and a notice", async () => {
    await worlds();
    const { app, studio, log, held, overlay } = stub();
    const result = await WorldThumbnails.run(app, studio);
    assert.deepEqual(log, [["gate"], ["run", "DrawingThumbnails 1,3"], ["open", "Westmarch"], ["open", "Bare"], ["open", "Old Map"], ["restore", null, true]]);
    assert.deepEqual(held, ["DrawingThumbnails 1,3", "DrawingThumbnails 2,3", "DrawingThumbnails 3,3", null], "the overlay's line kept through each opening");
    assert.deepEqual(overlay.details, ["Westmarch", "Bare", "Old Map", null]);
    assert.deepEqual(result, { drawn: 3, failed: [], total: 3, cancelled: false });
    assert.deepEqual(notices, ["ThumbnailsDrawn 3"]);
    assert.deepEqual(await missingNames(), []);
});

test("the open world, unchanged, is drawn from its canvas without being opened, and opened again after the rest", async () => {
    const { old } = await worlds();
    const open = { worldId: old.id, mapId: old.maps[0].id, name: "Old Map" };
    const { app, studio, log, held } = stub({ open });
    await WorldThumbnails.run(app, studio);
    assert.deepEqual(log, [["gate"], ["drawOpen"], ["run", "DrawingThumbnails 2,3"], ["open", "Westmarch"], ["open", "Bare"], ["restore", "Old Map", true]]);
    assert.equal(held.at(-2), "OpeningWorld Old Map", "the world that was open named as it opens again");
});

test("an open world needing only its own picture is not left, and one with changes discarded at the gate is opened again", async () => {
    const { region, old, bare } = await worlds();
    for (const world of [region, bare]) await Worlds.setThumbnail(world.id, world.maps[0].id, THUMB);
    const open = { worldId: old.id, mapId: old.maps[0].id, name: "Old Map" };
    let run = stub({ open });
    await WorldThumbnails.run(run.app, run.studio);
    assert.deepEqual(run.log, [["gate"], ["drawOpen"], ["restore", "Old Map", false]]);
    assert.deepEqual(notices, ["ThumbnailsDrawnOne"]);
    assert.equal(confirms.length, 0, "nothing to open, so nothing to warn of");

    install();
    const again = await worlds();
    const openAgain = { worldId: again.old.id, mapId: again.old.maps[0].id, name: "Old Map" };
    run = stub({ open: openAgain, dirty: true });
    await WorldThumbnails.run(run.app, run.studio);
    assert.equal(confirms.at(-1).content, "<p>DrawThumbnailsConfirm 3</p><p>DrawThumbnailsOnce</p>", "the open world counted when it is to be opened again");
    assert.deepEqual(run.log.map(([step, name]) => (name ? `${step} ${name}` : step)), ["gate", "run DrawingThumbnails 1,3", "open Westmarch", "open Bare", "open Old Map", "restore Old Map"], "its canvas still shows the discarded changes");
});

test("it says first that each world is opened and that it is needed once, Cancel the default; Cancel there does nothing", async () => {
    await worlds();
    let run = stub();
    await WorldThumbnails.run(run.app, run.studio);
    assert.equal(confirms.length, 1);
    assert.equal(confirms[0].title, "DrawThumbnailsTitle");
    assert.equal(confirms[0].content, "<p>DrawThumbnailsConfirm 3</p><p>DrawThumbnailsOnce</p>");
    assert.equal(confirms[0].confirmLabel, "DrawThumbnailsTitle");
    assert.equal(confirms[0].destructive, false, "the action the primary, Cancel the default");
    install();
    await worlds();
    confirmAnswer = false;
    run = stub();
    assert.equal(await WorldThumbnails.run(run.app, run.studio), null);
    assert.deepEqual(run.log, [], "not even the unsaved-changes question");
    assert.deepEqual(await missingNames(), ["Westmarch", "Bare", "Old Map"]);
});

test("Cancel at the gate does nothing", async () => {
    await worlds();
    const { app, studio, log } = stub({ gate: false });
    assert.equal(await WorldThumbnails.run(app, studio), null);
    assert.deepEqual(log, [["gate"]]);
    assert.deepEqual(notices, []);
});

test("Cancel stops after the world being opened, keeps what was drawn, and a second run draws the rest", async () => {
    await worlds();
    let run = stub({ cancelAfter: 1 });
    const result = await WorldThumbnails.run(run.app, run.studio);
    assert.deepEqual(run.log, [["gate"], ["run", "DrawingThumbnails 1,3"], ["open", "Westmarch"], ["restore", null, true]]);
    assert.deepEqual(result, { drawn: 1, failed: [], total: 3, cancelled: true });
    assert.deepEqual(notices, ["ThumbnailsDrawnCancelled 1,3"]);
    assert.deepEqual(await missingNames(), ["Bare", "Old Map"]);
    run = stub();
    await WorldThumbnails.run(run.app, run.studio);
    assert.deepEqual(await missingNames(), []);
});

test("a world that cannot be opened is skipped and named in a dialogue", async () => {
    await worlds();
    const { app, studio, log } = stub({ failing: ["Bare"] });
    const result = await WorldThumbnails.run(app, studio);
    assert.deepEqual(log.filter(([step]) => step === "open").map(([, name]) => name), ["Westmarch", "Bare", "Old Map"]);
    assert.deepEqual(result.failed, ["Bare"]);
    assert.deepEqual(notices, [], "a dialogue instead of the notice");
    assert.equal(dialogs.length, 1);
    assert.equal(dialogs[0].title, "DrawThumbnailsTitle");
    assert.match(dialogs[0].content, /<p>ThumbnailsDrawn 2<\/p><p>ThumbnailsFailed<\/p><ul class="fwmb-dialog-list"><li>Bare<\/li><\/ul>/);
    assert.deepEqual(dialogs[0].buttons.map((button) => button.action), ["close"]);
    assert.deepEqual(await missingNames(), ["Bare"]);
});
