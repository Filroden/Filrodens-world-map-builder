// Mass edit (MassEdit, FieldSpecs) drawn from the real template in a happy-dom document: every
// inspector field of a kind is offered (or listed as each item's own); a field shows the value the
// items share or Mixed; selects offer Leave as is, booleans and visibility three ways; a touched
// row is marked changed and ↺ puts it back; Apply writes only the changed rows, to every item, as
// one undo step; a style picked fills its rows and writes its fields, and a styled field changed by
// hand makes the items Custom.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { Window } from "happy-dom";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const window = new Window({ url: "http://localhost/" });
for (const name of Object.getOwnPropertyNames(window)) {
    if (/^[A-Z]/.test(name) && !(name in globalThis)) globalThis[name] = window[name];
}
Object.assign(globalThis, { window, document: window.document });
after(() => window.happyDOM.close());
const document = window.document;

const { installPlatform, platform } = await import("../../src/platform/index.js");
const { createWebTemplates, registerHelpers } = await import("../../src/platform/web/templates.js");

const i18n = { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" };
const handlebars = Handlebars.create();
registerHelpers(handlebars, i18n);
const templates = createWebTemplates({ handlebars, prefix: "modules/filrodens-world-map-builder/templates/", fetchText: async (path) => readFileSync(join(ROOT, "templates", path), "utf8") });
await templates.load(["dialogs/mass-edit.hbs"]);

/** What the dialogue does when it opens: the test drives the rendered form, then submits it. */
const dialogue = { drive: null };
installPlatform({
    i18n,
    notify: { info: () => {}, warn: () => {}, error: () => {} },
    utils: { ...platform.utils, randomID: () => "id", deepClone: (value) => structuredClone(value), mergeObject: (target, source) => Object.assign(target, source), escapeHtml: (text) => handlebars.escapeExpression(text) },
    templates,
    fonts: { list: () => ["Noto Serif", "Sora", "Signika"] },
    settings: { get: () => [] },
    assets: { url: (path) => path, path: (path) => path },
    dialogs: {
        prompt: async ({ content, onRender, onSubmit }) => {
            const form = document.body.appendChild(document.createElement("form"));
            form.innerHTML = content;
            onRender(form);
            const go = await dialogue.drive?.(form);
            return go === false ? null : onSubmit(form);
        },
        confirm: async () => true,
        dismiss: () => {},
        attach: () => () => {},
    },
});

const { FieldSpecs } = await import("../../src/applications/FieldSpecs.js");
const { MassEdit } = await import("../../src/applications/MassEdit.js");
const { VectorHistory } = await import("../../src/applications/VectorHistory.js");
const { addRegion, createLayerSet, createLevel } = await import("../../src/mesh/Schema.js");
const { allLevels } = await import("../../src/mesh/LayerTree.js");

beforeEach(() => {
    dialogue.drive = null;
    document.body.innerHTML = "";
});

function studio() {
    const realms = createLevel({ id: "realms", name: "Realms", opacity: 1 });
    addRegion(realms, { id: "west", name: "West", quickStyle: "custom", fillColor: "#aa0000", fillStyle: "solid" });
    addRegion(realms, { id: "east", name: "East", quickStyle: "custom", fillColor: "#00aa00", fillStyle: "solid" });
    return {
        layerSets: [createLayerSet({ id: "political", name: "Political", levels: [realms] })],
        get regionLevels() {
            return allLevels(this.layerSets);
        },
        tectonicFaults: [],
        manualRivers: [],
        landMasks: [],
        mapDecorations: [],
        mapPins: [],
        mapLabels: [
            { id: "a", name: "Alpha", quickStyle: "custom", fontFamily: "Noto Serif", fontSize: 1, fillColor: "#ffffff", maxChars: 0, justify: "left", bold: true, italic: false, visibility: "all" },
            { id: "b", name: "Beta", quickStyle: "custom", fontFamily: "Noto Serif", fontSize: 2, fillColor: "#000000", maxChars: 0, justify: "left", bold: false, italic: false, visibility: "gm" },
        ],
        mapRoutes: [
            { id: "r1", name: "One", transport: "road", quickStyle: "custom", color: "#ff0000", thickness: 2, style: "solid", outline: true, smoothing: false, class: "main", label: { quickStyle: "custom", fontFamily: "Noto Serif", fontSize: 1 }, waypoints: [] },
            { id: "r2", name: "Two", transport: "road", quickStyle: "custom", color: "#00ff00", thickness: 3, style: "solid", outline: false, smoothing: false, label: { quickStyle: "custom", fontFamily: "Noto Serif", fontSize: 1 }, waypoints: [] },
        ],
        massEditMode: { pin: true, route: true, region: true, label: true },
        massEditSelection: { pin: new Set(), route: new Set(["r1", "r2"]), region: new Set(["west", "east"]), label: new Set(["a", "b"]) },
        uiState: {
            customRouteStyles: [{ id: "trunk", name: "Trunk", color: "#6b3a1f", thickness: 3, style: "solid", outline: true, smoothing: false }],
            customRegionStyles: [{ id: "realm", name: "Realm", fillColor: "#123456", fillStyle: "diagonal" }],
            customLabelStyles: [{ id: "big", name: "Big", fontFamily: "Sora", fontSize: 3, fillColor: "#abcdef", maxChars: 10, justify: "center", bold: true, italic: false }],
            customPinStyles: [],
            customBiomes: [],
            labelFontFamily: "Noto Serif",
            labelFontSize: 1,
            labelFillColor: "#ffffff",
            labelMaxChars: 0,
            labelJustify: "left",
        },
        pinHistory: [],
        pinRedoStack: [],
        rendered: [],
        _repaintVectors() {},
        markDirty() {},
        view: { render: (regions) => this?.rendered?.push(...regions) },
    };
}

const row = (form, name) => form.querySelector(`[data-mass-row="${name}"]`);
const control = (form, name) => row(form, name).querySelector("[name]");
function change(form, name, value) {
    const input = control(form, name);
    if (input.type === "checkbox") input.checked = value;
    else input.value = value;
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
}

test("every inspector field of a kind is in its mass edit, or listed as each item's own", () => {
    const names = (file) => [...readFileSync(join(ROOT, "templates/parts", file), "utf8").matchAll(/name="([a-zA-Z]+)"/g)].map((match) => match[1]);
    const label = [...names("label-fields.hbs"), "labelBold", "labelItalic"];
    const inspectors = { pin: [...names("inspector-pin.hbs"), ...label], route: [...names("inspector-route.hbs"), ...label], region: [...names("inspector-region.hbs"), ...label], label: [...names("inspector-label.hbs"), ...label] };
    for (const [type, fields] of Object.entries(inspectors)) {
        const kind = FieldSpecs.KINDS[type];
        const offered = new Set([...kind.fields.flatMap((field) => field.inspector), ...kind.perItem]);
        assert.deepEqual(fields.filter((name) => !offered.has(name)), [], `${type}'s inspector fields are all in its mass edit`);
    }
    // The fixes this brings: regions have no line fields; routes have outline and smoothing; labels bold, italic, visibility and the font picker
    assert.equal(FieldSpecs.KINDS.region.fields.some((field) => /line/i.test(field.key)), false);
    assert.ok(["outline", "smoothing", "class"].every((key) => FieldSpecs.KINDS.route.fields.some((field) => field.key === key)));
    assert.ok(["bold", "italic", "visibility", "fontFamily"].every((key) => FieldSpecs.KINDS.label.fields.some((field) => field.key === key)));
    assert.equal(FieldSpecs.KINDS.route.fields.some((field) => field.key === "mode" || field.key === "spanWater"), false, "New legs and Span water stay per route");
});

test("each field shows the value the items share, or Mixed: Leave as is, three-way booleans, empty numbers, a slider reading Mixed", async () => {
    const app = studio();
    const items = MassEdit.items(app, "label");
    document.body.innerHTML = await templates.render("modules/filrodens-world-map-builder/templates/dialogs/mass-edit.hbs", MassEdit.context(app, "label", items));
    const form = document.body;
    // The option the template chose (happy-dom's select value does not always follow the attribute)
    const chosen = (name) => control(form, name).querySelector("option[selected]")?.value ?? "";
    assert.equal(chosen("item.fontFamily"), "Noto Serif", "the shared font");
    assert.equal(chosen("item.visibility"), "", "mixed visibility: Leave as is");
    assert.deepEqual([...control(form, "item.visibility").options].map((option) => option.value), ["", "all", "gm", "none"]);
    assert.deepEqual([...control(form, "item.bold").options].map((option) => option.value), ["", "true", "false"]);
    assert.equal(chosen("item.bold"), "");
    assert.equal(chosen("item.italic"), "false", "both upright: Off");
    assert.equal(control(form, "item.maxChars").value, "0");
    assert.equal(row(form, "item.fontSize").querySelector("output").textContent, "FILRODENSWMB.UI.Mixed");
    assert.equal(row(form, "item.fillColor").dataset.mixed, "true");
    assert.equal(form.querySelectorAll("fieldset").length, 1, "a standalone label has no label fieldset");
});

test("a touched row is marked changed and ↺ puts it back; a select back on Leave as is is not changed", async () => {
    const app = studio();
    const items = MassEdit.items(app, "route");
    document.body.innerHTML = `<form>${await templates.render("modules/filrodens-world-map-builder/templates/dialogs/mass-edit.hbs", MassEdit.context(app, "route", items))}</form>`;
    const form = document.querySelector("form");
    MassEdit.bind(app, "route", form);
    assert.equal(form.querySelectorAll(".fwmb-is-changed").length, 0);
    change(form, "item.visibility", "gm");
    assert.ok(row(form, "item.visibility").classList.contains("fwmb-is-changed"));
    assert.equal(row(form, "item.visibility").querySelector("[data-mass-reset]").hidden, false);
    change(form, "item.visibility", "");
    assert.equal(row(form, "item.visibility").classList.contains("fwmb-is-changed"), false);

    // A styled field moves the style to Custom; ↺ on each puts both back
    change(form, "item.thickness", "5");
    assert.equal(control(form, "item.quickStyle").value, "custom");
    row(form, "item.thickness").querySelector("[data-mass-reset]").click();
    assert.equal(row(form, "item.thickness").classList.contains("fwmb-is-changed"), false);
    assert.equal(row(form, "item.thickness").querySelector("output").textContent, "FILRODENSWMB.UI.Mixed");
    assert.equal(row(form, "item.quickStyle").classList.contains("fwmb-is-changed"), false, "both routes were Custom already");
    assert.deepEqual(MassEdit.read(form), []);
});

test("Apply writes only the changed rows, to every item, as one undo step; untouched fields are left alone", async () => {
    const app = studio();
    dialogue.drive = (form) => {
        change(form, "item.class", "trunk");
        change(form, "label.fontSize", "2.5");
        change(form, "item.visibility", "gm");
    };
    assert.equal(await MassEdit.open(app, "route"), true);
    const [one, two] = app.mapRoutes;
    assert.deepEqual([one.class, two.class], ["trunk", "trunk"]);
    assert.deepEqual([one.visibility, two.visibility], ["gm", "gm"]);
    assert.deepEqual([one.label.fontSize, two.label.fontSize], [2.5, 2.5]);
    assert.deepEqual([one.color, two.color], ["#ff0000", "#00ff00"], "the differing colours are left alone");
    assert.deepEqual([one.outline, two.outline], [true, false]);
    assert.equal(app.pinHistory.length, 1);
    assert.equal(app.massEditSelection.route.size, 0, "the choosing ends");
    VectorHistory.step(app, true);
    assert.equal(app.mapRoutes[0].class, "main");
    assert.equal(app.mapRoutes[1].visibility, undefined);
});

test("cancelling changes nothing and keeps the items chosen", async () => {
    const app = studio();
    dialogue.drive = (form) => {
        change(form, "item.class", "trunk");
        return false;
    };
    assert.equal(await MassEdit.open(app, "route"), false);
    assert.equal(app.mapRoutes[0].class, "main");
    assert.equal(app.massEditSelection.route.size, 2);
});

test("a style picked fills its rows and writes its fields; a styled field changed by hand makes the items Custom", async () => {
    const app = studio();
    dialogue.drive = (form) => {
        change(form, "item.quickStyle", "trunk");
        assert.equal(control(form, "item.color").value, "#6b3a1f", "the style's colour shows");
        assert.ok(row(form, "item.color").classList.contains("fwmb-is-changed"));
    };
    await MassEdit.open(app, "route");
    assert.deepEqual(app.mapRoutes.map((route) => [route.quickStyle, route.color, route.thickness, route.outline]), [["trunk", "#6b3a1f", 3, true], ["trunk", "#6b3a1f", 3, true]]);

    app.massEditSelection.route = new Set(["r1", "r2"]);
    dialogue.drive = (form) => {
        change(form, "item.thickness", "1");
        assert.equal(control(form, "item.quickStyle").value, "custom", "the style moves to Custom");
    };
    await MassEdit.open(app, "route");
    assert.deepEqual(app.mapRoutes.map((route) => [route.quickStyle, route.thickness, route.color]), [["custom", 1, "#6b3a1f"], ["custom", 1, "#6b3a1f"]]);

    // A label style on standalone labels, and a region fill
    dialogue.drive = (form) => change(form, "item.quickStyle", "big");
    await MassEdit.open(app, "label");
    assert.deepEqual(app.mapLabels.map((label) => [label.quickStyle, label.fontFamily, label.fontSize, label.bold]), [["big", "Sora", 3, true], ["big", "Sora", 3, true]]);
    dialogue.drive = (form) => {
        control(form, "item.fillColor").value = "#000000";
        row(form, "item.fillColor").querySelector('[name="item.fillColor.none"]').checked = true;
        row(form, "item.fillColor").querySelector('[name="item.fillColor.none"]').dispatchEvent(new window.Event("change", { bubbles: true }));
    };
    await MassEdit.open(app, "region");
    assert.deepEqual(app.regionLevels[0].regions.map((region) => region.fillColor), ["transparent", "transparent"]);
});
