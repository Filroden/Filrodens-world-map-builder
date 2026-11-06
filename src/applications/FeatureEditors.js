import { FILRODENSWMB } from "../config.js";
import { Inspector } from "./Inspector.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { MapStateManager } from "./MapStateManager.js";
import { RegionPanel } from "./RegionPanel.js";
import { TectonicFeatureEngine } from "../generation/TectonicFeatureEngine.js";
import { CanvasTransforms } from "../tools/CanvasTransforms.js";
import { TerrainVersion } from "../tools/TerrainVersion.js";
import { RangeCurve } from "../tools/RangeCurve.js";
import { MaskSettings } from "../generation/MaskSettings.js";
import { FaultThickness } from "../tools/FaultThickness.js";
import { platform } from "../platform/index.js";
import { typed } from "../data/MapRules.js";
import { DrawnDecoration } from "../canvas/decorations/DrawnDecoration.js";
import { CompassFields } from "./CompassFields.js";
import { nameInset } from "../canvas/MapBorder.js";

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
 * A river guide (Rivers and faults) in the inspector: its name and width, from terrain revision 3
 * on its corridor width and whether it cuts through high ground (see RiverCorridor), and Focus
 * view and Delete. All but the name carve the river again. When the river is the one being
 * drawn, the bar's width follows it, so the rest of the line is drawn at the same width.
 */
export class RiverEditor {
    /** @returns {Promise<boolean>} */
    static open(app, id, options) {
        return Inspector.open(app, this.KIND, { id }, options);
    }

    /** A river's corridor width, in river widths: its own, or the default. */
    static corridorOf(river) {
        return river.corridor ?? FILRODENSWMB.HYDROLOGY.CORRIDOR;
    }

    static KIND = Object.freeze({
        id: "river",
        template: `${TEMPLATES}inspector-river.hbs`,
        find: (app, { id }) => app.manualRivers?.find((river) => river.id === id) ?? null,
        header: (_app, river) => ({ title: river.name, subtitle: platform.i18n.localize("FILRODENSWMB.UI.InspectorSubtitleRiver") }),
        context: (app, river) => ({
            river,
            widths: RIVER_WIDTHS.map(([value, label]) => ({ value, label, selected: value === Number(river.width) })),
            guided: TerrainVersion.usesGuidedRivers(app.uiState),
            corridor: { value: RiverEditor.corridorOf(river), min: FILRODENSWMB.HYDROLOGY.CORRIDOR_MIN, max: FILRODENSWMB.HYDROLOGY.CORRIDOR_MAX },
        }),
        apply: (app, river, _ref, form) => {
            const elements = form.elements;
            const fields = { name: elements.riverName.value.trim() || river.name, width: Number(elements.riverWidth.value) };
            // The corridor's settings, shown from terrain revision 3 on
            if (elements.riverCorridor) fields.corridor = Number(elements.riverCorridor.value);
            if (elements.riverCutThrough) fields.cutThrough = elements.riverCutThrough.checked;
            const values = typed("river", fields, river);
            const current = { ...river, corridor: RiverEditor.corridorOf(river), cutThrough: river.cutThrough === true };
            const applied = applyValues(app, river, values, ["width", "corridor", "cutThrough"], current);
            if (applied && river.cutThrough === false) delete river.cutThrough;
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
            thickness: FaultThickness.limits(app.mapWidth, fault.thickness),
            isFeature: TectonicFeatureEngine.isFeatureType(fault.type),
        }),
        apply: (app, fault, _ref, form) => FaultEditor.#apply(app, fault, form),
        actions: {
            zoom: (app, fault) => zoomTo(app, fault.points),
            delete: (app, fault) => MapDialogManager.deleteEntityById(app, "fault", fault.id),
        },
    });

    static #currentMap(app) {
        return TerrainVersion.getVersion(app.uiState) >= FILRODENSWMB.TERRAIN_VERSION.REVISION_2;
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

/** The name a new drawn decoration starts with, by kind. */
const DECORATION_NAMES = Object.freeze({ compass: "FILRODENSWMB.UI.DecorationKindCompass", cartouche: "FILRODENSWMB.UI.DecorationKindCartouche" });

/**
 * A decoration (Cartography) in the inspector: its name and visibility, its opacity, scale and
 * rotation, a compass rose's own design, options, colours and letters (see CompassFields), and
 * Focus view and Delete.
 */
export class DecorationEditor {
    /** @returns {Promise<boolean>} */
    static open(app, id, options) {
        return Inspector.open(app, this.KIND, { id }, options);
    }

    /**
     * Adds a decoration the module draws (see DrawnDecoration), with its defaults, and opens it in
     * the inspector, as one undo step. It needs no dialogue: everything about it is changed
     * afterwards in the inspector.
     * @param {"compass"} kind
     * @returns {Promise<string>} Its id.
     */
    static async add(app, kind) {
        MapStateManager.pushVectorState(app);
        const decoration = DrawnDecoration.create(kind, {
            id: platform.utils.randomID(),
            name: platform.i18n.localize(DECORATION_NAMES[kind]),
            mapWidth: app.mapWidth,
            mapHeight: app.mapHeight,
            inset: nameInset(app.uiState),
        });
        app.mapDecorations.push(decoration);
        app._repaintVectors();
        app.view?.render(["context"]);
        app.markDirty();
        await DecorationEditor.open(app, decoration.id);
        return decoration.id;
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
            compass: decoration.kind === "compass" ? CompassFields.context(decoration) : null,
            palette: FILRODENSWMB.LABELS?.PRESETS || [],
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
            if (decoration.kind === "compass") Object.assign(values, CompassFields.read(decoration, elements, field));
            const checked = typed("decoration", values, decoration);
            const current = { ...decoration, visibility: decoration.visibility ?? "all" };
            // Compared by value, so a colours object holding the same colours is no change
            const changed = Object.fromEntries(Object.entries(checked).filter(([name, value]) => JSON.stringify(current[name]) !== JSON.stringify(value)));
            return applyValues(app, decoration, changed, [], current);
        },
        actions: {
            zoom: (app, decoration) => zoomTo(app, [decoration]),
            delete: (app, decoration) => MapDialogManager.deleteEntityById(app, "decoration", decoration.id),
        },
    });
}

/**
 * A land mask (New map, Guided engine) in the inspector: its name and type (Land, Ocean, or Coast
 * only, which shapes no land and only carries coast settings), and Focus view and Delete. On a map
 * on the current coastline rules, a Land or Coast only mask has a Coast section: each of the map's
 * Coastline Fracture, Coastal Plains and Continental Shelf follows the map unless ticked, when the
 * mask has its own value, and Sharp edge applies them right up to the mask's edge rather than
 * blending them into the land around it (see MaskSettings). A new type or setting shapes the land
 * again; the name is only a label. An Ocean mask keeps the settings it had, ignored, so making it
 * Land again brings them back.
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

    /** A mask's type, as its Type field names it: "add" (Land), "subtract" (Ocean) or "settings" (Coast only). */
    static operationOf(mask) {
        return mask.operation === "subtract" || mask.operation === MaskSettings.COAST_ONLY ? mask.operation : "add";
    }

    /** The localisation key naming a mask's type. */
    static typeLabel(mask) {
        return { subtract: "FILRODENSWMB.UI.LandMaskTypeOcean", settings: "FILRODENSWMB.UI.LandMaskTypeCoast" }[LandMaskEditor.operationOf(mask)] ?? "FILRODENSWMB.UI.LandMaskTypeLand";
    }

    /**
     * The Coast section's settings: each one's field on the mask, its input's name, label, hint
     * and slider. The inputs are named apart from the map's own settings of the same fields: the
     * studio writes any field named after one of its settings straight into the map's settings.
     */
    static #SETTINGS = Object.freeze([
        { field: "coastlineFracture", input: "maskCoastlineFracture", label: "FILRODENSWMB.UI.CoastlineFracture", hint: "FILRODENSWMB.UI.CoastlineFractureHint", step: 0.01, curve: () => FILRODENSWMB.GENERATION.COASTLINE_FRACTURE_CURVE, fallback: () => FILRODENSWMB.GENERATION.COASTLINE_FRACTURE },
        { field: "coastalPlain", input: "maskCoastalPlain", label: "FILRODENSWMB.UI.CoastalPlains", hint: "FILRODENSWMB.UI.CoastalPlainsHint", step: 0.05, curve: () => null, fallback: () => FILRODENSWMB.GENERATION.COASTAL_PLAIN },
        { field: "shelfRange", input: "maskShelfRange", label: "FILRODENSWMB.UI.ContinentalShelf", hint: "FILRODENSWMB.UI.ShelfWidthHint", step: 0.05, curve: () => null, fallback: () => FILRODENSWMB.GENERATION.SHELF_RANGE },
    ]);

    /** Whether the map gives masks coast settings: a guided map on the current coastline rules. */
    static #hasCoast(app) {
        return app.uiState?.generationEngine === "guided" && TerrainVersion.usesCurrentCoastline(app.uiState);
    }

    /** The Coast section's context, or null where it is not shown. */
    static #coast(app, mask) {
        if (!LandMaskEditor.#hasCoast(app) || LandMaskEditor.operationOf(mask) === "subtract") return null;
        const settings = LandMaskEditor.#SETTINGS.map((setting) => {
            const own = MaskSettings.overrides(mask, setting.field);
            const mapValue = app.uiState[setting.field] ?? setting.fallback();
            const value = own ? mask[setting.field] : mapValue;
            const curve = setting.curve();
            return { name: setting.input, label: setting.label, hint: setting.hint, step: setting.step, own, value, mapValue: Number(mapValue).toFixed(2), curve: curve ?? undefined, position: curve ? RangeCurve.positionOf(value, curve) : undefined };
        });
        const count = settings.filter((setting) => setting.own).length;
        // A Land mask covers what lies beneath with the map's value where a setting is unticked; a
        // Coast only mask leaves it to what lies beneath (see MaskSettings)
        return { settings, count: count || undefined, sharpEdge: mask.sharpEdge === true, seeThrough: LandMaskEditor.operationOf(mask) === MaskSettings.COAST_ONLY };
    }

    static KIND = Object.freeze({
        id: "landMask",
        template: `${TEMPLATES}inspector-land-mask.hbs`,
        find: (app, { id }) => app.landMasks?.find((mask) => mask.id === id) ?? null,
        header: (_app, mask) => ({
            title: mask.name,
            subtitle: platform.i18n.format("FILRODENSWMB.UI.InspectorSubtitleLandMask", { type: platform.i18n.localize(LandMaskEditor.typeLabel(mask)) }),
        }),
        context: (app, mask) => {
            const operation = LandMaskEditor.operationOf(mask);
            // Coast only is offered where masks have coast settings (and kept for a mask that is one)
            return { mask, operation, coastOnly: LandMaskEditor.#hasCoast(app) || operation === MaskSettings.COAST_ONLY, coast: LandMaskEditor.#coast(app, mask) };
        },
        apply: (app, mask, _ref, form) => {
            const elements = form.elements;
            const chosen = elements.maskOperation.value;
            const operation = chosen === "subtract" || chosen === MaskSettings.COAST_ONLY ? chosen : "add";
            const values = { name: elements.maskName.value.trim() || mask.name, operation };
            // The Coast section is in the form only where it is shown; elsewhere the settings stay as they are
            if (elements.maskSharpEdge) {
                for (const setting of LandMaskEditor.#SETTINGS) {
                    const own = elements[`${setting.input}Own`]?.checked === true;
                    const slider = elements[setting.input];
                    // Ticked: the slider's value, or (just ticked, so no slider yet) the map's, to start from
                    values[setting.field] = own ? Number(slider ? RangeCurve.read(slider) : (app.uiState[setting.field] ?? setting.fallback())) : null;
                }
                values.sharpEdge = elements.maskSharpEdge.checked;
            }
            const next = typed("landMask", values, mask);
            const current = { ...mask, operation: LandMaskEditor.operationOf(mask) };
            for (const setting of LandMaskEditor.#SETTINGS) current[setting.field] ??= null;
            current.sharpEdge ??= false;
            const changed = Object.keys(next).filter((name) => current[name] !== next[name]);
            if (!changed.length) return false;
            MapStateManager.pushVectorState(app);
            Object.assign(mask, next);
            // A setting that follows the map, and a sharp edge that is off, are left out of the mask
            for (const setting of LandMaskEditor.#SETTINGS) if (mask[setting.field] === null) delete mask[setting.field];
            if (mask.sharpEdge === false) delete mask.sharpEdge;
            redraw(app, changed.some((name) => name !== "name"));
            return true;
        },
        actions: {
            zoom: (app, mask) => zoomTo(app, mask.points),
            delete: (app, mask) => MapDialogManager.deleteLandMaskById(app, mask.id),
        },
    });
}
