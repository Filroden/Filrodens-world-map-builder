// Pin quick styles (PinStyles and the Pin entry of MapDialogManager.QUICK_STYLE_CONFIG): the default
// set a map starts with, what a style writes onto a pin, the cascade when a style is edited, letting
// go of a deleted style, usage counts, and the toolbar's choice of style for new pins.
import assert from "node:assert/strict";
import { test } from "node:test";

const { installPlatform, platform } = await import("../../src/platform/index.js");

let nextId = 0;
installPlatform({
    i18n: { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" },
    notify: { info() {}, warn() {}, error() {} },
    utils: { ...platform.utils, randomID: () => `p${++nextId}`, deepClone: (value) => structuredClone(value), mergeObject: (target, source) => Object.assign(target, source) },
    templates: { render: async () => "" },
    fonts: { list: () => [] },
    dialogs: { confirm: async () => true, prompt: async () => null, choose: async () => null, dismiss() {}, attach: () => () => {} },
});

const { PinStyles } = await import("../../src/applications/PinStyles.js");
const { MapDialogManager } = await import("../../src/applications/MapDialogManager.js");
const { FILRODENSWMB } = await import("../../src/config.js");

const config = MapDialogManager.QUICK_STYLE_CONFIG.Pin;

/** A studio stand-in with no pin styles yet, one label quick style, and two pins. */
function studio() {
    return {
        uiState: {
            customPinStyles: null,
            customLabelStyles: [{ id: "serif", name: "Serif", fontFamily: "Georgia", fontSize: 2, fillColor: "#112233", maxChars: 12, justify: "center" }],
            activePinStyle: "custom",
            activeIcon: "map_pin",
            pinColor: "#ffffff",
            pinScale: 1,
        },
        mapPins: [
            { id: "a", name: "A", icon: "dot", scale: 1, color: "#ffffff", pinStyle: null, label: { fontSize: 1, rotation: 15 } },
            { id: "b", name: "B", icon: "dot", scale: 1, color: "#ffffff", pinStyle: null, label: { fontSize: 1 } },
        ],
    };
}

test("a map without pin styles gets the default tier set once; a map with the key keeps its own, even emptied", () => {
    const app = studio();
    assert.equal(PinStyles.ensure(app), true);
    const styles = app.uiState.customPinStyles;
    assert.equal(styles.length, FILRODENSWMB.PINS.DEFAULT_STYLES.length);
    assert.equal(styles[0].name, "FILRODENSWMB.UI.PinStyleCapital", "names are localised when the set is made");
    assert.equal(styles[0].icon, "circle_outline_with_star");
    assert.equal(styles[0].detailLevel, 0);
    assert.equal(new Set(styles.map((style) => style.id)).size, styles.length, "every style has its own id");
    assert.equal(PinStyles.ensure(app), false, "made once");

    app.uiState.customPinStyles = [];
    assert.equal(PinStyles.ensure(app), false, "an emptied set stays empty");
});

test("a style writes its icon, scale, colour and label onto a pin, taking the label quick style's look with the style's own size over it", () => {
    const app = studio();
    PinStyles.ensure(app);
    const town = app.uiState.customPinStyles.find((style) => style.name === "FILRODENSWMB.UI.PinStyleTown");
    town.label.quickStyle = "serif";
    town.label.visibility = "gm";
    town.color = "#ff0000";

    const fields = PinStyles.fields(app, town);
    assert.deepEqual(fields, { icon: "dot", scale: 0.6, color: "#ff0000", label: { quickStyle: "serif", fontFamily: "Georgia", fillColor: "#112233", maxChars: 12, justify: "center", fontSize: 0.6, visibility: "gm" } });

    const pin = app.mapPins[0];
    PinStyles.apply(app, pin, town);
    assert.equal(pin.pinStyle, town.id);
    assert.equal(pin.color, "#ff0000");
    assert.equal(pin.label.fontFamily, "Georgia");
    assert.equal(pin.label.rotation, 15, "the pin's other label fields are kept");

    const plain = app.uiState.customPinStyles.find((style) => style.name === "FILRODENSWMB.UI.PinStyleVillage");
    assert.deepEqual(PinStyles.fields(app, plain).label, { quickStyle: "custom", fontSize: 0.5, visibility: "all" }, "no label quick style: size and visibility alone");
});

test("editing a style cascades to the pins that use it, deleting one lets them go, and usage is counted", () => {
    const app = studio();
    PinStyles.ensure(app);
    const city = app.uiState.customPinStyles.find((style) => style.name === "FILRODENSWMB.UI.PinStyleCity");
    PinStyles.apply(app, app.mapPins[0], city);
    assert.equal(config.getUsageCount(app, city.id), 1);

    config.onCascade(app, city.id, { ...city, icon: "castle", scale: 2.5, label: { ...city.label, fontSize: 2.2 } });
    assert.equal(app.mapPins[0].icon, "castle");
    assert.equal(app.mapPins[0].scale, 2.5);
    assert.equal(app.mapPins[0].label.fontSize, 2.2);
    assert.equal(app.mapPins[1].icon, "dot", "a pin without the style is untouched");

    config.onDisconnect(app, city.id);
    assert.equal(app.mapPins[0].pinStyle, null);
    assert.equal(app.mapPins[0].icon, "castle", "it keeps the look it had");
    assert.equal(config.getUsageCount(app, city.id), 0);
});

test("the quick style dialogue reads a style's fields from its form, and the defaults come from the toolbar", () => {
    const app = studio();
    app.uiState.activeIcon = "anchor";
    app.uiState.pinScale = 1.5;
    app.uiState.pinColor = "#00ff00";
    const defaults = config.getDefaults(app);
    assert.equal(defaults.icon, "anchor");
    assert.equal(defaults.scale, 1.5);
    assert.equal(defaults.color, "#00ff00");
    assert.equal(defaults.label.fontSize, 1.5);

    const form = { elements: { styleName: { value: "  Harbour " }, styleIcon: { value: "anchor" }, styleScale: { value: "1.2" }, styleColor: { value: "#123456" }, styleLabelSize: { value: "0.9" }, styleLabelVisibility: { value: "gm" }, styleLabelQuickStyle: { value: "serif" }, styleDetailLevel: { value: "1" } } };
    assert.deepEqual(config.onExtract(form, "Fallback"), { name: "Harbour", icon: "anchor", scale: 1.2, color: "#123456", label: { fontSize: 0.9, visibility: "gm", quickStyle: "serif" }, detailLevel: 1 });
    form.elements.styleName.value = "";
    assert.equal(config.onExtract(form, "Fallback").name, "Fallback");
});

test("the toolbar's choice of style fills its icon, colour and scale; no style leaves them alone", () => {
    const app = studio();
    PinStyles.ensure(app);
    const capital = app.uiState.customPinStyles[0];
    app.uiState.activePinStyle = capital.id;
    PinStyles.readIntoToolbar(app, PinStyles.active(app));
    assert.equal(app.uiState.activeIcon, "circle_outline_with_star");
    assert.equal(app.uiState.pinScale, 1);

    app.uiState.activePinStyle = "custom";
    assert.equal(PinStyles.active(app), null);
    PinStyles.readIntoToolbar(app, PinStyles.active(app));
    assert.equal(app.uiState.activeIcon, "circle_outline_with_star", "nothing changes for no style");

    const choices = PinStyles.choices(app, capital.id);
    assert.equal(choices.length, FILRODENSWMB.PINS.DEFAULT_STYLES.length);
    assert.equal(choices.filter((choice) => choice.selected).length, 1);
    assert.deepEqual(choices.map((choice) => choice.name), [...choices.map((choice) => choice.name)].sort((a, b) => a.localeCompare(b)), "offered by name");
});
