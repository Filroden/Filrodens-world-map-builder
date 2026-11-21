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

const { Overlay } = await import("../../src/shell/Overlay.js");
const { createOverlayDialogs } = await import("../../src/shell/dialogs.js");

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

const labels = () => [...dialog().querySelectorAll(".fwmb-overlay-footer button")].map((b) => b.textContent);
const parts = () => [...dialog().querySelector(".fwmb-overlay-footer").children].map((child) => child.dataset.overlayAction ?? child.className);

test("confirm names its action: Cancel first and the default, the action at the end, resolving true", async () => {
    const yes = dialogs.confirm({ title: "Delete?", content: "<p>Sure?</p>", confirmLabel: "Delete" });
    assert.equal(dialog().querySelector("h2").textContent, "Delete?");
    assert.deepEqual(labels(), ["Cancel", "Delete"]);
    assert.deepEqual(parts(), ["cancel", "fwmb-start fwmb-hint", "fwmb-overlay-gap", "confirm"], "board N1: the way out at the start");
    assert.equal(document.activeElement, button("cancel"), "with no fields, focus starts on Cancel, so Enter never confirms");
    assert.ok(!button("cancel").classList.contains("fwmb-btn--primary"), "the way out is never the primary");
    button("confirm").click();
    assert.equal(await yes, true);
    assert.equal(dialog(), null, "the dialogue is removed once answered");

    const no = dialogs.confirm({ title: "Delete?", content: "" });
    assert.deepEqual(labels(), ["Cancel", "Confirm"], "Confirm when no action is named");
    button("cancel").click();
    assert.equal(await no, false);
});

test("a destructive confirmation's action is negative; any other is the primary", async () => {
    const tones = () => [...dialog().querySelectorAll(".fwmb-overlay-footer button")].map((b) => b.dataset.tone ?? null);
    const deleting = dialogs.confirm({ title: "A", content: "", confirmLabel: "Delete" });
    assert.deepEqual(tones(), [null, "negative"]);
    assert.equal(dialog().querySelector(".fwmb-btn--primary"), null);
    key(dialog(), "Escape");
    await deleting;

    const promoting = dialogs.confirm({ title: "B", content: "", confirmLabel: "Clone as new", destructive: false });
    assert.deepEqual(tones(), [null, null]);
    assert.ok(button("confirm").classList.contains("fwmb-btn--primary"));
    assert.equal(document.activeElement, button("cancel"), "focus still opens on Cancel");
    key(dialog(), "Escape");
    await promoting;

    const prompted = dialogs.prompt({ title: "C", content: "", confirmLabel: "Rename" });
    assert.deepEqual(tones(), [null, null], "a prompt's buttons have no tone");
    assert.deepEqual(labels(), ["Cancel", "Rename"]);
    assert.ok(button("ok").classList.contains("fwmb-btn--primary"));
    assert.equal(button("cancel").querySelector("i"), null, "the way out has no icon");
    key(dialog(), "Escape");
    await prompted;
});

test("choose's footer is board N1's: tones only on a lone destructive action, one primary, a lone Close at the end", async () => {
    const tones = () => [...dialog().querySelectorAll(".fwmb-overlay-footer button")].map((b) => b.dataset.tone ?? null);
    const three = dialogs.choose({
        title: "Close the world first",
        content: "",
        buttons: [
            { action: "cancel", label: "Cancel", default: true },
            { action: "discard", label: "Discard changes", tone: "negative" },
            { action: "save", label: "Save and close", tone: "positive", primary: true },
        ],
        dismissed: "cancel",
    });
    assert.deepEqual(parts(), ["cancel", "fwmb-start fwmb-hint", "fwmb-overlay-gap", "discard", "save"]);
    assert.deepEqual(tones(), [null, null, null], "beside another action, Discard changes is plain");
    assert.deepEqual([...dialog().querySelectorAll(".fwmb-btn--primary")].map((b) => b.dataset.overlayAction), ["save"]);
    assert.equal(document.activeElement, button("cancel"), "the default has the focus");
    key(dialog(), "Escape");
    assert.equal(await three, "cancel");

    const revert = dialogs.choose({ title: "Revert", content: "", buttons: [{ action: "cancel", label: "Cancel", default: true }, { action: "revert", label: "Revert", tone: "negative" }], dismissed: "cancel" });
    assert.deepEqual(tones(), [null, "negative"], "a lone destructive action keeps its tone");
    key(dialog(), "Escape");
    await revert;

    const closing = dialogs.choose({ title: "Shortcuts", content: "", buttons: [{ action: "close", label: "Close", default: true }], dismissed: "closed" });
    assert.deepEqual(parts(), ["fwmb-start fwmb-hint", "fwmb-overlay-gap", "close"], "a lone Close sits at the end");
    assert.ok(button("close").classList.contains("fwmb-btn--primary"));
    button("close").click();
    assert.equal(await closing, "closed", "Close dismisses, as the header's close does");
});

test("a dialogue's own start item (a setting such as Ask each time) goes to the footer after Cancel", async () => {
    const answer = dialogs.choose({
        title: "Generate",
        content: '<p>Body</p><label class="fwmb-start"><input type="checkbox" name="askEachTime" checked> Ask each time</label>',
        buttons: [
            { action: "cancel", label: "Cancel", callback: () => null },
            { action: "generate", label: "Generate", default: true, callback: (form) => (form.closest("dialog") ?? form).querySelector('input[name="askEachTime"]').checked },
        ],
        dismissed: null,
    });
    assert.deepEqual(parts(), ["cancel", "fwmb-start", "fwmb-overlay-gap", "generate"]);
    assert.equal(dialog().querySelector(".fwmb-overlay-body .fwmb-start"), null);
    button("generate").click();
    assert.equal(await answer, true, "the setting is still read from the dialogue");
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
        icon: "fwmb-icon fwmb-icon--tune",
        onRender: (element) => (rendered = element),
        onSubmit: (form) => form.elements.name.value,
    });
    assert.equal(rendered, dialog());
    assert.ok(dialog().classList.contains("fwmb-test-dialog"));
    assert.ok(dialog().querySelector(".fwmb-overlay-header i.fwmb-icon.fwmb-icon--tune"));
    assert.deepEqual(labels(), ["Cancel", "Confirm"]);
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
    button("confirm").click();
    await result;
    assert.equal(document.activeElement, before);
});

test("sliders in the content show their value when the dialogue opens", async () => {
    const result = dialogs.prompt({ title: "T", content: '<input type="range" name="s" min="0" max="10" value="5"><output></output>' });
    const slider = dialog().querySelector("input");
    assert.equal(slider.style.getPropertyValue("--fwmb-range-percent"), "50%");
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

test("show() returns a dialogue its caller drives: a split footer, a button that stays open, a start line", async () => {
    let pressed = 0;
    const overlay = dialogs.show({
        title: "Export image",
        content: "<p>Body</p>",
        footer: "split",
        footerStart: "Drawn in 4 tiles and joined",
        dismissed: false,
        buttons: [
            { action: "export", label: "Export image", default: true, stays: true, callback: (_form, shown) => { pressed++; assert.equal(shown, overlay); } },
            { action: "cancel", label: "Cancel", start: true, callback: () => false },
        ],
    });
    const footer = dialog().querySelector(".fwmb-overlay-footer");
    assert.ok(footer.classList.contains("fwmb-overlay-footer--split"));
    assert.deepEqual([...footer.children].map((child) => child.dataset.overlayAction ?? child.className), ["cancel", "fwmb-start fwmb-hint", "fwmb-overlay-gap", "export"], "Cancel, the start line, the gap, then the rest");
    assert.equal(footer.querySelector(".fwmb-start").textContent, "Drawn in 4 tiles and joined");
    assert.equal(overlay.button("export"), button("export"));
    button("export").click();
    assert.equal(pressed, 1);
    assert.ok(dialog(), "a button that stays leaves the dialogue open");
    overlay.button("export").disabled = true;
    button("export").click();
    key(dialog().querySelector(".fwmb-overlay-body"), "Enter");
    assert.equal(pressed, 1, "a disabled button is not pressed, nor by Enter");
    overlay.setFooterStart("");
    assert.ok(footer.querySelector(".fwmb-start").hidden);
    overlay.close(true);
    assert.equal(await overlay.closed, true, "the caller closes it with a value");
    assert.equal(dialog(), null);
});
