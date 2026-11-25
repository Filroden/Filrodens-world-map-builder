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

test("the rail is the registration's: one mode's stages (every mode's when none is named)", () => {
    const ids = (stages) => stages.map((stage) => [stage.id, stage.tools.map((tool) => tool.id)]);
    assert.deepEqual(ids(WORLD_DEFINITION.railStages("surface")), [
        ["shape", ["scene", "terrain", "climate", "biomes", "features"]],
        ["populate", ["influences", "generate", "regions", "infrastructure", "labels"]],
        ["finish", ["cartography", "export"]],
        ["explore", ["history", "travel", "threeD"]],
    ]);
    assert.deepEqual(ids(WORLD_DEFINITION.railStages("surface", "explore")), [["explore", ["history", "travel", "threeD"]]]);
    assert.equal(WORLD_DEFINITION.railStages("surface", "create").length, 3);
    // The studio's one rail (S0 step 6, as v4's): every stage, Explore after Finish
    assert.deepEqual(WORLD_DEFINITION.railStages("surface").map((stage) => stage.id), ["shape", "populate", "finish", "explore"]);
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

test("the Local studio registers beside the World studio, its rail Map setup, Export and Households and supply (L-surface)", () => {
    const world = { definition: WORLD_DEFINITION, create: () => ({ mount() {}, canClose: async () => true, destroy() {} }) };
    const shell = new Shell({ studios: [world, LocalStudio] });
    assert.deepEqual(shell.registry.ids(), ["world", "local"]);
    const local = shell.registry.get("local");
    assert.equal(local.definition.id, "local");
    assert.deepEqual(
        local.definition.railStages("settlement").map((stage) => [stage.id, stage.tools.map((tool) => tool.id)]),
        [["shape", ["mapSetup"]], ["finish", ["export"]], ["explore", ["households"]]],
    );
    // Export is a later step's: drawn in its place, off; Households and supply is step 3's
    assert.ok(local.definition.tool("export").later);
    assert.ok(!local.definition.tool("households").later);
    assert.equal(local.definition.tool("households").mode, "explore");
    assert.equal(local.definition.tool("households").lede, "FILRODENSWMB.UI.LedeHouseholds");
    // Its map controls' Thematic views: the five household views
    assert.deepEqual(LocalStudio.views.map((view) => view.id), ["people", "group", "culture", "wealth", "age"]);
    // The World studio mounts its controller (the open world is its host): it is made with one
    const controller = local.create(shell, { world: () => null });
    assert.equal(controller.isOpen, false);
    assert.equal(controller.isDirty, false);
    assert.equal(typeof local.rules.check, "function");
});

test("the shell opens the first studio unless told otherwise, and refuses one it does not have", () => {
    const world = { definition: WORLD_DEFINITION, create: () => ({}) };
    assert.equal(new Shell({ studios: [world, LocalStudio] }).definition.id, "world");
    assert.throws(() => new Shell({ studios: [world], studio: "local" }), /no studio/);
});
