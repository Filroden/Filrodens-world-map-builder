// The Labels and Regions menus' rows (ContentRows): the label styles the map's names use and No
// style, each set with its levels, All turning every row off or back on, a set's row its levels,
// what the canvas and picking then leave out, a tool bringing its rows back, and the choices saved
// with the map.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ContentRows, NO_STYLE } from "../../src/applications/ContentRows.js";
import { DetailLevel } from "../../src/applications/DetailLevel.js";
import { RULES, clean, cleanContext } from "../../src/data/MapRules.js";
import { installPlatform, platform } from "../../src/platform/index.js";

installPlatform({ i18n: { ...platform.i18n, localize: (key) => key } });

function studio() {
    const level = (id, name, regions) => ({ id, name, regions });
    return {
        uiState: {
            customLabelStyles: [{ id: "label-style-realm", name: "Realm" }, { id: "label-style-capital", name: "Capital" }, { id: "label-style-water", name: "Water" }],
            hiddenLabelStyles: [],
            hiddenLevels: [],
        },
        mapLabels: [{ id: "l1", name: "The Narrows", quickStyle: "custom" }],
        mapPins: [
            { id: "p1", icon: "dot", name: "Ashford", label: { quickStyle: "label-style-capital" } },
            { id: "p2", icon: "dot", name: "", label: { quickStyle: "label-style-water" } },
        ],
        mapRoutes: [{ id: "r1", name: "Old road", label: { quickStyle: "label-style-gone" } }],
        layerSets: [
            { id: "political", name: "Political", kind: "political", levels: [level("realms", "Realms", [{ name: "Brill", label: { quickStyle: "label-style-realm" } }]), level("duchies", "Duchies", [])] },
            { id: "own", name: "Lands", kind: "custom", levels: [level("lands", "Lands", [])] },
        ],
    };
}

const rowsOf = (app, id) => ContentRows.groups(app).find((group) => group.id === id);

test("the Labels menu lists the styles the map's names use, in the styles' order, then No style", () => {
    const labels = rowsOf(studio(), "labels");
    assert.deepEqual(labels.rows.map((row) => [row.key, row.label]), [["label-style-realm", "Realm"], ["label-style-capital", "Capital"], [NO_STYLE, "FILRODENSWMB.UI.StyleNone"]], "a style only an unnamed pin uses is not listed; a deleted style counts as none");
    assert.equal(labels.state, "on");
});

test("the Regions menu lists each set, its levels indented below it, then Fills", () => {
    const regions = rowsOf(studio(), "regions");
    assert.deepEqual(regions.rows.map((row) => [row.kind, row.key, !!row.sub]), [["set", "political", false], ["level", "realms", true], ["level", "duchies", true], ["set", "own", false], ["level", "lands", true], ["fills", "fills", false]]);
    assert.equal(regions.rows.at(-1).separator, true);
    const empty = studio();
    empty.layerSets = [];
    assert.deepEqual(rowsOf(empty, "regions").rows, [], "no sets: no Fills either");
});

test("Fills turns the levels' fills off and on, apart from All and the menu's state, and is saved", () => {
    const app = studio();
    assert.equal(ContentRows.fillsShown(app), true);
    ContentRows.toggle(app, "regions", "fills", "fills");
    assert.equal(app.uiState.hideRegionFills, true);
    assert.equal(ContentRows.fillsShown(app), false);
    assert.equal(rowsOf(app, "regions").rows.at(-1).on, false);
    assert.equal(rowsOf(app, "regions").state, "on", "every level is still shown");
    ContentRows.toggle(app, "regions", "all");
    assert.deepEqual(app.uiState.hiddenLevels.sort(), ["duchies", "lands", "realms"], "All is the levels alone");
    assert.equal(ContentRows.fillsShown(app), false, "All leaves Fills as it was");
    ContentRows.toggle(app, "regions", "fills", "fills");
    assert.equal(ContentRows.fillsShown(app), true);
    const saved = clean({ hideRegionFills: true }, RULES.map, cleanContext(() => "x"));
    assert.equal(saved.hideRegionFills, true);
});

test("a row turns its style or level off and on; a set's row all its levels; All every row", () => {
    const app = studio();
    ContentRows.toggle(app, "labels", "style", "label-style-capital");
    assert.deepEqual(app.uiState.hiddenLabelStyles, ["label-style-capital"]);
    assert.equal(rowsOf(app, "labels").state, "partial");
    const shown = ContentRows.labelShown(app);
    assert.equal(shown({ quickStyle: "label-style-capital" }), false);
    assert.equal(shown({ quickStyle: "label-style-realm" }), true);
    ContentRows.toggle(app, "labels", "all");
    assert.equal(rowsOf(app, "labels").state, "on", "All with some off turns every row on");
    ContentRows.toggle(app, "labels", "all");
    assert.equal(rowsOf(app, "labels").state, "off");
    assert.equal(ContentRows.labelShown(app)({ quickStyle: "label-style-gone" }), false, "No style covers deleted styles too");

    ContentRows.toggle(app, "regions", "set", "political");
    assert.deepEqual(app.uiState.hiddenLevels.sort(), ["duchies", "realms"]);
    const political = rowsOf(app, "regions").rows[0];
    assert.equal(political.on, false);
    ContentRows.toggle(app, "regions", "level", "realms");
    assert.equal(rowsOf(app, "regions").rows[0].mixed, true, "a set partly on reads mixed");
});

test("a level turned off is neither drawn nor picked, whatever the detail level", () => {
    const app = studio();
    ContentRows.toggle(app, "regions", "level", "realms");
    const [political] = app.layerSets;
    for (const detailLevel of [3, 0]) {
        app.uiState.detailLevel = detailLevel;
        assert.equal(DetailLevel.shown(app).showsLevel(political, political.levels[0]), false);
        assert.equal(DetailLevel.shows(app, "region", { set: political, level: political.levels[0] }), false);
    }
    assert.equal(DetailLevel.shown(app).showsLevel(political, political.levels[1]), false, "Duchies hidden at World by detail");
    app.uiState.detailLevel = 3;
    assert.equal(DetailLevel.shown(app).showsLevel(political, political.levels[1]), true);
});

test("opening the Labels or Regions tool brings its rows back only when every one was off", () => {
    const app = studio();
    ContentRows.toggle(app, "labels", "style", "label-style-realm");
    assert.equal(ContentRows.ensureShown(app, "labels"), false, "some still on: left as chosen");
    ContentRows.toggle(app, "labels", "all");
    ContentRows.toggle(app, "labels", "all");
    assert.equal(rowsOf(app, "labels").state, "off");
    assert.equal(ContentRows.ensureShown(app, "labels"), true);
    assert.equal(rowsOf(app, "labels").state, "on");
});

test("the choices are saved with the map", () => {
    const saved = clean({ hiddenLabelStyles: ["label-style-realm", "custom"], hiddenLevels: ["realms"] }, RULES.map, cleanContext(() => "x"));
    assert.deepEqual(saved.hiddenLabelStyles, ["label-style-realm", "custom"]);
    assert.deepEqual(saved.hiddenLevels, ["realms"]);
});
