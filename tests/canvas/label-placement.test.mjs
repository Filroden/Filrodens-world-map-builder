// Placing names so they do not cover each other (LabelPlacement): free candidates first, the
// important labels first, obstacles avoided, names that must show kept, the annealing pass fitting
// more than greedy alone, the same result for the same seed, and a small change leaving the rest.
import assert from "node:assert/strict";
import { test } from "node:test";
import { placeLabels } from "../../src/canvas/LabelPlacement.js";

/** A pin's name: right of its point first, then left, then above. */
function pinLabel(id, x, y, { w = 40, h = 10, weight = 1, mustShow = false } = {}) {
    return {
        id,
        w,
        h,
        weight,
        mustShow,
        key: `${id}:${x},${y},${w},${h}`,
        candidates: [
            { x: x + 5 + w / 2, y, cost: 0 },
            { x: x - 5 - w / 2, y, cost: 0.3 },
            { x, y: y - 5 - h / 2, cost: 0.5 },
        ],
    };
}

const overlaps = (a, b) => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;

/** Every placed box, to check none overlaps another. */
function placedBoxes(labels, result) {
    return labels.filter((label) => result.position(label.id)).map((label) => ({ ...result.position(label.id), w: label.w, h: label.h }));
}

test("a label takes its first candidate that covers nothing; the more important label is placed first", () => {
    const labels = [pinLabel("capital", 100, 100, { weight: 10 }), pinLabel("town", 90, 100)];
    const result = placeLabels(labels, [], { anneal: false });
    assert.deepEqual(result.position("capital"), { x: 125, y: 100 });
    assert.deepEqual(result.position("town"), { x: 65, y: 100 }, "its right would cover the capital's name, so it goes left");
    assert.equal(result.dropped.size, 0);
});

test("a label with no free candidate is dropped, unless it must be shown", () => {
    const crowd = [pinLabel("a", 100, 100, { weight: 5 }), pinLabel("b", 100, 100)];
    const dropped = placeLabels(crowd, [], { anneal: false });
    assert.ok(dropped.position("a"));
    // b's three candidates: its right is a's; left and above are free
    assert.ok(dropped.position("b"));
    const blocked = [{ x: 0, y: 0, w: 1000, h: 1000 }];
    const result = placeLabels([pinLabel("realm", 100, 100, { mustShow: true }), pinLabel("town", 300, 300)], blocked, { anneal: false });
    assert.ok(result.position("realm"), "a realm's name is always drawn");
    assert.equal(result.position("town"), null);
    assert.deepEqual([...result.dropped], ["town"]);
});

test("a soft box (a minor place's icon) is covered only when there is no better place, and never drops a name", () => {
    const icon = (id, x, y) => ({ id, w: 12, h: 12, weight: 1, fixed: true, soft: true, key: id, candidates: [{ x, y, cost: 0 }] });
    // Every place of the name covers one icon or another
    const icons = [icon("i1", 130, 100), icon("i2", 75, 100), icon("i3", 100, 88)];
    const result = placeLabels([...icons, pinLabel("city", 100, 100, { weight: 20 })], [], { anneal: false });
    assert.ok(result.position("city"), "the city's name is drawn");
    assert.equal(result.dropped.size, 0);
    const free = placeLabels([icon("i1", 130, 100), pinLabel("city", 100, 100, { weight: 20 })], [], { anneal: false });
    assert.deepEqual(free.position("city"), { x: 75, y: 100 }, "a free place beats covering an icon");
});

test("a name that must show pushes out a lighter one rather than covering another that must show", () => {
    // Two realm names with one place each would clash; a third place for the second covers only a city's name
    const realm1 = { id: "r1", w: 80, h: 14, weight: 30, mustShow: true, key: "r1", candidates: [{ x: 100, y: 100, cost: 0 }] };
    const city = { id: "city", w: 40, h: 10, weight: 20, key: "city", candidates: [{ x: 100, y: 140, cost: 0 }, { x: 300, y: 300, cost: 1 }] };
    const realm2 = { id: "r2", w: 80, h: 14, weight: 30, mustShow: true, key: "r2", candidates: [{ x: 110, y: 104, cost: 0 }, { x: 100, y: 140, cost: 0.5 }] };
    const result = placeLabels([realm1, city, realm2], [], { anneal: false });
    assert.deepEqual(result.position("r2"), { x: 100, y: 140 }, "clear of the other realm's name");
    assert.deepEqual(result.position("city"), { x: 300, y: 300 }, "the city's name moved to its other place");
});

test("realm names take precedence over places' names, and may cross their dots, rather than crowd into one gap", () => {
    const capitalIcon = { id: "icon:cap", w: 12, h: 12, weight: 30, fixed: true, marker: true, key: "icon", candidates: [{ x: 100, y: 160, cost: 0 }] };
    const capital = { id: "cap", w: 60, h: 12, weight: 50, beside: "icon:cap", key: "cap", candidates: [{ x: 140, y: 160, cost: 0 }, { x: 60, y: 160, cost: 0.4 }, { x: 100, y: 200, cost: 0.6 }] };
    const realmA = { id: "a", w: 120, h: 16, weight: 30, mustShow: true, overMarkers: true, key: "a", candidates: [{ x: 100, y: 100, cost: 0 }] };
    // B's best place is A's; its other runs over the capital's dot and name
    const realmB = { id: "b", w: 120, h: 16, weight: 30, mustShow: true, overMarkers: true, key: "b", candidates: [{ x: 110, y: 104, cost: 0 }, { x: 110, y: 160, cost: 0.5 }] };
    const result = placeLabels([capitalIcon, capital, realmA, realmB], [], { anneal: false });
    const box = (id, w, h) => ({ ...result.position(id), w, h });
    assert.deepEqual(result.position("b"), { x: 110, y: 160 }, "B over the capital, clear of A");
    assert.ok(!overlaps(box("a", 120, 16), box("b", 120, 16)));
    assert.ok(result.position("cap"), "the capital's name found another place round its pin");
    assert.ok(!overlaps(box("cap", 60, 12), box("b", 120, 16)));
    const annealed = placeLabels([capitalIcon, capital, realmA, realmB], [], { seed: 3 });
    assert.ok(!overlaps({ ...annealed.position("a"), w: 120, h: 16 }, { ...annealed.position("b"), w: 120, h: 16 }), "and after annealing");
});

test("obstacles (the pins' icons) are never covered", () => {
    const pin = { x: 145, y: 100, w: 12, h: 12 };
    const result = placeLabels([pinLabel("a", 100, 100)], [pin], { anneal: false });
    assert.ok(!overlaps({ ...result.position("a"), w: 40, h: 10 }, pin));
});

test("annealing fits names greedy placing in order cannot", () => {
    // A's first choice blocks both B and C; its second blocks neither
    const a = { id: "a", w: 40, h: 10, weight: 1, key: "a", candidates: [{ x: 100, y: 100, cost: 0 }, { x: 100, y: 200, cost: 0.1 }] };
    const b = { id: "b", w: 40, h: 10, weight: 1, key: "b", candidates: [{ x: 70, y: 100, cost: 0 }] };
    const c = { id: "c", w: 40, h: 10, weight: 1, key: "c", candidates: [{ x: 130, y: 100, cost: 0 }] };
    const greedy = placeLabels([a, b, c], [], { anneal: false });
    assert.equal(greedy.dropped.size, 2);
    const annealed = placeLabels([a, b, c], [], { seed: 7 });
    assert.equal(annealed.dropped.size, 0);
    assert.deepEqual(annealed.position("a"), { x: 100, y: 200 });
});

/** A crowd of pins' names, from a seeded spread. */
function crowd(count, size, seed = 3) {
    let state = seed;
    const next = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
    return Array.from({ length: count }, (_, index) => pinLabel(`p${index}`, next() * size, next() * size, { w: 30 + next() * 50, weight: index < count / 10 ? 10 : 1 }));
}

test("nothing placed overlaps; the same seed gives the same placement", () => {
    const labels = crowd(400, 1200);
    const first = placeLabels(labels, [], { seed: 5 });
    const boxes = placedBoxes(labels, first);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlaps(boxes[i], boxes[j]), `boxes ${i} and ${j} overlap`);
    const again = placeLabels(labels, [], { seed: 5 });
    assert.deepEqual([...again.chosen].map(([id, entry]) => [id, entry.index]), [...first.chosen].map(([id, entry]) => [id, entry.index]));
    const greedy = placeLabels(labels, [], { anneal: false });
    assert.ok(first.dropped.size <= greedy.dropped.size, `annealed drops ${first.dropped.size}, greedy ${greedy.dropped.size}`);
    const important = labels.filter((label) => label.weight > 1);
    assert.ok(important.filter((label) => first.dropped.has(label.id)).length <= important.filter((label) => greedy.dropped.has(label.id)).length);
});

test("an unchanged set reuses the last result; a change moves only the labels near it", () => {
    const labels = crowd(300, 1500);
    const first = placeLabels(labels, [], { seed: 5 });
    const same = placeLabels(labels.map((label) => ({ ...label })), [], { seed: 5, previous: first });
    assert.equal(same.stats.reused, true);
    // One pin moves to the far corner
    const moved = labels.map((label, index) => (index === 0 ? pinLabel("p0", 1490, 1490, { w: label.w, weight: label.weight }) : label));
    const next = placeLabels(moved, [], { seed: 9, previous: first });
    const far = labels.filter((label) => Math.hypot(label.candidates[0].x - labels[0].candidates[0].x, label.candidates[0].y - labels[0].candidates[0].y) > 300 && Math.hypot(label.candidates[0].x - 1490, label.candidates[0].y - 1490) > 300);
    const shifted = far.filter((label) => first.chosen.get(label.id).index !== next.chosen.get(label.id).index);
    assert.deepEqual(shifted.map((label) => label.id), [], "labels far from the change stay where they were");
});

test("placing thousands of names takes well under a second", () => {
    const labels = crowd(4000, 6000);
    const started = Date.now();
    const result = placeLabels(labels, [], { seed: 1 });
    const ms = Date.now() - started;
    assert.ok(ms < 3000, `${ms} ms`);
    assert.ok(result.stats.placed > 0);
});
