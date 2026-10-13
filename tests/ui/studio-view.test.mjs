// StudioView: drawing regions from templates, redrawing them in place, and routing data-action
// clicks, in a DOM provided by happy-dom (no browser needed). The browser-only behaviour (focus
// and typing in a real page, the PIXI canvas) is covered by the thin-frame prototype's checks.
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/" });
// The page's globals as a browser has them (idiomorph checks nodes against Element, Document,
// HTMLInputElement and others): every DOM class happy-dom provides that Node lacks, plus the
// window and its document
for (const name of Object.getOwnPropertyNames(window)) {
    if (/^[A-Z]/.test(name) && !(name in globalThis)) globalThis[name] = window[name];
}
Object.assign(globalThis, { window, document: window.document, customElements: window.customElements });
after(() => window.happyDOM.close());

const { StudioView } = await import("../../src/ui/StudioView.js");

/** Templates as plain functions of their context, standing in for Handlebars. */
const TEMPLATES = {
    toolbar: (c) => `<div><button type="button" data-action="pick" data-tool="a" class="${c.tool === "a" ? "active" : ""}"><i class="icon ${c.tool}"></i></button><input type="checkbox" data-action="tick"></div>`,
    panel: (c) => `<form class="${c.locked ? "locked" : ""}"><input type="text" name="title" value="${c.title}"><input type="range" name="size" min="0" max="10" value="${c.size}"><output></output>${c.extra ?? ""}</form>`,
    map: () => `<div class="container"><div class="preview" data-morph-ignore></div></div>`,
    edit: (c) => `<div class="${c.editing ? "" : "hidden"}">edit</div>`,
};

let root;
let state;
let calls;

function makeView(overrides = {}) {
    calls = { templates: 0, after: [] };
    return new StudioView({
        root,
        regions: {
            toolbar: { template: "toolbar", classes: ["fwmb-toolbar"] },
            panel: { template: "panel", classes: ["fwmb-context-panel"] },
            map: { template: "map", classes: ["fwmb-map"], once: true },
            edit: { template: "edit", classes: ["fwmb-edit-toolbar"], slot: ".container" },
        },
        renderTemplate: async (name, context) => {
            calls.templates++;
            return TEMPLATES[name](context);
        },
        buildContext: () => ({ ...state }),
        actions: {
            pick(_event, target) {
                this.picked = target.dataset.tool;
            },
            tick(event) {
                this.ticked = event.target.checked;
            },
        },
        controller: state.controller,
        afterRender: (regions) => calls.after.push(regions),
        ...overrides,
    });
}

beforeEach(() => {
    document.body.innerHTML = `<div class="fwmb-studio"><div data-region="toolbar"></div><div data-region="panel"></div><div data-region="map"></div></div>`;
    root = document.querySelector(".fwmb-studio");
    state = { tool: "a", locked: false, title: "Harbour", size: 3, editing: true, controller: {} };
});

test("each region's template root becomes the region, with the region's classes, in order", async () => {
    const view = makeView();
    await view.render();
    const regions = [...root.children].map((child) => `${child.localName}.${[...child.classList].join(".")}`);
    assert.deepEqual(regions, ["div.fwmb-toolbar", "form.fwmb-context-panel", "div.container.fwmb-map"]);
    assert.ok(root.querySelector(".container > .fwmb-edit-toolbar:first-child"), "the edit toolbar is drawn first inside its slot");
    assert.deepEqual(calls.after, [["toolbar", "panel", "map", "edit"]]);
});

test("a redraw updates elements in place, keeping them and their region classes", async () => {
    const view = makeView();
    await view.render();
    const form = root.querySelector("form");
    const field = root.querySelector('input[name="title"]');

    state.locked = true;
    state.title = "Port Arthur";
    await view.render(["panel"]);

    assert.equal(root.querySelector("form"), form, "the region element is the same element");
    assert.equal(root.querySelector('input[name="title"]'), field, "the field is the same element");
    assert.ok(form.classList.contains("fwmb-context-panel") && form.classList.contains("locked"));
    assert.equal(field.value, "Port Arthur");
});

test("the focused field keeps what is being typed into it", async () => {
    const view = makeView();
    await view.render();
    const field = root.querySelector('input[name="title"]');
    field.focus();
    field.value = "Half-typ";

    state.title = "Harbour";
    await view.render(["panel"]);
    assert.equal(field.value, "Half-typ");
});

test("a focused button still has its icon redrawn", async () => {
    const view = makeView();
    await view.render();
    const button = root.querySelector('[data-action="pick"]');
    button.focus();
    state.tool = "b";
    await view.render(["toolbar"]);
    assert.equal(root.querySelector('[data-action="pick"] i').className, "icon b");
    assert.equal(document.activeElement, button, "focus is kept");
});

test("calls in one task are merged into one redraw of each region asked for", async () => {
    const view = makeView();
    await view.render();
    calls.templates = 0;
    calls.after = [];

    await Promise.all([view.render(["panel"]), view.render(["toolbar", "panel"]), view.render(["toolbar"])]);
    assert.equal(calls.templates, 2);
    assert.deepEqual(calls.after, [["toolbar", "panel"]]);
});

test("a region drawn once is never redrawn, and ignored elements are left alone", async () => {
    const view = makeView();
    await view.render();
    const preview = root.querySelector(".preview");
    preview.append(document.createElement("canvas"));

    await view.render();
    assert.equal(root.querySelector(".preview"), preview);
    assert.ok(preview.querySelector("canvas"), "the canvas added to the map survives");
    assert.ok(!calls.after.at(-1).includes("map"));
});

test("a custom element keeps the children it built, and takes a new value through its property", async () => {
    class FakePicker extends window.HTMLElement {
        connectedCallback() {
            if (!this.querySelector("input")) this.append(document.createElement("input"));
            this.querySelector("input").value = this.getAttribute("value") ?? "";
        }
        get value() {
            return this.querySelector("input")?.value ?? "";
        }
        set value(text) {
            this.querySelector("input").value = text;
        }
    }
    window.customElements.define("fake-picker", FakePicker);

    state.extra = `<fake-picker name="image" value="a.png"></fake-picker>`;
    const view = makeView();
    await view.render();
    const picker = root.querySelector("fake-picker");
    assert.equal(picker.value, "a.png");

    state.extra = `<fake-picker name="image" value=""></fake-picker>`;
    await view.render(["panel"]);
    assert.equal(root.querySelector("fake-picker"), picker);
    assert.ok(picker.querySelector("input"), "its own input survives the redraw");
    assert.equal(picker.value, "");
    assert.equal(picker.getAttribute("value"), "");
});

test("clicks on data-action elements call the handler with the controller as this", async () => {
    const view = makeView();
    await view.render();
    root.querySelector('[data-action="pick"]').click();
    assert.equal(state.controller.picked, "a");
});

test("a data-action checkbox still ticks: the click's own behaviour is not cancelled", async () => {
    const view = makeView();
    await view.render();
    const box = root.querySelector('[data-action="tick"]');
    box.click();
    assert.equal(box.checked, true);
    assert.equal(state.controller.ticked, true);
});

test("sliders get their value display and fill after a redraw and as they move", async () => {
    const view = makeView();
    await view.render();
    const slider = root.querySelector('input[type="range"]');
    assert.equal(slider.style.getPropertyValue("--fwmb-range-fill"), "30%");

    slider.value = "7";
    slider.dispatchEvent(new window.Event("input", { bubbles: true }));
    assert.equal(slider.style.getPropertyValue("--fwmb-range-fill"), "70%");
});

test("after destroy, clicks are ignored and render does nothing", async () => {
    const view = makeView();
    await view.render();
    view.destroy();
    root.querySelector('[data-action="pick"]').click();
    assert.equal(state.controller.picked, undefined);
    await view.render();
});

test("a region whose template draws more than one root element is refused", async () => {
    const view = makeView({ renderTemplate: async () => "<div></div><div></div>" });
    await assert.rejects(view.render(["toolbar"]), /exactly one root element/);
});
