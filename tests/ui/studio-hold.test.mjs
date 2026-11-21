// The studio held while an export draws (StudioHold, S0 step 7b), in a DOM provided by happy-dom:
// what waits and what stays free, the tooltip, a press going nowhere, the action dispatcher
// refusing, controls drawn afresh while held, and everything put back as it was afterwards.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/" });
for (const name of Object.getOwnPropertyNames(window)) {
    if (/^[A-Z]/.test(name) && !(name in globalThis)) globalThis[name] = window[name];
}
Object.assign(globalThis, { window, document: window.document });
after(() => window.happyDOM.close());

const { StudioHold } = await import("../../src/shell/StudioHold.js");
const { StudioView } = await import("../../src/shell/StudioView.js");

const REASON = "An export is drawing";

function studio() {
    document.body.innerHTML = `<div class="fwmb-studio">
        <nav><button id="tool" data-action="changeTool">Terrain</button><button id="zoom" data-action="zoomIn">+</button></nav>
        <aside class="fwmb-context-panel">
            <input id="seed" name="seed" value="A">
            <select id="already" disabled><option>x</option></select>
            <button id="gen" data-action="generateWorld" data-tooltip="Generate the map">Generate</button>
            <button id="menu" aria-disabled="false">Menu</button>
            <details id="section"><summary id="summary">Section</summary></details>
        </aside>
        <dialog class="fwmb-overlay fwmb-overlay-modal" open><button id="inside">Cancel</button></dialog>
        <dialog class="fwmb-overlay fwmb-overlay-docked" open><button id="close" data-overlay-action="close">x</button><input id="field"></dialog>
        <div data-fwmb-hold-free><button id="toast">Cancel</button></div>
    </div>`;
    return document.querySelector(".fwmb-studio");
}
const $ = (id) => document.getElementById(id);

test("held, what changes the map waits with the reason; viewing, the export's own dialogue and the toast stay free", () => {
    const root = studio();
    const hold = new StudioHold(root);
    hold.set({ reason: REASON, allowed: ["zoomIn"] });
    assert.ok(root.hasAttribute("data-fwmb-exporting"));
    assert.equal($("tool").getAttribute("aria-disabled"), "true");
    assert.equal($("tool").dataset.tooltip, REASON);
    assert.equal($("gen").dataset.tooltip, REASON, "a tooltip of its own is replaced while held");
    assert.equal($("seed").disabled, true, "a field is disabled");
    assert.equal($("field").disabled, true, "the inspector's fields too");
    assert.equal($("menu").getAttribute("aria-disabled"), "true");
    assert.equal($("zoom").hasAttribute("aria-disabled"), false, "an allowed action stays free");
    assert.equal($("inside").hasAttribute("aria-disabled"), false, "the export's dialogue stays free");
    assert.equal($("close").hasAttribute("aria-disabled"), false, "a dialogue's close stays free");
    assert.equal($("toast").hasAttribute("aria-disabled"), false, "the toast stays free");
    assert.equal($("summary").hasAttribute("aria-disabled"), false, "sections still open");
    assert.ok(hold.refuses("generateWorld") && !hold.refuses("zoomIn"));

    hold.set(null);
    assert.ok(!root.hasAttribute("data-fwmb-exporting"));
    assert.equal($("tool").hasAttribute("aria-disabled"), false);
    assert.equal($("tool").dataset.tooltip, undefined);
    assert.equal($("gen").dataset.tooltip, "Generate the map", "its own tooltip back");
    assert.equal($("seed").disabled, false);
    assert.equal($("already").disabled, true, "a field disabled before stays disabled");
    assert.equal($("menu").getAttribute("aria-disabled"), "false", "an aria-disabled as it was");
    assert.equal(root.querySelectorAll("[data-fwmb-held]").length, 0);
    assert.ok(!hold.refuses("generateWorld"));
    hold.destroy();
});

test("a press on a control that waits never reaches its own listeners; Enter on it neither", () => {
    const root = studio();
    const hold = new StudioHold(root);
    let heard = 0;
    $("menu").addEventListener("click", () => heard++);
    $("menu").addEventListener("keydown", () => heard++);
    hold.set({ reason: REASON });
    $("menu").click();
    $("menu").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    assert.equal(heard, 0);
    $("menu").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    assert.equal(heard, 1, "Tab goes on");
    hold.set(null);
    $("menu").click();
    assert.equal(heard, 2, "freed");
    hold.destroy();
});

test("a control drawn afresh while held waits too", async () => {
    const root = studio();
    const hold = new StudioHold(root);
    hold.set({ reason: REASON });
    const added = document.createElement("button");
    added.dataset.action = "addRegion";
    root.querySelector(".fwmb-context-panel").append(added);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(added.getAttribute("aria-disabled"), "true");
    // A redraw that puts the field back as drawn (enabled, unmarked)
    $("seed").removeAttribute("data-fwmb-held");
    $("seed").disabled = false;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal($("seed").disabled, true, "held again");
    hold.set(null);
    assert.equal($("seed").disabled, false, "and freed as it was drawn");
    hold.destroy();
});

test("the studio's view refuses a held action, and calls an allowed one", async () => {
    const root = studio();
    const called = [];
    const view = new StudioView({ root, regions: {}, renderTemplate: async () => "", buildContext: () => ({}), actions: { generateWorld: () => called.push("generate"), zoomIn: () => called.push("zoom") }, controller: {} });
    view.hold({ reason: REASON, allowed: ["zoomIn"] });
    assert.ok(view.held);
    $("gen").click();
    $("zoom").click();
    assert.deepEqual(called, ["zoom"]);
    view.hold(null);
    $("gen").click();
    assert.deepEqual(called, ["zoom", "generate"]);
    view.destroy();
});
