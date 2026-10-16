import { FILRODENSWMB } from "../config.js";
import { MapStateManager } from "./MapStateManager.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { VectorHistory } from "./VectorHistory.js";
import { addRegion, childLevelFields, createLayerSet, createLevel, regionFillColor, UNCLAIMED, VISIBILITIES } from "../mesh/Schema.js";
import { childLevels, insertLevel, levelDepth, moveLevel, setOfLevel, setParent, uniqueName } from "../mesh/LayerTree.js";
import { assignToParents, autoAssign, claimWaters, deleteLevel, deleteRegion, deleteSet, levelCounts, mergeRegion, nestingProblems, regionParents, unassignedCount } from "../mesh/RegionEdits.js";
import { platform } from "../platform/index.js";

/** Where the dialogue templates live (Merge Into's). */
const DIALOG_ROOT = "modules/filrodens-world-map-builder/templates/dialogs/";

/**
 * The Regions tool's panel, three lists of the same shape, each choosing what the next one shows:
 * the map's layer sets (each with visibility, an edit button and a menu: move up or down, delete),
 * the active set's levels as a tree (each with visibility, an edit button and a menu: add a child
 * level, move up or down, auto-assign unassigned cells, fix nesting, delete), and the regions of
 * the active level (each with visibility, zoom to, edit and a menu: merge into another, delete).
 *
 * The studio keeps which set, level and region are being edited (activeLayerSetId,
 * activeLevelId, activeRegionId); this panel keeps them valid (see settleActive) and works on the
 * studio's layer sets (app.layerSets) and mesh session. Every change is one undo step: a vector
 * snapshot taken first, plus the owner changes it made, as one composite entry where cells
 * changed too (see VectorHistory).
 *
 * Sets, levels and regions open in the inspector, docked beside the map (see LayerSetEditor,
 * LevelEditor, RegionEditor and Inspector), so the map can be painted and looked at while one is
 * open. A new set or level is named first (a prompt), then opens there.
 */
export class RegionPanel {
    // ------------------------------------------------------------------ the panel's context

    /**
     * What tools-regions.hbs draws: the sets to choose from, the active set's level tree and the
     * active level's regions.
     * @param {object} app
     * @returns {object}
     */
    static context(app) {
        this.settleActive(app);
        const set = this.activeSet(app);
        const level = this.activeLevel(app);
        return {
            sets: this.#setRows(app),
            activeSet: set ? { id: set.id, name: set.name, visibility: set.visibility } : null,
            levels: set ? this.#levelRows(app, set) : [],
            activeLevel: level ? { id: level.id, name: level.name, hasParent: !!level.parentLevelId } : null,
            regions: level ? this.#regionRows(app, level) : [],
        };
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
    }

    static #setRows(app) {
        const sets = app.layerSets ?? [];
        return sets.map((set, index) => ({
            id: set.id,
            name: set.name,
            visibility: set.visibility,
            isActive: set.id === app.activeLayerSetId,
            levelCount: set.levels.length,
            canMoveUp: index > 0,
            canMoveDown: index < sets.length - 1,
        }));
    }

    static #levelRows(app, set) {
        const session = app.meshSession;
        return set.levels.map((level) => {
            const siblings = childLevels(set, level.parentLevelId ?? null);
            const index = siblings.indexOf(level);
            const hasParent = !!level.parentLevelId;
            return {
                id: level.id,
                name: level.name,
                depth: levelDepth(set, level),
                visibility: level.visibility,
                isActive: level.id === app.activeLevelId,
                regionCount: level.regions.length,
                hasParent,
                isFree: level.nestingMode === "free",
                canMoveUp: index > 0,
                canMoveDown: index < siblings.length - 1,
                problems: hasParent && session ? nestingProblems(session, level).length : 0,
                unassigned: hasParent && session ? unassignedCount(session, level) : 0,
            };
        });
    }

    static #regionRows(app, level) {
        const alphaSort = (a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });
        return [...level.regions].sort(alphaSort).map((region) => ({
            id: region.id,
            name: region.name,
            visibility: region.visibility,
            swatch: regionFillColor(region),
            isActive: region.id === app.activeRegionId,
            massEditSelected: app.massEditSelection?.region?.has(region.id) ?? false,
        }));
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

    /** A click on a region's name. */
    static selectRegion(app, target) {
        const regionId = target.closest(".fwmb-list-item")?.dataset.id;
        if (!regionId) return;
        app.activeRegionId = regionId === app.activeRegionId ? null : regionId;
        this.#refresh(app, { vectors: false, toolbar: true });
    }

    /**
     * Makes a region the region being edited, with its level and set (a pick on the map, or the
     * region opening in the inspector); null ids let go of the region.
     */
    static selectRegionById(app, levelId, regionId) {
        if (!regionId) {
            if (app.activeRegionId === null) return;
            app.activeRegionId = null;
            this.#refresh(app, { vectors: false, toolbar: true });
            return;
        }
        const set = setOfLevel(app.layerSets ?? [], levelId);
        if (!set || regionId === app.activeRegionId) return;
        app.activeLayerSetId = set.id;
        app.activeLevelId = levelId;
        app.activeRegionId = regionId;
        this.#refresh(app, { vectors: false, toolbar: true });
    }

    // ------------------------------------------------------------------ layer sets

    /**
     * New Set: asks for its name, then makes a set with one level, which become the active set and
     * level. Resolves with the new set's id (null when no name was given), for the inspector to open.
     */
    static async addSet(app) {
        const name = await this.#askName(app, "FILRODENSWMB.UI.NewLayerSet", uniqueName(platform.i18n.localize("FILRODENSWMB.UI.NewSetName"), app.layerSets ?? []));
        if (!name) return null;
        MapStateManager.pushVectorState(app);
        const set = createLayerSet({ name, visibility: "all", waterTint: true, opacity: 1, kind: "custom" }, this.#idFactory);
        const level = createLevel({ name: platform.i18n.localize("FILRODENSWMB.UI.NewLevelName") }, this.#idFactory);
        set.levels.push(level);
        app.layerSets.push(set);
        app.activeLayerSetId = set.id;
        app.activeLevelId = level.id;
        app.activeRegionId = null;
        this.#refresh(app);
        return set.id;
    }

    /** Asks for a new set's or level's name; resolves with it trimmed, or null when none was given. */
    static async #askName(app, titleKey, suggested) {
        const name = await MapDialogManager._promptTextValue(platform.i18n.localize(titleKey), platform.i18n.localize("FILRODENSWMB.UI.Name"), suggested);
        return name?.trim() || null;
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
     * New Level: asks for its name, then adds a top level at the end of the active set (a set is
     * made first when there is none). Resolves with the new level's id, or null.
     */
    static async addLevel(app) {
        const name = await this.#askName(app, "FILRODENSWMB.UI.NewLevel", uniqueName(platform.i18n.localize("FILRODENSWMB.UI.NewLevelName"), this.activeSet(app)?.levels ?? []));
        if (!name) return null;
        MapStateManager.pushVectorState(app);
        let set = this.activeSet(app);
        if (!set) {
            set = createLayerSet({ name: platform.i18n.localize("FILRODENSWMB.UI.MigratedRegionsSet") }, this.#idFactory);
            app.layerSets.push(set);
            app.activeLayerSetId = set.id;
        }
        return this.#insertNewLevel(app, set, null, name);
    }

    /** Add Child Level: asks for its name, then adds an empty level below the chosen one, constrained to it. */
    static async addChildLevel(app, target) {
        const set = this.activeSet(app);
        const parentId = this.#levelIdOf(target);
        if (!set?.levels.some((level) => level.id === parentId)) return null;
        const name = await this.#askName(app, "FILRODENSWMB.UI.NewLevel", uniqueName(platform.i18n.localize("FILRODENSWMB.UI.NewLevelName"), set.levels));
        if (!name) return null;
        MapStateManager.pushVectorState(app);
        return this.#insertNewLevel(app, set, parentId, name);
    }

    static #insertNewLevel(app, set, parentLevelId, name) {
        const level = createLevel({ name, ...(parentLevelId ? childLevelFields(parentLevelId) : {}) }, this.#idFactory);
        insertLevel(set, level);
        app.activeLevelId = level.id;
        app.activeRegionId = null;
        this.#refresh(app);
        return level.id;
    }

    static moveLevel(app, target, step) {
        const set = this.activeSet(app);
        const levelId = this.#levelIdOf(target);
        if (!set || !levelId) return;
        const snapshot = VectorHistory.snapshot(app);
        if (!moveLevel(set, levelId, step)) return;
        VectorHistory.push(app, snapshot);
        this.#refresh(app);
    }

    /** The eye on a level's row: all, GM only, hidden, and round again. */
    static toggleLevelVisibility(app, target) {
        const level = this.activeSet(app)?.levels.find((candidate) => candidate.id === this.#levelIdOf(target));
        if (!level) return;
        MapStateManager.pushVectorState(app);
        level.visibility = this.#nextVisibility(level.visibility);
        this.#refresh(app);
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
        const level = this.activeSet(app)?.levels.find((candidate) => candidate.id === this.#levelIdOf(target));
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
        const level = this.activeSet(app)?.levels.find((candidate) => candidate.id === this.#levelIdOf(target));
        if (!level?.parentLevelId || !app.meshSession) return;
        const before = VectorHistory.snapshot(app);
        const result = assignToParents(app.meshSession, level);
        VectorHistory.push(app, VectorHistory.composite([before, VectorHistory.owners(level.id, result?.patch), this.watersEntry(app, level.id)]));
        this.#refresh(app);
    }

    // ------------------------------------------------------------------ regions

    /**
     * New Region: an empty region in the active level, which becomes the active region, ready to be
     * painted. Its fill is left to the level's preset colours (see Schema.regionFillColor) unless a region
     * quick style is chosen in the toolbar. Returns `{ levelId, id }` of the new region (undefined
     * when there is no level), for the inspector to open.
     */
    static addRegion(app) {
        const level = this.activeLevel(app);
        if (!level) {
            platform.notify.warn(platform.i18n.localize("FILRODENSWMB.UI.WarnNoLevel"));
            return;
        }
        MapStateManager.pushVectorState(app);
        const name = uniqueName(platform.i18n.localize("FILRODENSWMB.UI.NewRegionName"), level.regions);
        const style = (app.uiState.customRegionStyles ?? []).find((candidate) => candidate.id === app.uiState.activeRegionQuickStyle);
        const region = addRegion(level, { name, quickStyle: style ? style.id : "custom", fillColor: style?.fillColor ?? null, fillStyle: style?.fillStyle ?? null, label: { visibility: "all" } }, this.#idFactory);
        app.activeRegionId = region.id;
        this.#refresh(app, { toolbar: true });
        return { levelId: level.id, id: region.id };
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
