import { FILRODENSWMB } from "../config.js";
import { typed } from "../data/MapRules.js";
import { CultureMarkers } from "./CultureMarkers.js";
import { GeneratePanel } from "./GeneratePanel.js";
import { Inspector } from "./Inspector.js";
import { InspectorFields } from "./InspectorFields.js";
import { MapStateManager } from "./MapStateManager.js";
import { RuleEditorDialog } from "./RuleEditorDialog.js";
import { platform } from "../platform/index.js";

/**
 * A culture in the inspector (see Inspector), opened from its row in the Generate panel's Cultures
 * section (see CultureLists): its name, colour and name style; how open and how dense it is; its
 * habitat (temperature, moisture, height and relief as bands on one track each, coast and river
 * from avoids to seeks); and its homelands.
 *
 * Each field applies when committed, as one undo step (the undo snapshot holds the cultures; see
 * MapStateManager.getVectorStateSnapshot), and marks a run made before it out of date. A culture's
 * shape is MapRules' CULTURE; the run reads it through CultureInput.
 *
 * Heights are the map's elevation (0 to 1, as the biome rule editor and the Elev readout show it),
 * from the sea level to the top; relief is the height a cell spans, in the same units. A band
 * covering its whole track is no limit, and is kept as none.
 */

const TEMPLATE = "modules/filrodens-world-map-builder/templates/parts/inspector-culture.hbs";

/** Each habitat band's form field. */
const BANDS = Object.freeze({ temperature: "habitatTemperature", moisture: "habitatMoisture", height: "habitatHeight", relief: "habitatRelief" });

/** Steps of the fields (a band's handle, a slider). */
const STEP = 0.01;
const DENSITY_STEP = 0.05;

/** The relief quick picks, by their top (elevation units; FIELDS.relief.max is the track's end). */
const RELIEF_ZONES = Object.freeze([
    Object.freeze({ key: "Flat", to: 0.02 }),
    Object.freeze({ key: "Rolling", to: 0.06 }),
    Object.freeze({ key: "Hilly", to: 0.12 }),
    Object.freeze({ key: "Rugged", to: null }),
]);

export class CultureEditor {
    /**
     * Opens the inspector on a culture.
     * @param {object} app
     * @param {string} id
     * @param {object} [options] - As Inspector.open's.
     */
    static open(app, id, options) {
        return Inspector.open(app, this.KIND, { id }, options);
    }

    /** A culture by id, or null. */
    static find(app, id) {
        return (app.uiState.cultures ?? []).find((culture) => culture.id === id) ?? null;
    }

    /**
     * A new culture's fields: the default culture's (open 0.5, density 1, no limits), the Generate
     * panel's name style (so the first culture keeps the names the map had), and the first region
     * preset colour no culture uses yet.
     */
    static defaults(app, name) {
        const presets = FILRODENSWMB.REGIONS.PRESETS;
        const used = new Set((app.uiState.cultures ?? []).map((culture) => culture.color?.toLowerCase()));
        const color = presets.find((preset) => !used.has(preset.toLowerCase())) ?? presets[(app.uiState.cultures ?? []).length % presets.length];
        const { FIELDS } = FILRODENSWMB.GENERATOR.CULTURES;
        return {
            name,
            color,
            nameBase: GeneratePanel.settings(app).nameBase,
            openness: FIELDS.openness.default,
            density: FIELDS.density.default,
            habitat: { temperature: null, moisture: null, height: null, relief: null, coast: FIELDS.coast.default, river: FIELDS.river.default },
            homelands: [],
        };
    }

    /** The template's context. */
    static #context(app, culture) {
        const { FIELDS } = FILRODENSWMB.GENERATOR.CULTURES;
        const habitat = culture.habitat ?? {};
        const seaLevel = Number(app.uiState.seaLevel ?? 0);
        const band = (range, min, max) => (Array.isArray(range) ? { lo: Math.max(min, range[0]), hi: Math.min(max, range[1]) } : { lo: min, hi: max });
        const reliefMax = FIELDS.relief.max;
        let from = 0;
        const reliefZones = RELIEF_ZONES.map(({ key, to }) => {
            const zone = { label: `FILRODENSWMB.UI.CultureRelief${key}`, from, to: to ?? reliefMax };
            from = zone.to;
            return zone;
        });
        // The land's quick picks of the rule editor (its Underwater band is not a culture's)
        const heightZones = RuleEditorDialog.elevationZones(seaLevel)
            .filter((zone) => zone.key !== "Underwater")
            .map((zone) => ({ label: `FILRODENSWMB.UI.RuleEditorZone${zone.key}`, from: zone.from, to: zone.to }));
        return {
            culture,
            palette: FILRODENSWMB.REGIONS.PRESETS,
            nameBases: GeneratePanel.nameBaseChoices(culture.nameBase),
            fields: {
                openness: { value: culture.openness ?? FIELDS.openness.default, ...FIELDS.openness, step: STEP, resetTo: String(FIELDS.openness.default) },
                density: { value: culture.density ?? FIELDS.density.default, ...FIELDS.density, step: DENSITY_STEP, resetTo: String(FIELDS.density.default) },
                coast: { value: habitat.coast ?? FIELDS.coast.default, ...FIELDS.coast, step: STEP, resetTo: String(FIELDS.coast.default) },
                river: { value: habitat.river ?? FIELDS.river.default, ...FIELDS.river, step: STEP, resetTo: String(FIELDS.river.default) },
            },
            bands: {
                temperature: { ...band(habitat.temperature, 0, 1), min: 0, max: 1, step: STEP },
                moisture: { ...band(habitat.moisture, 0, 1), min: 0, max: 1, step: STEP },
                height: { ...band(habitat.height, seaLevel, 1), min: seaLevel, max: 1, step: STEP, zones: heightZones },
                relief: { ...band(habitat.relief, 0, reliefMax), min: 0, max: reliefMax, step: STEP / 2, zones: reliefZones },
            },
            homelands: (culture.homelands ?? []).map((point, index) => ({ index, label: platform.i18n.format("FILRODENSWMB.UI.CultureHomelandAt", { number: index + 1, x: Math.round(point.x), y: Math.round(point.y) }) })),
            picking: CultureMarkers.picking(app, culture.id),
            canAddHomeland: (culture.homelands ?? []).length < FILRODENSWMB.GENERATOR.CULTURES.MAX_HOMELANDS,
        };
    }

    /** The culture's fields as the form holds them (a band at its whole track read as none). */
    static #read(app, culture, form) {
        const { FIELDS } = FILRODENSWMB.GENERATOR.CULTURES;
        const seaLevel = Number(app.uiState.seaLevel ?? 0);
        const tracks = { temperature: [0, 1], moisture: [0, 1], height: [seaLevel, 1], relief: [0, FIELDS.relief.max] };
        const number = (field, fallback) => {
            const value = Number(form.elements[field]?.value);
            return Number.isFinite(value) ? value : fallback;
        };
        const habitat = { ...(culture.habitat ?? {}) };
        for (const [key, field] of Object.entries(BANDS)) {
            const parts = String(form.elements[field]?.value ?? "").split(",").map(Number);
            if (parts.length !== 2 || !parts.every(Number.isFinite)) continue;
            const [min, max] = tracks[key];
            const lo = Math.max(min, Math.min(...parts));
            const hi = Math.min(max, Math.max(...parts));
            habitat[key] = lo <= min + 1e-9 && hi >= max - 1e-9 ? null : [lo, hi];
        }
        habitat.coast = number("habitatCoast", habitat.coast ?? 0);
        habitat.river = number("habitatRiver", habitat.river ?? 0);
        const name = String(form.elements.cultureName?.value ?? "").trim();
        return {
            name: name || culture.name,
            color: form.elements.cultureColor?.value ?? culture.color,
            nameBase: form.elements.cultureNameBase?.value ?? culture.nameBase,
            openness: number("cultureOpenness", culture.openness),
            density: number("cultureDensity", culture.density),
            habitat,
        };
    }

    /** Applies what changed, as one undo step; a run made before is then out of date. */
    static #apply(app, culture, form) {
        const values = typed("culture", this.#read(app, culture, form), culture);
        if (!InspectorFields.differs(culture, values)) return false;
        MapStateManager.pushVectorState(app);
        Object.assign(culture, values);
        app.markGeneratorStale?.();
        app.view?.render(["context"]);
        app.markDirty();
        return true;
    }

    static KIND = Object.freeze({
        id: "culture",
        template: TEMPLATE,
        find: (app, ref) => CultureEditor.find(app, ref.id),
        header: (_app, culture) => ({ title: culture.name, subtitle: platform.i18n.localize("FILRODENSWMB.UI.CultureKind"), swatch: culture.color ?? null }),
        context: (app, culture) => CultureEditor.#context(app, culture),
        apply: (app, culture, _ref, form) => CultureEditor.#apply(app, culture, form),
        // A pick under way ends with the inspector (another object, a tool change, Escape, closing)
        closed: (app) => CultureMarkers.stopPick(app),
        actions: {
            // Add homeland: the next click on the map's land adds one (see CultureMarkers)
            addHomeland: (app, culture) => CultureMarkers.togglePick(app, culture.id),
            // One homeland taken away
            removeHomeland: (app, culture, _ref, button) => {
                const index = Number(button.dataset.index);
                if (!Number.isInteger(index) || !culture.homelands?.[index]) return;
                MapStateManager.pushVectorState(app);
                culture.homelands = culture.homelands.filter((_, at) => at !== index);
                app.markGeneratorStale?.();
                app.view?.render(["context"]);
                app.markDirty();
            },
            // Auto: the culture's homelands go, and a run places one
            autoHomelands: (app, culture) => {
                if (!(culture.homelands ?? []).length) return;
                MapStateManager.pushVectorState(app);
                culture.homelands = [];
                app.markGeneratorStale?.();
                app.view?.render(["context"]);
                app.markDirty();
            },
        },
    });
}
