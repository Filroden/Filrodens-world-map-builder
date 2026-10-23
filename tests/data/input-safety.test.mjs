// Input safety: every hostile input the import and the editors can meet is either kept as harmless
// data or refused with a readable, localised reason. Covers the structural walk (Sanitize.plainTree),
// the allow-list of a map's fields (MapRules, MapImport), the free-text limits on import and export,
// image sniffing (ImageCheck), the values the inspector applies (MapRules.typed), the journal's
// escaping, the owner decoder's guard, the web host's merge, and the names imports are given.
// SVG cleaning needs a real browser and is checked in svg-clean.test.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import Handlebars from "handlebars";

const { FILRODENSWMB } = await import("../../src/config.js");
const { MapImport } = await import("../../src/data/MapImport.js");
const { overLimit, typed } = await import("../../src/data/MapRules.js");
const { ImportRefusal, Sanitize } = await import("../../src/data/Sanitize.js");
const { ImageCheck } = await import("../../src/data/ImageCheck.js");
const { MapNames } = await import("../../src/data/MapNames.js");
const { MapJson } = await import("../../src/data/MapJson.js");
const { createMeshBlock, createLayerSet, createLevel, addRegion, normaliseAreaFactor } = await import("../../src/mesh/Schema.js");
const { decodeOwners, encodeOwners } = await import("../../src/mesh/OwnerLayer.js");
const { encodeModelRun } = await import("../../src/generator/ModelRun.js");
const { resolveSettings } = await import("../../src/generator/GeneratorSettings.js");
const webUtils = await import("../../src/platform/web/utils.js");
const { registerHelpers } = await import("../../src/platform/web/templates.js");

const EN = JSON.parse(readFileSync(new URL("../../languages/en.json", import.meta.url), "utf8"));
const i18n = {
    localize: (key) => EN[key] ?? key,
    format: (key, data = {}) => (EN[key] ?? key).replaceAll(/\{(\w+)\}/g, (_, name) => String(data[name] ?? `{${name}}`)),
};

const SCRIPT = `<script>alert("x")</script><img src=x onerror=alert(1)>`;
const HOSTILE_COLOUR = "red;background:url(https://example.com/x.png)";

/** A small but complete v4 map, as an export writes it: every kind of object, a layer set with owners. */
function v4Map() {
    const base = JSON.parse(readFileSync(new URL("../mesh/fixtures/p0jbva.json", import.meta.url), "utf8"));
    const mapData = { ...base, vectorSchemaVersion: FILRODENSWMB.VECTOR_SCHEMA_VERSION };
    mapData.mesh = createMeshBlock(mapData, { cells: 4 });
    const level = createLevel({ id: "levelAAAAAAAAAAA", name: "Realms" });
    addRegion(level, { id: "regionAAAAAAAAAA", name: "Zor", description: "A realm.", fillColor: "#336699", label: { fontFamily: "Cinzel", fontSize: 1, fillColor: "#ffffff" } });
    mapData.layerSets = [createLayerSet({ id: "setAAAAAAAAAAAAA", name: "Political", levels: [level] })];
    delete mapData.regionLayers;
    mapData.mapPins = [{ id: "pinAAAAAAAAAAAAA", name: "Harbour", description: "A port.", icon: "map_pin", x: 10, y: 20, color: "#ffffff", scale: 1, visibility: "all", label: { fontFamily: "EB Garamond", fontSize: 1, fillColor: "#dedcd3" } }];
    mapData.mapLabels = [{ id: "labelAAAAAAAAAAA", name: "The Sea", x: 5, y: 5, rotation: 0, fontFamily: "Noto Serif", fontSize: 1, fillColor: "#e0f0fa", visibility: "all" }];
    mapData.mapDecorations = [{ id: "decoAAAAAAAAAAAA", type: "decoration", name: "Rose", src: "assets/rose.webp", x: 1, y: 1, rotation: 0, scale: 1, visibility: "all" }];
    mapData.tectonicFaults = [{ id: "faultAAAAAAAAAAA", name: "Spine", description: "", points: [{ x: 0, y: 0 }], type: "range", thickness: 40, strength: 0.5, revision: 2, style: "fold" }];
    mapData.manualRivers = [{ id: "riverAAAAAAAAAAA", name: "Long", points: [{ x: 0, y: 0 }], width: 4 }];
    mapData.landMasks = [{ id: "maskAAAAAAAAAAAA", name: "Isle", operation: "add", points: [{ x: 0, y: 0 }] }];
    mapData.customRouteStyles = [{ id: "route-style-road", name: "Road", color: "#5a3a1e", thickness: 2, style: "solid", outline: true, smoothing: false }];
    mapData.customRegionStyles = [{ id: "regionStyleAAAAA", name: "Fill", fillColor: "transparent", fillStyle: "solid" }];
    mapData.customLabelStyles = [{ id: "label-style-realm", name: "Realm", fontFamily: "Cinzel", fontSize: 1.8, fillColor: "#dedcd3", maxChars: 0, justify: "center", bold: true, italic: false }];
    mapData.customPinStyles = [{ id: "pinStyleAAAAAAAA", name: "Town", icon: "map_pin", scale: 1, color: "#ffffff", detailLevel: 1, label: { fontSize: 1, visibility: "all", quickStyle: "custom" } }];
    mapData.sizeRevision = FILRODENSWMB.SYMBOLS.REVISION;
    mapData.mapUnit = "leagues";
    mapData.thematic = { fill: "population", opacity: 0.6 };
    mapData.params = { ...mapData.params, cartography: { ...mapData.params.cartography, scaleMatchWorld: true } };
    mapData.generatorSettings = { seed: "Avalon", nameBase: "Nordic", world: { density: 1.5, urbanisation: 1, realmSpacing: 0.8, fragmentation: 1 }, output: { duchies: true, counties: false, places: { city: true, largeTown: true, town: false, castle: true }, routes: { road: true, river: false, sea: true }, labels: true } };
    mapData.cultures = [{ id: "cultureAAAAAAAAA", name: "Hillfolk", color: "#8a6a4a", nameBase: "Nordic", openness: 0.3, density: 1.5, habitat: { temperature: [0, 0.4], moisture: null, height: [0.6, 1], relief: [0.05, 0.25], coast: -0.5, river: 0.5 }, homelands: [{ x: 12, y: 30 }, { x: 80, y: 44.5 }] }];
    mapData.customBiomes = [{ id: 14, name: "Moor", code: "MR", color: [90, 80, 70], placement: "land", behavesLike: "TAIGA", rules: [{ elevation: [[0.2, 0.4, false, true]], moisture: [], temperature: [] }] }];
    return JSON.parse(JSON.stringify(MapJson.toExport(mapData, { levelAAAAAAAAAAA: encodeOwners(new Int32Array([0, 0, -1, 0])) })));
}

/** Runs `fn` with an import or text limit changed, then puts it back. */
function withLimit(group, key, value, fn) {
    const before = FILRODENSWMB.LIMITS[group][key];
    FILRODENSWMB.LIMITS[group][key] = value;
    try {
        return fn();
    } finally {
        FILRODENSWMB.LIMITS[group][key] = before;
    }
}

const refusedFor = (reason) => (error) => error instanceof ImportRefusal && error.reason === reason;

// ------------------------------------------------------------------ the allow-list keeps a real map whole

test("a complete v4 map, and the older sample maps, pass the importer with nothing dropped or changed", () => {
    const file = v4Map();
    const { mapData, owners, corrected } = MapImport.read(structuredClone(file));
    assert.equal(corrected, 0);
    const { owners: fileOwners, ...rest } = file;
    for (const level of rest.layerSets[0].levels) level.ownersKey = `owners.${level.id}`;
    assert.deepEqual(mapData, rest);
    assert.deepEqual(owners, fileOwners);
    for (const name of ["fwmb_eldoria.json", "fwmb_aethoria.json"]) {
        const sample = JSON.parse(readFileSync(new URL(`../../samples/${name}`, import.meta.url), "utf8"));
        const result = MapImport.read(structuredClone(sample));
        assert.equal(result.corrected, 0, name);
        // The one value an import has always repaired rather than kept: the area factor
        normaliseAreaFactor(sample);
        assert.deepEqual(result.mapData, sample, name);
    }
});

// ------------------------------------------------------------------ script tags in every text field

test("script and markup in every text field are kept as text, never as markup", () => {
    const file = v4Map();
    file.seed = SCRIPT;
    file.mapUnit = SCRIPT;
    file.params.cartography = { ...file.params.cartography, scaleUnits: SCRIPT };
    file.mapPins[0].name = SCRIPT;
    file.mapPins[0].description = SCRIPT;
    file.mapLabels[0].name = SCRIPT;
    file.mapDecorations[0].name = SCRIPT;
    file.tectonicFaults[0].name = SCRIPT;
    file.tectonicFaults[0].description = SCRIPT;
    file.manualRivers[0].name = SCRIPT;
    file.landMasks[0].name = SCRIPT;
    file.layerSets[0].name = SCRIPT;
    file.layerSets[0].levels[0].name = SCRIPT;
    file.layerSets[0].levels[0].titleTemplate = SCRIPT;
    file.layerSets[0].levels[0].regions[0].name = SCRIPT;
    file.layerSets[0].levels[0].regions[0].description = SCRIPT;
    for (const list of ["customRouteStyles", "customRegionStyles", "customLabelStyles", "customPinStyles", "customBiomes"]) file[list][0].name = SCRIPT;
    file.customBiomes[0].code = SCRIPT;

    const { mapData } = MapImport.read(file);
    assert.equal(mapData.mapPins[0].name, SCRIPT, "stored as the text it is");
    assert.equal(mapData.mapUnit, SCRIPT, "the map's unit is plain text too");

    // The journal page: escaped, so the description reads as the characters typed
    const html = Sanitize.textToHtml(mapData.mapPins[0].description);
    assert.ok(!html.includes("<script") && !html.includes("<img"), html);
    assert.ok(html.includes("&lt;script&gt;"));
    assert.equal(Sanitize.textToHtml("One\nTwo\n\nThree"), "<p>One<br>Two</p><p>Three</p>");

    // The templates: Handlebars escapes every value it writes
    const handlebars = Handlebars.create();
    registerHelpers(handlebars, i18n);
    const field = handlebars.compile(`<input name="pinName" maxlength="{{fwmbTextLimit 'name'}}" value="{{pin.name}}"><textarea>{{pin.description}}</textarea>`);
    const rendered = field({ pin: mapData.mapPins[0] });
    assert.ok(!rendered.includes("<script") && !rendered.includes("<img"), rendered);
    assert.ok(rendered.includes(`maxlength="${FILRODENSWMB.LIMITS.TEXT.NAME}"`));
});

// ------------------------------------------------------------------ __proto__, constructor, prototype

test("__proto__, constructor and prototype keys are dropped at every depth and pollute nothing", () => {
    const file = v4Map();
    const text = JSON.stringify(file)
        .replace("{", '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},')
        .replace('"mapPins":[{', '"mapPins":[{"__proto__":{"polluted":true},')
        .replace('"noise":{', '"noise":{"__proto__":{"polluted":true},');
    const parsed = JSON.parse(text);
    assert.ok(Object.hasOwn(parsed, "__proto__"), "JSON.parse makes the key an own property");

    const { mapData } = MapImport.read(parsed);
    assert.equal({}.polluted, undefined);
    assert.equal(Object.getPrototypeOf(mapData), Object.prototype);
    assert.ok(!Object.hasOwn(mapData, "__proto__") && !Object.hasOwn(mapData, "constructor"));
    assert.ok(!Object.hasOwn(mapData.mapPins[0], "__proto__"));
    assert.equal(mapData.mapPins[0].polluted, undefined);
    assert.equal(mapData.params.noise.polluted, undefined);

    // The web host's merge (Foundry's mergeObject's stand-in) skips them too, dotted or not
    const target = {};
    webUtils.mergeObject(target, JSON.parse('{"__proto__":{"polluted":true},"a.__proto__.polluted":true,"constructor.prototype.polluted":true,"ok":1}'));
    assert.equal({}.polluted, undefined);
    assert.deepEqual(target, { ok: 1 });
});

test("a key the rules do not know is dropped; a style file's entries are rebuilt the same way", () => {
    const file = v4Map();
    file.injected = SCRIPT;
    file.mapPins[0].onclick = SCRIPT;
    const { mapData } = MapImport.read(file);
    assert.ok(!("injected" in mapData) && !("onclick" in mapData.mapPins[0]));

    const styles = MapImport.readStyles({ categories: { customRouteStyles: [{ id: "x", name: "Road", color: HOSTILE_COLOUR, style: "constructor", thickness: 2, extra: 1 }], __proto__: [] } });
    assert.deepEqual(styles.categories.customRouteStyles, [{ name: "Road", thickness: 2 }]);
    assert.equal(styles.corrected, 2);
    assert.throws(() => MapImport.readStyles({ nothing: true }), refusedFor("notStyles"));
});

// ------------------------------------------------------------------ oversized and malformed structure

test("oversized arrays, too many values, deep nesting and huge strings are refused before they reach the map", () => {
    withLimit("IMPORT", "ARRAY_LENGTH", 100, () => {
        const file = v4Map();
        file.history = Array.from({ length: 101 }, () => ({ layer: "terrain", tool: "raise", points: [] }));
        assert.throws(() => MapImport.read(file), refusedFor("tooLarge"));
    });
    withLimit("IMPORT", "VALUES", 100, () => assert.throws(() => MapImport.read(v4Map()), refusedFor("tooLarge")));
    let nested = {};
    const deep = nested;
    for (let i = 0; i < 40; i++) nested = nested.next = {};
    assert.throws(() => Sanitize.plainTree(deep), refusedFor("damaged"));
    withLimit("IMPORT", "STRING_LENGTH", 1000, () => {
        const file = v4Map();
        file.mapDecorations[0].src = `data:image/png;base64,${"A".repeat(2000)}`;
        assert.throws(() => MapImport.read(file), refusedFor("tooLarge"));
    });
});

test("a file that is not a map, or whose map data is damaged, is refused with its reason", () => {
    assert.throws(() => MapImport.parse("{ not json"), refusedFor("notMap"));
    assert.throws(() => MapImport.read({ hello: "world" }), refusedFor("notMap"));
    assert.throws(() => MapImport.read([]), refusedFor("notMap"));

    const huge = v4Map();
    huge.mapWidth = 1e9;
    assert.throws(() => MapImport.read(huge), refusedFor("damaged"), "a map size that would allocate billions of cells");

    const fine = v4Map();
    fine.mesh.spacing = 0.5;
    assert.throws(() => MapImport.read(fine), refusedFor("damaged"), "a mesh finer than the map's size allows");

    const badId = v4Map();
    badId.layerSets[0].levels[0].id = "owners.-=evil";
    assert.throws(() => MapImport.read(badId), refusedFor("damaged"), "an id other objects refer to, that would be read as a path");

    const twice = v4Map();
    twice.customRouteStyles.push({ ...twice.customRouteStyles[0] });
    assert.throws(() => MapImport.read(twice), refusedFor("damaged"));

    // Ids nothing refers to are simply replaced
    const pins = v4Map();
    pins.mapPins.push({ ...pins.mapPins[0] }, { ...pins.mapPins[0], id: "a.b" });
    const ids = MapImport.read(pins, { newId: (() => { let n = 0; return () => `new${n++}`; })() }).mapData.mapPins.map((pin) => pin.id);
    assert.deepEqual(ids, ["pinAAAAAAAAAAAAA", "new1", "new0"]);
});

test("owner arrays are kept only for the map's own layers, and the decoder refuses an impossible length", () => {
    const file = v4Map();
    file.owners.someoneElse = file.owners.levelAAAAAAAAAAA;
    file.owners.levelAAAAAAAAAAA += "!";
    const { owners, corrected } = MapImport.read(file);
    assert.deepEqual(owners, {});
    assert.equal(corrected, 2);

    // A run-length header claiming a billion cells, which would allocate gigabytes
    const header = Buffer.from([0x80, 0x94, 0xeb, 0xdc, 0x03, 0x01, 0x01]).toString("base64");
    assert.throws(() => decodeOwners(header), /Owner data is corrupt/);
});

/** A four-cell generator run as a map saves it (see ModelRun). */
function savedModelRun() {
    const cells = { capacity: [10, 20, 0, 5], population: [8, 15, 0, 4], landArea: [600, 512.5, 0, 80], security: [1, 0.5, 0, 0.25], cleared: [0.5, 0.5, 0, 0], water: [0, 0, 1, 0], realm: [0, 0, -1, 1], duchy: [0, 1, -1, 2], county: [0, 1, -1, 3], culture: [0, 0, -1, 0] };
    const result = {
        modelCells: { ...cells, shareStart: [0, 1, 2, 2, 3], shareCulture: [0, 0, 0], shareValue: [1, 1, 1] },
        settings: resolveSettings({}, "SEED"),
        cellCount: 4,
        cultures: [{ name: "Northfolk", nameBase: "english", homeland: 0 }],
        stats: { kingdoms: 2, independents: 0 },
        trade: { from: [0, 1], to: [1, 3], kind: [0, 2], value: [1, 0.25] },
        history: [{
            development: 0.5,
            plague: 0,
            strife: 0.2,
            places: [0, 1, 1, 3, 2, 0],
            placeNames: ["Ashby", "Brook"],
            castles: [1],
            castleNames: ["Crag"],
            castleKeeps: ["keep"],
            seats: [0, -1],
            realmNames: ["Ashmark", "Brookland"],
            realmPeople: [1200, 300],
            realm: [0, 0, -1, 1],
            culture: [0, 0, -1, 0],
            roadFrom: [0, 1],
            roadTo: [1, 3],
        }],
    };
    return JSON.parse(JSON.stringify(encodeModelRun(result, "runAAAAAAAAAAAAA")));
}

test("a regional map's copy of its parent's run passes the importer whole, and a damaged one is dropped", async () => {
    const { cropRun } = await import("../../src/generator/ParentRun.js");
    const copyOf = () => cropRun(savedModelRun(), { sites: [0, 0, 10, 0, 0, 10, 10, 10], spacingPx: 10, spacingKm: 25, crop: { x: 0, y: 0, width: 10, height: 10 }, zoomScale: 2 });
    const file = v4Map();
    file.parentRun = copyOf();
    const kept = MapImport.read(file);
    assert.deepEqual(kept.mapData.parentRun, file.parentRun);
    assert.equal(kept.corrected, 0);
    const damaged = (change) => {
        const broken = v4Map();
        broken.parentRun = copyOf();
        change(broken.parentRun);
        return MapImport.read(broken);
    };
    const short = damaged((copy) => (copy.sites.x.data = copy.sites.x.data.slice(0, 8)));
    assert.equal(short.mapData.parentRun, null, "fewer sites than cells");
    assert.equal(short.corrected, 1);
    assert.equal(damaged((copy) => (copy.cells.population.data = copy.cells.population.data.slice(0, 4))).mapData.parentRun, null, "an array shorter than the cells");
    assert.equal(damaged((copy) => (copy.origin = "self")).mapData.parentRun, null, "not a parent's run");
    assert.equal(damaged((copy) => (copy.spacingPx = "wide")).mapData.parentRun, null, "no spacing");
});

test("a saved model run passes the importer whole, and a damaged or hostile one is dropped", () => {
    const file = v4Map();
    file.modelRun = savedModelRun();
    const kept = MapImport.read(file);
    assert.deepEqual(kept.modelRun, file.modelRun);
    assert.equal(kept.corrected, 0);

    const hostile = (change) => {
        const damaged = v4Map();
        damaged.modelRun = savedModelRun();
        change(damaged.modelRun);
        return MapImport.read(damaged);
    };
    const short = hostile((run) => (run.cells.population.data = run.cells.population.data.slice(0, 4)));
    assert.equal(short.modelRun, null, "an array shorter than the run's cells");
    assert.equal(short.corrected, 1);
    assert.equal(hostile((run) => (run.cells.realm.data = "not base64!")).modelRun, null);
    assert.equal(hostile((run) => (run.cells.landArea.data = run.cells.landArea.data.slice(0, 8))).modelRun, null, "a land area shorter than the run's cells");
    assert.equal(hostile((run) => (run.cells.tradeTo.data = run.cells.tradeTo.data.slice(0, 1))).modelRun, null, "trade arrays of different lengths");
    assert.equal(hostile((run) => (run.cells.tradeFrom.data = btoa(String.fromCharCode(0, 9)))).modelRun, null, "a trade edge from a cell the run does not have");
    assert.equal(hostile((run) => (run.cells.tradeKind.data = btoa(String.fromCharCode(0, 7)))).modelRun, null, "an unknown transport");
    assert.ok(hostile((run) => ["tradeFrom", "tradeTo", "tradeKind", "tradeValue"].forEach((name) => delete run.cells[name])).modelRun, "a run saved before trade was kept is whole");
    // An earlier age: its names run with its places, castles and realms, and its arrays with the cells
    const age = (change) => hostile((run) => change(run.history[0])).modelRun;
    assert.equal(age((saved) => saved.placeNames.pop()), null, "a place with no name");
    assert.equal(age((saved) => saved.castleKeeps.push("tower")), null, "more keeps than castles");
    assert.equal(age((saved) => saved.realmNames.pop()), null, "a realm with no name");
    assert.equal(age((saved) => saved.realmPeople.push(5)), null, "more people counts than realms");
    assert.equal(age((saved) => (saved.culture.data = saved.culture.data.slice(0, 4))), null, "cultures shorter than the run's cells");
    assert.equal(age((saved) => delete saved.roadTo), null, "a road with one end");
    assert.equal(age((saved) => (saved.roadTo.data = btoa(String.fromCharCode(1, 9)))), null, "a road to a cell the run does not have");
    assert.equal(age((saved) => (saved.seats = [0, -2])), null, "a seat that is no cell");
    assert.ok(age((saved) => ["placeNames", "castleNames", "castleKeeps", "realmNames", "realmPeople", "culture", "roadFrom", "roadTo"].forEach((name) => delete saved[name])), "an age saved before names, cultures and roads were kept is whole");
    assert.equal(age((saved) => (saved.placeNames[0] = 7)).history[0].placeNames[0], "7", "a name is text");
    // A run saved before land areas were kept is whole: only its density layers have no data
    const older = hostile((run) => delete run.cells.landArea);
    assert.ok(older.modelRun && !older.modelRun.cells.landArea);
    assert.equal(hostile((run) => (run.cellCount = 1e12)).modelRun, null, "a cell count past the mesh's limit");
    assert.equal(hostile((run) => (run.cells.shareStart.data = btoa(String.fromCharCode(9, 0, 0, 0, 0)))).modelRun, null, "shares that run backwards");
    const scripted = hostile((run) => {
        run.cultures[0].name = SCRIPT;
        run.__proto__ = { polluted: true };
        run.extra = "dropped";
    });
    assert.equal(scripted.modelRun.cultures[0].name, SCRIPT, "a name is kept as text");
    assert.equal(scripted.modelRun.extra, undefined);
    assert.equal({}.polluted, undefined);
    assert.equal(MapImport.read(v4Map()).modelRun, null, "a map without a run has none");
});

// ------------------------------------------------------------------ colours, enums, numbers, fonts, images

test("a colour such as red;background:url(…) never passes, in a file or in the inspector", () => {
    const file = v4Map();
    file.mapPins[0].color = HOSTILE_COLOUR;
    file.mapLabels[0].fillColor = HOSTILE_COLOUR;
    file.layerSets[0].levels[0].regions[0].fillColor = HOSTILE_COLOUR;
    file.layerSets[0].levels[0].style.lineColor = HOSTILE_COLOUR;
    file.customRouteStyles[0].color = HOSTILE_COLOUR;
    file.params.cartography = { ...file.params.cartography, borderColor: HOSTILE_COLOUR };
    file.customBiomes[0].color = ["red", 0, 0];
    const { mapData, corrected } = MapImport.read(file);
    assert.equal(corrected, 7);
    assert.ok(!JSON.stringify(mapData).includes("url("));
    assert.ok(!("color" in mapData.mapPins[0]), "dropped, so the load path's default applies");

    // The inspector keeps the object's own value when a typed one fails
    const pin = { color: "#123456", visibility: "gm", scale: 1, name: "Harbour" };
    assert.deepEqual(typed("pin", { color: HOSTILE_COLOUR, visibility: "constructor", scale: Number.NaN, name: "x".repeat(500) }, pin), { color: "#123456", visibility: "gm", scale: 1, name: "x".repeat(FILRODENSWMB.LIMITS.TEXT.NAME) });
    assert.deepEqual(typed("region", { fillColor: "transparent", label: { fillColor: HOSTILE_COLOUR, fontFamily: 'Cinzel"; color: red' } }, { fillColor: "#000000", label: { fillColor: "#ffffff", fontFamily: "Cinzel" } }), { fillColor: "transparent", label: { fillColor: "#ffffff", fontFamily: "Cinzel" } });
});

test("enums, numbers, font names and image sources are checked by their rules", () => {
    assert.equal(Sanitize.oneOf("constructor", ["solid", "dashed"]), null);
    assert.equal(Sanitize.number(Number.POSITIVE_INFINITY), null);
    assert.equal(Sanitize.number(5, { min: 0, max: 1 }), 1);
    assert.equal(Sanitize.fontFamily("Noto Serif"), "Noto Serif");
    assert.equal(Sanitize.fontFamily("Fell'); background: url(x"), null);
    assert.equal(Sanitize.imageSource("worlds/w/fwmb-assets/a.webp"), "worlds/w/fwmb-assets/a.webp");
    for (const bad of ["javascript:alert(1)", "https://example.com/x.png", "../../etc/passwd", "/abs/x.png", "a.png');background:url(x", "data:text/html;base64,PHNjcmlwdD4="]) assert.equal(Sanitize.imageSource(bad), null, bad);
    assert.equal(Sanitize.imageSource("https://assets.forge-vtt.com/x.png", { remote: true }), "https://assets.forge-vtt.com/x.png");
    assert.equal(Sanitize.imageSource("data:image/png;base64,iVBORw0KGgo="), "data:image/png;base64,iVBORw0KGgo=");

    const file = v4Map();
    file.mapDecorations[0].src = "javascript:alert(1)";
    file.mapRoutes = [{ id: "routeAAAAAAAAAAA", style: "constructor", mode: "__proto__", waypoints: [1, -1, 2.5, "x", 3], legs: [[1, "x", 3]], transport: "road" }];
    file.history = [{ layer: "terrain", tool: "raise;", size: "huge", points: [{ x: 1, y: 2 }, { x: "a" }, [3, 4], 5] }];
    file.customBiomes[0].behavesLike = "DEEP_OCEAN";
    file.cultures[0].habitat.temperature = [0.6, 0.2];
    file.cultures[0].habitat.relief = ["low", 1];
    file.cultures[0].openness = 7;
    file.cultures[0].homelands.push({ x: "1", y: 2 }, [3, 4]);
    file.thematic = { fill: "__proto__", opacity: 40 };
    file.travel = { mode: "dragon", speeds: { foot: 5000, sea: -3, riverUp: "fast" }, start: { x: 10, y: "2" } };
    const { mapData } = MapImport.read(file);
    assert.deepEqual(mapData.travel, { speeds: { foot: FILRODENSWMB.TRAVEL_TIME.SPEED_RANGE.MAX, sea: FILRODENSWMB.TRAVEL_TIME.SPEED_RANGE.MIN } }, "an unknown way of travel, a speed that is no number and a broken start are dropped; speeds are kept in range");
    assert.deepEqual(mapData.thematic, { opacity: FILRODENSWMB.THEMATIC.OPACITY_RANGE.MAX }, "an unknown thematic layer is dropped and the opacity kept in range");
    assert.ok(!("temperature" in mapData.cultures[0].habitat) && !("relief" in mapData.cultures[0].habitat), "a band must be two numbers, low first");
    assert.equal(mapData.cultures[0].openness, 1);
    assert.deepEqual(mapData.cultures[0].homelands, [{ x: 12, y: 30 }, { x: 80, y: 44.5 }]);
    assert.ok(!("src" in mapData.mapDecorations[0]));
    assert.ok(!("behavesLike" in mapData.customBiomes[0]), "Behaves like names only a land biome the generator knows");
    assert.deepEqual(mapData.mapRoutes[0], { id: "routeAAAAAAAAAAA", waypoints: [1, 3], legs: [[1, 3]], transport: "road" });
    assert.deepEqual(mapData.history[0], { layer: "terrain", points: [{ x: 1, y: 2 }, [3, 4], 5] });
});

test("an image is known by its bytes: an SVG renamed .png is an SVG, and an unknown file is refused", async () => {
    const svg = new TextEncoder().encode(`<?xml version="1.0"?>\n<!-- icon --><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>`);
    assert.equal(ImageCheck.sniff(svg), "svg");
    assert.equal(ImageCheck.sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "png");
    assert.equal(ImageCheck.sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "jpeg");
    assert.equal(ImageCheck.sniff(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "webp");
    assert.equal(ImageCheck.sniff(new TextEncoder().encode("<html><body>not an image</body></html>")), null);

    // Named and typed as a PNG, it is still an SVG; with no browser to clean it with, it is refused
    // rather than passed through (the browser test checks the cleaning itself)
    const renamed = new File([svg], "icon.png", { type: "image/png" });
    await assert.rejects(ImageCheck.checkFile(renamed), refusedFor("image"));
    await assert.rejects(ImageCheck.checkFile(new File([new TextEncoder().encode("<html></html>")], "x.png")), refusedFor("image"));

    // Raster images are decoded to prove they are images, within the size limits
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const decodeAs = (width, height) => async () => ({ width, height, close() {} });
    assert.equal((await ImageCheck.check(png, { decode: decodeAs(100, 50) })).type, "png");
    await assert.rejects(ImageCheck.check(png, { decode: decodeAs(9000, 10) }), refusedFor("image"));
    await assert.rejects(ImageCheck.check(png, { decode: () => Promise.reject(new Error("broken")) }), refusedFor("image"));
    await withLimit("IMAGE", "BYTES", 4, () => assert.rejects(ImageCheck.check(png, { decode: decodeAs(1, 1) }), refusedFor("image")));

    // A data URL is retyped by what its bytes are
    const url = `data:image/webp;base64,${Buffer.from(png).toString("base64")}`;
    assert.ok((await ImageCheck.checkDataUrl(url, { decode: decodeAs(4, 4) })).startsWith("data:image/png;base64,"));
});

// ------------------------------------------------------------------ text limits

test("text past its limit refuses an import, naming where, and an export lists every one", () => {
    const file = v4Map();
    file.mapPins[0].description = "d".repeat(FILRODENSWMB.LIMITS.TEXT.DESCRIPTION + 1);
    file.mapLabels[0].name = "l".repeat(FILRODENSWMB.LIMITS.TEXT.LABEL + 1);
    file.mapUnit = "u".repeat(FILRODENSWMB.LIMITS.TEXT.NAME + 1);
    let refusal;
    assert.throws(
        () => MapImport.read(file),
        (error) => {
            refusal = error;
            return refusedFor("textTooLong")(error);
        },
    );
    const message = Sanitize.refusalMessage(refusal, i18n);
    assert.equal(message, `This file can't be imported: the map unit of the map is ${FILRODENSWMB.LIMITS.TEXT.NAME + 1} characters long, and the limit is ${FILRODENSWMB.LIMITS.TEXT.NAME}. 2 more texts are over their limits too.`);

    // Raising the limit (as for testing) lets the same file in
    withLimit("TEXT", "DESCRIPTION", 1e6, () => withLimit("TEXT", "LABEL", 1e6, () => assert.ok(MapImport.read(v4Map()))));

    const entries = overLimit(file, { "FILRODENSWMB.UI.LimitFieldName": "n".repeat(FILRODENSWMB.LIMITS.TEXT.NAME + 1) });
    assert.deepEqual(
        entries.map((entry) => Sanitize.limitLine(entry, i18n)),
        [
            `the map: name, ${FILRODENSWMB.LIMITS.TEXT.NAME + 1} characters (the limit is ${FILRODENSWMB.LIMITS.TEXT.NAME})`,
            `the map: map unit, ${FILRODENSWMB.LIMITS.TEXT.NAME + 1} characters (the limit is ${FILRODENSWMB.LIMITS.TEXT.NAME})`,
            `the pin “Harbour”: description, ${FILRODENSWMB.LIMITS.TEXT.DESCRIPTION + 1} characters (the limit is ${FILRODENSWMB.LIMITS.TEXT.DESCRIPTION})`,
            `the label “${"l".repeat(40)}…”: text, ${FILRODENSWMB.LIMITS.TEXT.LABEL + 1} characters (the limit is ${FILRODENSWMB.LIMITS.TEXT.LABEL})`,
        ],
    );
    assert.deepEqual(overLimit(v4Map()), []);
});

test("every refusal has a localised message", () => {
    for (const reason of ["tooLarge", "notMap", "notStyles", "damaged", "image"]) {
        const message = Sanitize.refusalMessage(new ImportRefusal(reason), i18n);
        assert.ok(!message.startsWith("FILRODENSWMB.") && !/\{\w+\}/.test(message), `${reason}: ${message}`);
    }
});

// ------------------------------------------------------------------ names

test("an exported file carries the map's name, as typed, and an older file without one reads as null", () => {
    const named = MapImport.read(JSON.parse(JSON.stringify(MapJson.toExport(v4Map(), {}, "Harbour Town"))));
    assert.equal(named.name, "Harbour Town");
    assert.ok(!("name" in named.mapData), "kept apart from the map data, as a save keeps it");
    assert.equal(MapImport.read(v4Map()).name, null);
    const blank = v4Map();
    blank.name = "   ";
    assert.equal(MapImport.read(blank).name, null);
    const long = v4Map();
    long.name = "n".repeat(FILRODENSWMB.LIMITS.TEXT.NAME + 1);
    assert.throws(() => MapImport.read(long), refusedFor("textTooLong"));
});

test("an imported map keeps its name, numbered only when a saved map already has it", () => {
    const numbered = (name, number) => i18n.format("FILRODENSWMB.UI.NumberedMapName", { name, number });
    assert.equal(MapNames.fromFileName("fwmb_harbour.json", "Unnamed map"), "harbour");
    assert.equal(MapNames.fromFileName(".json", "Unnamed map"), "Unnamed map");
    assert.equal(MapNames.fromFileName(`${"x".repeat(300)}.json`, "U").length, FILRODENSWMB.LIMITS.TEXT.NAME);
    assert.equal(MapNames.unique("Harbour", ["Coast"], numbered), "Harbour");
    assert.equal(MapNames.unique("Harbour", ["Harbour", "Harbour (2)"], numbered), "Harbour (3)");
    assert.deepEqual(MapNames.namesIn([{ name: "A", children: [{ name: "B", children: [] }] }, { name: "C" }]), ["A", "B", "C"]);
});
