import { transportCost } from "../mesh/RouteEdits.js";
import { distanceField, extractPath } from "../mesh/RoutePath.js";
import { isKept } from "./Regeneration.js";

/**
 * A regional map traces its rivers again on its own, finer terrain, so a river can take another
 * course than on its parent, and draws it at its own detail. The river trade routes it inherited
 * are the parent's line carried over, in the parent's cell-sized steps, so they can run beside the
 * river, or where it no longer is.
 *
 * Once, as a regional map opens with its rivers drawn (a new cut, or one cut before this), its
 * inherited river trade routes are laid again over its own rivers: the ends stay at their towns,
 * each waypoint between moves to the nearest cell a river is drawn through (no further than half
 * the way to its neighbours, so the route keeps to the same rivers in the same order), and each
 * leg is found again with a river route's costs (see RouteEdits.transportCost and
 * MeshSession.riverChannel), longest route first so the others join it. A route left mostly off
 * the rivers (less than RIVER_ROUTE_MIN_SHARE of its cells on a drawn river or water) follows a
 * river this map does not draw, and is removed. Routes the reader has edited or locked, and
 * routes nobody generated, are left as they are.
 *
 * The map is marked (`riverRoutes`, saved with it) and not marked as changed: until it is saved,
 * the same pass runs on every load, with the same result.
 */
export class RiverRelay {
    /** Whether the open map's river routes are still to be laid again. */
    static needed(app) {
        return !!app.currentParentId && app.riverRoutesLaid !== true && !!app.meshSession?.aggregates;
    }

    /**
     * Lays the open regional map's inherited river trade routes again over its own rivers.
     * @param {object} app
     * @returns {{laid: number, removed: number}} How many routes were laid again and how many
     *     removed (none when the map draws no river).
     */
    static run(app) {
        const session = app.meshSession;
        const channel = session?.riverChannel?.();
        const none = { laid: 0, removed: 0 };
        if (!channel) return none;
        const relaid = (route) => route.transport === "river" && !!route.generated && !isKept(route) && route.waypoints?.length >= 2;
        const targets = (app.mapRoutes ?? []).filter(relaid).sort((a, b) => length(b) - length(a));
        if (!targets.length) return none;
        const laid = (app.mapRoutes ?? []).filter((route) => !relaid(route));
        for (const route of targets) {
            const { cost, stepPassable } = transportCost(session, "river", laid, route.id);
            const waypoints = this.#snapped(session.mesh, route.waypoints, channel);
            const legs = [];
            for (let k = 0; k + 1 < waypoints.length; k++) {
                const [from, to] = [waypoints[k], waypoints[k + 1]];
                if (from === to) continue;
                const { prev } = distanceField(session.mesh, cost, from, { target: to, passable: stepPassable });
                const path = extractPath(prev, from, to);
                legs.push(path ? Array.from(path) : [from, to]);
            }
            if (!legs.length) continue;
            route.waypoints = [waypoints[0], ...legs.map((leg) => leg.at(-1))];
            route.legs = legs;
            laid.push(route);
        }
        const land = session.aggregates?.land;
        const onRiver = (cell) => channel[cell] === 1 || (land && land[cell] !== 1);
        const orphans = new Set(targets.filter((route) => {
            const cells = route.legs.flat();
            return cells.filter(onRiver).length < cells.length * RIVER_ROUTE_MIN_SHARE;
        }));
        if (orphans.size) app.mapRoutes = app.mapRoutes.filter((route) => !orphans.has(route));
        return { laid: targets.length - orphans.size, removed: orphans.size };
    }

    /**
     * The route's waypoints with each one between its ends moved onto the nearest cell a river is
     * drawn through, within half the distance to its nearer neighbour; repeats dropped.
     */
    static #snapped(mesh, waypoints, channel) {
        const out = [];
        for (let k = 0; k < waypoints.length; k++) {
            let cell = waypoints[k];
            if (k > 0 && k < waypoints.length - 1 && !channel[cell]) {
                const reach = Math.min(mesh.distance(cell, waypoints[k - 1]), mesh.distance(cell, waypoints[k + 1])) / 2;
                cell = nearestRiver(mesh, cell, channel, reach) ?? cell;
            }
            if (out.at(-1) !== cell) out.push(cell);
        }
        return out;
    }
}

/** The share of a laid route's cells that must be on a drawn river or water for it to stay. */
const RIVER_ROUTE_MIN_SHARE = 0.5;

/** A route's cell count over its legs. */
function length(route) {
    return (route.legs ?? []).reduce((sum, leg) => sum + leg.length, 0);
}

/** The cell a river is drawn through nearest a cell, within `reach` pixels, or null. */
function nearestRiver(mesh, start, channel, reach) {
    const seen = new Set([start]);
    let frontier = [start];
    let best = null;
    let bestDistance = Infinity;
    while (frontier.length) {
        const next = [];
        for (const cell of frontier) {
            for (const neighbour of mesh.neighbours(cell)) {
                if (seen.has(neighbour)) continue;
                seen.add(neighbour);
                const distance = mesh.distance(start, neighbour);
                if (distance > reach) continue;
                if (channel[neighbour] && distance < bestDistance) {
                    best = neighbour;
                    bestDistance = distance;
                }
                next.push(neighbour);
            }
        }
        frontier = next;
    }
    return best;
}
