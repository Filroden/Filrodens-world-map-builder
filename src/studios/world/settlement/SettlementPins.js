import { WORLD_PARTS } from "../config.js";

/**
 * A settlement map follows its place through a re-run (L-surface step 2b; Ken, 2026-11-24): a run
 * (Generate again, Fill in again) replaces the generated pins it does not keep with new ones under
 * new ids, and a settlement map is its pin's by id. So the new pin for the same place takes the
 * id of the pin it replaces: the one on the same cell first, then on the same model cell, then the
 * nearest new settlement within LOCAL.FOLLOW_CELLS model cells' spacing; each old pin and each new
 * one taken once, the closest pairs first. A place the run no longer makes leaves its settlement
 * map without a pin (Its pin has gone). The settlement map then shows Out of date for whatever the
 * run changed about it.
 *
 * Undoing the run brings the old pins back with their ids, so nothing more is needed for Undo.
 */
export const SettlementPins = Object.freeze({
    /**
     * Gives each new settlement pin standing for a replaced pin with a settlement map that pin's id.
     * @param {object} app - Its mesh (cells and model cells) and the map's size.
     * @param {object[]} replaced - The pins the run removed.
     * @param {object[]} placed - The pins it is about to add (changed in place).
     * @param {Set<string>} linked - The ids of pins with a settlement map.
     * @returns {number} How many settlement maps follow their place.
     */
    follow(app, replaced, placed, linked) {
        const gone = replaced.filter((pin) => linked.has(pin.id));
        if (!gone.length) return 0;
        const mesh = app.meshSession?.mesh ?? null;
        const siteOf = (cell) => mesh?.parentOf?.[cell] ?? cell;
        const spacing = mesh?.modelCount ? Math.sqrt(((app.mapWidth ?? 0) * (app.mapHeight ?? 0)) / mesh.modelCount) : 0;
        const reach = spacing * WORLD_PARTS.FOLLOW_CELLS;
        const towns = placed.filter((pin) => pin.generated?.kind === "town");
        const pairs = [];
        for (const old of gone) {
            for (const pin of towns) {
                const cells = Number.isInteger(old.cell) && Number.isInteger(pin.cell);
                const sameCell = cells && old.cell === pin.cell;
                const sameSite = cells && siteOf(old.cell) === siteOf(pin.cell);
                const distance = Math.hypot((old.x ?? 0) - (pin.x ?? 0), (old.y ?? 0) - (pin.y ?? 0));
                if (!sameCell && !sameSite && !(distance <= reach)) continue;
                pairs.push({ old, pin, rank: sameCell ? 0 : sameSite ? 1 : 2, distance });
            }
        }
        pairs.sort((a, b) => a.rank - b.rank || a.distance - b.distance);
        const followed = new Set();
        const taken = new Set();
        for (const { old, pin } of pairs) {
            if (followed.has(old.id) || taken.has(pin)) continue;
            pin.id = old.id;
            followed.add(old.id);
            taken.add(pin);
        }
        return followed.size;
    },
});
