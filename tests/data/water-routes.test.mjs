// The water route styles' new look on maps saved before it (src/data/WaterRouteStyles.js): styles
// and routes still on the old default colour and line take the new ones, once; anything given a
// look of its own is left alone.
import assert from "node:assert/strict";
import { test } from "node:test";

const { refreshWaterRoutesOnce } = await import("../../src/data/WaterRouteStyles.js");

function savedMap() {
    return {
        customRouteStyles: [
            { id: "route-style-sea-lane", color: "#2E5F8A", thickness: 2, style: "dashed" },
            { id: "route-style-minor-sea-lane", color: "#5f89ad", thickness: 1, style: "dashed" },
            { id: "route-style-river-trade", color: "#ff0000", thickness: 1.5, style: "solid" },
            { id: "route-style-minor-river-trade", color: "#6a9fcc", thickness: 1, style: "dotted" },
            { id: "route-style-main-road", color: "#8a5a2b", thickness: 2, style: "solid" },
        ],
        mapRoutes: [
            { id: "sea", quickStyle: "route-style-sea-lane", color: "#2e5f8a", thickness: 2, style: "dashed" },
            { id: "sea-own", quickStyle: "route-style-sea-lane", color: "#123456", thickness: 2, style: "dashed" },
            { id: "minor", quickStyle: "route-style-minor-sea-lane", color: "#5f89ad", thickness: 1, style: "dashed" },
            { id: "river", quickStyle: "route-style-river-trade", color: "#3d7fb8", thickness: 1.5, style: "solid" },
        ],
    };
}

test("water route styles and routes still on the old defaults take the new look, once", () => {
    const map = savedMap();
    assert.equal(refreshWaterRoutesOnce(map), true);
    const styles = Object.fromEntries(map.customRouteStyles.map((style) => [style.id, [style.color, style.style, style.thickness]]));
    assert.deepEqual(styles["route-style-sea-lane"], ["#8db2cc", "dashed", 2], "colour taken, thickness kept");
    assert.deepEqual(styles["route-style-minor-sea-lane"], ["#8db2cc", "dotted", 1]);
    assert.deepEqual(styles["route-style-river-trade"], ["#ff0000", "solid", 1.5], "a style given its own colour stays");
    assert.deepEqual(styles["route-style-minor-river-trade"], ["#6a9fcc", "dotted", 1], "a style given its own line stays");
    assert.deepEqual(styles["route-style-main-road"], ["#8a5a2b", "solid", 2]);
    const routes = Object.fromEntries(map.mapRoutes.map((route) => [route.id, [route.color, route.style]]));
    assert.deepEqual(routes.sea, ["#8db2cc", "dashed"]);
    assert.deepEqual(routes["sea-own"], ["#123456", "dashed"], "a route with a look of its own stays");
    assert.deepEqual(routes.minor, ["#8db2cc", "dotted"]);
    assert.deepEqual(routes.river, ["#3d7fb8", "solid"], "its style kept its own look, so it stays");
    assert.equal(map.waterRoutes, true);
    assert.equal(refreshWaterRoutesOnce(map), false, "once");
    const current = { ...savedMap(), waterRoutes: true };
    refreshWaterRoutesOnce(current);
    assert.equal(current.customRouteStyles[0].color, "#2E5F8A", "a map saved since is left alone");
});
