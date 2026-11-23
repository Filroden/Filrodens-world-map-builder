import { UNCLAIMED, createLevel } from "../mesh/Schema.js";
import { UserFigures } from "./UserFigures.js";

/**
 * Running Generate again, and Remove generated content: what earlier runs made is replaced,
 * except what the reader has made their own.
 *
 * - An item is kept when it is hand-made, or generated and edited (a substantive change; see
 *   GeneratedEdits) or locked, or a generated pin with an entered population (see UserFigures).
 * - A region is kept only for itself (Ken, 2026-11-23): one the reader drew, or a generated one
 *   edited, locked or given cultures. The generated regions above and inside it are the run's to
 *   remake. A kept duchy or county whose parent goes is left unassigned, so the next run may take
 *   it into a realm (or duchy) of its own, unless it is ticked Independent. The rest of each
 *   Political set is removed with its cells.
 * - A set left with no regions is removed, except the latest Political set (the map's one). A run
 *   writes into that set (new regions fill only the cells no kept region holds; one left with
 *   none is dropped), so its levels keep their names and looks, or adds a new one when there is none.
 *   There is only ever the one Political set: a run making fewer levels than it holds (no duchies
 *   or counties) writes into its top levels, the levels below keeping only their kept regions;
 *   a run making more adds the levels it lacks.
 * - New places are not put on a kept pin's cell.
 *
 * Every step records what it changes, so the caller makes the whole of it one undo step.
 */

/** Whether a generated item is the reader's own: edited or locked. */
export function isKept(item) {
    // A generated pin with an entered population is the reader's, as an edited one is (see
    // UserFigures); so is a generated region the reader gave cultures (UC phase 2)
    return !!item && (!item.generated || item.generated.edited === true || item.generated.locked === true || UserFigures.has(item) || (Array.isArray(item.cultures) && item.cultures.length > 0));
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
     * The latest Political set stays even when left empty (the map's one Political set, which
     * a run writes into and which is never removed); an older one left empty goes.
     * @param {object} app
     * @returns {{owners: {levelId: string, before: string, after: string|null}[], target: object|null}}
     */
    static remove(app) {
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
            // A kept region whose parent went is unassigned, for the next run to place (or not,
            // when it is ticked Independent)
            set.levels.forEach((level, depth) => {
                if (depth === 0) return;
                const above = new Set(set.levels[depth - 1].regions.map((region) => region.key));
                for (const region of level.regions) {
                    if (region.parentKey === null || region.parentKey === undefined || region.parentKey === UNCLAIMED || above.has(region.parentKey)) continue;
                    region.parentKey = null;
                    delete region.parentFromRun;
                }
            });
            if (set.levels.every((level) => level.regions.length === 0)) emptied.add(set);
        }
        emptied.delete(politicalSets(app).at(-1));
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
     * Each level's kept region keys in a Political set: each region kept for itself (drawn by the
     * reader, or generated and edited, locked or given cultures; see isKept). Neither the regions
     * above a kept one nor those inside it are kept with it (Ken, 2026-11-23): what the reader set
     * is what stands.
     * @returns {Set<number>[]} One set of keys per level, by depth.
     */
    static keptKeys(set) {
        return (set?.levels ?? []).map((level) => new Set(level.regions.filter(isKept).map((region) => region.key)));
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
     * @returns {{levelId: string, before: string|null, after: string}[]} before is null for a level the run added.
     */
    static merge(app, target, made) {
        const session = app.meshSession;
        const changes = [];
        // A run of more levels than the set holds adds the ones it lacks, each as the run made it
        // (its name and look) under the set's deepest, so the map keeps one Political set
        const added = new Set();
        while (target.levels.length < made.levels.length) {
            const { id: _id, ownersKey: _ownersKey, regions: _regions, nextKey: _nextKey, ...fields } = made.levels[target.levels.length];
            const level = createLevel({ ...fields, parentLevelId: target.levels.at(-1).id, regions: [] });
            target.levels.push(level);
            added.add(level.id);
        }
        if (added.size) session.setLayerSets(app.layerSets);
        let parentKeys = null;
        // A run of fewer levels (no duchies or counties) writes into the set's top ones
        target.levels.slice(0, made.levels.length).forEach((level, depth) => {
            const fresh = made.levels[depth];
            const into = session.layer(level.id);
            const before = added.has(level.id) ? null : into.encode();
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
