import { cleanCultures } from "../generator/RegionCultures.js";
import { Regeneration, isKept } from "./Regeneration.js";
import { UserFigures } from "./UserFigures.js";

/**
 * What a run reads from the map's own content: the regions, cultures, routes and settlement pins
 * it builds round. Generation gives them to the run, and RunInputs takes the run's fingerprint of
 * them, so both read them here (RF1: they were Generation's, which made the two import each other).
 */
/** The pin style tiers a run takes as seats: the settlements and castles the world model makes. */
const SEAT_KINDS = new Set(["capital", "city", "largeTown", "town", "fortifiedTown", "port", "castle"]);

/** How far (map pixels, each way) from a settlement pin's point a land pixel makes it a pin on land (see RunSources.#onLand). */
const SEAT_SHORE_PX = 4;

export class RunSources {
    /**
     * The map's own realms, duchies and counties, which a run builds round (see UserRealms): the
     * regions of the Political set the run writes into (Regeneration.target) that a run keeps
     * (Regeneration.keptKeys: each drawn, edited, locked or given cultures, for itself), so
     * what the model is given is what the map will show. Each level by depth as `{ key, cells,
     * independent }`, its cells the model cells whose land display cells it holds most of
     * (cells outside every such region of the level count too, so a region holding a sliver of a
     * model cell does not take it).
     *
     * Null when there are none, and when the set's levels are not a chain (see
     * Regeneration.chain), since the run could not then be written into it.
     * @param {object} app
     * @returns {{realms: object[], duchies: object[], counties: object[]}|null}
     */
    static userRegions(app) {
        const levels = this.userLevels(app);
        if (!levels) return null;
        const session = app.meshSession;
        const kept = Regeneration.keptKeys(Regeneration.target(app));
        const [realms, duchies, counties] = [0, 1, 2].map((depth) => (levels[depth] ? this.#modelRegions(session, levels[depth], kept[depth]) : []));
        return realms.length || duchies.length || counties.length ? { realms, duchies, counties } : null;
    }

    /**
     * The cultures the kept regions of the run's Political set are given (UC phase 2), for the
     * run's fingerprint (see RunInputs): each such region's level, key and cultures, in order. Empty
     * when none has any, or the set is not the run's.
     * @param {object} app
     * @returns {[number, number, {culture: string, share: number|null}[]][]}
     */
    static regionCultures(app) {
        // As the regions' own fingerprint (see RunInputs.regionsHash): the target set's chain
        const set = Regeneration.target(app);
        const levels = Regeneration.chain(set);
        if (!levels) return [];
        const kept = Regeneration.keptKeys(set);
        const out = [];
        levels.forEach((level, depth) => {
            for (const region of level.regions) {
                const cultures = kept[depth].has(region.key) ? cleanCultures(region.cultures) : [];
                if (cultures.length) out.push([depth, region.key, cultures]);
            }
        });
        return out;
    }

    /** The target set's levels by depth, when they are a chain; null otherwise. */
    static userLevels(app) {
        const session = app.meshSession;
        const set = Regeneration.target(app);
        const levels = Regeneration.chain(set);
        if (!session?.mesh || !session.aggregates || !levels) return null;
        // The run writes into the set whatever its levels (see Regeneration.merge), and builds round
        // every kept region of them, also below the levels it makes
        return levels.slice(0, 3);
    }

    /** A level's kept regions by model cell (see userRegions). */
    static #modelRegions(session, level, keys) {
        const { mesh, aggregates } = session;
        const owners = session.layer(level.id).owners;
        const NONE = -1;
        const ownerOf = (cell) => (keys.has(owners[cell]) ? owners[cell] : NONE);
        // Only the model cells some user region touches need a tally
        const tallies = new Map();
        for (let cell = 0; cell < mesh.cellCount; cell++) {
            if (aggregates.land[cell] === 1 && ownerOf(cell) !== NONE) tallies.set(mesh.parentOf[cell], new Map());
        }
        for (let cell = 0; cell < mesh.cellCount; cell++) {
            const tally = aggregates.land[cell] === 1 ? tallies.get(mesh.parentOf[cell]) : undefined;
            if (!tally) continue;
            const owner = ownerOf(cell);
            tally.set(owner, (tally.get(owner) ?? 0) + 1);
        }
        const cellsOf = new Map();
        for (const [modelCell, tally] of tallies) {
            let best = NONE;
            let most = 0;
            for (const [owner, n] of tally) {
                if (n > most || (n === most && owner < best)) {
                    best = owner;
                    most = n;
                }
            }
            if (best === NONE) continue;
            if (!cellsOf.has(best)) cellsOf.set(best, []);
            cellsOf.get(best).push(modelCell);
        }
        return level.regions.filter((region) => keys.has(region.key)).map((region) => {
            const entry = { key: region.key, cells: (cellsOf.get(region.key) ?? []).sort((a, b) => a - b), independent: region.independent === true };
            // The cultures the user gave the region (UC phase 2), only when it has some, so a map
            // without them sends what it always sent
            const cultures = cleanCultures(region.cultures);
            if (cultures.length) entry.cultures = cultures;
            return entry;
        });
    }

    /**
     * The map's own routes as the run's trade may use them (see UserRoutes): every route drawn by
     * hand, and every generated one a run keeps (edited or locked), since a run lays its own routes
     * only where the map has none (an earlier age's old road is left out: it carries no trade).
     * Each is its transport and the model cells its drawn line passes through, in order: its legs'
     * display cells (or, for a route without legs, its waypoints), each read as its model cell,
     * with repeats in a row dropped.
     * @param {object} app
     * @returns {{transport: string, cells: number[]}[]}
     */
    static userRoutes(app) {
        const mesh = app.meshSession?.mesh;
        if (!mesh) return [];
        const routes = [];
        for (const route of app.mapRoutes ?? []) {
            if (route.generated && (!isKept(route) || route.generated.oldRoad)) continue;
            const line = route.legs?.length ? route.legs.flat() : (route.waypoints ?? []);
            const cells = [];
            for (const display of line) {
                const cell = Number.isInteger(display) && display >= 0 && display < mesh.cellCount ? mesh.parentOf[display] : -1;
                if (cell >= 0 && cells.at(-1) !== cell) cells.push(cell);
            }
            if (cells.length >= 2) routes.push({ transport: route.transport ?? "road", cells });
        }
        return routes;
    }

    /**
     * The map's settlement pins as seats a run must build on: every pin on the map whose style has
     * a settlement tier the world model makes (SEAT_KINDS), hand-placed or generated and kept
     * (edited or locked); a generated pin a run would replace is no seat. Each by the model cell
     * its display cell lies in, with the pin's point and whether it stands on land (see #onLand),
     * so a pin on a coast in a model cell the model counts as sea is built on the land beside it
     * (see Pipeline.seatsOf).
     *
     * A pin with an entered population (see UserFigures) carries it as `target`, the figure its
     * town is held to (a castle's never). A pin whose style has no settlement tier the model makes
     * (no style, a Village or a custom one) is a seat of its own kind, `entered`, when its entered
     * population is a town's (UserFigures.TOWN_MIN or more); below that it is a village's figure,
     * which a world run builds no town for. Only pins with an entered figure carry one, so the
     * seats of a map without any are as they were (and so is the run's fingerprint, RunInputs).
     * @param {object} app
     * @returns {{cell: number, kind: string, pin: string, x: number, y: number, land: boolean|null, target?: number}[]}
     */
    static seats(app) {
        const session = app.meshSession;
        if (!session?.mesh) return [];
        const styles = new Map((app.uiState.customPinStyles ?? []).map((style) => [style.id, style]));
        const seats = [];
        for (const pin of app.mapPins ?? []) {
            if (pin.generated && !isKept(pin)) continue;
            const tier = styles.get(pin.pinStyle)?.tier;
            const target = UserFigures.takes(tier) ? UserFigures.population(pin) : null;
            const kind = SEAT_KINDS.has(tier) ? tier : target !== null && target >= UserFigures.TOWN_MIN ? "entered" : null;
            if (!kind || !Number.isFinite(pin.x) || !Number.isFinite(pin.y)) continue;
            const display = session.cellAt(pin.x, pin.y);
            if (!(display >= 0)) continue;
            const seat = { cell: session.mesh.parentOf[display], kind, pin: pin.id, x: pin.x, y: pin.y, land: this.#onLand(app, display, pin) };
            if (target !== null && kind !== "castle") seat.target = target;
            seats.push(seat);
        }
        return seats;
    }

    /**
     * Whether a settlement pin stands on land, for its seat (see Pipeline.seatsOf): its display
     * cell is land, or there is a land pixel within SEAT_SHORE_PX of its point. The second counts a
     * pin dropped just off a coast (its icon sits on the shore, its point in the water) as the
     * coastal settlement it plainly is. Null without the terrain to tell.
     */
    static #onLand(app, display, pin) {
        if (app.meshSession?.aggregates?.land[display] === 1) return true;
        const elevation = app.currentElevationData;
        const width = app.mapWidth ?? app.meshSession?.mesh?.width;
        if (!elevation || !width) return app.meshSession?.aggregates ? false : null;
        const height = elevation.length / width;
        const water = app.bufferWaterMask;
        const seaLevel = app.uiState.seaLevel;
        const cx = Math.floor(pin.x);
        const cy = Math.floor(pin.y);
        for (let y = Math.max(0, cy - SEAT_SHORE_PX); y <= Math.min(height - 1, cy + SEAT_SHORE_PX); y++) {
            for (let x = Math.max(0, cx - SEAT_SHORE_PX); x <= Math.min(width - 1, cx + SEAT_SHORE_PX); x++) {
                const pixel = y * width + x;
                if (elevation[pixel] >= seaLevel && !(water?.[pixel] > 0)) return true;
            }
        }
        return false;
    }
}
