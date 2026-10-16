import { FILRODENSWMB } from "../config.js";
import { MapStateManager } from "./MapStateManager.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { VectorHistory } from "./VectorHistory.js";
import { addRegion, childLevelFields, createLayerSet, createLevel, regionFillColor, UNCLAIMED, VISIBILITIES } from "../mesh/Schema.js";
import { childLevels, descendantLevels, insertLevel, levelDepth, parentLevel, setOfLevel, setParent, uniqueName } from "../mesh/LayerTree.js";
import { assignToParents, autoAssign, claimWaters, deleteLevel, deleteRegion, deleteSet, levelCounts, mergeRegion, nestingProblems, regionParents, unassignedCount } from "../mesh/RegionEdits.js";
import { platform } from "../platform/index.js";

/** Where the dialogue templates live (Merge Into's). */
const DIALOG_ROOT = "modules/filrodens-world-map-builder/templates/dialogs/";

/**
 * The Regions tool's panel: cascading lists, one per level (see context and tools-regions.hbs).
 * First the map's layer sets; then the chosen set's top level; then each level below, showing
 * only the regions inside the region chosen in the list above ("Provinces · in Zor"); and so on,
 * as deep as the set goes. The data's levels are unchanged: a child level is the next tier of its
 * set, and its regions name their parent region (parentKey).
 *
 * Choosing a row opens it in the inspector; choosing a region also makes it the region painted
 * and sets what the next list shows. Which region is chosen in each level is the studio's
 * `regionPath` (a Map of level id → region id, kept for the session, not with the map), kept in
 * step with the region being painted however it was chosen (a list, the map, the inspector).
 *
 * Every list ends with an add row: + Set, and + Region in <parent> in a layer (the set, for a top
 * layer; the region chosen above, for a layer below, made with that parent). The chain of lists
 * ends with + Layer below, which makes the next layer ("Layer <tier>") with no regions, so a set's
 * layers can be laid out before they hold any. A new entry is named in a row
 * of its own before it is made (see RegionLists). Nothing is created from a menu: a set's menu has
 * rename, move and delete; a level's heading has its edit button and a menu (rename, edit several
 * regions, auto-assign, fix nesting, delete); a region's menu has rename, merge and delete.
 *
 * The studio keeps which set, level and region are being edited (activeLayerSetId,
 * activeLevelId, activeRegionId); this panel keeps them valid (see settleActive) and works on the
 * studio's layer sets (app.layerSets) and mesh session. Every change is one undo step: a vector
 * snapshot taken first, plus the owner changes it made, as one composite entry where cells
 * changed too (see VectorHistory).
 */
export class RegionPanel {
    // ------------------------------------------------------------------ the panel's context

    /**
     * What tools-regions.hbs draws: the Sets list and, for the chosen set, one entry per list in
     * reading order (see sections).
     * @param {object} app
     * @param {Record<string, string>} [inspected] - What the inspector shows (Inspector.inspected).
     * @returns {object}
     */
    static context(app, inspected = {}) {
        this.settleActive(app);
        const sections = this.sections(app, inspected);
        for (const list of [sections.sets, ...sections.levels.filter((entry) => entry.rows)]) {
            // One tab stop per list: its chosen row, else its first
            const stop = list.rows.find((row) => row.selected) ?? list.rows.find((row) => row.focusable);
            if (stop) stop.tabStop = true;
            else if (list.add) list.add.tabStop = true;
        }
        return sections;
    }

    /**
     * The lists. `sets` is the Sets list; `levels` holds, in reading order, each level's list
     * (`type` "level": its heading, rows and add row) and the + Layer row (`type` "addLayer"). A
     * row has `type` ("set", "region", "unassigned", "naming") and `key` (its type and id).
     */
    static sections(app, inspected = {}) {
        const sets = app.layerSets ?? [];
        const naming = app.regionNaming ?? null;
        const setRows = [];
        sets.forEach((set, index) => {
            const key = `set:${set.id}`;
            if (naming?.kind === "rename" && naming.key === key) {
                setRows.push(this.#namingRow(naming));
                return;
            }
            setRows.push({
                type: "set",
                key,
                id: set.id,
                name: set.name,
                visibility: set.visibility ?? "all",
                levelCount: set.levels.length,
                levelsKey: set.levels.length === 1 ? "FILRODENSWMB.UI.SetLevelMeta" : "FILRODENSWMB.UI.SetLevelsMeta",
                selected: set.id === app.activeLayerSetId,
                inspected: inspected.set === set.id,
                canMoveUp: index > 0,
                canMoveDown: index < sets.length - 1,
                focusable: true,
            });
        });
        if (naming?.kind === "set") setRows.push(this.#namingRow(naming));
        const result = {
            sets: { key: "sets", rows: setRows, add: { key: "add:sets", action: "addLayerSet", label: "FILRODENSWMB.UI.AddSet", hint: "FILRODENSWMB.UI.LayerSetsHint" } },
            levels: [],
            massEdit: null,
        };

        const set = this.activeSet(app);
        if (!set) return result;
        const tops = childLevels(set, null);
        for (const level of tops) this.#pushLevel(app, result, set, level, null, inspected, naming);
        if (tops.length === 0) result.levels.push(this.#addLayerRow({ setId: set.id, name: set.name }));
        return result;
    }

    /**
     * A level's list (its regions inside `parent`, the region chosen in the level above, or all of
     * a top level's), then the lists of the levels below it, or + Layer below when there are none.
     * The lists below are shown whether or not a region is chosen, so the set's layers can be laid
     * out before they hold regions; a list whose parent layer has no region chosen asks for one.
     */
    static #pushLevel(app, result, set, level, parent, inspected, naming) {
        const key = `level:${level.id}`;
        const below = childLevels(set, level.id);
        const parentLevelOf = level.parentLevelId ? set.levels.find((candidate) => candidate.id === level.parentLevelId) : null;
        const waiting = !!parentLevelOf && !parent;
        const painting = !!app.uiState?.isEditMode && app.activeTool === "regions";
        const massEdit = !!app.massEditMode?.region && app.massEditLevelId === level.id;
        const regionRow = (region) => {
            const regionKey = `region:${region.id}`;
            if (naming?.kind === "rename" && naming.key === regionKey) return this.#namingRow(naming);
            const working = region.id === app.activeRegionId && level.id === app.activeLevelId;
            return {
                type: "region",
                key: regionKey,
                id: region.id,
                levelId: level.id,
                name: region.name,
                visibility: region.visibility ?? "all",
                swatch: regionFillColor(region),
                // The regions inside it, in the layers below (none shown when there are none below)
                count: below.length ? below.reduce((sum, child) => sum + child.regions.filter((inner) => inner.parentKey === region.key).length, 0) : null,
                working,
                stateWord: working && painting ? "FILRODENSWMB.UI.TreeStatePainting" : null,
                selected: app.regionPath?.get(level.id) === region.id,
                massEdit,
                massEditSelected: massEdit && (app.massEditSelection?.region?.has(region.id) ?? false),
                focusable: true,
            };
        };
        const { listed, unassigned } = this.#regionsOf(app, set, level, parent);
        const rows = listed.map(regionRow);
        if (naming?.kind === "region" && naming.levelId === level.id) rows.push(this.#namingRow(naming));
        if (unassigned.length) {
            const open = !!app.regionUnassignedOpen?.has(level.id);
            rows.push({ type: "unassigned", key: `unassigned:${level.id}`, levelId: level.id, count: unassigned.length, open, focusable: true });
            if (open) rows.push(...unassigned.map(regionRow));
        }
        const sectionKey = `regionList-${level.id}`;
        if (massEdit) result.massEdit = { levelId: level.id, name: level.name, count: app.massEditSelection?.region?.size ?? 0 };
        result.levels.push({
            type: "level",
            key,
            sectionKey,
            id: level.id,
            setId: set.id,
            name: level.name,
            renaming: naming?.kind === "rename" && naming.key === key ? this.#namingRow(naming) : null,
            parentName: waiting ? null : parent ? parent.name : set.name,
            hasParent: !!level.parentLevelId,
            isFree: level.nestingMode === "free",
            problems: level.parentLevelId && app.meshSession ? nestingProblems(app.meshSession, level).length : 0,
            unassignedCells: level.parentLevelId && app.meshSession ? unassignedCount(app.meshSession, level) : 0,
            canMassEdit: listed.length + unassigned.length > 0,
            massEdit: massEdit ? result.massEdit : null,
            rows,
            empty: waiting
                ? { key: "FILRODENSWMB.UI.ChooseParentRegion", name: parentLevelOf.name }
                : rows.length === 0
                  ? { key: "FILRODENSWMB.UI.NoRegionsInParentYet", name: parent ? parent.name : set.name }
                  : null,
            add: waiting
                ? null
                : {
                      key: `add:${key}`,
                      action: "addRegion",
                      levelId: level.id,
                      parentId: parent?.id ?? null,
                      label: "FILRODENSWMB.UI.AddRegionIn",
                      labelName: parent ? parent.name : set.name,
                      hint: "FILRODENSWMB.UI.RegionsHint",
                  },
        });

        const chosen = parent || !parentLevelOf ? level.regions.find((region) => region.id === app.regionPath?.get(level.id)) : null;
        for (const child of below) this.#pushLevel(app, result, set, child, chosen ?? null, inspected, naming);
        if (below.length === 0) result.levels.push(this.#addLayerRow({ levelId: level.id, name: level.name }));
    }

    /** + Layer below <layer> (or + Layer in <set>, for a set with no layer yet). */
    static #addLayerRow({ setId = null, levelId = null, name }) {
        return { type: "addLayer", key: `addLayer:${levelId ?? setId}`, setId, levelId, name, label: levelId ? "FILRODENSWMB.UI.AddLayerBelow" : "FILRODENSWMB.UI.AddLayerIn" };
    }

    /**
     * A level's regions for its list, by name: those inside `parent` (all of a top level's), and
     * apart from them those without a single parent region (free nesting, or a map from before
     * parents were kept), which every list of the level shows folded as Unassigned.
     */
    static #regionsOf(app, set, level, parent) {
        const alphaSort = (a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });
        const regions = [...level.regions].sort(alphaSort);
        if (!level.parentLevelId) return { listed: regions, unassigned: [] };
        const parentKeys = new Set(set.levels.find((candidate) => candidate.id === level.parentLevelId)?.regions.map((region) => region.key) ?? []);
        const hasParent = (region) => region.parentKey !== null && region.parentKey !== undefined && parentKeys.has(region.parentKey);
        return {
            listed: parent ? regions.filter((region) => hasParent(region) && region.parentKey === parent.key) : [],
            unassigned: regions.filter((region) => !hasParent(region)),
        };
    }

    /** The ids of the regions a level's list shows (its Mass Edit's Select all). */
    static listedRegionIds(app, levelId) {
        const level = this.#level(app, levelId);
        const set = setOfLevel(app.layerSets ?? [], levelId);
        if (!level || !set) return [];
        const parentId = level.parentLevelId ? app.regionPath?.get(level.parentLevelId) : null;
        const parent = parentId ? this.#level(app, level.parentLevelId)?.regions.find((region) => region.id === parentId) : null;
        const { listed, unassigned } = this.#regionsOf(app, set, level, parent);
        return [...listed, ...unassigned].map((region) => region.id);
    }

    /** The row a new (or renamed) entry is named in. */
    static #namingRow(naming) {
        return { type: "naming", key: "naming", kind: naming.kind, value: naming.value ?? "", swatch: naming.swatch ?? null, label: naming.label, focusable: true };
    }

    // ------------------------------------------------------------------ the chosen regions

    /**
     * Chooses a region in its level's list: it and the regions holding it (by their parent keys)
     * are chosen in the lists above, and the levels below forget theirs.
     */
    static choosePath(app, levelId, regionId) {
        const set = setOfLevel(app.layerSets ?? [], levelId);
        if (!set) return;
        app.regionPath ??= new Map();
        for (const below of descendantLevels(set, levelId)) app.regionPath.delete(below.id);
        let level = set.levels.find((candidate) => candidate.id === levelId);
        let region = level?.regions.find((candidate) => candidate.id === regionId);
        if (!region) {
            app.regionPath.delete(levelId);
            return;
        }
        while (level && region) {
            app.regionPath.set(level.id, region.id);
            const parent = parentLevel(set, level);
            const key = region.parentKey;
            region = parent && key !== null && key !== undefined ? parent.regions.find((candidate) => candidate.key === key) : null;
            level = parent;
        }
    }

    /** Opens or closes a level's Unassigned row. */
    static toggleUnassigned(app, levelId) {
        app.regionUnassignedOpen ??= new Set();
        if (app.regionUnassignedOpen.has(levelId)) app.regionUnassignedOpen.delete(levelId);
        else app.regionUnassignedOpen.add(levelId);
    }

    /** A level of any set, by id. */
    static #level(app, levelId) {
        return setOfLevel(app.layerSets ?? [], levelId)?.levels.find((level) => level.id === levelId) ?? null;
    }

    /** The layer set being edited, or null when the map has none. */
    static activeSet(app) {
        return (app.layerSets ?? []).find((set) => set.id === app.activeLayerSetId) ?? null;
    }

    /** The level being edited (always one of the active set's), or null. */
    static activeLevel(app) {
        return this.activeSet(app)?.levels.find((level) => level.id === app.activeLevelId) ?? null;
    }

    /** The region being edited (always one of the active level's), or null. */
    static activeRegion(app) {
        return this.activeLevel(app)?.regions.find((region) => region.id === app.activeRegionId) ?? null;
    }

    /**
     * Keeps the active set, level and region pointing at things that exist and belong together: a
     * set that has gone (an undo, a deletion) gives way to the first set, a level outside the
     * active set to that set's first level, and a region outside the active level to none.
     */
    static settleActive(app) {
        const sets = app.layerSets ?? [];
        if (!sets.some((set) => set.id === app.activeLayerSetId)) app.activeLayerSetId = sets[0]?.id ?? null;
        const set = this.activeSet(app);
        if (!set?.levels.some((level) => level.id === app.activeLevelId)) {
            app.activeLevelId = set?.levels[0]?.id ?? null;
            app.activeRegionId = null;
        }
        const level = this.activeLevel(app);
        if (!level?.regions.some((region) => region.id === app.activeRegionId)) app.activeRegionId = null;
        // The lists' choices: none of a region that has gone, and the region being painted chosen
        // however it became so (a region made by painting unclaimed land, say)
        const path = app.regionPath;
        if (path) {
            for (const [levelId, regionId] of [...path]) {
                const level = this.#level(app, levelId);
                if (!level) path.delete(levelId);
                else if (!level.regions.some((region) => region.id === regionId)) this.choosePath(app, levelId, null);
            }
        }
        if (app.activeRegionId && path?.get(app.activeLevelId) !== app.activeRegionId) this.choosePath(app, app.activeLevelId, app.activeRegionId);
    }

    // ------------------------------------------------------------------ choosing

    /** The layer set a row names (its `data-set-id`), or null. */
    static setIdOf(target) {
        return this.#setIdOf(target);
    }

    /** The level a row names (its `data-level-id`), or null. */
    static levelIdOf(target) {
        return this.#levelIdOf(target);
    }

    /** Makes a layer set the active one (a click on its row, or its opening in the inspector). */
    static selectSetById(app, setId) {
        if (!setId || setId === app.activeLayerSetId) return;
        app.activeLayerSetId = setId;
        app.activeLevelId = null;
        app.activeRegionId = null;
        this.#refresh(app, { vectors: false });
    }

    /** Makes a level the active one, with its set (a click on its row, or its opening in the inspector). */
    static selectLevelById(app, levelId) {
        const set = setOfLevel(app.layerSets ?? [], levelId);
        if (!set || (levelId === app.activeLevelId && set.id === app.activeLayerSetId)) return;
        app.activeLayerSetId = set.id;
        app.activeLevelId = levelId;
        app.activeRegionId = null;
        this.#refresh(app, { vectors: false });
    }

    /**
     * Makes a region the region being edited, with its level and set, and chooses it (and the
     * regions holding it) in the lists (a row, a pick on the map, the region opening in the
     * inspector); null ids let go of the region, and its level's list forgets its choice.
     */
    static selectRegionById(app, levelId, regionId) {
        if (!regionId) {
            if (app.activeRegionId === null) return;
            if (app.activeLevelId) this.choosePath(app, app.activeLevelId, null);
            app.activeRegionId = null;
            this.#refresh(app, { vectors: false, toolbar: true });
            return;
        }
        const set = setOfLevel(app.layerSets ?? [], levelId);
        if (!set) return;
        this.choosePath(app, levelId, regionId);
        if (regionId === app.activeRegionId && levelId === app.activeLevelId) return;
        app.activeLayerSetId = set.id;
        app.activeLevelId = levelId;
        app.activeRegionId = regionId;
        this.#refresh(app, { vectors: false, toolbar: true });
    }

    // ------------------------------------------------------------------ layer sets

    /**
     * A new layer set at the end of the map's, named as the reader named it in its row (see
     * RegionLists), with its first layer ("Layer 1", renamable from its heading), which become
     * the active set and level, its + Region ready. One undo step. Returns the set's id.
     */
    static createSet(app, name) {
        MapStateManager.pushVectorState(app);
        const set = createLayerSet({ name, visibility: "all", waterTint: true, opacity: 1, kind: "custom" }, this.#idFactory);
        const level = createLevel({ name: this.layerName(null, 1) }, this.#idFactory);
        set.levels.push(level);
        app.layerSets.push(set);
        app.meshSession?.setLayerSets(app.layerSets);
        app.activeLayerSetId = set.id;
        app.activeLevelId = level.id;
        app.activeRegionId = null;
        this.#refresh(app);
        return set.id;
    }

    /**
     * Renames a set, level or region (its row key) as one undo step; nothing changes for an empty
     * name or the name it has. Returns whether it changed.
     */
    static rename(app, key, name) {
        const object = this.objectOf(app, key);
        if (!object || !name || object.name === name) return false;
        MapStateManager.pushVectorState(app);
        object.name = name;
        this.#refresh(app);
        return true;
    }

    /** The set, level or region a row key names, or null. */
    static objectOf(app, key) {
        const [type, id] = String(key ?? "").split(":");
        if (type === "set") return (app.layerSets ?? []).find((set) => set.id === id) ?? null;
        if (type === "level") return this.#level(app, id);
        if (type === "region") return (app.regionLevels ?? []).flatMap((level) => level.regions).find((region) => region.id === id) ?? null;
        return null;
    }

    /** The name a new set or region is offered in its naming row: the next free one. */
    static suggestedName(app, kind, { levelId = null } = {}) {
        if (kind === "set") return uniqueName(platform.i18n.localize("FILRODENSWMB.UI.NewSetName"), app.layerSets ?? []);
        return uniqueName(platform.i18n.localize("FILRODENSWMB.UI.NewRegionName"), this.#level(app, levelId)?.regions ?? []);
    }

    /**
     * The layer set a new map starts with (S12): one set holding "Layer 1", so regions can be
     * added at once.
     */
    static starterLayerSets() {
        const set = createLayerSet({ name: platform.i18n.localize("FILRODENSWMB.UI.StarterSetName"), visibility: "all", waterTint: true, opacity: 1, kind: "custom" }, this.#idFactory);
        set.levels.push(createLevel({ name: this.layerName(null, 1) }, this.#idFactory));
        return [set];
    }

    /** Applies a set's changed fields (from its inspector) as one undo step. */
    static applySetEdit(app, set, values) {
        MapStateManager.pushVectorState(app);
        Object.assign(set, values);
        this.#refresh(app);
    }

    /** Delete Set (a row's menu): see deleteSetById. */
    static deleteSet(app, target) {
        return this.deleteSetById(app, this.#setIdOf(target));
    }

    /** Delete Set: after confirming with what it holds, the set and all its levels go. One undo step. */
    static async deleteSetById(app, setId) {
        const set = (app.layerSets ?? []).find((candidate) => candidate.id === setId);
        if (!set || !app.meshSession) return;
        const regions = set.levels.reduce((sum, level) => sum + level.regions.length, 0);
        const confirmed = await MapDialogManager._confirmDialog(platform.i18n.localize("FILRODENSWMB.UI.DeleteLayerSetTitle"), platform.i18n.format("FILRODENSWMB.UI.DeleteLayerSetConfirm", { name: set.name, levels: set.levels.length, regions }));
        if (!confirmed) return;

        const before = VectorHistory.snapshot(app);
        const removed = deleteSet(app.meshSession, app.layerSets, set.id);
        if (!removed) return;
        VectorHistory.push(app, VectorHistory.composite([before, ...removed.levels.map((entry) => VectorHistory.levelOwners(entry.levelId, entry.owners, null))]));
        this.#refresh(app);
    }

    /** Move Up and Move Down in a set's menu: sets are drawn in list order, the first lowest. */
    static moveSet(app, target, step) {
        const sets = app.layerSets ?? [];
        const index = sets.findIndex((set) => set.id === this.#setIdOf(target));
        const to = index + step;
        if (index < 0 || to < 0 || to >= sets.length) return;
        MapStateManager.pushVectorState(app);
        const [set] = sets.splice(index, 1);
        sets.splice(to, 0, set);
        app.meshSession?.setLayerSets(sets);
        this.#refresh(app);
    }

    /** The eye on a set's row: all, GM only, hidden, and round again. */
    static toggleSetVisibility(app, target) {
        const set = this.#setOf(app, target);
        if (!set) return;
        MapStateManager.pushVectorState(app);
        set.visibility = this.#nextVisibility(set.visibility);
        this.#refresh(app);
    }

    // ------------------------------------------------------------------ levels

    /**
     * + Layer below: the next layer below a layer (or a set's first layer), named "Layer <n>" by
     * its tier (renamable from its heading), with no regions yet. It becomes the active level. One
     * undo step. Returns its id, or null when the set or layer has gone.
     */
    static addLayerBelow(app, { setId = null, levelId = null }) {
        const set = levelId ? setOfLevel(app.layerSets ?? [], levelId) : (app.layerSets ?? []).find((candidate) => candidate.id === setId);
        if (!set) return null;
        const above = levelId ? set.levels.find((candidate) => candidate.id === levelId) : null;
        if (levelId && !above) return null;
        MapStateManager.pushVectorState(app);
        const level = createLevel({ name: this.layerName(set, above ? levelDepth(set, above) + 2 : 1), ...(levelId ? childLevelFields(levelId) : {}) }, this.#idFactory);
        insertLevel(set, level);
        app.meshSession?.setLayerSets(app.layerSets);
        app.activeLayerSetId = set.id;
        app.activeLevelId = level.id;
        app.activeRegionId = null;
        this.#refresh(app);
        return level.id;
    }

    /** "Layer <tier>", or the next free name after it in the set. */
    static layerName(set, tier) {
        return uniqueName(platform.i18n.format("FILRODENSWMB.UI.LayerName", { tier }), set?.levels ?? []);
    }

    /**
     * Applies a level's changed fields (from its inspector) as one undo step. A new parent moves the level (and the
     * levels below it) after that parent where needed, and each region of the level is given the
     * region of its new parent level holding most of its cells. A new territorial waters distance
     * (or a new parent, which changes where waters may lie) claims the waters again.
     */
    static applyLevelEdit(app, set, level, values) {
        const before = VectorHistory.snapshot(app);
        const { parentLevelId, ...fields } = values;
        const watersChanged = fields.watersPx !== level.watersPx;
        Object.assign(level, fields);
        const parentChanged = setParent(set, level.id, parentLevelId);
        if (parentChanged && app.meshSession) {
            app.meshSession.setLayerSets(app.layerSets);
            const parents = regionParents(app.meshSession, level);
            for (const region of level.regions) {
                const key = parents.get(region.key) ?? UNCLAIMED;
                region.parentKey = key === UNCLAIMED ? null : key;
            }
        }
        const waters = watersChanged || parentChanged ? this.watersEntry(app, level.id) : null;
        VectorHistory.push(app, VectorHistory.composite([before, waters]));
        this.#refresh(app);
    }

    /**
     * Gives a level its territorial waters after its land changed (see RegionEdits.claimWaters),
     * as an undo entry to add to the change's own, or null when nothing changed.
     */
    static watersEntry(app, levelId) {
        const level = app.meshSession?.level(levelId);
        if (!level) return null;
        const result = claimWaters(app.meshSession, level);
        return result ? VectorHistory.owners(levelId, result.patch) : null;
    }

    /**
     * Delete Level: after confirming with what it holds, the level goes, with its cells; the
     * levels below it move up to its parent. One undo step.
     */
    static deleteLevel(app, target) {
        return this.deleteLevelById(app, this.#levelIdOf(target));
    }

    /** Delete Level by id: see deleteLevel. */
    static async deleteLevelById(app, levelId) {
        const level = setOfLevel(app.layerSets ?? [], levelId)?.levels.find((candidate) => candidate.id === levelId);
        if (!level || !app.meshSession) return;

        const counts = levelCounts(app.meshSession, app.layerSets, levelId);
        const confirmed = await MapDialogManager._confirmDialog(platform.i18n.localize("FILRODENSWMB.UI.DeleteLevelTitle"), platform.i18n.format("FILRODENSWMB.UI.DeleteLevelConfirm", { name: level.name, ...counts }));
        if (!confirmed) return;

        const before = VectorHistory.snapshot(app);
        const removed = deleteLevel(app.meshSession, app.layerSets, levelId);
        if (!removed) return;
        VectorHistory.push(app, VectorHistory.composite([before, VectorHistory.levelOwners(levelId, removed.owners, null)]));
        this.#refresh(app);
    }

    /**
     * Auto-Assign: gives a child level's unassigned land to the nearest of its regions inside the
     * same parent region (see RegionEdits.autoAssign), under the processing overlay, which can
     * cancel it. One undo step.
     */
    static async autoAssign(app, target) {
        const level = this.#level(app, this.#levelIdOf(target));
        if (!level?.parentLevelId || !app.meshSession) return;
        const result = await app.runCancellable(platform.i18n.localize("FILRODENSWMB.UI.AutoAssigning"), (signal) => autoAssign(app.meshSession, level, { signal }));
        if (!result) return;
        VectorHistory.push(app, VectorHistory.composite([VectorHistory.owners(level.id, result.patch), this.watersEntry(app, level.id)]));
        platform.notify.info(platform.i18n.format("FILRODENSWMB.UI.AutoAssigned", { count: result.patch.cells.length, name: level.name }));
        this.#refresh(app);
    }

    /**
     * Fix Nesting: every region of the level is given the parent region holding most of its cells
     * and loses its cells outside it (see RegionEdits.assignToParents). One undo step.
     */
    static fixNesting(app, target) {
        const level = this.#level(app, this.#levelIdOf(target));
        if (!level?.parentLevelId || !app.meshSession) return;
        const before = VectorHistory.snapshot(app);
        const result = assignToParents(app.meshSession, level);
        VectorHistory.push(app, VectorHistory.composite([before, VectorHistory.owners(level.id, result?.patch), this.watersEntry(app, level.id)]));
        this.#refresh(app);
    }

    // ------------------------------------------------------------------ regions

    /**
     * A new, empty region in a level, named as the reader named it in its row (see RegionLists),
     * inside the parent region its list is filtered to (given as `parentId`, so it has its parent
     * from the start rather than from its first painting), which becomes the region being painted.
     * Its fill is left to the level's preset colours (see Schema.regionFillColor) unless a region
     * style is chosen on the bar. One undo step. Returns `{ levelId, id }`, or null when the level
     * (or the parent) has gone.
     */
    static createRegion(app, levelId, name, parentId = null) {
        const level = this.#level(app, levelId);
        const set = setOfLevel(app.layerSets ?? [], levelId);
        const parent = parentId && level?.parentLevelId ? this.#level(app, level.parentLevelId)?.regions.find((region) => region.id === parentId) : null;
        if (!level || (parentId && !parent)) return null;
        MapStateManager.pushVectorState(app);
        const region = this.#newRegion(app, level, name, parent?.key ?? null);
        this.#makeActive(app, set, level, region);
        return { levelId: level.id, id: region.id };
    }

    /** Adds a region to a level, in the bar's region style, if one is chosen. */
    static #newRegion(app, level, name, parentKey) {
        const style = (app.uiState.customRegionStyles ?? []).find((candidate) => candidate.id === app.uiState.activeRegionQuickStyle);
        return addRegion(level, { name: name || uniqueName(platform.i18n.localize("FILRODENSWMB.UI.NewRegionName"), level.regions), parentKey, quickStyle: style ? style.id : "custom", fillColor: style?.fillColor ?? null, fillStyle: style?.fillStyle ?? null, label: { visibility: "all" } }, this.#idFactory);
    }

    /** A region just made becomes the one painted, chosen in its list. */
    static #makeActive(app, set, level, region) {
        app.activeLayerSetId = set.id;
        app.activeLevelId = level.id;
        app.activeRegionId = region.id;
        this.choosePath(app, level.id, region.id);
        this.#refresh(app, { toolbar: true });
    }

    /**
     * Delete Region: its cells become unclaimed at its level. One undo step, which brings the
     * region and its cells back.
     */
    static async deleteRegion(app, levelId, regionId) {
        if (!app.meshSession || !app.regionLevels.some((level) => level.id === levelId)) return;
        const confirmed = await MapDialogManager._confirmDialog();
        if (!confirmed) return false;

        const before = VectorHistory.snapshot(app);
        const removed = deleteRegion(app.meshSession, levelId, regionId);
        if (!removed) return false;
        VectorHistory.push(app, VectorHistory.composite([before, VectorHistory.owners(levelId, removed.patch), this.watersEntry(app, levelId)]));
        this.#refresh(app);
        return true;
    }

    /**
     * Merge Into: the region's cells go to another region of the same level, chosen in a dialogue,
     * and the region goes. One undo step.
     */
    static async mergeRegion(app, levelId, regionId) {
        const level = app.regionLevels.find((candidate) => candidate.id === levelId);
        const region = level?.regions.find((candidate) => candidate.id === regionId);
        const others = level?.regions.filter((candidate) => candidate.id !== regionId) ?? [];
        if (!region || !others.length || !app.meshSession) {
            if (region) platform.notify.warn(platform.i18n.localize("FILRODENSWMB.UI.MergeNoOther"));
            return false;
        }
        const content = await platform.templates.render(`${DIALOG_ROOT}merge-region.hbs`, { region, others });
        const intoId = await platform.dialogs.prompt({
            classes: ["fwmb"],
            title: platform.i18n.format("FILRODENSWMB.UI.MergeRegionTitle", { name: region.name }),
            content,
            onSubmit: (form) => form.elements.mergeInto.value,
        });
        if (!intoId) return false;

        const before = VectorHistory.snapshot(app);
        const merged = mergeRegion(app.meshSession, levelId, regionId, intoId);
        if (!merged) return false;
        VectorHistory.push(app, VectorHistory.composite([before, VectorHistory.owners(levelId, merged.patch), this.watersEntry(app, levelId)]));
        app.activeRegionId = intoId;
        this.#refresh(app);
        return true;
    }

    // ------------------------------------------------------------------ helpers

    static #idFactory = () => platform.utils.randomID();

    /**
     * The level and region a region row's control belongs to, as [levelId, regionId] (the row
     * carries both, as data-layer-id and data-id).
     * @param {HTMLElement} target
     * @returns {[string|undefined, string|undefined]}
     */
    static regionIdsOf(target) {
        const row = target?.closest?.(".fwmb-list-item");
        return [row?.dataset.layerId, row?.dataset.id];
    }

    static #setIdOf(target) {
        return target?.closest?.("[data-set-id]")?.dataset.setId ?? null;
    }

    static #setOf(app, target) {
        const setId = this.#setIdOf(target);
        return (app.layerSets ?? []).find((set) => set.id === setId) ?? null;
    }

    static #levelIdOf(target) {
        return target?.closest?.("[data-level-id]")?.dataset.levelId ?? null;
    }

    static #nextVisibility(current) {
        const states = FILRODENSWMB.UI.VISIBILITY_STATES;
        return states[(states.indexOf(current || "all") + 1) % states.length];
    }

    /** The visibility choices for a select, with `selected` chosen. */
    static visibilityChoices(selected) {
        const labels = { all: "FILRODENSWMB.UI.VisibleToAll", gm: "FILRODENSWMB.UI.VisibleToGM", none: "FILRODENSWMB.UI.VisibleToNone" };
        return VISIBILITIES.map((value) => ({ value, label: labels[value], selected: value === (selected ?? "all") }));
    }

    static lineStyleChoices(selected) {
        const styles = { solid: "FILRODENSWMB.UI.StyleSolid", dashed: "FILRODENSWMB.UI.StyleDashed", dotted: "FILRODENSWMB.UI.StyleDotted", dashdot: "FILRODENSWMB.UI.StyleDashDot" };
        return Object.entries(styles).map(([value, label]) => ({ value, label, selected: value === (selected ?? "solid") }));
    }

    /**
     * Redraws after a change: the regions (unless only the selection changed), the panel and the
     * dirty flag. The active ids are settled first, since the regions are drawn for the level being
     * painted and a level just deleted must not be it.
     */
    static #refresh(app, { vectors = true, toolbar = false } = {}) {
        this.settleActive(app);
        if (vectors) {
            app._repaintVectors();
            app.markDirty();
        }
        app.view?.render(toolbar ? ["context", "editToolbar"] : ["context"]);
    }
}
