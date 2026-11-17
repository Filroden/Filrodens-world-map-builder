// The studios' registration with the shell (S0 step 1): every tool a studio registers has a stage
// (or is occasional), a mode, its map types, an icon and a name in en.json; the rail is drawn from
// it; switching to a map type without the open tool opens that stage's first tool (decision 21);
// and the Local studio registers and opens, empty.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const STRINGS = JSON.parse(readFileSync(join(ROOT, "languages/en.json"), "utf8"));

const window = new Window({ url: "http://localhost/" });
Object.assign(globalThis, { window, document: window.document });
after(() => window.happyDOM.close());

const { installPlatform } = await import("../../src/platform/index.js");
const attached = [];
installPlatform({
    i18n: { localize: (key) => key, format: (key) => key, lang: "en" },
    dialogs: { attach: (root) => (attached.push(root), () => attached.splice(attached.indexOf(root), 1)) },
    fonts: { list: () => [] },
});

const { defineStudio, MODES, StudioRegistry } = await import("../../src/shell/StudioRegistry.js");
const { Shell } = await import("../../src/shell/Shell.js");
const { WORLD_DEFINITION } = await import("../../src/studios/world/definition.js");
const { LocalStudio } = await import("../../src/studios/local/LocalStudio.js");

test("every tool the World studio registers has a stage or is occasional, a mode, map types, an icon and a name", () => {
    for (const tool of WORLD_DEFINITION.tools) {
        assert.ok(tool.stage === null || WORLD_DEFINITION.stage(tool.stage), `${tool.id}'s stage`);
        assert.ok(MODES.includes(tool.mode), `${tool.id}'s mode`);
        assert.ok(tool.mapTypes.length && tool.mapTypes.every((type) => WORLD_DEFINITION.mapTypes.includes(type)), `${tool.id}'s map types`);
        assert.ok(tool.icon, `${tool.id}'s icon`);
        assert.ok(STRINGS[tool.label], `${tool.label} is in en.json`);
        if (tool.next) assert.ok(STRINGS[tool.next.reason], `${tool.next.reason} is in en.json`);
    }
    for (const stage of WORLD_DEFINITION.stages) assert.ok(STRINGS[stage.label], `${stage.label} is in en.json`);
    assert.ok(STRINGS[WORLD_DEFINITION.label] && STRINGS[LocalStudio.definition.label], "the studios' names are in en.json");
});

test("the rail is the registration's: every mode's stages until the mode switch, or one mode's", () => {
    const ids = (stages) => stages.map((stage) => [stage.id, stage.tools.map((tool) => tool.id)]);
    assert.deepEqual(ids(WORLD_DEFINITION.railStages("surface")), [
        ["shape", ["scene", "terrain", "biomes", "features"]],
        ["populate", ["influences", "generate", "regions", "infrastructure", "labels"]],
        ["finish", ["cartography", "export"]],
        ["explore", ["history", "travel"]],
    ]);
    assert.deepEqual(ids(WORLD_DEFINITION.railStages("surface", "explore")), [["explore", ["history", "travel"]]]);
    assert.equal(WORLD_DEFINITION.railStages("surface", "create").length, 3);
    assert.ok(WORLD_DEFINITION.offers("manage", "surface"), "an occasional tool is offered");
    assert.equal(WORLD_DEFINITION.offers("nothing", "surface"), false);
});

test("switching to a map type keeps the tool where it is offered, else opens its stage's first tool", () => {
    const studio = defineStudio({
        id: "test",
        label: "FILRODENSWMB.UI.StudioWorld",
        mapTypes: ["surface", "aerial"],
        stages: [{ id: "shape", label: "s" }, { id: "populate", label: "p" }],
        tools: [
            { id: "terrain", stage: "shape", mode: "create", icon: "i", label: "l", mapTypes: ["surface", "aerial"] },
            { id: "rivers", stage: "shape", mode: "create", icon: "i", label: "l", mapTypes: ["surface"] },
            { id: "islands", stage: "shape", mode: "create", icon: "i", label: "l", mapTypes: ["aerial"] },
            { id: "regions", stage: "populate", mode: "create", icon: "i", label: "l", mapTypes: ["surface"] },
            { id: "routes", stage: "populate", mode: "create", icon: "i", label: "l", mapTypes: ["surface", "aerial"] },
        ],
    });
    assert.equal(studio.toolForMapType("terrain", "aerial"), "terrain", "kept where the new map has it");
    assert.equal(studio.toolForMapType("rivers", "aerial"), "terrain", "else its stage's first tool there");
    assert.equal(studio.toolForMapType("regions", "aerial"), "routes");
    assert.deepEqual(studio.stageTools("terrain", "aerial").map((tool) => tool.id), ["terrain", "islands"]);
});

test("a registration that does not hold together is refused", () => {
    const base = { id: "bad", label: "l", mapTypes: ["surface"], stages: [{ id: "shape", label: "s" }] };
    const tool = { id: "a", stage: "shape", mode: "create", icon: "i", label: "l", mapTypes: ["surface"] };
    assert.throws(() => defineStudio({ ...base, tools: [{ ...tool, stage: "nowhere" }] }), /unknown stage/);
    assert.throws(() => defineStudio({ ...base, tools: [{ ...tool, mode: "paint" }] }), /no mode/);
    assert.throws(() => defineStudio({ ...base, tools: [{ ...tool, mapTypes: ["underground"] }] }), /map type/);
    assert.throws(() => defineStudio({ ...base, tools: [tool, tool] }), /twice/);
    assert.throws(() => defineStudio({ ...base, tools: [{ ...tool, next: { tool: "b", reason: "r" } }] }), /Next/);
    const registry = new StudioRegistry([LocalStudio]);
    assert.throws(() => registry.register(LocalStudio), /twice/);
});

test("the Local studio registers beside the World studio and opens, empty", async () => {
    const world = { definition: WORLD_DEFINITION, create: () => ({ mount() {}, canClose: async () => true, destroy() {} }) };
    const shell = new Shell({ studios: [world, LocalStudio], studio: "local" });
    assert.deepEqual(shell.registry.ids(), ["world", "local"]);
    assert.equal(shell.definition.id, "local");
    assert.deepEqual(shell.definition.tools, []);
    assert.deepEqual(shell.definition.railStages("settlement"), []);

    const root = document.createElement("div");
    shell.mount(root);
    assert.equal(root.dataset.fwmbStudio, "local");
    assert.equal(shell.studio.root, root, "its controller is mounted in the frame");
    assert.deepEqual(attached, [root], "the shell draws dialogues in the frame");
    assert.equal(shell.isDirty, false);
    assert.equal(await shell.canClose(), true);
    shell.destroy();
    assert.deepEqual(attached, [], "and stops when it closes");
    assert.equal(shell.studio, null);
});

test("the shell opens the first studio unless told otherwise, and refuses one it does not have", () => {
    const world = { definition: WORLD_DEFINITION, create: () => ({}) };
    assert.equal(new Shell({ studios: [world, LocalStudio] }).definition.id, "world");
    assert.throws(() => new Shell({ studios: [world], studio: "local" }), /no studio/);
});
