// Lists put in order by their rows' grab handles (ListReorder), and the land masks list it serves:
// Up and Down on a handle move its row one place, never past either end, and keys anywhere else
// are left alone; the New map panel lists the land masks in their own order, not by name, each
// with a handle once there are two, and the Land masks list's template carries the marks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/" });
Object.assign(globalThis, { window, document: window.document, CSS: window.CSS ?? { escape: (text) => text } });
after(() => window.happyDOM.close());
const { ListReorder } = await import("../../src/ui/ListReorder.js");

function list(ids) {
    document.body.innerHTML = `<div data-reorder="landMasks">${ids.map((id) => `<div data-reorder-item data-id="${id}"><button data-reorder-handle></button></div>`).join("")}</div>`;
    return [...document.querySelectorAll("[data-reorder-handle]")];
}
const key = (target, name, extra = {}) => ({ key: name, target, altKey: false, ctrlKey: false, metaKey: false, ...extra });

test("Up and Down on a handle move its row one place, never past the ends; other keys and targets are left alone", () => {
    const moves = [];
    const onMove = (...move) => moves.push(move);
    const handles = list(["a", "b", "c"]);
    assert.equal(ListReorder.handleKey(key(handles[1], "ArrowUp"), onMove), true);
    assert.equal(ListReorder.handleKey(key(handles[1], "ArrowDown"), onMove), true);
    assert.deepEqual(moves, [
        ["landMasks", "b", 0],
        ["landMasks", "b", 2],
    ]);
    assert.equal(ListReorder.handleKey(key(handles[0], "ArrowUp"), onMove), true, "the first row cannot go higher, but the key is still the handle's");
    assert.equal(ListReorder.handleKey(key(handles[2], "ArrowDown"), onMove), true);
    assert.equal(moves.length, 2);
    assert.equal(ListReorder.handleKey(key(handles[1], "Enter"), onMove), false);
    assert.equal(ListReorder.handleKey(key(handles[1], "ArrowUp", { altKey: true }), onMove), false);
    assert.equal(ListReorder.handleKey(key(document.querySelector("[data-reorder-item]"), "ArrowUp"), onMove), false, "a key on the row itself is the list's (see ListNav)");
});

test("the Land masks list is in the masks' own order, with a handle on each row once there are two", () => {
    const studio = readFileSync(fileURLToPath(new URL("../../src/applications/MapStudio.js", import.meta.url)), "utf8");
    assert.doesNotMatch(studio, /context\.landMasks = \[\.\.\.\(this\.landMasks \|\| \[\]\)\]\.sort/, "not sorted by name");
    const template = readFileSync(fileURLToPath(new URL("../../templates/tools-scene.hbs", import.meta.url)), "utf8");
    assert.match(template, /data-reorder="landMasks"/);
    assert.match(template, /data-reorder-item/);
    assert.match(template, /\{\{#if @root\.landMasksReorderable\}\}<button[^>]*data-reorder-handle/);
});
