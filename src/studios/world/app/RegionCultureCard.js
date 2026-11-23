import { FILRODENSWMB } from "../../../config.js";
import { platform } from "../../../platform/index.js";
import { cleanCultures } from "../generator/RegionCultures.js";
import { levelDepth, setOfLevel } from "../mesh/LayerTree.js";
import { Generation } from "./Generation.js";
import { MapStateManager } from "./MapStateManager.js";
import { Regeneration } from "./Regeneration.js";

/** The reorder list the Cultures card's mini-cards are (see ListReorder, MapStudio's #moveListItem). */
export const CULTURE_LIST = "regionCultures";

/** The share field of a culture's mini-card, by the culture's id. */
const SHARE_FIELD = "regionCultureShare:";

/**
 * The region inspector's **Cultures** card (UC phase 2; boards U2 and U2b): the cultures the reader
 * gives a region of the Political set Generate builds round (see generator/RegionCultures).
 *
 * - **One culture:** seeded in the region and left to the model; no share.
 * - **Two or more:** whole-number shares, held by the run across the region's land. Raising one
 *   takes from Unassigned first (always the last row), then from the bottom card up; lowering one
 *   leaves the rest Unassigned, for the model to fill. The shares always read 100%.
 * - **The top card** rules a realm, or an independent duchy or county: drawn in the hue with a
 *   Rules badge. Dragging a card's handle (or Up and Down on it) changes the order.
 * - **A deleted culture** (gone from the world's Cultures) reads Deleted culture, kept until
 *   removed; the run passes over it.
 * - **Read only** on a held regional world (Fill in neither spreads cultures nor builds realms);
 *   outside the run's Political set, the card says why and offers Move to Political set….
 *
 * Every change is one undo step and marks the run Out of date (see RunInputs' `cultures`).
 */
export class RegionCultureCard {
    /**
     * The card's context, or null where it is not shown (a region of no set, or a set of no level).
     * @param {object} app
     * @param {object} region
     * @param {string} levelId
     * @param {{canMoveToPolitical?: boolean}} [options]
     */
    static context(app, region, levelId, { canMoveToPolitical = false } = {}) {
        const set = setOfLevel(app.layerSets ?? [], levelId);
        const level = set?.levels.find((candidate) => candidate.id === levelId);
        if (!set || !level) return null;
        const target = Regeneration.target(app);
        if (set !== target || !Regeneration.chain(set)) return { outside: true, canMove: canMoveToPolitical };
        const depth = levelDepth(set, level);
        const world = app.uiState?.cultures ?? [];
        const byId = new Map(world.map((culture) => [culture.id, culture]));
        const chosen = cleanCultures(region.cultures);
        const shared = chosen.length > 1 && chosen.every((entry) => Number.isInteger(entry.share));
        // The first rules a realm, or a duchy or county ticked Independent
        const rules = depth === 0 || region.independent === true;
        const rows = chosen.map((entry, index) => {
            const culture = byId.get(entry.culture);
            return {
                id: entry.culture,
                name: culture?.name ?? null,
                color: culture?.color ?? null,
                gone: !culture,
                share: shared ? entry.share : null,
                shareField: `${SHARE_FIELD}${entry.culture}`,
                rules: index === 0 && rules,
            };
        });
        const total = shared ? rows.reduce((sum, row) => sum + row.share, 0) : 0;
        const unassigned = shared ? Math.max(0, 100 - total) : 0;
        const held = Generation.heldByParent(app);
        const addable = world.filter((culture) => !chosen.some((entry) => entry.culture === culture.id)).map((culture) => ({ id: culture.id, name: culture.name, color: culture.color }));
        const i18n = platform.i18n;
        let hint = "FILRODENSWMB.UI.RegionCulturesNoneHint";
        if (rows.length === 1) hint = rules ? "FILRODENSWMB.UI.RegionCulturesOneHint" : "FILRODENSWMB.UI.RegionCulturesOneUnruledHint";
        else if (rows.length > 1 && unassigned > 0) hint = "FILRODENSWMB.UI.RegionCulturesUnassignedHint";
        else if (rows.length > 1) hint = rules ? "FILRODENSWMB.UI.RegionCulturesSharesHint" : "FILRODENSWMB.UI.RegionCulturesSharesUnruledHint";
        return {
            rows,
            count: rows.length,
            reorderable: rows.length > 1 && !held,
            shared,
            unassigned: shared && unassigned > 0 ? unassigned : null,
            bar: shared ? [...rows.filter((row) => row.share > 0).map((row) => ({ share: row.share, color: row.color, gone: row.gone })), ...(unassigned > 0 ? [{ share: unassigned, unassigned: true }] : [])] : null,
            addable,
            canAdd: !held && addable.length > 0 && rows.length < FILRODENSWMB.GENERATOR.CULTURES.MAX,
            noWorldCultures: world.length === 0,
            held,
            hint: i18n.format(hint, { unassigned, name: rows[0]?.name ?? i18n.localize("FILRODENSWMB.UI.RegionCultureDeleted") }),
        };
    }

    /** Whether a committed field is one of the card's share fields. */
    static isShareField(field) {
        return typeof field === "string" && field.startsWith(SHARE_FIELD);
    }

    /**
     * A share committed: its culture takes the new whole share, from Unassigned first, then from the
     * bottom card up; a lower share leaves the rest Unassigned. One undo step when anything changed.
     */
    static applyShare(app, region, form, field) {
        const id = field.slice(SHARE_FIELD.length);
        const input = [...form.elements].find((element) => element.name === field);
        const list = cleanCultures(region.cultures);
        const at = list.findIndex((entry) => entry.culture === id);
        if (!input || at < 0 || list.length < 2) return false;
        const shares = rebalance(list.map((entry) => entry.share ?? 0), at, Number.parseInt(String(input.value).trim(), 10));
        if (shares.every((share, index) => share === list[index].share)) return false;
        return this.#write(app, region, list.map((entry, index) => ({ culture: entry.culture, share: shares[index] })));
    }

    /** Add culture…: the culture joins at the bottom; the second one splits the region evenly with the first, a later one takes what is Unassigned. */
    static add(app, region, id) {
        if (!(app.uiState?.cultures ?? []).some((culture) => culture.id === id)) return false;
        const list = cleanCultures(region.cultures);
        if (list.some((entry) => entry.culture === id) || list.length >= FILRODENSWMB.GENERATOR.CULTURES.MAX) return false;
        if (!list.length) return this.#write(app, region, [{ culture: id, share: null }]);
        if (list.length === 1) return this.#write(app, region, [{ culture: list[0].culture, share: 50 }, { culture: id, share: 50 }]);
        const total = list.reduce((sum, entry) => sum + (entry.share ?? 0), 0);
        return this.#write(app, region, [...list, { culture: id, share: Math.max(0, 100 - total) }]);
    }

    /** The delete icon: the culture leaves; its share becomes Unassigned, and one culture left has none. */
    static remove(app, region, id) {
        const list = cleanCultures(region.cultures).filter((entry) => entry.culture !== id);
        if (list.length === cleanCultures(region.cultures).length) return false;
        if (list.length === 1) list[0].share = null;
        return this.#write(app, region, list);
    }

    /** A card dragged (or moved with Up or Down) to its new place; the top card rules. */
    static move(app, region, id, to) {
        const list = cleanCultures(region.cultures);
        const from = list.findIndex((entry) => entry.culture === id);
        if (from < 0 || to < 0 || to >= list.length || from === to) return false;
        const [entry] = list.splice(from, 1);
        list.splice(to, 0, entry);
        return this.#write(app, region, list);
    }

    /** Writes the region's cultures as one undo step (none: the field goes), and redraws. */
    static #write(app, region, list) {
        if (Generation.heldByParent(app)) return false;
        MapStateManager.pushVectorState(app);
        if (list.length) region.cultures = list;
        else delete region.cultures;
        app.markDirty();
        // The Generate panel's Out of date follows (see RunInputs' cultures)
        app.view?.render(["context"]);
        return true;
    }
}

/**
 * The shares after one is set (see RegionCultureCard.applyShare): whole percents, never over 100 in
 * all. A higher share takes from what is Unassigned first, then from the other cultures from the
 * bottom up; it is held to what they can give. A lower one leaves the difference Unassigned.
 * @param {number[]} shares
 * @param {number} at
 * @param {number} wanted
 * @returns {number[]}
 */
export function rebalance(shares, at, wanted) {
    const out = [...shares];
    if (!Number.isFinite(wanted)) return out;
    const target = Math.max(0, Math.min(100, Math.round(wanted)));
    let need = target - out[at];
    if (need <= 0) {
        out[at] = target;
        return out;
    }
    const total = out.reduce((sum, share) => sum + share, 0);
    const free = Math.min(need, Math.max(0, 100 - total));
    out[at] += free;
    need -= free;
    for (let index = out.length - 1; index >= 0 && need > 0; index--) {
        if (index === at) continue;
        const take = Math.min(out[index], need);
        out[index] -= take;
        out[at] += take;
        need -= take;
    }
    return out;
}
