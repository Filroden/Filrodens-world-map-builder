// The studio's dialogues (Overlay and the dialogue service built on it), in a DOM provided by
// happy-dom: what each kind resolves with, the form its callbacks read, the keys it keeps to
// itself, and what happens when the studio goes away with a dialogue open. Focus moving with Tab
// needs a real layout and is checked in a browser by the studio smoke check.
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/" });
for (const name of Object.getOwnPropertyNames(window)) {
    if (/^[A-Z]/.test(name) && !(name in globalThis)) globalThis[name] = window[name];
}
Object.assign(globalThis, { window, document: window.document });
after(() => window.happyDOM.close());

const { Overlay } = await import("../../src/ui/Overlay.js");
const { createOverlayDialogs } = await import("../../src/ui/dialogs.js");

const dialogs = createOverlayDialogs({ localize: (key) => key.replace("FILRODENSWMB.UI.", "") });

let host;
let detach;

beforeEach(() => {
    document.body.innerHTML = '<div class="fwmb"><div class="fwmb-studio"><button id="before">Before</button></div></div>';
    host = document.querySelector(".fwmb-studio");
    detach = dialogs.attach(host);
});

afterEach(() => detach());

const dialog = () => host.querySelector("dialog.fwmb-overlay");
const button = (action) => dialog().querySelector(`.fwmb-overlay-footer [data-overlay-action="${action}"]`);
const key = (target, name, options = {}) => {
    const event = new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...options });
    target.dispatchEvent(event);
    return event;
};

test("confirm resolves true for Yes and false for No, with No first and the default", async () => {
    const yes = dialogs.confirm({ title: "Delete?", content: "<p>Sure?</p>" });
    assert.equal(dialog().querySelector("h2").textContent, "Delete?");
    assert.deepEqual([...dialog().querySelectorAll(".fwmb-overlay-footer button")].map((b) => b.textContent), ["No", "Yes"]);
    assert.ok(button("no").classList.contains("primary"));
    assert.equal(document.activeElement, button("no"), "with no fields, focus starts on the default button");
    button("yes").click();
    assert.equal(await yes, true);
    assert.equal(dialog(), null, "the dialogue is removed once answered");

    const no = dialogs.confirm({ title: "Delete?", content: "" });
    button("no").click();
    assert.equal(await no, false);
});

test("buttons carry their tone: confirm and prompt's are negative then positive, choose's as given", async () => {
    const tones = () => [...dialog().querySelectorAll(".fwmb-overlay-footer button")].map((b) => b.dataset.tone ?? null);
    const confirmed = dialogs.confirm({ title: "A", content: "" });
    assert.deepEqual(tones(), ["negative", "positive"]);
    key(dialog(), "Escape");
    await confirmed;

    const prompted = dialogs.prompt({ title: "B", content: "" });
    assert.deepEqual(tones(), ["negative", "positive"]);
    key(dialog(), "Escape");
    await prompted;

    const chosen = dialogs.choose({
        title: "C",
        content: "",
        buttons: [
            { action: "discard", label: "Discard", tone: "negative" },
            { action: "cancel", label: "Cancel", tone: "caution" },
            { action: "plain", label: "Plain" },
        ],
    });
    assert.deepEqual(tones(), ["negative", "caution", null], "a button without a tone keeps the accent colour");
    key(dialog(), "Escape");
    await chosen;
});

test("a modal dialogue has a scrim, removed with it; a docked one has none", async () => {
    const modal = dialogs.confirm({ title: "A", content: "" });
    assert.ok(dialog().classList.contains("fwmb-overlay-modal"));
    assert.ok(dialog().open, "opened with show()");
    assert.equal(host.querySelectorAll(".fwmb-overlay-scrim").length, 1);
    key(dialog(), "Escape");
    assert.equal(await modal, false, "a dismissed confirm counts as No");
    assert.equal(host.querySelector(".fwmb-overlay-scrim"), null);

    const docked = dialogs.prompt({ title: "B", content: "", placement: "docked" });
    assert.ok(dialog().classList.contains("fwmb-overlay-docked"));
    assert.equal(host.querySelector(".fwmb-overlay-scrim"), null);
    dialog().querySelector(".fwmb-overlay-close").click();
    assert.equal(await docked, null);
});

test("prompt reads its result from the form, runs onRender with the element and focuses the first field", async () => {
    let rendered = null;
    const result = dialogs.prompt({
        title: "Rename",
        content: '<label>Name</label><input type="text" name="name" value="Harbour">',
        classes: ["fwmb", "fwmb-test-dialog"],
        icon: "fwmb-icon tune",
        onRender: (element) => (rendered = element),
        onSubmit: (form) => form.elements.name.value,
    });
    assert.equal(rendered, dialog());
    assert.ok(dialog().classList.contains("fwmb-test-dialog"));
    assert.ok(dialog().querySelector(".fwmb-overlay-header i.fwmb-icon.tune"));
    assert.deepEqual([...dialog().querySelectorAll(".fwmb-overlay-footer button")].map((b) => b.textContent), ["Cancel", "Confirm"]);
    const input = dialog().querySelector('input[name="name"]');
    assert.equal(document.activeElement, input);
    input.value = "Port";
    button("ok").click();
    assert.equal(await result, "Port");
});

test("prompt's Cancel resolves null without reading the form", async () => {
    let read = false;
    const result = dialogs.prompt({ title: "T", content: '<input type="text" name="a">', onSubmit: () => (read = true) });
    button("cancel").click();
    assert.equal(await result, null);
    assert.equal(read, false);
});

test("Enter in a text field confirms; Enter elsewhere does not", async () => {
    const result = dialogs.prompt({ title: "T", content: '<input type="text" name="a" value="1"><input type="checkbox" name="b">', onSubmit: (form) => form.elements.a.value });
    key(dialog().querySelector('[name="b"]'), "Enter");
    assert.ok(dialog(), "Enter on a checkbox leaves the dialogue open");
    key(dialog().querySelector('[name="a"]'), "Enter");
    assert.equal(await result, "1");
});

test("choose resolves with a callback's result, the action without one, or `dismissed`", async () => {
    const buttons = [
        { action: "apply", label: "Apply", default: true },
        { action: "keep", label: "Keep", callback: (form) => form.elements.dismissUpgrade.checked },
    ];
    const content = '<input type="checkbox" name="dismissUpgrade" checked>';

    const pressed = dialogs.choose({ title: "Update?", content, buttons, dismissed: "cancel" });
    button("apply").click();
    assert.equal(await pressed, "apply");

    const read = dialogs.choose({ title: "Update?", content, buttons, dismissed: "cancel" });
    button("keep").click();
    assert.equal(await read, true);

    const dismissed = dialogs.choose({ title: "Update?", content, buttons, dismissed: "cancel" });
    key(dialog(), "Escape");
    assert.equal(await dismissed, "cancel");
});

test("keys pressed in a dialogue go no further than the dialogue", async () => {
    const reached = [];
    const listener = (event) => reached.push(event.key);
    host.addEventListener("keydown", listener);
    window.addEventListener("keydown", listener);

    const result = dialogs.prompt({ title: "T", content: '<input type="text" name="a">' });
    const input = dialog().querySelector("input");
    key(input, "z", { ctrlKey: true });
    const tab = key(input, "Tab");
    assert.ok(tab.defaultPrevented, "the dialogue moves focus itself");
    key(input, "Escape");
    assert.equal(await result, null);
    assert.deepEqual(reached, []);

    host.removeEventListener("keydown", listener);
    window.removeEventListener("keydown", listener);
});

test("focus returns to where it was when the dialogue closes", async () => {
    const before = host.querySelector("#before");
    before.focus();
    const result = dialogs.confirm({ title: "T", content: "" });
    assert.notEqual(document.activeElement, before);
    button("yes").click();
    await result;
    assert.equal(document.activeElement, before);
});

test("sliders in the content show their value when the dialogue opens", async () => {
    const result = dialogs.prompt({ title: "T", content: '<input type="range" name="s" min="0" max="10" value="5"><output></output>' });
    const slider = dialog().querySelector("input");
    assert.equal(slider.style.getPropertyValue("--fwmb-range-fill"), "50%");
    key(slider, "Escape");
    await result;
});

test("a slider returns to the value it opened with, unless it has a default of its own", async () => {
    const result = dialogs.prompt({
        title: "Style",
        content: '<input type="range" name="size" min="0" max="10" value="7"><input type="range" name="rotation" min="-180" max="180" value="45" data-default="0">',
    });
    const [size, rotation] = dialog().querySelectorAll('input[type="range"]');
    assert.equal(size.dataset.default, "7", "the opening value");
    assert.equal(rotation.dataset.default, "0", "its own default is kept");
    key(dialog(), "Escape");
    await result;
});

test("detaching the studio dismisses the dialogues still open in it", async () => {
    const first = dialogs.choose({ title: "A", content: "", buttons: [{ action: "x", label: "X" }], dismissed: "gone" });
    const second = dialogs.confirm({ title: "B", content: "" });
    assert.equal(host.querySelectorAll("dialog").length, 2);
    detach();
    assert.equal(await first, "gone");
    assert.equal(await second, false);
    assert.equal(host.querySelectorAll("dialog, .fwmb-overlay-scrim").length, 0);
    await assert.rejects(dialogs.confirm({ title: "C", content: "" }), /none is attached/);
});

test("dialogues open in the element attached most recently", async () => {
    const other = document.createElement("div");
    document.body.append(other);
    const detachOther = dialogs.attach(other);
    const result = dialogs.confirm({ title: "T", content: "" });
    assert.ok(other.querySelector("dialog"));
    detachOther();
    assert.equal(await result, false);
    assert.equal(Overlay.dismissAll(host), undefined);
});
