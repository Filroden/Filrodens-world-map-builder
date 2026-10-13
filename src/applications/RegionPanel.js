import { FILRODENSWMB } from "../config.js";
import { MapStateManager } from "./MapStateManager.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { VectorHistory } from "./VectorHistory.js";
import { addRegion, createLayerSet, createLevel, defaultLevelStyle, NESTING_MODES, regionFillColor, UNCLAIMED, VISIBILITIES } from "../mesh/Schema.js";
import { childLevels, insertLevel, levelDepth, moveLevel, parentCandidates, setParent, uniqueName } from "../mesh/LayerTree.js";
import { assignToParents, autoAssign, deleteLevel, deleteRegion, deleteSet, levelCounts, mergeRegion, nestingProblems, regionParents, unassignedCount } from "../mesh/RegionEdits.js";
import { platform } from "../platform/index.js";

/** The level editor's names for the nesting modes (see Schema.NESTING_MODES). */
const NESTING_LABELS = Object.freeze({ constrained: "FILRODENSWMB.UI.NestingConstrained", free: "FILRODENSWMB.UI.NestingFree" });

/** Where the dialogue templates live. */
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
 * The level and set editors are modal dialogues; the region editor is docked beside the map (see
 * RegionPainter), so the map can be painted and looked at while it is open.
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

    /** A click on a layer set's name. */
    static selectSet(app, target) {
        const setId = this.#setIdOf(target);
        if (!setId || setId === app.activeLayerSetId) return;
        app.activeLayerSetId = setId;
        app.activeLevelId = null;
        app.activeRegionId = null;
        this.#refresh(app, { vectors: false });
    }

    /** A click on a level's name. */
    static selectLevel(app, target) {
        const levelId = this.#levelIdOf(target);
        if (!levelId || levelId === app.activeLevelId) return;
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

    // ------------------------------------------------------------------ layer sets

    /** New Set: a set with one level, which become the active set and level. */
    static async addSet(app) {
        const values = await this.#editSetDialog(app, { name: uniqueName(platform.i18n.localize("FILRODENSWMB.UI.NewSetName"), app.layerSets ?? []), visibility: "all", waterTint: true, opacity: 1 }, "FILRODENSWMB.UI.NewLayerSet");
        if (!values) return;
        MapStateManager.pushVectorState(app);
        const set = createLayerSet({ ...values, kind: "custom" }, this.#idFactory);
        const level = createLevel({ name: platform.i18n.localize("FILRODENSWMB.UI.NewLevelName") }, this.#idFactory);
        set.levels.push(level);
        app.layerSets.push(set);
        app.activeLayerSetId = set.id;
        app.activeLevelId = level.id;
        app.activeRegionId = null;
        this.#refresh(app);
    }

    /** The set editor (modal): name, visibility, opacity and fill over water. */
    static async editSet(app, target) {
        const set = this.#setOf(app, target);
        if (!set) return;
        const values = await this.#editSetDialog(app, set, "FILRODENSWMB.UI.EditLayerSet");
        if (!values) return;
        MapStateManager.pushVectorState(app);
        Object.assign(set, values);
        this.#refresh(app);
    }

    static async #editSetDialog(app, set, titleKey) {
        const content = await platform.templates.render(`${DIALOG_ROOT}edit-layer-set.hbs`, { set, visibilities: this.#visibilityChoices(set.visibility) });
        return platform.dialogs.prompt({
            classes: ["fwmb"],
            title: platform.i18n.localize(titleKey),
            content,
            onSubmit: (form) => ({
                name: form.elements.setName.value.trim() || set.name,
                visibility: form.elements.setVisibility.value,
                waterTint: form.elements.setWaterTint.checked,
                opacity: Number(form.elements.setOpacity.value),
            }),
        });
    }

    /** Delete Set: after confirming with what it holds, the set and all its levels go. One undo step. */
    static async deleteSet(app, target) {
        const set = this.#setOf(app, target);
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

    /** New Level: a top level at the end of the active set (a set is made first when there is none). */
    static addLevel(app) {
        MapStateManager.pushVectorState(app);
        let set = this.activeSet(app);
        if (!set) {
            set = createLayerSet({ name: platform.i18n.localize("FILRODENSWMB.UI.MigratedRegionsSet") }, this.#idFactory);
            app.layerSets.push(set);
            app.activeLayerSetId = set.id;
        }
        this.#insertNewLevel(app, set, null);
    }

    /** Add Child Level: an empty level below the chosen one, constrained to it. */
    static addChildLevel(app, target) {
        const set = this.activeSet(app);
        const parentId = this.#levelIdOf(target);
        if (!set?.levels.some((level) => level.id === parentId)) return;
        MapStateManager.pushVectorState(app);
        this.#insertNewLevel(app, set, parentId);
    }

    static #insertNewLevel(app, set, parentLevelId) {
        const name = uniqueName(platform.i18n.localize("FILRODENSWMB.UI.NewLevelName"), set.levels);
        const level = createLevel({ name, parentLevelId }, this.#idFactory);
        insertLevel(set, level);
        app.activeLevelId = level.id;
        app.activeRegionId = null;
        this.#refresh(app);
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

    /** The level editor (modal): name, title template, parent, nesting, visibility, opacity and borders. */
    static async editLevel(app, target) {
        const set = this.activeSet(app);
        const level = set?.levels.find((candidate) => candidate.id === this.#levelIdOf(target));
        if (!level) return;

        const copySources = (app.layerSets ?? []).flatMap((candidate) => candidate.levels.filter((other) => other.id !== level.id).map((other) => ({ id: other.id, name: candidate === set ? other.name : `${candidate.name}: ${other.name}`, style: other.style })));
        const content = await platform.templates.render(`${DIALOG_ROOT}edit-level.hbs`, {
            level: { ...level, style: { ...defaultLevelStyle(), ...level.style } },
            parents: parentCandidates(set, level.id).map((candidate) => ({ id: candidate.id, name: candidate.name, selected: candidate.id === level.parentLevelId })),
            visibilities: this.#visibilityChoices(level.visibility),
            nestingModes: NESTING_MODES.map((mode) => ({ value: mode, label: NESTING_LABELS[mode], selected: mode === level.nestingMode })),
            lineStyles: this.#lineStyleChoices(level.style?.lineStyle),
            seaLineStyles: this.#lineStyleChoices(level.style?.seaLineStyle ?? "dashed"),
            copySources,
            thicknessStep: FILRODENSWMB.MESH.ARCS.THICKNESS_STEP,
        });
        const values = await platform.dialogs.prompt({
            classes: ["fwmb", "fwmb-level-editor"],
            title: platform.i18n.localize("FILRODENSWMB.UI.EditLevel"),
            content,
            onRender: (element) => this.#bindCopyStyle(element, copySources),
            onSubmit: (form) => this.#readLevelForm(form, level),
        });
        if (!values) return;
        this.#applyLevelEdit(app, set, level, values);
    }

    static #readLevelForm(form, level) {
        const elements = form.elements;
        return {
            name: elements.levelName.value.trim() || level.name,
            titleTemplate: elements.levelTitleTemplate.value.trim() || "{name}",
            parentLevelId: elements.levelParent.value || null,
            nestingMode: elements.levelNesting.value,
            visibility: elements.levelVisibility.value,
            opacity: Number(elements.levelOpacity.value),
            style: {
                ...level.style,
                lineColor: elements.levelLineColor.value,
                lineThickness: Number(elements.levelLineThickness.value),
                lineStyle: elements.levelLineStyle.value,
                seaLineThickness: Number(elements.levelSeaLineThickness.value),
                seaLineStyle: elements.levelSeaLineStyle.value,
                scaleWithMap: elements.levelScaleWithMap.checked,
            },
        };
    }

    /**
     * Applies the level editor's values as one undo step. A new parent moves the level (and the
     * levels below it) after that parent where needed, and each region of the level is given the
     * region of its new parent level holding most of its cells.
     */
    static #applyLevelEdit(app, set, level, values) {
        MapStateManager.pushVectorState(app);
        const { parentLevelId, ...fields } = values;
        Object.assign(level, fields);
        if (setParent(set, level.id, parentLevelId) && app.meshSession) {
            app.meshSession.setLayerSets(app.layerSets);
            const parents = regionParents(app.meshSession, level);
            for (const region of level.regions) {
                const key = parents.get(region.key) ?? UNCLAIMED;
                region.parentKey = key === UNCLAIMED ? null : key;
            }
        }
        this.#refresh(app);
    }

    /** The level editor's "Copy style from level" list fills the border fields from the chosen level. */
    static #bindCopyStyle(element, sources) {
        const select = element.querySelector('select[name="levelCopyStyle"]');
        select?.addEventListener("change", () => {
            const source = sources.find((candidate) => candidate.id === select.value);
            if (!source) return;
            const style = { ...defaultLevelStyle(), ...source.style };
            const set = (name, value) => {
                const field = element.querySelector(`[name="${name}"]`);
                if (!field) return;
                if (field.type === "checkbox") field.checked = value;
                else field.value = value;
                field.dispatchEvent(new Event("input", { bubbles: true }));
            };
            set("levelLineColor", style.lineColor);
            set("levelLineThickness", style.lineThickness);
            set("levelLineStyle", style.lineStyle);
            set("levelSeaLineThickness", style.seaLineThickness);
            set("levelSeaLineStyle", style.seaLineStyle);
            set("levelScaleWithMap", style.scaleWithMap === true);
            select.value = "";
        });
    }

    /**
     * Delete Level: after confirming with what it holds, the level goes, with its cells; the
     * levels below it move up to its parent. One undo step.
     */
    static async deleteLevel(app, target) {
        const levelId = this.#levelIdOf(target);
        const level = this.activeSet(app)?.levels.find((candidate) => candidate.id === levelId);
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
        VectorHistory.push(app, VectorHistory.owners(level.id, result.patch));
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
        VectorHistory.push(app, VectorHistory.composite([before, VectorHistory.owners(level.id, result?.patch)]));
        this.#refresh(app);
    }

    // ------------------------------------------------------------------ regions

    /**
     * New Region: an empty region in the active level, which becomes the active region, ready to be
     * painted. Its fill is left to the level's preset colours (see Schema.regionFillColor) unless a region
     * quick style is chosen in the toolbar.
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
        VectorHistory.push(app, VectorHistory.composite([before, VectorHistory.owners(levelId, removed.patch)]));
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
        VectorHistory.push(app, VectorHistory.composite([before, VectorHistory.owners(levelId, merged.patch)]));
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

    static #visibilityChoices(selected) {
        const labels = { all: "FILRODENSWMB.UI.VisibleToAll", gm: "FILRODENSWMB.UI.VisibleToGM", none: "FILRODENSWMB.UI.VisibleToNone" };
        return VISIBILITIES.map((value) => ({ value, label: labels[value], selected: value === (selected ?? "all") }));
    }

    static #lineStyleChoices(selected) {
        const styles = { solid: "FILRODENSWMB.UI.StyleSolid", dashed: "FILRODENSWMB.UI.StyleDashed", dotted: "FILRODENSWMB.UI.StyleDotted", dashdot: "FILRODENSWMB.UI.StyleDashDot" };
        return Object.entries(styles).map(([value, label]) => ({ value, label, selected: value === (selected ?? "solid") }));
    }

    /** Redraws after a change: the regions (unless only the selection changed), the panel and the dirty flag. */
    static #refresh(app, { vectors = true, toolbar = false } = {}) {
        if (vectors) {
            app._repaintVectors();
            app.markDirty();
        }
        app.view?.render(toolbar ? ["context", "editToolbar"] : ["context"]);
    }
}
