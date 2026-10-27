// The option menus on list items (src/ui/dropdowns.js): a menu opens below its button unless there
// is too little room below and more above, within its list (without popovers) or the studio (as a
// popover, drawn above every list). Layout is stood in for with fixed boxes, since
// happy-dom does not lay out the page; the real layout is checked in a browser by the smoke checks.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/" });
after(() => window.happyDOM.close());
const document = window.document;

const { placeDropdownMenu, positionPopoverMenu } = await import("../../src/ui/dropdowns.js");

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

/** A studio from 0 to 600 (and 0 to 400 across) holding a dropdown whose button spans `top` to `top + 30` at x 300 to 330, with a 120 by 100 menu. */
function studioWithDropdownAt(top) {
    document.body.innerHTML = '<div class="fwmb-studio"><div class="fwmb-dropdown" tabindex="0"><button>⋮</button><div class="fwmb-dropdown-menu"></div></div></div>';
    document.querySelector(".fwmb-studio").getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 400, width: 400, height: 600 });
    const dropdown = document.querySelector(".fwmb-dropdown");
    dropdown.getBoundingClientRect = () => ({ top, bottom: top + 30, left: 300, right: 330, width: 30, height: 30 });
    const menu = dropdown.querySelector(".fwmb-dropdown-menu");
    menu.getBoundingClientRect = () => ({ top: 0, bottom: 120, left: 0, right: 100, width: 100, height: 120 });
    return { dropdown, menu };
}

test("a popover menu sits below its button, its end edge with the button's", () => {
    const { dropdown, menu } = studioWithDropdownAt(100);
    positionPopoverMenu(dropdown, menu);
    const gap = Number.parseFloat(menu.style.top) - 130;
    assert.ok(gap > 0 && gap < 10, `just below the button (${menu.style.top})`);
    assert.equal(menu.style.left, "230px");
});

test("a popover menu near the foot of the studio opens above its button, and stays inside the studio", () => {
    const { dropdown, menu } = studioWithDropdownAt(520);
    positionPopoverMenu(dropdown, menu);
    assert.ok(Number.parseFloat(menu.style.top) + 120 < 520, menu.style.top);
    dropdown.getBoundingClientRect = () => ({ top: 10, bottom: 40, left: 0, right: 30, width: 30, height: 30 });
    positionPopoverMenu(dropdown, menu);
    assert.equal(menu.style.left, "0px", "kept inside the studio's left edge");
});
