import { UNCLAIMED } from "../mesh/Schema.js";

/**
 * Running Generate again, and Remove generated content: what earlier runs made is replaced,
 * except what the reader has made their own.
 *
 * - An item is kept when it is hand-made, or generated and edited (a substantive change; see
 *   GeneratedEdits) or locked.
 * - A kept region keeps its whole realm: the realm with every duchy and county in it, untouched,
 *   so nesting always holds. The rest of each generated (Political) set is removed with its cells.
 * - A set left with no regions is removed, except, for a run, the latest Political set. A run
 *   writes into that set (new regions fill only the cells no kept region holds; one left with
 *   none is dropped), so its levels keep their names and looks, or adds a new one when there is none.
 * - New places are not put on a kept pin's cell.
 *
 * Every step records what it changes, so the caller makes the whole of it one undo step.
 */

/** Whether a generated item is the reader's own: edited or locked. */
export function isKept(item) {
    return !!item && (!item.generated || item.generated.edited === true || item.generated.locked === true);
}

/** The sets a run writes into and removes from. */
function politicalSets(app) {
    return (app.layerSets ?? []).filter((set) => set.kind === "political");
}

export class Regeneration {
    /**
     * What a re-run (or Remove generated content) would replace and keep, for its confirmation.
     * @param {object} app
     * @returns {{removed: {realms: number, places: number, routes: number}, kept: number}}
     */
    static plan(app) {
        const removed = { realms: 0, places: 0, routes: 0 };
        let kept = 0;
        for (const set of politicalSets(app)) {
            const keep = this.keptKeys(set);
            set.levels[0]?.regions.forEach((region) => {
                if (!region.generated) return;
                if (keep[0].has(region.key)) kept++;
                else removed.realms++;
            });
        }
        for (const pin of app.mapPins ?? []) if (pin.generated) isKept(pin) ? kept++ : removed.places++;
        for (const route of app.mapRoutes ?? []) if (route.generated) isKept(route) ? kept++ : removed.routes++;
        return { removed, kept };
    }

    /**
     * Removes every generated item that is not kept. Returns what the undo step needs: each
     * changed level's owners before and after (encoded; after is null for a level removed with its
     * set), and the latest Political set that remains, for a run to write into.
     * @param {object} app
     * @param {{keepLatest?: boolean}} [options] - keepLatest: the latest Political set stays even
     *     when left empty, so a run writes into it (keeping its levels' names and looks).
     * @returns {{owners: {levelId: string, before: string, after: string|null}[], target: object|null}}
     */
    static remove(app, { keepLatest = false } = {}) {
        const session = app.meshSession;
        const owners = [];
        const emptied = new Set();
        for (const set of politicalSets(app)) {
            const keep = this.keptKeys(set);
            set.levels.forEach((level, depth) => {
                const gone = new Set(level.regions.filter((region) => !keep[depth].has(region.key)).map((region) => region.key));
                if (!gone.size) return;
                level.regions = level.regions.filter((region) => keep[depth].has(region.key));
                if (!session) return;
                const layer = session.layer(level.id);
                const before = layer.encode();
                const array = layer.owners.slice();
                for (let cell = 0; cell < array.length; cell++) if (gone.has(array[cell])) array[cell] = UNCLAIMED;
                session.restoreLevelOwners(level.id, array);
                owners.push({ levelId: level.id, before, after: session.layer(level.id).encode() });
            });
            if (set.levels.every((level) => level.regions.length === 0)) emptied.add(set);
        }
        if (keepLatest) emptied.delete(politicalSets(app).at(-1));
        // A set left empty goes, with its levels' owner arrays
        for (const set of emptied) {
            for (const level of set.levels) {
                const entry = owners.find((each) => each.levelId === level.id);
                if (entry) entry.after = null;
                else if (session) owners.push({ levelId: level.id, before: session.layer(level.id).encode(), after: null });
                session?.removeLevelOwners(level.id);
            }
        }
        app.layerSets = (app.layerSets ?? []).filter((set) => !emptied.has(set));
        session?.setLayerSets(app.layerSets);
        app.mapPins = (app.mapPins ?? []).filter(isKept);
        app.mapRoutes = (app.mapRoutes ?? []).filter(isKept);
        return { owners, target: politicalSets(app).at(-1) ?? null };
    }

    /**
     * Each level's kept region keys in a Political set: every region of a realm that is kept
     * because it, or any region in it, is hand-made, edited or locked; and any kept region whose
     * line does not reach a realm.
     * @returns {Set<number>[]} One set of keys per level, by depth.
     */
    static keptKeys(set) {
        const parentOf = set.levels.map((level) => new Map(level.regions.map((region) => [region.key, region.parentKey])));
        const realmOf = (depth, key) => {
            let current = key;
            for (let up = depth; up > 0; up--) {
                current = parentOf[up].get(current);
                if (current === undefined || current === null || current === UNCLAIMED) return null;
            }
            return current;
        };
        const realms = new Set();
        const loose = set.levels.map(() => new Set());
        set.levels.forEach((level, depth) => {
            for (const region of level.regions) {
                if (!isKept(region)) continue;
                const realm = realmOf(depth, region.key);
                if (realm === null) loose[depth].add(region.key);
                else realms.add(realm);
            }
        });
        return set.levels.map((level, depth) => new Set(level.regions.filter((region) => loose[depth].has(region.key) || realms.has(realmOf(depth, region.key))).map((region) => region.key)));
    }

    /**
     * Writes a run's new Political set into the set that remains: level by level (by depth), the
     * new regions take new keys and fill only the cells no kept region holds; a new region left
     * with no cells is dropped. The new set's own levels leave the session. Returns each target
     * level's owners before and after (encoded).
     * @param {object} app
     * @param {object} target - The set written into (in app.layerSets).
     * @param {object} made - The run's set, installed in the session but not in app.layerSets.
     * @returns {{levelId: string, before: string, after: string}[]|null} null when the sets' levels differ (the run keeps its own set).
     */
    static merge(app, target, made) {
        if (target.levels.length !== made.levels.length) return null;
        const session = app.meshSession;
        const changes = [];
        let parentKeys = null;
        target.levels.forEach((level, depth) => {
            const fresh = made.levels[depth];
            const into = session.layer(level.id);
            const before = into.encode();
            const array = into.owners.slice();
            const from = session.layer(fresh.id).owners;
            // New keys after the level's own, so kept regions keep theirs
            const keys = new Map(fresh.regions.map((region, index) => [region.key, level.nextKey + index]));
            const held = new Set();
            for (let cell = 0; cell < array.length; cell++) {
                const owner = from[cell];
                if (owner === UNCLAIMED || array[cell] !== UNCLAIMED) continue;
                array[cell] = keys.get(owner);
                held.add(array[cell]);
            }
            const regions = fresh.regions.map((region) => ({ ...region, key: keys.get(region.key), parentKey: depth === 0 ? region.parentKey : (parentKeys?.get(region.parentKey) ?? UNCLAIMED) })).filter((region) => held.has(region.key));
            level.regions.push(...regions);
            level.nextKey += fresh.regions.length;
            parentKeys = keys;
            session.restoreLevelOwners(level.id, array);
            changes.push({ levelId: level.id, before, after: session.layer(level.id).encode() });
        });
        for (const level of made.levels) session.removeLevelOwners(level.id);
        session.setLayerSets(app.layerSets);
        return changes;
    }

    /** New pins, less those on a kept pin's cell. */
    static placesBeside(app, pins) {
        const taken = new Set((app.mapPins ?? []).filter((pin) => Number.isInteger(pin.cell)).map((pin) => pin.cell));
        return pins.filter((pin) => !taken.has(pin.cell));
    }
}
