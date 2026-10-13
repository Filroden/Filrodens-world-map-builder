// The option menus on list items (src/ui/dropdowns.js): a menu opens below its button unless the
// list has too little room below and more above. Layout is stood in for with fixed boxes, since
// happy-dom does not lay out the page; the real layout is checked in a browser by the smoke checks.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/" });
after(() => window.happyDOM.close());
const document = window.document;

const { placeDropdownMenu } = await import("../../src/ui/dropdowns.js");

/** A scrolling list from 0 to 300 holding a dropdown whose button spans `top` to `top + 30` and whose menu is 120 tall. */
function listWithDropdownAt(top) {
    document.body.innerHTML = '<div class="list" style="overflow-y: auto"><div class="fwmb-dropdown" tabindex="0"><button>⋮</button><div class="fwmb-dropdown-menu"></div></div></div>';
    const box = (y, height) => () => ({ top: y, bottom: y + height, left: 0, right: 100, width: 100, height });
    document.querySelector(".list").getBoundingClientRect = box(0, 300);
    document.querySelector(".fwmb-dropdown").getBoundingClientRect = box(top, 30);
    document.querySelector(".fwmb-dropdown-menu").getBoundingClientRect = box(top + 38, 120);
    return document.querySelector(".fwmb-dropdown");
}

test("a menu with room below opens below its button", () => {
    const dropdown = listWithDropdownAt(20);
    placeDropdownMenu(dropdown.querySelector("button"));
    assert.equal(dropdown.classList.contains("fwmb-dropdown-up"), false);
});

test("a menu near the foot of the list opens above its button", () => {
    const dropdown = listWithDropdownAt(240);
    placeDropdownMenu(dropdown.querySelector("button"));
    assert.equal(dropdown.classList.contains("fwmb-dropdown-up"), true);
});

test("a menu that fits nowhere opens on the side with more room, and focus elsewhere is ignored", () => {
    const dropdown = listWithDropdownAt(100);
    dropdown.getBoundingClientRect = () => ({ top: 100, bottom: 130, left: 0, right: 100, width: 100, height: 30 });
    dropdown.querySelector(".fwmb-dropdown-menu").getBoundingClientRect = () => ({ top: 138, bottom: 538, left: 0, right: 100, width: 100, height: 400 });
    placeDropdownMenu(dropdown);
    assert.equal(dropdown.classList.contains("fwmb-dropdown-up"), false, "170 below beats 100 above");
    assert.doesNotThrow(() => placeDropdownMenu(document.body));
});
