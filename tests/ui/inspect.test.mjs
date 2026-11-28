// Inspect (EX1): the `inspect` registration (StudioRegistry.defineStudio checks it, the World
// studio registers it for the Surface map only, the Local studio none), and the Surface map's
// kinds on a small map of their own: the list's order (pins, routes, rivers, named natural
// features, regions set by set with the Political set first and each set deepest first, the ground
// last), only what the map draws (the detail level, the Regions menu, the Visibility filters with
// a GM-only set passing its visibility down), unnamed routes of a kind and class sharing a row,
// each route naming the next settlement the map shows along it, and the shell's reader holding a
// point on a click but not on a drag, letting go on Ctrl+click. The real fixtures are read in the browser checks.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/" });
Object.assign(globalThis, { window, document: window.document });
after(() => window.happyDOM.close());

const { installPlatform } = await import("../../src/platform/index.js");
installPlatform({
    i18n: { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" },
    dialogs: { attach: () => () => {} },
    fonts: { list: () => [] },
});

const { defineStudio } = await import("../../src/shell/StudioRegistry.js");
const { MapReader } = await import("../../src/shell/MapReader.js");
const { WORLD_DEFINITION } = await import("../../src/studios/world/definition.js");
const { LocalStudio } = await import("../../src/studios/local/LocalStudio.js");
const { SURFACE_INSPECT, nextSettlements } = await import("../../src/studios/world/inspect/SurfaceKinds.js");
const { GeneratedDetails } = await import("../../src/studios/world/app/GeneratedDetails.js");

// ------------------------------------------------------------------ the registration

const base = { id: "test", label: "x", mapTypes: ["surface"], stages: [{ id: "s", label: "x" }], tools: [{ id: "t", stage: "s", mode: "create", icon: "i", label: "x", mapTypes: ["surface"] }] };
const kind = (id) => ({ id, icon: "place", at: () => [], row: () => ({}), fold: () => ({}), outline: () => null });
const ground = { icon: "elevation", at: () => null, row: () => ({}), fold: () => ({}) };

test("defineStudio checks and freezes a studio's inspect, and gives it by map type", () => {
    const studio = defineStudio({ ...base, inspect: { surface: { kinds: [kind("a"), kind("b")], ground } } });
    assert.deepEqual(studio.inspectFor("surface").kinds.map((each) => each.id), ["a", "b"]);
    assert.equal(studio.inspectFor("surface").ground.id, "ground");
    assert.ok(Object.isFrozen(studio.inspectFor("surface")));
    assert.equal(studio.inspectFor("underground"), null);
    assert.equal(defineStudio(base).inspectFor("surface"), null);
    assert.throws(() => defineStudio({ ...base, inspect: { underground: { kinds: [kind("a")], ground } } }), /map type/);
    assert.throws(() => defineStudio({ ...base, inspect: { surface: { kinds: [kind("a"), kind("a")], ground } } }), /twice/);
    assert.throws(() => defineStudio({ ...base, inspect: { surface: { kinds: [{ ...kind("a"), outline: null }], ground } } }), /outline/);
    assert.throws(() => defineStudio({ ...base, inspect: { surface: { kinds: [kind("a")] } } }), /ground/);
});

test("the World studio registers Inspect for the Surface map, first in Explore; the Local studio none", () => {
    assert.deepEqual(WORLD_DEFINITION.inspectFor("surface").kinds.map((each) => each.id), ["pins", "routes", "rivers", "features", "regions"]);
    assert.equal(WORLD_DEFINITION.tool("inspect").mode, "explore");
    assert.equal(WORLD_DEFINITION.stageTools("inspect", "surface")[0].id, "inspect");
    assert.equal(LocalStudio.definition.inspectFor?.("settlement") ?? null, null);
});

// ------------------------------------------------------------------ the kinds

const flatLine = (points) => points.flatMap(([x, y]) => [x, y]);

/** A small map: a city and two towns on a road, a village off it, sea lanes at the city, a river, a forest, two region sets. */
function map({ detailLevel = 4, filters = { all: true, gm: true, none: false }, hiddenLevels = [] } = {}) {
    const political = {
        id: "pol",
        kind: "political",
        name: "Political",
        visibility: "all",
        levels: [
            { id: "realms", name: "Realms", visibility: "all", regions: [{ id: "r1", key: 1, name: "Kingdom", visibility: "all", generated: { population: 5000 } }] },
            { id: "duchies", name: "Duchies", visibility: "all", regions: [{ id: "d1", key: 2, parentKey: 1, name: "Duchy", visibility: "all" }] },
            { id: "counties", name: "Counties", visibility: "all", regions: [{ id: "c1", key: 3, parentKey: 2, name: "County", visibility: "all" }] },
        ],
    };
    const own = { id: "own", kind: "custom", name: "Dioceses", visibility: "gm", levels: [{ id: "sees", name: "Sees", visibility: "all", regions: [{ id: "s1", key: 9, name: "See", visibility: "all" }] }] };
    const lines = {
        road: flatLine([[0, 100], [100, 100], [200, 100], [300, 100]]),
        laneA: flatLine([[100, 100], [100, 0]]),
        laneB: flatLine([[100, 100], [100, 5], [0, 5]]),
        laneC: flatLine([[100, 100], [5, 100]]),
    };
    const pins = [
        { id: "city", name: "Castford", x: 100, y: 100, pinStyle: "s-city", generated: { kind: "town", tier: "city", population: 9000 }, visibility: "all" },
        { id: "east", name: "Eastby", x: 300, y: 100, pinStyle: "s-town", generated: { kind: "town", tier: "town", population: 900 }, visibility: "all" },
        { id: "west", name: "Westby", x: 0, y: 100, pinStyle: "s-village", generated: { kind: "town", tier: "village", population: 90 }, visibility: "all" },
        { id: "secret", name: "Hideaway", x: 200, y: 160, pinStyle: "s-town", generated: { kind: "town", tier: "town", population: 500 }, visibility: "gm" },
    ];
    const app = {
        mapWidth: 400,
        mapHeight: 300,
        viewOnly: false,
        viewFilters: filters,
        uiState: {
            detailLevel,
            seaLevel: 0.3,
            customPinStyles: [
                { id: "s-city", tier: "city", name: "City", detailLevel: 0 },
                { id: "s-town", tier: "town", name: "Town", detailLevel: 2 },
                { id: "s-village", tier: "village", name: "Village", detailLevel: 4 },
            ],
            hiddenLevels,
        },
        mapPins: pins,
        mapRoutes: [
            { id: "road", name: "The Kingsway", transport: "road", class: "main", visibility: "all", legs: [{}] },
            { id: "laneA", name: "", transport: "sea", class: "trunk", visibility: "all", legs: [{}] },
            { id: "laneB", name: "", transport: "sea", class: "trunk", visibility: "all", legs: [{}] },
            { id: "laneC", name: "", transport: "sea", class: "minor", visibility: "all", legs: [{}] },
        ],
        manualRivers: [{ id: "aske", name: "River Aske", points: [{ x: 98, y: 0 }, { x: 98, y: 300 }], label: { visibility: "all" } }],
        mapLabels: [{ id: "wood", name: "Greenwood", visibility: "all", feature: { kind: "forest", cell: 50, runs: [2, 1, 2] } }],
        layerSets: [own, political],
        canvasEngine: {
            stage: { scale: { x: 1 } },
            symbolSizeScale: 1,
            isLayerShown: () => true,
            isDrawn(visibility, parent = "all", isContainer = false) {
                let vis = visibility || "all";
                if (vis !== "none" && parent === "gm") vis = "gm";
                if (vis === "none") return filters.none;
                if (isContainer && vis === "all") return true;
                return vis === "gm" ? filters.gm : filters.all;
            },
        },
        meshSession: {
            layerSets: [own, political],
            routeLine: (route) => lines[route.id],
            regionAt: (levelId) => ({ realms: political.levels[0].regions[0], duchies: political.levels[1].regions[0], counties: political.levels[2].regions[0], sees: own.levels[0].regions[0] })[levelId] ?? null,
            arcsFor: () => [],
        },
    };
    return app;
}

/** The list at a point as kind ids and names, the way MapReader gathers it. */
function listAt(app, x, y) {
    const out = [];
    for (const each of SURFACE_INSPECT.kinds) for (const item of each.at(app, x, y)) out.push(`${each.id}:${each.row(app, item).name}`);
    return out;
}

test("everything at a point, in the list's order: pins, routes, rivers, features, regions set by set (Political first, deepest first)", () => {
    const app = map();
    assert.deepEqual(listAt(app, 100, 100), [
        "pins:Castford",
        "routes:The Kingsway",
        "routes:FILRODENSWMB.UI.InspectSeaLanes",
        "routes:FILRODENSWMB.UI.TransportSea",
        "rivers:River Aske",
        "features:Greenwood",
        "regions:County",
        "regions:Duchy",
        "regions:Kingdom",
        "regions:See",
    ]);
});

test("unnamed routes of a kind and class share a row with their count; a named route keeps its own", () => {
    const app = map();
    const items = SURFACE_INSPECT.kinds[1].at(app, 100, 100);
    const lanes = items.find((item) => item.routes.length === 2);
    assert.deepEqual(lanes.routes.map((route) => route.id).sort(), ["laneA", "laneB"]);
    assert.equal(SURFACE_INSPECT.kinds[1].row(app, lanes).figure, "2");
    assert.equal(SURFACE_INSPECT.kinds[1].fold(app, lanes).routes.length, 2);
});

test("a near miss drops only the pin's row", () => {
    const app = map();
    const near = listAt(app, 120, 100);
    assert.ok(!near.includes("pins:Castford"));
    assert.ok(near.includes("routes:The Kingsway"));
    assert.ok(near.includes("regions:Kingdom"));
});

test("only what the map draws: the detail level, the Regions menu and the Visibility filters", () => {
    // Towns are shown from detail 2: at 1 the road leads to no shown settlement eastward
    assert.ok(!listAt(map({ detailLevel: 1 }), 300, 100).includes("pins:Eastby"));
    assert.ok(listAt(map({ detailLevel: 2 }), 300, 100).includes("pins:Eastby"));
    // A GM-only pin, and a GM-only set's regions, only while GM only is shown
    assert.ok(listAt(map(), 200, 160).includes("pins:Hideaway"));
    assert.ok(!listAt(map({ filters: { all: true, gm: false, none: false } }), 200, 160).includes("pins:Hideaway"));
    assert.ok(!listAt(map({ filters: { all: true, gm: false, none: false } }), 100, 100).includes("regions:See"));
    // A level turned off in the Regions menu
    assert.ok(!listAt(map({ hiddenLevels: ["duchies"] }), 100, 100).includes("regions:Duchy"));
});

test("each route names the next settlement the map shows along it; a direction to a hidden one names none", () => {
    const app = map();
    const road = app.mapRoutes[0];
    const settlements = app.mapPins;
    assert.deepEqual(nextSettlements(app, road, 100, 100, settlements).map((pin) => pin?.id ?? null), ["west", "east"]);
    // At detail 2 the village west is hidden, so only Eastby is named
    const shown = map({ detailLevel: 2 });
    const fold = SURFACE_INSPECT.kinds[1].fold(shown, { routes: [road], x: 100, y: 100 });
    assert.match(fold.leads, /InspectRouteTo.*Eastby/);
});

test("a region's fold names its parents, and its set and tier outside the Political set", () => {
    const app = map();
    const regions = SURFACE_INSPECT.kinds[4].at(app, 100, 100);
    const county = regions.find((item) => item.region.id === "c1");
    assert.deepEqual(SURFACE_INSPECT.kinds[4].fold(app, county).within.map((link) => link.name), ["Duchy", "Kingdom"]);
    const see = regions.find((item) => item.region.id === "s1");
    const rows = SURFACE_INSPECT.kinds[4].fold(app, see).rows.map((row) => row.value);
    assert.deepEqual(rows, ["Dioceses", "Sees"]);
    assert.equal(SURFACE_INSPECT.kinds[4].row(app, see).set, "Dioceses");
    assert.equal(SURFACE_INSPECT.kinds[4].row(app, county).set, "FILRODENSWMB.UI.InspectPolitical");
});

test("Edit is offered on every kind with a record, and a route's rows leave out the studio's own", () => {
    const app = map();
    for (const each of SURFACE_INSPECT.kinds.filter((entry) => entry.id !== "routes")) {
        for (const item of each.at(app, 100, 100)) assert.ok(each.fold(app, item).edit, `${each.id} has Edit`);
    }
    const generated = { id: "g", transport: "road", class: "minor", generated: { run: "r", kind: "route" }, legs: [{}] };
    const labels = GeneratedDetails.forRoute({ ...app, meshSession: { routeLine: () => flatLine([[0, 0], [30, 40]]) } }, generated, { journal: true }).map((row) => row.label);
    assert.ok(!labels.includes("FILRODENSWMB.UI.GeneratedNextRun"));
    assert.ok(labels.includes("FILRODENSWMB.UI.GeneratedLength"));
});

test("a drawn route has rows (its kind and length), where it had none", () => {
    const app = { ...map(), meshSession: { routeLine: () => flatLine([[0, 0], [30, 40]]) } };
    const rows = GeneratedDetails.forRoute(app, { id: "d", transport: "road", class: null, generated: null, legs: [{}] });
    assert.deepEqual(rows.map((row) => row.label), ["FILRODENSWMB.UI.GeneratedRouteKind", "FILRODENSWMB.UI.GeneratedLength"]);
});

// ------------------------------------------------------------------ the reader

test("the reader holds a point on a click, not on a drag, and lets go on Ctrl+click, not Escape", () => {
    const surface = document.createElement("div");
    document.body.append(surface);
    const told = [];
    const reader = new MapReader({
        app: map(),
        inspect: SURFACE_INSPECT_WITHOUT_GROUND(),
        surface,
        t: { localize: (key) => key, format: (key) => key },
        toScreen: (x, y) => ({ x, y }),
        onHold: (held) => told.push(["hold", held.list.length]),
        onLetGo: () => told.push(["let go"]),
    });
    reader.down(100, 100, { clientX: 10, clientY: 10 });
    reader.up(100, 100, { clientX: 40, clientY: 10 });
    assert.equal(reader.held, null, "a drag holds nothing");
    reader.down(100, 100, { clientX: 10, clientY: 10 });
    reader.up(100, 100, { clientX: 11, clientY: 10 });
    assert.ok(reader.held);
    assert.equal(told[0][0], "hold");
    assert.equal(reader.handleKey, undefined, "Escape is Foundry's, for closing its windows");
    reader.down(150, 100, { clientX: 60, clientY: 10, ctrlKey: true });
    reader.up(150, 100, { clientX: 60, clientY: 10, ctrlKey: true });
    assert.equal(reader.held, null);
    assert.deepEqual(told.at(-1), ["let go"]);
    reader.destroy();
});

/** The Surface kinds with a ground that needs no terrain (the reader's test has none). */
function SURFACE_INSPECT_WITHOUT_GROUND() {
    return { kinds: SURFACE_INSPECT.kinds, ground: { icon: "elevation", at: () => ({ key: "ground" }), row: () => ({ name: "Ground" }), fold: () => ({}) } };
}

// ------------------------------------------------------------------ the panel

test("the panel lists the held point's folds under their set headings, the first open, with Edit only outside view only", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const Handlebars = (await import("handlebars")).default;
    const { createWebTemplates, registerHelpers } = await import("../../src/platform/web/templates.js");
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const t = { localize: (key) => key, format: (key) => key, lang: "en" };
    const handlebars = Handlebars.create();
    registerHelpers(handlebars, t);
    const prefix = "modules/filrodens-world-map-builder/templates/";
    const templates = createWebTemplates({ handlebars, prefix, fetchText: async (path) => readFileSync(join(root, "templates", path), "utf8") });
    await templates.load(["world/tools-inspect.hbs", "shell/parts/section.hbs"]);
    const fold = (index, extra) => ({ index, icon: "place", name: `Thing ${index}`, kind: "Town", rows: [], within: [], routes: [], canShow: true, canEdit: true, open: index === 0, ...extra });
    const context = (canEdit) => ({ inspect: { held: true, count: 3, countLabel: "3", folds: [fold(0, { canEdit }), fold(1, { heading: "Political", canEdit }), fold(2, { ground: true, canShow: false, canEdit: false })] } });
    const box = document.createElement("div");
    box.innerHTML = await templates.render(`${prefix}world/tools-inspect.hbs`, context(true));
    const folds = [...box.querySelectorAll(".fwmb-fold")];
    assert.equal(folds.length, 3);
    assert.ok(folds[0].hasAttribute("open") && !folds[1].hasAttribute("open"));
    assert.equal(box.querySelector(".fwmb-fold-set").textContent, "Political");
    assert.equal(box.querySelectorAll('[data-action="inspectEdit"]').length, 2);
    assert.equal(folds[2].querySelector('[data-action="inspectShow"]'), null, "the ground has nothing to show");
    box.innerHTML = await templates.render(`${prefix}world/tools-inspect.hbs`, context(false));
    assert.equal(box.querySelectorAll('[data-action="inspectEdit"]').length, 0, "no Edit in view only");
    box.innerHTML = await templates.render(`${prefix}world/tools-inspect.hbs`, { inspect: { held: false, reads: [{ label: "Detail", value: "All" }] } });
    assert.equal(box.querySelector('[data-section="inspectNothing"]') !== null, true);
});
