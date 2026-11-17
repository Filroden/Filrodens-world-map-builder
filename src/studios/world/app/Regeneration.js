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

/** What a run made of a region, as written onto a kept one: its figures, not its look, name or rank. */
const REGION_FIGURES = Object.freeze(["population", "culture", "mix", "rulingCulture"]);

/**
 * Writes what a run made of a kept region it built round onto it, as a seat's figures are written
 * onto its pin (see Generation.seats): a region the reader drew gains them as `modelled` (read
 * only, and the region stays the reader's); a kept generated region (edited or locked) has its
 * generated figures refreshed and joins the run (its run and index in it), keeping its name, look,
 * rank and whether it was edited or locked.
 * @param {object} own - The kept region.
 * @param {object|undefined} made - The `generated` record of the region the run made for it.
 */
function writeFigures(own, made) {
    if (!made) return;
    if (!own.generated) {
        const { edited: _edited, locked: _locked, ...figures } = made;
        own.modelled = figures;
        return;
    }
    for (const key of REGION_FIGURES) delete own.generated[key];
    own.generated.run = made.run;
    own.generated.sourceId = made.sourceId;
    for (const key of REGION_FIGURES) if (made[key] !== undefined) own.generated[key] = made[key];
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
        // A parent a run gave a lone region (see merge) is no link: that parent is the run's to replace
        const parentOf = set.levels.map((level) => new Map(level.regions.map((region) => [region.key, region.parentFromRun ? null : region.parentKey])));
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
     * A set's levels when they are one chain by depth (the first a top level, each after it the
     * child of the one before), as a generated Political set's are; null otherwise. keptKeys and
     * merge read a set's levels by depth.
     * @param {object} set
     * @returns {object[]|null}
     */
    static chain(set) {
        const levels = set?.levels ?? [];
        const ok = levels.length > 0 && levels.every((level, depth) => (depth === 0 ? !level.parentLevelId : level.parentLevelId === levels[depth - 1].id));
        return ok ? levels : null;
    }

    /**
     * The Political set a run writes into, and whose own regions it builds round: the latest.
     * @param {object} app
     * @returns {object|null}
     */
    static target(app) {
        return politicalSets(app).at(-1) ?? null;
    }

    /**
     * Writes a run's new Political set into the set that remains: level by level (by depth), the
     * new regions take new keys and fill only the cells no kept region holds; a new region left
     * with no cells is dropped. A new region that stands for a kept one (`standsFor`, a run built
     * round the map's own regions; see UserRealms) is not added: its key is the kept region's, so
     * the regions made inside it name the kept region as their parent. A kept region with no
     * parent of its own (a lone duchy or county) takes the one the run gave it (the state it made
     * of it, or the realm it placed it in), marked `parentFromRun`: the link keeps the levels
     * nested on the map, but keptKeys does not follow it, so the next run is free to place the
     * region again rather than keeping that parent as the reader's own. The kept region also takes
     * what the run made of it (see writeFigures). The new set's own levels leave the session. Returns each target level's owners before and after (encoded).
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
            // New keys after the level's own, so kept regions keep theirs; a region standing for a
            // kept one takes its key
            const kept = new Map(level.regions.map((region) => [region.key, region]));
            const standing = (region) => Number.isInteger(region.standsFor) && kept.has(region.standsFor);
            const keys = new Map();
            let next = level.nextKey;
            for (const region of fresh.regions) keys.set(region.key, standing(region) ? region.standsFor : next++);
            const held = new Set();
            for (let cell = 0; cell < array.length; cell++) {
                const owner = from[cell];
                if (owner === UNCLAIMED || array[cell] !== UNCLAIMED || kept.has(keys.get(owner))) continue;
                array[cell] = keys.get(owner);
                held.add(array[cell]);
            }
            const parentOf = (region) => (depth === 0 ? region.parentKey : (parentKeys?.get(region.parentKey) ?? UNCLAIMED));
            for (const region of fresh.regions.filter(standing)) {
                const own = kept.get(region.standsFor);
                writeFigures(own, region.generated);
                if (depth === 0 || (Number.isInteger(own.parentKey) && !own.parentFromRun)) continue;
                const parent = parentOf(region);
                own.parentKey = parent === UNCLAIMED ? null : parent;
                if (parent === UNCLAIMED) delete own.parentFromRun;
                else own.parentFromRun = true;
            }
            const regions = fresh.regions
                .filter((region) => !standing(region))
                .map(({ standsFor: _standsFor, ...region }) => ({ ...region, key: keys.get(region.key), parentKey: parentOf(region) }))
                .filter((region) => held.has(region.key));
            level.regions.push(...regions);
            level.nextKey = next;
            parentKeys = keys;
            session.restoreLevelOwners(level.id, array);
            changes.push({ levelId: level.id, before, after: session.layer(level.id).encode() });
        });
        for (const level of made.levels) session.removeLevelOwners(level.id);
        session.setLayerSets(app.layerSets);
        return changes;
    }

    /**
     * New pins, less those on a kept pin's cell, or whose model cell's site a kept pin stands on (a
     * port or river town stands off its site, on its shore or river).
     */
    static placesBeside(app, pins) {
        const taken = new Set((app.mapPins ?? []).filter((pin) => Number.isInteger(pin.cell)).map((pin) => pin.cell));
        const siteOf = (cell) => app.meshSession?.mesh?.parentOf?.[cell] ?? cell;
        return pins.filter((pin) => !taken.has(pin.cell) && !taken.has(siteOf(pin.cell)));
    }
}
