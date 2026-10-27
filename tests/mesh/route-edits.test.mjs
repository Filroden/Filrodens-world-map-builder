// Routes made and changed by hand (RouteEdits): a route placed waypoint by waypoint with its
// preview, the transports' costs and limits, the waypoints a traced stroke keeps, and the edits
// to a finished route.
import assert from "node:assert/strict";
import { test } from "node:test";
import { RouteDraft, fillGaps, findLeg, tryLeg, insertWaypoint, joinRoutes, moveWaypoint, nearestLegCell, removeWaypoint, repathRoute, simplifyPolyline, simplifyRoute, splitRoute, strokeWaypoints, transportCost, waypointAt } from "../../src/mesh/RouteEdits.js";
import { computeLeg } from "../../src/mesh/RoutePath.js";
import { createRoute } from "../../src/mesh/Schema.js";
import { isContiguous, smallSession } from "./helpers.mjs";

let ids = 0;
const nextId = () => `r${++ids}`;

/** The small session (water left of x 100), with no routes yet. */
async function map() {
    const session = await smallSession([]);
    const at = (x, y) => session.cellAt(x, y);
    return { session, at, land: session.aggregates.land };
}

const contiguousLegs = (session, route) => route.legs.every((leg) => isContiguous(session.mesh, leg)) && route.legs.every((leg, k) => leg[0] === route.waypoints[k] && leg.at(-1) === route.waypoints[k + 1]);

test("a draft adds waypoints with contiguous legs, previews the next leg exactly, and finishes with two or more", async () => {
    const { session, at } = await map();
    const draft = new RouteDraft(session, [], { name: "Road", transport: "road", mode: "terrain" }, nextId);
    assert.equal(draft.finish(), null, "nothing placed yet");
    assert.equal(draft.preview(at(200, 100)), null, "no last waypoint to preview from");
    assert.equal(draft.add(at(150, 50)), true);
    assert.equal(draft.add(at(150, 50)), false, "the last waypoint again adds nothing");
    assert.equal(draft.finish(), null, "one waypoint is not a route");

    const preview = draft.preview(at(350, 250));
    const direct = findLeg(session, [], draft.route, at(150, 50), at(350, 250));
    assert.deepEqual(preview, direct, "the preview is the leg the click would add");
    assert.equal(draft.add(at(350, 250)), true);
    assert.equal(draft.add(at(300, 50)), true);
    const route = draft.finish();
    assert.equal(route.waypoints.length, 3);
    assert.equal(route.legs.length, 2);
    assert.ok(contiguousLegs(session, route));
    draft.undoLast();
    assert.equal(draft.route.legs.length, 1);
});

test("a road keeps to land, a sea route to water, and neither reaches the other's ground", async () => {
    const { session, at, land } = await map();
    const road = createRoute({ id: "road", transport: "road", mode: "terrain" });
    const alongCoast = findLeg(session, [], road, at(110, 20), at(110, 280));
    assert.ok(alongCoast.length > 2 && alongCoast.every((cell) => land[cell] === 1), "a road never enters water");
    assert.deepEqual(findLeg(session, [], road, at(110, 20), at(50, 20)), [at(110, 20), at(50, 20)], "a road to a water cell is the two waypoints alone");

    const sea = createRoute({ id: "sea", transport: "sea", mode: "terrain" });
    const voyage = findLeg(session, [], sea, at(50, 20), at(50, 280));
    assert.ok(voyage.length > 2 && voyage.every((cell) => land[cell] !== 1), "a sea route never enters land");
    const draft = new RouteDraft(session, [], { transport: "sea", mode: "terrain" }, nextId);
    assert.equal(draft.add(at(200, 150)), false, "a sea route cannot start on land");

    const river = createRoute({ id: "river", transport: "river", mode: "terrain" });
    const { cost } = transportCost(session, "river", [], null);
    const overLand = cost(at(200, 150), session.mesh.neighbours(at(200, 150))[0]);
    assert.ok(overLand > session.mesh.distance(at(200, 150), session.mesh.neighbours(at(200, 150))[0]), "land without a river is dear for a river route");
    assert.ok(findLeg(session, [], river, at(150, 150), at(250, 150)).length > 2, "but a river route still crosses it");
});

test("a road allowed to span water bridges a channel at its narrowest, never wide water; one that is not stops at the shore", async () => {
    // A channel of water between two land halves, 10 px wide at the top and 130 px at the bottom
    const channel = (x, y) => Math.abs(x - 200) < 5 + (y / 300) * 60;
    const session = await smallSession([], {}, { isWater: channel });
    const at = (x, y) => session.cellAt(x, y);
    const land = session.aggregates.land;
    const road = createRoute({ id: "road", transport: "road", mode: "terrain", waypoints: [at(100, 250), at(300, 250)] });
    assert.equal(tryLeg(session, [], road, at(100, 250), at(300, 250)), null, "no way round and no bridge: no leg");
    assert.deepEqual(findLeg(session, [], road, at(100, 250), at(300, 250)), [at(100, 250), at(300, 250)], "kept whole, it is the waypoints alone");
    const plain = new RouteDraft(session, [], { transport: "road", mode: "terrain" }, nextId);
    assert.equal(plain.add(at(100, 250)), true);
    assert.equal(plain.add(at(300, 250)), false, "a route being drawn refuses a waypoint it cannot reach");
    assert.equal(plain.preview(at(300, 250)), null);

    const bridge = createRoute({ id: "bridge", transport: "road", mode: "terrain", spanWater: true, waypoints: [at(100, 250), at(300, 250)] });
    const leg = findLeg(session, [], bridge, at(100, 250), at(300, 250));
    assert.ok(leg.length > 2 && isContiguous(session.mesh, leg), "the road crosses");
    const wet = leg.filter((cell) => land[cell] !== 1);
    const straightAcross = leg.filter((cell) => Math.abs(session.mesh.siteY(cell) - 250) < 20 && land[cell] !== 1).length;
    assert.ok(wet.length > 0 && wet.length < 20, `a short crossing (${wet.length} water cells)`);
    assert.equal(straightAcross, 0, "it goes up the channel to where it is narrower rather than straight across the wide end");

    const draft = new RouteDraft(session, [], { transport: "road", mode: "terrain", spanWater: true }, nextId);
    assert.equal(draft.add(at(100, 250)), true);
    assert.equal(draft.add(at(200, 250)), false, "a waypoint still cannot be on water");

    const shore = session.shoreDistance();
    assert.equal(shore[at(100, 250)], 0, "land is at no distance from the shore");
    assert.equal(shore[at(200, 250)] > 5, true, "mid-channel at the wide end is well out from either shore");
    assert.ok(session.mesh.neighbours(at(100, 250)).some((cell) => shore[cell] <= 1), "the cells beside land are a step away");

    // A channel 100 px (about 25 cells) wide everywhere is too wide for a bridge
    const wide = await smallSession([], {}, { isWater: (x) => Math.abs(x - 200) < 50 });
    const far = createRoute({ id: "far", transport: "road", mode: "terrain", spanWater: true, waypoints: [wide.cellAt(100, 150), wide.cellAt(300, 150)] });
    assert.equal(tryLeg(wide, [], far, wide.cellAt(100, 150), wide.cellAt(300, 150)), null, "no bridge across open water");
    const home = createRoute({ id: "home", transport: "road", mode: "terrain", spanWater: true, waypoints: [wide.cellAt(100, 150), wide.cellAt(100, 250)], legs: [[wide.cellAt(100, 150), wide.cellAt(100, 250)]] });
    assert.equal(moveWaypoint(wide, [], home, 1, wide.cellAt(300, 250)), false, "a waypoint cannot be dragged across it either");
    assert.equal(home.waypoints[1], wide.cellAt(100, 250));
});

test("an existing road makes the same cells cheaper for the next road, but not for a sea route", async () => {
    const { session, at } = await map();
    const first = createRoute({ id: "first", transport: "road", mode: "terrain", waypoints: [at(150, 150), at(350, 150)] });
    first.legs = [findLeg(session, [], first, at(150, 150), at(350, 150))];
    const { cost } = transportCost(session, "road", [first], null);
    const [a, b] = first.legs[0];
    const { cost: alone } = transportCost(session, "road", [], null);
    assert.ok(cost(a, b) < alone(a, b));
    const { cost: ownCost } = transportCost(session, "road", [first], "first");
    assert.equal(ownCost(a, b), alone(a, b), "a route's own cells do not count while it is edited");
    const { cost: seaCost } = transportCost(session, "sea", [first], null);
    assert.equal(seaCost(a, b), alone(a, b));
});

test("direct legs follow the straight line", async () => {
    const { session, at } = await map();
    const route = createRoute({ id: "d", mode: "direct", transport: "road" });
    const leg = findLeg(session, [], route, at(150, 50), at(350, 250));
    assert.deepEqual(leg, Array.from(computeLeg("direct", session.mesh, at(150, 50), at(350, 250))));
});

test("a polyline is thinned to the points that bend it by more than the tolerance, its ends always kept", () => {
    const line = [0, 0, 10, 1, 20, 0, 30, 12, 40, 0];
    assert.deepEqual(simplifyPolyline(line, 8), [0, 3, 4], "the small bumps go, the big one stays");
    assert.deepEqual(simplifyPolyline(line, 0.5), [0, 1, 2, 3, 4], "a tight tolerance keeps every bend");
    assert.deepEqual(simplifyPolyline(line, 50), [0, 4], "a loose one keeps only the ends");
    assert.deepEqual(simplifyPolyline([5, 5], 1), [0]);
    assert.deepEqual(simplifyPolyline([], 1), []);
    assert.deepEqual(simplifyPolyline([0, 0, 3, 4, 0, 0], 1), [0, 1, 2], "a line that returns to its start keeps the far point");
});

test("a long run between kept points gains evenly spread points, so a straight stroke is not two ends alone", () => {
    const line = [];
    for (let x = 0; x <= 100; x += 10) line.push(x, 0);
    assert.deepEqual(simplifyPolyline(line, 1), [0, 10], "a straight line has no bends");
    assert.deepEqual(fillGaps(line, [0, 10], 25), [0, 3, 5, 8, 10], "four pieces of 25");
    assert.deepEqual(fillGaps(line, [0, 10], 100), [0, 10], "within the gap already");
    assert.deepEqual(fillGaps(line, [0, 10], 0), [0, 10], "no gap rule");
    assert.deepEqual(fillGaps(line, [0, 5, 10], 30), [0, 3, 5, 8, 10], "each run is split on its own");
});

test("a traced stroke becomes the cells at its bends, fewer the looser the detail", async () => {
    const { session, at } = await map();
    const stroke = [150, 200, 175, 230, 200, 260, 250, 230, 300, 200];
    const tight = strokeWaypoints(session, stroke, 1);
    assert.equal(tight[0], at(150, 200));
    assert.equal(tight.at(-1), at(300, 200));
    assert.ok(tight.includes(at(200, 260)), "the bend is kept");
    assert.ok(tight.length >= 3 && new Set(tight).size === tight.length, "no cell is kept twice in a row");
    assert.deepEqual(strokeWaypoints(session, stroke, 500), [at(150, 200), at(300, 200)], "a loose detail keeps the ends alone");
    assert.ok(strokeWaypoints(session, stroke, 500, 60).length >= 4, "unless a gap limit spreads waypoints along it");
    assert.deepEqual(strokeWaypoints(session, [150, 200, 151, 200], 1), [at(150, 200)], "a stroke within one cell is one waypoint");
});

test("moving, inserting and removing waypoints keep the legs contiguous and ending at the waypoints", async () => {
    const { session, at } = await map();
    const draft = new RouteDraft(session, [], { transport: "road", mode: "terrain" }, nextId);
    for (const [x, y] of [[150, 50], [250, 150], [350, 250]]) draft.add(at(x, y));
    const route = draft.finish();
    const legsBefore = route.legs;

    assert.equal(moveWaypoint(session, [], route, 1, at(250, 50)), true);
    assert.equal(route.waypoints[1], at(250, 50));
    assert.notEqual(route.legs, legsBefore, "a move gives the route new legs (undo compares them by identity)");
    assert.ok(contiguousLegs(session, route));
    assert.equal(moveWaypoint(session, [], route, 1, at(250, 50)), false, "the same cell is no move");

    const middle = route.legs[0][Math.floor(route.legs[0].length / 2)];
    const index = insertWaypoint(route, 0, middle);
    assert.equal(index, 1);
    assert.equal(route.waypoints.length, 4);
    assert.ok(contiguousLegs(session, route));
    assert.equal(insertWaypoint(route, 0, route.waypoints[0]), -1, "a leg's end is already a waypoint");

    assert.equal(removeWaypoint(session, [], route, 1), true);
    assert.equal(route.waypoints.length, 3);
    assert.ok(contiguousLegs(session, route));
    assert.equal(removeWaypoint(session, [], route, 0), true, "an end waypoint goes with its leg");
    assert.equal(route.waypoints.length, 2);
    assert.equal(removeWaypoint(session, [], route, 0), false, "a route keeps two waypoints");
});

test("a route splits at a waypoint into two that share it, and joins back end to end", async () => {
    const { session, at } = await map();
    const draft = new RouteDraft(session, [], { name: "Long", transport: "road", mode: "terrain", color: "#123456" }, nextId);
    for (const [x, y] of [[150, 50], [250, 150], [350, 250], [350, 50]]) draft.add(at(x, y));
    const route = draft.finish();
    assert.equal(splitRoute(route, 0, nextId), null, "not at an end");
    const second = splitRoute(route, 2, nextId, "Long (2)");
    assert.deepEqual(route.waypoints, [at(150, 50), at(250, 150), at(350, 250)]);
    assert.deepEqual(second.waypoints, [at(350, 250), at(350, 50)]);
    assert.equal(second.color, "#123456");
    assert.equal(second.name, "Long (2)");
    assert.ok(contiguousLegs(session, route) && contiguousLegs(session, second));

    const reversed = createRoute({ waypoints: second.waypoints.slice().reverse(), legs: second.legs.map((leg) => leg.slice().reverse()).reverse() });
    assert.equal(joinRoutes(route, reversed), true, "a route meeting end to end is turned round and joined");
    assert.equal(route.waypoints.length, 4);
    assert.ok(contiguousLegs(session, route));
    assert.equal(joinRoutes(route, createRoute({ waypoints: [at(10, 10), at(20, 20)], legs: [[at(10, 10), at(20, 20)]] })), false, "routes that do not meet stay apart");
});

test("re-pathing finds every leg again in the route's mode, and the nearest leg cell and waypoint are found", async () => {
    const { session, at } = await map();
    const route = createRoute({ id: "r", transport: "road", mode: "direct", waypoints: [at(150, 50), at(350, 250)], legs: [[at(150, 50), at(350, 250)]] });
    repathRoute(session, [], route);
    assert.ok(route.legs[0].length > 2 && isContiguous(session.mesh, route.legs[0]));
    const near = nearestLegCell(session, route, 250, 150);
    assert.equal(near.legIndex, 0);
    assert.ok(route.legs[0].includes(near.cell));
    assert.equal(waypointAt(session, route, 352, 248, 10), 1);
    assert.equal(waypointAt(session, route, 250, 150, 10), -1);
});

test("simplifying drops the waypoints that barely bend the route and finds the legs again", async () => {
    const { session, at } = await map();
    const draft = new RouteDraft(session, [], { transport: "road", mode: "direct" }, nextId);
    for (const [x, y] of [[150, 50], [200, 52], [250, 50], [300, 150], [350, 250]]) draft.add(at(x, y));
    const route = draft.finish();
    assert.equal(route.waypoints.length, 5);
    assert.equal(simplifyRoute(session, [], route, 10), true);
    assert.deepEqual(route.waypoints, [at(150, 50), at(250, 50), at(350, 250)], "the nearly straight waypoint goes; the corner stays");
    assert.ok(contiguousLegs(session, route));
    assert.equal(simplifyRoute(session, [], route, 10), false, "nothing left to drop");
    assert.equal(simplifyRoute(session, [], route, 1000), true);
    assert.deepEqual(route.waypoints, [at(150, 50), at(350, 250)], "the ends always stay");
});
