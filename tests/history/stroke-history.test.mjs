// The one owner of a map's stroke history rewrites (src/studios/world/tools/StrokeHistory.js): the
// cut's translation, a v4.3 regional map's inherited strokes recovered from its parent, and the
// count kept right when the history is rewritten (moving the noise frame).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { StrokeHistory } from "../../src/studios/world/tools/StrokeHistory.js";
import { ParentRunRecovery } from "../../src/studios/world/app/ParentRunRecovery.js";
import { NoiseTransform } from "../../src/studios/world/app/NoiseTransform.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`../data/fixtures/${name}`, import.meta.url), "utf8"));
// Eldoria is a regional map cut from Aethoria, and every one of its strokes is Aethoria's
const parent = fixture("fwmb_aethoria.json");
const child = fixture("fwmb_eldoria.json");
const size = { width: child.mapWidth, height: child.mapHeight };
const frame = ParentRunRecovery.frame(parent, { world: child.world, mapWidth: child.mapWidth, mapHeight: child.mapHeight });

test("a regional map's inherited strokes are recovered from its parent", () => {
    assert.ok(frame, "the two maps' places give the crop");
    assert.equal(StrokeHistory.inheritedCount(child.history, parent.history, frame, size), child.history.length);
});

test("strokes painted on the regional map after the cut are its own", () => {
    const own = { ...structuredClone(child.history[0]), points: [{ x: 5, y: 5 }] };
    const history = [...child.history, own, ...child.history.slice(0, 1)];
    assert.equal(StrokeHistory.inheritedCount(history, parent.history, frame, size), child.history.length);
});

test("strokes the parent painted after the cut are passed over", () => {
    const later = { ...structuredClone(parent.history[0]), points: [{ x: 1, y: 1 }] };
    assert.equal(StrokeHistory.inheritedCount(child.history, [later, ...parent.history], frame, size), child.history.length);
});

test("without the parent or its place, nothing is inherited", () => {
    assert.equal(StrokeHistory.inheritedCount(child.history, parent.history, null, size), 0);
    assert.equal(StrokeHistory.inheritedCount(child.history, [], frame, size), 0);
    assert.equal(StrokeHistory.inheritedCount(child.history, undefined, frame, size), 0);
});

test("a stroke moved by more than half a pixel is not the parent's", () => {
    const moved = structuredClone(child.history);
    moved[0].points[0].x += 1;
    assert.equal(StrokeHistory.inheritedCount(moved, parent.history, frame, size), 0);
});

test("the translation keeps only the strokes the crop shows, and leaves the parent's alone", () => {
    const before = JSON.stringify(parent.history);
    const translated = StrokeHistory.translate(parent.history, frame.crop, frame.zoomScale, size.width, size.height);
    assert.ok(translated.length < parent.history.length);
    assert.equal(JSON.stringify(parent.history), before);
});

/** A studio stand-in: its brush engine's history and redo stack, and the noise frame's fields. */
const studio = (history, inheritedStrokes) => ({
    brushEngine: { history: structuredClone(history), redoStack: [], invalidateLayerCache() {} },
    uiState: { "noise.offsetX": 0, "noise.offsetY": 0, "noise.elevation.scale": 1 },
    inheritedStrokes,
});

test("moving the noise frame keeps the count, and moving it back keeps the parent's strokes", () => {
    const app = studio(child.history, child.history.length);
    NoiseTransform.apply(app, { offsetX: 40, offsetY: -25, scale: 1.25 });
    assert.equal(app.inheritedStrokes, child.history.length);
    NoiseTransform.apply(app, { offsetX: 0, offsetY: 0, scale: 1 });
    assert.equal(app.inheritedStrokes, child.history.length);
    assert.equal(StrokeHistory.inheritedCount(app.brushEngine.history, parent.history, frame, size), child.history.length);
});

test("a rewrite that removes an inherited stroke lowers the count by one; one of the map's own among them ends it", () => {
    const app = studio(child.history, 5);
    StrokeHistory.rewrite(app, () => app.brushEngine.history.splice(2, 1));
    assert.equal(app.inheritedStrokes, 4);
    StrokeHistory.rewrite(app, () => app.brushEngine.history.splice(0, 1));
    assert.equal(app.inheritedStrokes, 3);
    StrokeHistory.rewrite(app, () => app.brushEngine.history.push({ points: [] }));
    assert.equal(app.inheritedStrokes, 3);
    StrokeHistory.rewrite(app, () => app.brushEngine.history.splice(1, 0, { points: [] }));
    assert.equal(app.inheritedStrokes, 1);
    // Reordered: only the run still in the parent's order counts
    const swapped = studio(child.history, 3);
    StrokeHistory.rewrite(swapped, () => {
        const [a, b] = swapped.brushEngine.history;
        swapped.brushEngine.history[0] = b;
        swapped.brushEngine.history[1] = a;
    });
    assert.equal(swapped.inheritedStrokes, 1);
});

test("a rewrite on a map that is not held leaves it without a count", () => {
    const plain = studio(child.history, undefined);
    StrokeHistory.rewrite(plain, () => plain.brushEngine.history.reverse());
    assert.equal(plain.inheritedStrokes, undefined);
});

test("Undo stops at a held regional world's inherited strokes (S0 step 5), Redo brings back what it took", async () => {
    const { BrushEngine } = await import("../../src/studios/world/tools/BrushEngine.js");
    const engine = new BrushEngine(8, 8);
    const stroke = (id) => ({ id, type: "terrain", tool: "raise", points: [{ x: 1, y: 1 }], size: 2, strength: 0.1, feather: 0.5 });
    engine.history = [stroke("p1"), stroke("p2"), stroke("own1")];
    engine.undoFloor = 2;
    assert.ok(engine.canUndo());
    assert.equal(engine.undo(), true, "the map's own stroke goes");
    assert.equal(engine.canUndo(), false);
    assert.equal(engine.undo(), false, "the parent's are kept");
    assert.deepEqual(engine.history.map((each) => each.id), ["p1", "p2"]);
    assert.equal(engine.redo(), true);
    engine.undoFloor = 0;
    assert.equal(engine.undo(), true, "with no floor (a world of its own) every stroke can go");
});
