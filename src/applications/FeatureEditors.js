import { FILRODENSWMB } from "../config.js";
import { Inspector } from "./Inspector.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { MapStateManager } from "./MapStateManager.js";
import { RegionPanel } from "./RegionPanel.js";
import { TectonicFeatureEngine } from "../generation/TectonicFeatureEngine.js";
import { CanvasTransforms } from "../tools/CanvasTransforms.js";
import { TerrainVersion } from "../tools/TerrainVersion.js";
import { platform } from "../platform/index.js";
import { typed } from "../data/MapRules.js";

const TEMPLATES = "modules/filrodens-world-map-builder/templates/parts/";

/** The widths a river can have, with their names. */
const RIVER_WIDTHS = Object.freeze([
    [2, "FILRODENSWMB.UI.SizeSmall"],
    [4, "FILRODENSWMB.UI.SizeMedium"],
    [6, "FILRODENSWMB.UI.SizeLarge"],
    [8, "FILRODENSWMB.UI.SizeXLarge"],
]);

/** The settings each tectonic feature type reads, beyond thickness and strength. */
const FEATURE_FIELDS = Object.freeze({
    range: ["style"],
    subduction: ["arcDistance", "trenchDepth"],
    rift: ["floorTexture", "volcanoes"],
    hotspot: ["spacing", "spacingTrend", "scatter", "variation", "pulses", "vents", "drowned"],
});

/**
 * Applies `values` to `object` as one undo step when any differs from `current` (the object as
 * the inspector shows it, its defaults filled in), then redraws. Shapes the terrain again when one
 * of `terrainFields` changed.
 * @returns {boolean} Whether anything changed.
 */
function applyValues(app, object, values, terrainFields = [], current = object) {
    const changed = Object.keys(values).filter((name) => current[name] !== values[name]);
    if (!changed.length) return false;
    MapStateManager.pushVectorState(app);
    Object.assign(object, values);
    redraw(app, changed.some((name) => terrainFields.includes(name)));
    return true;
}

function redraw(app, terrain = false) {
    app._repaintVectors();
    if (terrain) app.requestTerrainUpdate();
    app.view?.render(["context", "editToolbar"]);
    app.markDirty();
}

/** Focus view on a line or outline of points. */
function zoomTo(app, points) {
    if (points?.length) app.canvasEngine?.zoomToFeature(points);
}

/**
 * A river guide (Rivers and faults) in the inspector: its name and width, and Focus view and
 * Delete. A new width carves the river again. When the river is the one being drawn, the bar's
 * width follows it, so the rest of the line is drawn at the same width.
 */
export class RiverEditor {
    /** @returns {Promise<boolean>} */
    static open(app, id, options) {
        return Inspector.open(app, this.KIND, { id }, options);
    }

    static KIND = Object.freeze({
        id: "river",
        template: `${TEMPLATES}inspector-river.hbs`,
        find: (app, { id }) => app.manualRivers?.find((river) => river.id === id) ?? null,
        header: (_app, river) => ({ title: river.name, subtitle: platform.i18n.localize("FILRODENSWMB.UI.InspectorSubtitleRiver") }),
        context: (_app, river) => ({ river, widths: RIVER_WIDTHS.map(([value, label]) => ({ value, label, selected: value === Number(river.width) })) }),
        apply: (app, river, _ref, form) => {
            const values = typed("river", { name: form.elements.riverName.value.trim() || river.name, width: Number(form.elements.riverWidth.value) }, river);
            const applied = applyValues(app, river, values, ["width"]);
            if (applied && app.activeRiverId === river.id) app.uiState.riverWidth = river.width;
            return applied;
        },
        actions: {
            zoom: (app, river) => zoomTo(app, river.points),
            delete: (app, river) => MapDialogManager.deleteEntityById(app, "river", river.id),
        },
    });
}

/**
 * A fault line or tectonic feature (Rivers and faults) in the inspector: its name and
 * description, its type and that type's settings, and Focus view and Delete. Everything but the
 * name and description shapes the terrain again. A fault given a new type takes that type's
 * default settings and drops the settings of the type it was. When the fault is the one being
 * drawn, the bar's fault settings follow it.
 */
export class FaultEditor {
    /** @returns {Promise<boolean>} */
    static open(app, id, options) {
        return Inspector.open(app, this.KIND, { id }, options);
    }

    static KIND = Object.freeze({
        id: "fault",
        template: `${TEMPLATES}inspector-fault.hbs`,
        find: (app, { id }) => app.tectonicFaults?.find((fault) => fault.id === id) ?? null,
        header: (app, fault) => ({
            title: fault.name,
            subtitle: platform.i18n.format("FILRODENSWMB.UI.InspectorSubtitleFault", { type: FaultEditor.#typeName(app, fault) }),
            swatch: fault.color ?? TectonicFeatureEngine.colorOf(fault.type),
        }),
        context: (app, fault) => ({
            fault,
            tectonicTypes: TectonicFeatureEngine.typeOptions(FaultEditor.#currentMap(app), fault.type),
            rangeStyles: Object.entries(FILRODENSWMB.TECTONICS.FEATURES.RANGE_STYLES).map(([id, label]) => ({ id, label })),
            settings: FaultEditor.settings(fault),
            isFeature: TectonicFeatureEngine.isFeatureType(fault.type),
        }),
        apply: (app, fault, _ref, form) => FaultEditor.#apply(app, fault, form),
        actions: {
            zoom: (app, fault) => zoomTo(app, fault.points),
            delete: (app, fault) => MapDialogManager.deleteEntityById(app, "fault", fault.id),
        },
    });

    static #currentMap(app) {
        return TerrainVersion.getVersion(app.uiState) >= FILRODENSWMB.TERRAIN_VERSION.CURRENT;
    }

    static #typeName(app, fault) {
        const option = TectonicFeatureEngine.typeOptions(this.#currentMap(app), fault.type).find((candidate) => candidate.id === fault.type);
        return option ? platform.i18n.localize(option.label) : fault.type;
    }

    /**
     * The settings of every feature type: the fault's own where it has them, the defaults
     * otherwise, so a fault given a new type starts from sensible values.
     */
    static settings(fault) {
        const features = FILRODENSWMB.TECTONICS.FEATURES;
        return {
            style: fault.style ?? features.RANGE.DEFAULT_STYLE,
            arcDistance: fault.arcDistance ?? features.SUBDUCTION.DEFAULT_ARC_DISTANCE,
            trenchDepth: fault.trenchDepth ?? features.SUBDUCTION.DEFAULT_TRENCH_DEPTH,
            floorTexture: fault.floorTexture ?? features.RIFT.DEFAULT_FLOOR_TEXTURE,
            volcanoes: fault.volcanoes ?? 0,
            spacing: fault.spacing ?? features.HOTSPOT.DEFAULT_SPACING,
            spacingTrend: fault.spacingTrend ?? features.HOTSPOT.DEFAULT_SPACING_TREND,
            scatter: fault.scatter ?? features.HOTSPOT.DEFAULT_SCATTER,
            variation: fault.variation ?? features.HOTSPOT.DEFAULT_VARIATION,
            pulses: fault.pulses ?? features.HOTSPOT.DEFAULT_PULSES,
            vents: fault.vents ?? features.HOTSPOT.DEFAULT_VENTS,
            drowned: fault.drowned ?? features.HOTSPOT.DEFAULT_DROWNED,
        };
    }

    /**
     * The form as fault fields: the shared ones, plus the settings of the chosen type (from the
     * form when it shows them, the defaults when the type has just changed).
     */
    static read(fault, form) {
        const elements = form.elements;
        const type = elements.faultType.value;
        const values = {
            name: elements.faultName.value.trim() || fault.name,
            description: elements.faultDesc.value,
            type,
            thickness: Number(elements.faultThickness.value),
            strength: Number(elements.faultStrength.value),
            reversed: type === fault.type && elements.faultReverse?.checked === true,
        };
        const defaults = this.settings(fault);
        for (const field of FEATURE_FIELDS[type] ?? []) {
            const input = type === fault.type ? (field === "style" ? elements.faultStyle : elements[field]) : null;
            values[field] = input ? (field === "style" ? input.value : Number(input.value)) : defaults[field];
        }
        return values;
    }

    static #apply(app, fault, form) {
        const values = typed("fault", this.read(fault, form), fault);
        const current = { ...fault, reversed: fault.reversed === true };
        const changed = Object.keys(values).filter((name) => current[name] !== values[name]);
        if (!changed.length) return false;
        MapStateManager.pushVectorState(app);
        Object.assign(fault, values);
        this.#finish(fault);
        if (app.activeFaultId === fault.id) {
            app.uiState.faultType = fault.type;
            app.uiState.faultThickness = fault.thickness;
            app.uiState.faultStrength = fault.strength;
            if (fault.style) app.uiState.faultStyle = fault.style;
        }
        redraw(app, changed.some((name) => name !== "name" && name !== "description"));
        return true;
    }

    /**
     * Completes a fault after a change: its colour, whether it is a tectonic feature, and dropping
     * settings of other types. Its direction (`reversed`) is kept only while on, and only for a feature.
     */
    static #finish(fault) {
        fault.color = TectonicFeatureEngine.colorOf(fault.type);
        if (!fault.reversed || !TectonicFeatureEngine.isFeatureType(fault.type)) delete fault.reversed;
        const keep = new Set(FEATURE_FIELDS[fault.type] ?? []);
        for (const fields of Object.values(FEATURE_FIELDS)) for (const field of fields) if (!keep.has(field)) delete fault[field];
        if (TectonicFeatureEngine.isFeatureType(fault.type)) fault.revision = FILRODENSWMB.TECTONICS.FEATURES.REVISION;
        else delete fault.revision;
    }
}

/**
 * A decoration (Cartography) in the inspector: its name and visibility, its opacity, scale and
 * rotation, and Focus view and Delete.
 */
export class DecorationEditor {
    /** @returns {Promise<boolean>} */
    static open(app, id, options) {
        return Inspector.open(app, this.KIND, { id }, options);
    }

    static KIND = Object.freeze({
        id: "decoration",
        template: `${TEMPLATES}inspector-decoration.hbs`,
        find: (app, { id }) => app.mapDecorations?.find((decoration) => decoration.id === id) ?? null,
        header: (_app, decoration) => ({ title: decoration.name, subtitle: platform.i18n.localize("FILRODENSWMB.UI.InspectorSubtitleDecoration") }),
        context: (_app, decoration) => ({
            decoration: {
                name: decoration.name,
                opacity: decoration.opacity ?? 1,
                // Snapped to the slider's grid, so the value shown matches the slider's position
                scale: CanvasTransforms.stepValue(decoration.scale ?? 1, 0, FILRODENSWMB.UI.WHEEL_RESIZE.DECORATION_SCALE),
                rotation: CanvasTransforms.normalizeAngle(decoration.rotation),
            },
            visibilities: RegionPanel.visibilityChoices(decoration.visibility),
            scaleRange: FILRODENSWMB.UI.WHEEL_RESIZE.DECORATION_SCALE,
            rotationRange: FILRODENSWMB.UI.ROTATION,
        }),
        apply: (app, decoration, _ref, form, field) => {
            const elements = form.elements;
            const values = {
                name: elements.decorationName.value.trim() || decoration.name,
                visibility: elements.decorationVisibility.value,
            };
            // Only the slider moved is read, so a scale or rotation saved off the sliders' grid is
            // kept until it is changed
            if (field === "decorationOpacity") values.opacity = Number(elements.decorationOpacity.value);
            if (field === "decorationScale") values.scale = Number(elements.decorationScale.value) || 1;
            if (field === "decorationRotation") values.rotation = CanvasTransforms.normalizeAngle(elements.decorationRotation.value);
            return applyValues(app, decoration, typed("decoration", values, decoration), [], { ...decoration, visibility: decoration.visibility ?? "all" });
        },
        actions: {
            zoom: (app, decoration) => zoomTo(app, [decoration]),
            delete: (app, decoration) => MapDialogManager.deleteEntityById(app, "decoration", decoration.id),
        },
    });
}

/**
 * A land mask (New map, Guided engine) in the inspector: its name and whether it marks land or an
 * ocean, and Focus view and Delete. A new type shapes the land again; the name is only a label.
 */
export class LandMaskEditor {
    /**
     * @param {{created?: boolean}} [options] - `created`: the mask was just begun on the map, and
     *   is opened while it is drawn.
     * @returns {Promise<boolean>}
     */
    static open(app, id, options) {
        // Opened from a list or the map, a mask still being drawn is finished first (or dropped if
        // it never became a shape): it may be the one being opened, and its points must not keep
        // growing underneath
        if (!options?.created && app._finishActiveLandMask?.()) app.requestTerrainUpdate();
        return Inspector.open(app, this.KIND, { id }, options);
    }

    static KIND = Object.freeze({
        id: "landMask",
        template: `${TEMPLATES}inspector-land-mask.hbs`,
        find: (app, { id }) => app.landMasks?.find((mask) => mask.id === id) ?? null,
        header: (_app, mask) => ({
            title: mask.name,
            subtitle: platform.i18n.format("FILRODENSWMB.UI.InspectorSubtitleLandMask", { type: platform.i18n.localize(mask.operation === "subtract" ? "FILRODENSWMB.UI.LandMaskTypeOcean" : "FILRODENSWMB.UI.LandMaskTypeLand") }),
        }),
        context: (_app, mask) => ({ mask, ocean: mask.operation === "subtract" }),
        apply: (app, mask, _ref, form) => {
            const values = typed("landMask", { name: form.elements.maskName.value.trim() || mask.name, operation: form.elements.maskOperation.value === "subtract" ? "subtract" : "add" }, mask);
            return applyValues(app, mask, values, ["operation"], { ...mask, operation: mask.operation === "subtract" ? "subtract" : "add" });
        },
        actions: {
            zoom: (app, mask) => zoomTo(app, mask.points),
            delete: (app, mask) => MapDialogManager.deleteLandMaskById(app, mask.id),
        },
    });
}
