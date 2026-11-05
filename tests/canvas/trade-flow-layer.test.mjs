// The trade layer (TradeFlowLayer) with a stand-in for PIXI: while the trade is shown the routes
// beneath are drawn fainter, hand-placed and generated alike (trade follows only the generated
// routes, so a hand-placed route would otherwise be the one road with nothing over it), and back
// at full strength once it is hidden.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FILRODENSWMB } from "../../src/config.js";
import { TradeFlowLayer } from "../../src/canvas/TradeFlowLayer.js";

class Graphics {
    visible = true;
    clear() {}
    lineStyle() {}
    moveTo() {}
    lineTo() {}
    destroy() {}
}
const pixi = { Graphics, LINE_CAP: { ROUND: "round" }, LINE_JOIN: { ROUND: "round" } };
const container = { addChild() {} };
const line = { points: [0, 0, 10, 10], kind: 0, cls: 0, value: 1 };

test("the routes are drawn fainter while the trade is shown, and at full strength once it is hidden", () => {
    const routes = { alpha: 1 };
    const layer = new TradeFlowLayer(pixi, container, routes);
    layer.show([line], 1);
    assert.equal(routes.alpha, FILRODENSWMB.THEMATIC.TRADE.ROUTE_ALPHA);
    assert.ok(FILRODENSWMB.THEMATIC.TRADE.ROUTE_ALPHA < 1);
    layer.show(null, 1);
    assert.equal(routes.alpha, 1);
});

test("the same lines shown again keep the routes faint without drawing the lines again", () => {
    const routes = { alpha: 1 };
    const layer = new TradeFlowLayer(pixi, container, routes);
    const lines = [line];
    layer.show(lines, 1);
    routes.alpha = 1;
    layer.show(lines, 1);
    assert.equal(routes.alpha, FILRODENSWMB.THEMATIC.TRADE.ROUTE_ALPHA);
});
