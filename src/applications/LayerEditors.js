import { FILRODENSWMB } from "../config.js";
import { Inspector } from "./Inspector.js";
import { RegionPanel } from "./RegionPanel.js";
import { defaultLevelStyle, NESTING_MODES } from "../mesh/Schema.js";
import { parentCandidates, setOfLevel } from "../mesh/LayerTree.js";
import { platform } from "../platform/index.js";
import { typed } from "../data/MapRules.js";
import { cleanUnit, formatDistance, kmPerPxOf } from "../data/MapUnit.js";

const TEMPLATES = "modules/filrodens-world-map-builder/templates/parts/";

/** The names of the nesting modes (see Schema.NESTING_MODES). */
const NESTING_LABELS = Object.freeze({ constrained: "FILRODENSWMB.UI.NestingConstrained", free: "FILRODENSWMB.UI.NestingFree" });

/** The border fields a level's style holds, which Copy style from fills. */
const BORDER_FIELDS = Object.freeze(["lineColor", "lineThickness", "lineStyle", "seaLineThickness", "seaLineStyle", "scaleWithMap"]);

/** Whether two plain values or style objects hold the same fields. */
function same(a, b) {
    if (a && typeof a === "object") return Object.keys({ ...a, ...b }).every((key) => a[key] === b?.[key]);
    return a === b;
}

/**
 * A layer set (Regions) in the inspector: its name and visibility, its opacity and whether its
 * fill covers water, and Delete. Opening it makes it the active set.
 */
export class LayerSetEditor {
    /**
     * @param {object} app
     * @param {string} setId
     * @param {{created?: boolean}} [options] - See Inspector.open.
     * @returns {Promise<boolean>}
     */
    static open(app, setId, options) {
        return Inspector.open(app, this.KIND, { id: setId }, options);
    }

    static KIND = Object.freeze({
        id: "set",
        template: `${TEMPLATES}inspector-set.hbs`,
        find: (app, { id }) => (app.layerSets ?? []).find((set) => set.id === id) ?? null,
        opened: (app, set) => RegionPanel.selectSetById(app, set.id),
        header: (_app, set) => ({ title: set.name, subtitle: platform.i18n.localize("FILRODENSWMB.UI.InspectorSubtitleSet") }),
        context: (_app, set) => ({ set: { ...set, opacity: set.opacity ?? 1, waterTint: set.waterTint !== false }, visibilities: RegionPanel.visibilityChoices(set.visibility) }),
        apply: (app, set, _ref, form) => {
            const elements = form.elements;
            // Checked as an import is (see MapRules.typed): a value that fails its rule keeps the set's own
            const values = typed(
                "layerSet",
                {
                    name: elements.setName.value.trim() || set.name,
                    visibility: elements.setVisibility.value,
                    opacity: Number(elements.setOpacity.value),
                    waterTint: elements.setWaterTint.checked,
                },
                set,
            );
            const current = { ...set, visibility: set.visibility ?? "all", opacity: set.opacity ?? 1, waterTint: set.waterTint !== false };
            if (!Object.keys(values).some((name) => current[name] !== values[name])) return false;
            RegionPanel.applySetEdit(app, set, values);
            return true;
        },
        actions: {
            delete: (app, set) => RegionPanel.deleteSetById(app, set.id),
        },
    });
}

/**
 * A region level (Regions) in the inspector: its name and title template; its parent, nesting
 * and visibility; its opacity and territorial waters; its borders, which Copy style from fills
 * from another level's (one step); and Delete. Opening it makes it the active level.
 *
 * A new parent moves the level after it and gives each of its regions the parent region holding
 * most of its land; a new parent or waters distance claims the waters again (see
 * RegionPanel.applyLevelEdit).
 */
export class LevelEditor {
    /**
     * @param {object} app
     * @param {string} levelId
     * @param {{created?: boolean}} [options] - See Inspector.open.
     * @returns {Promise<boolean>}
     */
    static open(app, levelId, options) {
        return Inspector.open(app, this.KIND, { id: levelId }, options);
    }

    static #find(app, { id }) {
        const set = setOfLevel(app.layerSets ?? [], id);
        const level = set?.levels.find((candidate) => candidate.id === id) ?? null;
        return level ? { set, level } : null;
    }

    static KIND = Object.freeze({
        id: "level",
        template: `${TEMPLATES}inspector-level.hbs`,
        find: (app, ref) => LevelEditor.#find(app, ref)?.level ?? null,
        opened: (app, level) => RegionPanel.selectLevelById(app, level.id),
        header: (app, level, ref) => ({
            title: level.name,
            subtitle: platform.i18n.format("FILRODENSWMB.UI.InspectorSubtitleLevel", { set: LevelEditor.#find(app, ref)?.set.name ?? "" }),
            swatch: { ...defaultLevelStyle(), ...level.style }.lineColor,
        }),
        context: (app, level, ref) => LevelEditor.#context(app, level, LevelEditor.#find(app, ref).set),
        apply: (app, level, ref, form, field) => LevelEditor.#apply(app, level, LevelEditor.#find(app, ref).set, form, field),
        actions: {
            delete: (app, level) => RegionPanel.deleteLevelById(app, level.id),
        },
    });

    /** Every other level of the map, as Copy style from offers them (another set's named with it). */
    static #copySources(app, set, level) {
        return (app.layerSets ?? []).flatMap((candidate) => candidate.levels.filter((other) => other.id !== level.id).map((other) => ({ id: other.id, name: candidate === set ? other.name : `${candidate.name}: ${other.name}`, style: other.style })));
    }

    /**
     * What the territorial waters slider needs to show its pixels in the map unit: the km a pixel
     * measures, the current distance formatted as the slider will format it, and the unit's name.
     */
    static #watersInUnit(app, watersPx) {
        const kmPerPx = kmPerPxOf(app.uiState, app.mapHeight);
        return { kmPerPx, display: formatDistance(watersPx * kmPerPx), unit: cleanUnit(app.uiState?.mapUnit) };
    }

    static #context(app, level, set) {
        const style = { ...defaultLevelStyle(), ...level.style };
        return {
            level: { ...level, style, opacity: level.opacity ?? FILRODENSWMB.DISPLAY.REGION_OPACITY, watersPx: level.watersPx ?? 0 },
            parents: parentCandidates(set, level.id).map((candidate) => ({ id: candidate.id, name: candidate.name, selected: candidate.id === level.parentLevelId })),
            visibilities: RegionPanel.visibilityChoices(level.visibility),
            nestingModes: NESTING_MODES.map((mode) => ({ value: mode, label: NESTING_LABELS[mode], selected: mode === level.nestingMode })),
            lineStyles: RegionPanel.lineStyleChoices(style.lineStyle),
            seaLineStyles: RegionPanel.lineStyleChoices(style.seaLineStyle ?? "dashed"),
            copySources: this.#copySources(app, set, level),
            thicknessStep: FILRODENSWMB.MESH.ARCS.THICKNESS_STEP,
            // Stored in map pixels and shown in the map unit (see MapUnit)
            waters: { ...FILRODENSWMB.MESH.WATERS, ...LevelEditor.#watersInUnit(app, level.watersPx ?? 0) },
        };
    }

    /** The form as level fields; Copy style from fills the border fields from the chosen level. */
    static read(app, level, set, form, field) {
        const elements = form.elements;
        const style = {
            ...level.style,
            lineColor: elements.levelLineColor.value,
            lineThickness: Number(elements.levelLineThickness.value),
            lineStyle: elements.levelLineStyle.value,
            seaLineThickness: Number(elements.levelSeaLineThickness.value),
            seaLineStyle: elements.levelSeaLineStyle.value,
            scaleWithMap: elements.levelScaleWithMap.checked,
        };
        if (field === "levelCopyStyle") {
            const source = this.#copySources(app, set, level).find((candidate) => candidate.id === elements.levelCopyStyle.value);
            if (source) {
                const copied = { ...defaultLevelStyle(), ...source.style };
                for (const name of BORDER_FIELDS) style[name] = name === "scaleWithMap" ? copied[name] === true : copied[name];
            }
        }
        return {
            name: elements.levelName.value.trim() || level.name,
            titleTemplate: elements.levelTitleTemplate.value.trim() || "{name}",
            parentLevelId: elements.levelParent.value || null,
            nestingMode: elements.levelNesting.value,
            visibility: elements.levelVisibility.value,
            opacity: Number(elements.levelOpacity.value),
            watersPx: Math.max(0, Number(elements.levelWatersPx.value) || 0),
            style,
        };
    }

    static #apply(app, level, set, form, field) {
        // Checked as an import is (see MapRules.typed): a value that fails its rule keeps the layer's own
        const values = typed("level", this.read(app, level, set, form, field), level);
        const current = {
            ...level,
            titleTemplate: level.titleTemplate || "{name}",
            parentLevelId: level.parentLevelId ?? null,
            nestingMode: level.nestingMode ?? "constrained",
            visibility: level.visibility ?? "all",
            opacity: level.opacity ?? FILRODENSWMB.DISPLAY.REGION_OPACITY,
            watersPx: level.watersPx ?? 0,
            style: { ...defaultLevelStyle(), ...level.style, scaleWithMap: level.style?.scaleWithMap === true },
        };
        if (Object.keys(values).every((name) => same(current[name], values[name]))) return false;
        RegionPanel.applyLevelEdit(app, set, level, values);
        return true;
    }
}
