// Where the map's names are drawn (LabelLayout): a pin's name beside it, keeping clear of other
// pins; a capital's name before a realm's, which is fitted round it and always drawn; a label with
// its own position staying there; a region name preferring places that do not spill over its
// border; and every name at its first place with Avoid overlaps off.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { FILRODENSWMB } from "../../src/config.js";
import { LabelLayout, pinCandidates } from "../../src/canvas/LabelLayout.js";
import { labelCandidates } from "../../src/mesh/BorderArcs.js";
import { UNCLAIMED } from "../../src/mesh/Schema.js";
import { smallMesh } from "../mesh/helpers.mjs";

const PIN_WIDTH = 10;
const pinWidth = () => PIN_WIDTH;
const overlaps = (a, b) => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;

function pinItem(id, x, y, tier, w = 60, h = 12) {
    const pin = { id, x, y, icon: "dot", generated: tier ? { tier } : undefined };
    return { id: `pin:${id}`, type: "pin", labelData: {}, w, h, defaultX: x + PIN_WIDTH * FILRODENSWMB.PINS.LABEL_OFFSET, defaultY: y, pin, pinWidth: PIN_WIDTH };
}

/** A mesh with one region, a 200 by 100 band, and a session-like view of it. */
function bandSession() {
    const mesh = smallMesh();
    const owners = new Int32Array(mesh.cellCount).fill(UNCLAIMED);
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        const [x, y] = [mesh.siteX(cell), mesh.siteY(cell)];
        if (x > 100 && x < 300 && y > 100 && y < 200) owners[cell] = 1;
    }
    return { mesh, layer: () => ({ owners }), labelCandidates: () => labelCandidates(mesh, owners, 1) };
}

test("a pin's name starts just past its edge on the right, and its other places surround it", () => {
    const item = pinItem("a", 100, 100);
    const places = pinCandidates(item);
    assert.deepEqual(places[0], { x: 100 + PIN_WIDTH * FILRODENSWMB.PINS.LABEL_OFFSET + 30, y: 100, cost: 0 });
    assert.equal(places.length, FILRODENSWMB.LABELS.PLACEMENT.PIN_CANDIDATES.length);
    const pin = { x: 100, y: 100, w: PIN_WIDTH, h: PIN_WIDTH };
    assert.ok(places.every((place) => !overlaps({ ...place, w: 60, h: 12 }, pin)), "no place covers its own pin");
});

test("names keep clear of each other and of other pins; a label with its own position stays there", () => {
    const layout = new LabelLayout();
    const items = [pinItem("a", 100, 100, "city"), pinItem("b", 140, 100, "town"), { id: "custom:c", type: "custom", labelData: { x: 100, y: 130 }, w: 50, h: 12, defaultX: 100, defaultY: 130 }];
    const pins = items.filter((item) => item.pin).map((item) => item.pin);
    const placed = layout.layout(items, { pins, pinWidth, pass: "normal" });
    const boxes = items.map((item) => placed.position(item) && { ...placed.position(item), w: item.w, h: item.h }).filter(Boolean);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlaps(boxes[i], boxes[j]));
    for (const box of boxes) for (const pin of pins) assert.ok(!overlaps(box, { x: pin.x, y: pin.y, w: PIN_WIDTH, h: PIN_WIDTH }));
    assert.deepEqual(placed.position(items[2]), { x: 100, y: 130 });
});

test("a capital is placed before a realm's name, which is fitted round it and always drawn", () => {
    const session = bandSession();
    const layout = new LabelLayout();
    const [anchor] = session.labelCandidates();
    const capital = pinItem("capital", anchor.x - 40, anchor.y, "capital", 80, 14);
    const realm = { id: "region:r", type: "region", labelData: {}, w: 90, h: 16, defaultX: anchor.x, defaultY: anchor.y, region: { levelId: "realms", key: 1, depth: 0 } };
    const placed = layout.layout([realm, capital], { pins: [capital.pin], pinWidth, meshSession: session, pass: "normal" });
    assert.deepEqual(placed.position(capital), { x: pinCandidates(capital)[0].x, y: anchor.y }, "the capital keeps its first place");
    const realmBox = { ...placed.position(realm), w: realm.w, h: realm.h };
    assert.ok(realmBox.x !== undefined, "the realm's name is drawn");
    assert.ok(!overlaps(realmBox, { ...placed.position(capital), w: capital.w, h: capital.h }), "clear of the capital's name");
    assert.equal(placed.dropped.size, 0);
});

test("a region name prefers a place inside its region, but may spill when it must", () => {
    const session = bandSession();
    const layout = new LabelLayout();
    const fits = { id: "region:r", type: "region", labelData: {}, w: 80, h: 14, defaultX: 0, defaultY: 0, region: { levelId: "realms", key: 1, depth: 0 } };
    const position = layout.layout([fits], { pins: [], pinWidth, meshSession: session, pass: "normal" }).position(fits);
    assert.ok(position.x - 40 > 100 && position.x + 40 < 300 && position.y - 7 > 100 && position.y + 7 < 200, "inside the band");
    const wide = { ...fits, id: "region:wide", w: 260 };
    assert.ok(new LabelLayout().layout([wide], { pins: [], pinWidth, meshSession: session, pass: "normal" }).position(wide), "a name wider than its region is still drawn");
});

test("with Avoid overlaps off every name is at its first place, overlapping or not", () => {
    const items = [pinItem("a", 100, 100, "city"), pinItem("b", 100, 100, "town")];
    const placed = new LabelLayout().layout(items, { pins: items.map((item) => item.pin), pinWidth, pass: "normal", avoid: false });
    assert.deepEqual(placed.position(items[0]), placed.position(items[1]));
    assert.equal(placed.dropped.size, 0);
});
