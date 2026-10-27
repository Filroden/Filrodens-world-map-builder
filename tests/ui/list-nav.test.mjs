// The panel's lists' keys (ListNav): one tab stop per list, Up/Down/Home/End moving without
// opening, Enter opening; the rows' own controls keep their tab stops.
// happy-dom does not lay out the page; the real lists are checked in a browser by the smoke checks.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/" });
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;

const { ListNav } = await import("../../src/ui/ListNav.js");

function list({ selected = null } = {}) {
    document.body.innerHTML = `
        <div role="listbox" data-list-nav>
            ${["a", "b", "c"].map((id) => `
                <div role="option" tabindex="-1" data-list-item data-id="${id}" data-action="editPin" aria-selected="${id === selected}">
                    ${id}
                    <button type="button" data-action="toggleVisibility">eye</button>
                    <div class="fwmb-dropdown"><button type="button">menu</button></div>
                    <button type="button" data-action="deletePin">bin</button>
                </div>`).join("")}
            <button type="button" data-list-item data-action="addPin">Add</button>
        </div>`;
    return document.querySelector("[data-list-nav]");
}

const key = (target, keyName, extra = {}) => {
    const event = new window.KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true, ...extra });
    Object.defineProperty(event, "target", { value: target });
    return ListNav.handleKey(event);
};

test("settle makes the selected row the list's one tab stop among its rows, and leaves the rows' controls in the tab order", () => {
    const root = list({ selected: "b" });
    ListNav.settle(document);
    const stops = ListNav.items(root).filter((item) => item.tabIndex === 0);
    assert.deepEqual(stops.map((item) => item.dataset.id), ["b"]);
    assert.ok([...root.querySelectorAll("[data-list-item] button")].every((control) => control.tabIndex === 0));
});

test("with nothing selected the first row is the tab stop, and a row already marked keeps it", () => {
    const root = list();
    ListNav.settle(document);
    assert.equal(ListNav.items(root).find((item) => item.tabIndex === 0).dataset.id, "a");
    ListNav.moveTo(root, ListNav.items(root)[2]);
    ListNav.settle(document);
    assert.deepEqual(ListNav.items(root).filter((item) => item.tabIndex === 0).map((item) => item.dataset.id), ["c"]);
});

test("Up, Down, Home and End move the tab stop and focus without opening anything", () => {
    const root = list();
    ListNav.settle(document);
    const items = ListNav.items(root);
    let opened = 0;
    for (const item of items) item.addEventListener("click", () => opened++);
    items[0].focus();
    assert.ok(key(items[0], "ArrowDown"));
    assert.equal(document.activeElement, items[1]);
    assert.ok(key(items[1], "End"));
    assert.equal(document.activeElement, items[3], "the add button is the last item");
    assert.ok(key(items[3], "ArrowDown"), "Down on the last item stays put");
    assert.equal(document.activeElement, items[3]);
    assert.ok(key(items[3], "Home"));
    assert.equal(document.activeElement, items[0]);
    assert.ok(key(items[0], "ArrowUp"));
    assert.equal(items.filter((item) => item.tabIndex === 0).length, 1);
    assert.equal(opened, 0);
});

test("Enter opens a row as a click does, and leaves an add button to the browser", () => {
    const root = list();
    const items = ListNav.items(root);
    let clicked = null;
    root.addEventListener("click", (event) => (clicked = event.target));
    assert.ok(key(items[1], "Enter"));
    assert.equal(clicked, items[1]);
    assert.equal(key(items[3], "Enter"), false);
});

test("Delete and the context-menu key are not the list's: the row's controls are reached by Tab", () => {
    const root = list();
    const row = ListNav.items(root)[0];
    let deleted = 0;
    row.querySelector('[data-action="deletePin"]').addEventListener("click", () => deleted++);
    assert.equal(key(row, "Delete"), false);
    assert.equal(key(row, "ContextMenu"), false);
    assert.equal(deleted, 0);
});

test("keys with a modifier, and keys outside a list, are left alone", () => {
    const root = list();
    const row = ListNav.items(root)[0];
    assert.equal(key(row, "ArrowDown", { ctrlKey: true }), false);
    assert.equal(key(row.querySelector("button"), "ArrowDown"), false);
    document.body.innerHTML = `<div data-list-item tabindex="0"></div>`;
    assert.equal(key(document.querySelector("[data-list-item]"), "ArrowDown"), false);
});
