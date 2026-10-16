// The Routes tool's pointer input (RouteTool): Draw places waypoints by click or by traced stroke
// with a live preview (the paths are checked against the engine in tests/mesh/route-edits.test.mjs)
// and finishes or abandons the route, Select picks the route under the pointer, Edit moves,
// inserts, removes and splits waypoints and joins routes end to end, and the toolbar's fields
// follow the picked route. Each finished change is one undo step.
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/" });
after(() => window.happyDOM.close());

const { installPlatform, platform } = await import("../../src/platform/index.js");

const notices = [];
const dialogs = { dismissed: [], opened: [] };
let nextId = 0;
installPlatform({
    i18n: { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" },
    notify: { info: (text) => notices.push(text), warn: (text) => notices.push(text), error: (text) => notices.push(text) },
    utils: { ...platform.utils, randomID: () => `n${++nextId}`, deepClone: (value) => structuredClone(value), mergeObject: (target, source) => Object.assign(target, source) },
    templates: { render: async () => "" },
    fonts: { list: () => [] },
    dialogs: {
        confirm: async () => true,
        prompt: async () => null,
        choose: async (options) => {
            dialogs.opened.push(options);
            return null;
        },
        dismiss: (options) => dialogs.dismissed.push(options),
        attach: () => () => {},
    },
});

const { RouteTool } = await import("../../src/applications/RouteTool.js");
const { RouteEditor } = await import("../../src/applications/RouteEditor.js");
const { Inspector } = await import("../../src/applications/Inspector.js");
const { VectorHistory } = await import("../../src/applications/VectorHistory.js");
const { isContiguous, smallSession } = await import("../mesh/helpers.mjs");

beforeEach(() => {
    notices.length = 0;
    dialogs.dismissed.length = 0;
    dialogs.opened.length = 0;
});

/** A studio stand-in in the Infrastructure tool's Route mode, on the small map (water left of x 100), with no routes. */
async function studio() {
    const session = await smallSession([]);
    const overlays = { draft: null, handles: null };
    const app = {
        layerSets: [],
        meshSession: session,
        activeTool: "infrastructure",
        activeRouteId: null,
        activeRegionId: null,
        tectonicFaults: [],
        manualRivers: [],
        landMasks: [],
        mapPins: [],
        mapRoutes: [],
        mapLabels: [],
        mapDecorations: [],
        uiState: {
            isEditMode: true,
            activeInfraMode: "route",
            routeToolMode: "draw",
            routeDetail: 1,
            routeColor: "#ff0000",
            routeThickness: 2,
            routeStyle: "solid",
            routeOutline: true,
            routeSmoothing: false,
            routeMode: "terrain",
            routeTransport: "road",
            activeRouteQuickStyle: "custom",
            customRouteStyles: [{ id: "trade", name: "Trade", color: "#00ff00", thickness: 3.5, style: "dashed", outline: false, smoothing: true }],
            customBiomes: [],
            customLabelStyles: [],
        },
        pinHistory: [],
        pinRedoStack: [],
        globalHistoryLedger: [],
        globalRedoLedger: [],
        root: null,
        rendered: [],
        _repaintVectors() {},
        markDirty() {},
        view: { render: (regions) => app.rendered.push(...regions) },
        canvasEngine: {
            stage: { scale: { x: 1 } },
            app: {},
            routeOverlays: {
                setDraft: (state) => (overlays.draft = state),
                setHandles: (state) => (overlays.handles = state),
            },
        },
    };
    const at = (x, y) => session.cellAt(x, y);
    return { app, session, overlays, at };
}

const press = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };
const withKey = (key) => ({ ...press, [key]: true });
const legsOk = (session, route) => route.legs.every((leg) => isContiguous(session.mesh, leg)) && route.legs.every((leg, k) => leg[0] === route.waypoints[k] && leg.at(-1) === route.waypoints[k + 1]);

/** A click in Draw mode: a press let go where it began. */
const click = (tool, x, y) => {
    tool.down(x, y, press);
    tool.up(x, y, press);
};

/** Places a three-waypoint road by clicks and finishes it with Enter. */
function placeRoad(app, tool) {
    for (const [x, y] of [[150, 50], [250, 150], [350, 250]]) click(tool, x, y);
    RouteTool.handleKey(app, { key: "Enter" });
    return app.mapRoutes.at(-1);
}

test("Draw: a click places a waypoint, the next leg is previewed, and Enter finishes the route as one undo step", async () => {
    const { app, session, overlays, at } = await studio();
    const tool = RouteTool.tool(app);
    click(tool, 150, 50);
    assert.equal(app.mapRoutes.length, 0, "a route is not on the map until it is finished");
    tool.hover(350, 250);
    assert.ok(overlays.draft.preview?.length >= 4, "the leg to the pointer is previewed");
    click(tool, 350, 250);
    assert.ok(overlays.draft.line.length >= 4, "the placed leg is drawn");

    assert.equal(RouteTool.handleKey(app, { key: "Enter" }), true);
    const route = app.mapRoutes[0];
    assert.deepEqual(route.waypoints, [at(150, 50), at(350, 250)]);
    assert.ok(legsOk(session, route));
    assert.ok(route.legs[0].every((cell) => session.aggregates.land[cell] === 1), "a road keeps to land");
    assert.equal(route.color, "#ff0000");
    assert.equal(route.transport, "road");
    assert.equal(route.name, "FILRODENSWMB.UI.NewRouteName");
    assert.equal(app.activeRouteId, route.id, "the finished route is the one being edited");
    assert.equal(app.pinHistory.length, 1);
    assert.equal(overlays.draft, null);
});

test("Backspace or Ctrl+Z takes the last press back (a click, or a whole stroke), Escape abandons the draft, and a one-waypoint route is not kept", async () => {
    const { app, overlays } = await studio();
    const tool = RouteTool.tool(app);
    click(tool, 150, 50);
    click(tool, 250, 150);
    click(tool, 350, 250);
    assert.equal(RouteTool.handleKey(app, { key: "z", ctrlKey: true }), true);
    assert.equal(overlays.handles.points.length, 4, "two waypoints remain");
    tool.down(350, 250, press);
    for (const [x, y] of [[350, 200], [300, 150], [350, 100], [300, 50]]) tool.move(x, y, press);
    tool.up(300, 50, press);
    assert.ok(overlays.handles.points.length > 6, "the stroke added waypoints");
    RouteTool.handleKey(app, { key: "Backspace" });
    assert.equal(overlays.handles.points.length, 4, "one Backspace takes the whole stroke back");
    RouteTool.handleKey(app, { key: "Escape" });
    assert.equal(overlays.draft, null);
    assert.equal(app.mapRoutes.length, 0);

    click(tool, 150, 50);
    RouteTool.handleKey(app, { key: "Enter" });
    assert.equal(app.mapRoutes.length, 0, "one waypoint is no route");
    assert.equal(app.pinHistory.length, 0);
});

test("a sea route cannot start on land, and says so", async () => {
    const { app } = await studio();
    app.uiState.routeTransport = "sea";
    click(RouteTool.tool(app), 200, 150);
    assert.equal(notices.length, 1);
    assert.equal(notices[0], "FILRODENSWMB.UI.WarnRouteUnreachable");
});

test("Select picks the route under the pointer, leaving the bar's settings for the next route; Escape lets go of it", async () => {
    const { app, overlays, at } = await studio();
    const tool = RouteTool.tool(app);
    const route = placeRoad(app, tool);
    route.color = "#123456";
    route.thickness = 0.75;
    RouteTool.select(app, null);
    RouteTool.setMode(app, { dataset: { mode: "select" } });
    assert.equal(app.activeRouteId, null);

    const middle = route.legs[0][Math.floor(route.legs[0].length / 2)];
    tool.down(app.meshSession.mesh.siteX(middle), app.meshSession.mesh.siteY(middle), press);
    assert.equal(app.activeRouteId, route.id);
    assert.notEqual(app.uiState.routeColor, "#123456", "the bar is for the next route; the picked route's own look is its inspector's");
    assert.equal(overlays.handles.points.length, 6, "the picked route's three waypoints show");
    assert.equal(overlays.handles.points[0], app.meshSession.mesh.siteX(at(150, 50)));

    tool.down(50, 280, press);
    assert.equal(app.activeRouteId, null, "a press on nothing lets go of the route");
    RouteTool.select(app, route);
    assert.equal(RouteTool.handleKey(app, { key: "Escape" }), true);
    assert.equal(app.activeRouteId, null);
    assert.equal(overlays.handles, null);
});

test("Edit drags a waypoint to a new cell with its legs found again, as one undo step; a press let go in place is none", async () => {
    const { app, session, at } = await studio();
    const tool = RouteTool.tool(app);
    const route = placeRoad(app, tool);
    RouteTool.setMode(app, { dataset: { mode: "edit" } });
    const steps = app.pinHistory.length;
    const legsBefore = route.legs;

    const [hx, hy] = [session.mesh.siteX(route.waypoints[1]), session.mesh.siteY(route.waypoints[1])];
    tool.down(hx, hy, press);
    tool.up(hx, hy, press);
    assert.equal(app.pinHistory.length, steps, "nothing moved");

    tool.down(hx, hy, press);
    tool.move(250, 60, press);
    tool.up(250, 60, press);
    assert.equal(route.waypoints[1], at(250, 60));
    assert.notEqual(route.legs, legsBefore);
    assert.ok(legsOk(session, route));
    assert.equal(app.pinHistory.length, steps + 1);

    VectorHistory.step(app, true);
    assert.equal(app.mapRoutes[0].waypoints[1], at(250, 150), "undo puts the waypoint back");
});

test("Edit inserts with Shift, removes with Ctrl and splits with Alt, each one undo step", async () => {
    const { app, session, at } = await studio();
    const tool = RouteTool.tool(app);
    const route = placeRoad(app, tool);
    RouteTool.setMode(app, { dataset: { mode: "edit" } });
    const steps = app.pinHistory.length;

    const middle = route.legs[0][Math.floor(route.legs[0].length / 2)];
    const [mx, my] = [session.mesh.siteX(middle), session.mesh.siteY(middle)];
    tool.down(mx, my, withKey("shiftKey"));
    tool.up(mx, my, withKey("shiftKey"));
    assert.equal(route.waypoints.length, 4);
    assert.equal(route.waypoints[1], middle);
    assert.ok(legsOk(session, route));
    assert.equal(app.pinHistory.length, steps + 1);

    tool.down(mx, my, withKey("ctrlKey"));
    assert.equal(route.waypoints.length, 3);
    assert.ok(legsOk(session, route));
    assert.equal(app.pinHistory.length, steps + 2);

    const [sx, sy] = [session.mesh.siteX(route.waypoints[1]), session.mesh.siteY(route.waypoints[1])];
    tool.down(sx, sy, withKey("altKey"));
    assert.equal(app.mapRoutes.length, 2);
    assert.deepEqual(app.mapRoutes[0].waypoints, [at(150, 50), at(250, 150)]);
    assert.deepEqual(app.mapRoutes[1].waypoints, [at(250, 150), at(350, 250)]);
    assert.equal(app.mapRoutes[1].name, "FILRODENSWMB.UI.NewRouteName 2");
    assert.equal(app.pinHistory.length, steps + 3);
});

test("dropping an end waypoint on another route's end with Alt joins the two; without Alt they only meet", async () => {
    const { app, session, at } = await studio();
    const tool = RouteTool.tool(app);
    const first = placeRoad(app, tool);
    for (const [x, y] of [[350, 50], [250, 50]]) click(tool, x, y);
    RouteTool.handleKey(app, { key: "Enter" });
    const second = app.mapRoutes[1];
    assert.equal(app.activeRouteId, second.id);
    RouteTool.setMode(app, { dataset: { mode: "edit" } });
    RouteTool.select(app, second);

    const [hx, hy] = [session.mesh.siteX(second.waypoints[1]), session.mesh.siteY(second.waypoints[1])];
    const [tx, ty] = [session.mesh.siteX(first.waypoints[2]), session.mesh.siteY(first.waypoints[2])];
    tool.down(hx, hy, press);
    tool.move(tx, ty, press);
    tool.up(tx, ty, press);
    assert.equal(app.mapRoutes.length, 2, "a plain drop only shares the cell");
    assert.equal(second.waypoints[1], first.waypoints[2]);
    tool.down(tx, ty, press);
    tool.move(tx, ty, press);
    tool.up(tx, ty, withKey("altKey"));
    assert.equal(app.mapRoutes.length, 1, "dropped with Alt, the two became one");
    const joined = app.mapRoutes[0];
    assert.equal(joined.id, second.id, "the held route takes the other in");
    assert.deepEqual(joined.waypoints, [at(350, 50), at(350, 250), at(250, 150), at(150, 50)]);
    assert.ok(legsOk(session, joined));
});

test("Draw: a drag traces a stroke whose bends become waypoints, shown while it is drawn, and clicks carry on from it", async () => {
    const { app, session, overlays, at } = await studio();
    app.uiState.routeMode = "direct";
    const tool = RouteTool.tool(app);
    tool.down(150, 200, press);
    tool.move(175, 230, press);
    tool.move(200, 260, press);
    assert.ok(overlays.draft.stroke.length >= 6, "the stroke is drawn as it is traced");
    assert.ok(overlays.handles.points.length >= 4, "the bends it would keep show as handles");
    tool.move(250, 230, press);
    tool.move(300, 200, press);
    tool.up(300, 200, press);
    assert.equal(app.mapRoutes.length, 0, "a stroke does not finish the route");
    const draft = overlays.handles.points.length / 2;
    assert.ok(draft >= 3, "the stroke's ends and its bend are waypoints");
    click(tool, 350, 250);
    RouteTool.handleKey(app, { key: "Enter" });
    const route = app.mapRoutes[0];
    assert.equal(route.mode, "direct");
    assert.equal(route.waypoints[0], at(150, 200));
    assert.ok(route.waypoints.includes(at(200, 260)), "the bend is kept at Detail 1");
    assert.equal(route.waypoints.at(-1), at(350, 250), "the click carried on from the stroke");
    assert.equal(route.waypoints.length, draft + 1);
    assert.ok(legsOk(session, route));
    assert.equal(app.pinHistory.length, 1);
});

test("Draw: a loose Detail keeps fewer bends, and a stroke over ground the transport cannot use leaves those bends out with a message", async () => {
    const { app, at } = await studio();
    const tool = RouteTool.tool(app);
    // Detail 12 on a mesh of 4 px cells tolerates 48 px; the stroke's bend is 30 px off its chord
    app.uiState.routeDetail = 12;
    tool.down(150, 200, press);
    for (const [x, y] of [[175, 215], [200, 230], [250, 215], [300, 200]]) tool.move(x, y, press);
    tool.up(300, 200, press);
    RouteTool.handleKey(app, { key: "Enter" });
    assert.deepEqual(app.mapRoutes[0].waypoints, [at(150, 200), at(300, 200)], "only the ends at a loose Detail");

    app.uiState.routeDetail = 1;
    tool.down(150, 100, press);
    for (const [x, y] of [[100, 60], [50, 100], [100, 140], [150, 180]]) tool.move(x, y, press);
    tool.up(150, 180, press);
    assert.equal(notices.length, 1);
    assert.ok(notices[0].startsWith("FILRODENSWMB.UI.WarnRouteStrokeSkipped"), notices[0]);
    RouteTool.handleKey(app, { key: "Enter" });
    assert.ok(app.mapRoutes[1].waypoints.every((cell) => app.meshSession.aggregates.land[cell] === 1), "the bends over water were left out");
});

test("a route is drawn with the bar's style, or with no style the map's default line; the bar never changes the picked route", async () => {
    const { app } = await studio();
    const tool = RouteTool.tool(app);
    const plain = placeRoad(app, tool);
    assert.deepEqual([plain.quickStyle, plain.color, plain.thickness, plain.style], ["custom", app.uiState.routeColor, app.uiState.routeThickness, app.uiState.routeStyle]);

    app.uiState.activeRouteQuickStyle = "trade";
    const styled = placeRoad(app, tool);
    assert.deepEqual([styled.quickStyle, styled.color, styled.thickness, styled.style, styled.outline, styled.smoothing], ["trade", "#00ff00", 3.5, "dashed", false, true]);
    assert.equal(app.activeRouteId, styled.id);
    assert.deepEqual([plain.quickStyle, plain.color], ["custom", app.uiState.routeColor], "the first route keeps its own look");
    assert.equal(RouteTool.applyToolbarField, undefined, "the bar has no fields that edit the picked route");
});

test("a route opens in the inspector, closing anything docked, with the route picked", async () => {
    const { app } = await studio();
    app.root = window.document.body.appendChild(window.document.createElement("div"));
    const route = placeRoad(app, RouteTool.tool(app));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(Inspector.shows(app, "route", route.id), "a finished route opens in the inspector");
    Inspector.close(app);
    RouteTool.select(app, null);
    dialogs.dismissed.length = 0;
    assert.equal(await RouteEditor.open(app, route.id), true);
    assert.deepEqual(dialogs.dismissed, [{ placement: "docked" }]);
    assert.ok(Inspector.shows(app, "route", route.id));
    assert.equal(app.activeRouteId, route.id);
    assert.equal(await RouteEditor.open(app, "missing"), false, "a route that is not on the map opens nothing");
    assert.ok(Inspector.shows(app, "route", route.id));
    Inspector.close(app);
});

test("deleting a route from its editor is one undo step, and lets go of it", async () => {
    const { app } = await studio();
    const route = placeRoad(app, RouteTool.tool(app));
    const steps = app.pinHistory.length;
    await RouteEditor.delete(app, route.id);
    assert.equal(app.mapRoutes.length, 0);
    assert.equal(app.activeRouteId, null);
    assert.equal(app.pinHistory.length, steps + 1);
    VectorHistory.step(app, true);
    assert.equal(app.mapRoutes.length, 1);
});
