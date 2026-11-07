// Where the map's names are drawn (LabelLayout): a pin's name beside it, keeping clear of other
// pins; a capital's name before a realm's, which is fitted round it and always drawn; a label with
// its own position staying there; a region name preferring places that do not spill over its
// border; every name at its first place with Avoid overlaps off; names clear of a map border;
// natural features' names placed with the others, inside their features (a river's on any
// stretch of its course, turned to follow it) and clear of decorations, unless the reader moved
// them; and named routes ranked above the smallest places.
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

test("names keep clear of a border's band along the map's edges", async () => {
    const { nameInset } = await import("../../src/canvas/MapBorder.js");
    assert.equal(nameInset({ cartographyBorderEnable: false, cartographyBorderStyle: "double" }), 0, "no border, no band");
    const inset = nameInset({ cartographyBorderEnable: true, cartographyBorderStyle: "double" });
    assert.ok(inset > nameInset({ cartographyBorderEnable: true, cartographyBorderStyle: "solid" }), "a double border's band is deeper than a solid one's");

    // A pin by the left edge: its name goes to its right, inside the band
    const layout = new LabelLayout();
    const pin = pinItem("edge", inset - 2, 100, "town");
    const bounds = { width: 400, height: 300, inset };
    const placed = layout.layout([pin], { pins: [pin.pin], pinWidth, pass: "normal", bounds });
    const at = placed.position(pin);
    assert.ok(at.x - pin.w / 2 >= inset, `the name is clear of the band: ${at.x - pin.w / 2} against ${inset}`);

    // A pin just below the band: its name, which would reach into it beside the pin, goes below
    const top = pinItem("top", 200, inset + 2, "town");
    const none = new LabelLayout().layout([top], { pins: [top.pin], pinWidth, pass: "normal", bounds: { ...bounds, inset: 0 } });
    const banded = new LabelLayout().layout([top], { pins: [top.pin], pinWidth, pass: "normal", bounds });
    assert.ok(none.position(top).y - top.h / 2 < inset, "without a border it sits beside the pin, reaching into the band");
    assert.ok(banded.position(top).y - top.h / 2 >= inset, "with one, clear of the band");

    // A pin beyond the map's left edge: its name keeps off the map, on the pin's far side
    const beyond = pinItem("beyond", -8, 150, "town");
    const outside = new LabelLayout().layout([beyond], { pins: [beyond.pin], pinWidth, pass: "normal", bounds });
    assert.ok(outside.position(beyond).x + beyond.w / 2 <= 0, `off the map: ${outside.position(beyond).x + beyond.w / 2}`);
});

/** A natural feature's label as Name natural features makes it: placed at x, y, with its footprint. */
function featureItem(id, kind, x, y, w = 120, h = 24, runs = null) {
    const labelData = { id, name: "Grey Sea", x, y, rotation: 0, fontSize: 3, quickStyle: "label-style-ocean-sea" };
    labelData.feature = { kind, cell: 8, runs: runs ?? [Math.floor(y / 8) - 10, Math.floor(x / 8) - 20, 40], x, y, rotation: 0, fontSize: 3, text: "Grey Sea", style: "label-style-ocean-sea" };
    return { id: `custom:${id}`, type: "custom", labelData, w, h, defaultX: x, defaultY: y };
}

test("a feature's name moves off a decoration, while one the reader moved stays; decorations are obstacles for every name", () => {
    const layout = new LabelLayout();
    const sea = featureItem("sea", "sea", 200, 200);
    const rose = { x: 200, y: 200, w: 100, h: 20 };
    let placed = layout.layout([sea], { pins: [], pinWidth, pass: "a", obstacles: [rose] });
    const at = placed.position(sea);
    assert.ok(at && !overlaps({ ...at, w: sea.w, h: sea.h }, rose), "the sea's name is moved clear of the rose");
    assert.ok(Math.abs(at.y - 200) <= sea.h * 1.2 + 1, "to a place beside its own");

    const moved = featureItem("moved", "sea", 200, 200);
    moved.labelData.x = 210;
    placed = new LabelLayout().layout([moved], { pins: [], pinWidth, pass: "b", obstacles: [rose] });
    assert.deepEqual(placed.position(moved), { x: 210, y: 200 }, "a label the reader moved stays where they put it");

    const town = pinItem("t", 200, 300, "town");
    const plate = { x: town.defaultX + 30, y: 300, w: 80, h: 30 };
    placed = new LabelLayout().layout([town], { pins: [town.pin], pinWidth, pass: "c", obstacles: [plate] });
    const name = placed.position(town);
    assert.ok(!name || !overlaps({ ...name, w: town.w, h: town.h }, plate), "a town's name goes round the cartouche, not over it");
});

test("a feature's name prefers places inside its feature, and ranks by its kind", () => {
    const layout = new LabelLayout();
    // A lake reaching only below the fitted place (rows from y = 200): the name moves down into it
    const rows = [];
    for (let row = 25; row < 35; row++) rows.push(row, 10, 30);
    const lake = featureItem("lake", "lake", 200, 200, 60, 12, rows);
    const at = layout.layout([lake], { pins: [], pinWidth, pass: "d" }).position(lake);
    assert.ok(at.y > 200 && at.x === 200, `moved down into its lake (${JSON.stringify(at)})`);
    const { FEATURES } = FILRODENSWMB.LABELS.PLACEMENT;
    assert.ok(FEATURES.ocean.order <= FILRODENSWMB.LABELS.PLACEMENT.REGION_DEPTHS[0].order && FEATURES.bay.order > FILRODENSWMB.LABELS.PLACEMENT.ROUTE.order);
});

test("a named route ranks above the smallest places and below towns; a generated route's own name with the other routes", () => {
    const { PIN_TIERS, NAMED_ROUTE } = FILRODENSWMB.LABELS.PLACEMENT;
    assert.ok(NAMED_ROUTE.weight < PIN_TIERS.town.weight && NAMED_ROUTE.weight > PIN_TIERS.village.weight && NAMED_ROUTE.order <= PIN_TIERS.village.order);
    const routeItem = (route) => ({ id: `route:${route.id}`, type: "route", labelData: {}, w: 60, h: 12, defaultX: 100, defaultY: 100, route });
    // Two routes' names wanting the same place: the reader's own wins it
    const mine = routeItem({ id: "mine", name: "King's Road" });
    const made = routeItem({ id: "made", name: "Old Way", generated: { edited: false }, nameSource: "random" });
    const placed = new LabelLayout().layout([made, mine], { pins: [], pinWidth, pass: "e" });
    assert.deepEqual(placed.position(mine), { x: 100, y: 100 });
    assert.equal(placed.position(made), null);
    const typed = routeItem({ id: "typed", name: "Salt Road", generated: { edited: true } });
    const placedAgain = new LabelLayout().layout([made, typed], { pins: [], pinWidth, pass: "f" });
    assert.deepEqual(placedAgain.position(typed), { x: 100, y: 100 }, "an edited generated route's name is the reader's");
});

test("a river's name moves along its course at its own turn, off a decoration, and stays on the river", () => {
    // A river running down to the south east at 30 degrees, its name fitted half way
    const angle = 30;
    const [dx, dy] = [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)];
    const path = Array.from({ length: 40 }, (_, i) => ({ x: Math.round(100 + i * 20 * dx), y: Math.round(100 + i * 20 * dy) }));
    const [fx, fy] = [100 + 400 * dx, 100 + 400 * dy];
    const labelData = { id: "river", name: "River Wend", x: fx, y: fy, rotation: angle, fontSize: 1.3, quickStyle: "label-style-river" };
    labelData.feature = { kind: "river", path, x: fx, y: fy, rotation: angle, fontSize: 1.3, text: "River Wend", style: "label-style-river" };
    // Its box when turned, and its text's own length
    const item = { id: "custom:river", type: "custom", labelData, w: 100 * dx + 12 * dy, h: 100 * dy + 12 * dx, length: 100, defaultX: fx, defaultY: fy };
    const plate = { x: fx, y: fy, w: 160, h: 120 };
    const at = new LabelLayout().layout([item], { pins: [], pinWidth, pass: "river", obstacles: [plate] }).position(item);
    assert.ok(at && !overlaps({ ...at, w: item.w, h: item.h }, plate), `moved clear of the cartouche (${JSON.stringify(at)})`);
    assert.ok(Math.hypot(at.x - fx, at.y - fy) > 100, "along its course, beyond the nudges an area's name has");
    const nearest = Math.min(...path.map((point) => Math.hypot(point.x - at.x, point.y - at.y)));
    assert.ok(nearest < 2, "on the river itself");
    assert.ok(Math.abs(at.rotation - angle) < 1, "turned as the river runs");
});

test("a river's name on another stretch of a bending river is turned to follow that stretch", () => {
    // Running east, then turning south: the name fitted on the eastward stretch, which a cartouche covers
    const path = [...Array.from({ length: 20 }, (_, i) => ({ x: 100 + i * 20, y: 100 })), ...Array.from({ length: 20 }, (_, i) => ({ x: 480, y: 120 + i * 20 }))];
    const labelData = { id: "river", name: "River Bend", x: 290, y: 100, rotation: 0, fontSize: 1.3, quickStyle: "label-style-river" };
    labelData.feature = { kind: "river", path, x: 290, y: 100, rotation: 0, fontSize: 1.3, text: "River Bend", style: "label-style-river" };
    const item = { id: "custom:river", type: "custom", labelData, w: 100, h: 12, length: 100, thickness: 12, defaultX: 290, defaultY: 100 };
    const plate = { x: 290, y: 100, w: 400, h: 60 };
    const at = new LabelLayout().layout([item], { pins: [], pinWidth, pass: "bend", obstacles: [plate] }).position(item);
    assert.ok(at, "placed");
    assert.ok(Math.abs(at.x - 480) < 2 && at.y > 160, `on the southward stretch (${JSON.stringify(at)})`);
    assert.equal(at.rotation, 75, "turned as far as names turn, to run down the river");
    // Its box is the turned name's, so it keeps clear of the cartouche
    assert.ok(!overlaps({ x: at.x, y: at.y, w: 100 * Math.cos((75 * Math.PI) / 180) + 12 * Math.sin((75 * Math.PI) / 180), h: 100 * Math.sin((75 * Math.PI) / 180) + 12 * Math.cos((75 * Math.PI) / 180) }, plate));
});
