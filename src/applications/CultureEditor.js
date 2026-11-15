import { FILRODENSWMB } from "../config.js";
import { typed } from "../data/MapRules.js";
import { ProceduralEngine } from "../generation/ProceduralEngine.js";
import { biomeZones, CLIMATES, climateOf, landBiomeIds, zoneCoverage } from "../generator/CultureClimate.js";
import { ColorMath } from "../tools/ColorMath.js";
import { CultureMarkers } from "./CultureMarkers.js";
import { GeneratePanel } from "./GeneratePanel.js";
import { Inspector } from "./Inspector.js";
import { InspectorFields } from "./InspectorFields.js";
import { MapStateManager } from "./MapStateManager.js";
import { RuleEditorDialog } from "./RuleEditorDialog.js";
import { platform } from "../platform/index.js";

/**
 * A culture in the inspector (see Inspector), opened from its row in the Generate panel's Cultures
 * section (see CultureLists): its name, colour and name style; then, in folding sections, how open
 * and how dense it is; its habitat (its climate from chosen biomes or from zones, see
 * CultureClimate; relief as a band on one track; coast and river from avoids to seeks); and its
 * homelands.
 *
 * Each field applies when committed, as one undo step (the undo snapshot holds the cultures; see
 * MapStateManager.getVectorStateSnapshot), and marks a run made before it out of date. A culture's
 * shape is MapRules' CULTURE; the run reads it through CultureInput.
 *
 * A culture saved before the climate choice has temperature, moisture and height bands instead;
 * it shows them as one zone, and the first change written makes them that zone (the run is the
 * same either way). Relief is the height a cell spans, in the map's elevation units (as the biome
 * rule editor and the Elev readout show it). A band covering its whole track is no limit, and is
 * kept as none.
 */

const TEMPLATE = "modules/filrodens-world-map-builder/templates/parts/inspector-culture.hbs";

/** The relief band's form field. */
const RELIEF_FIELD = "habitatRelief";

/** One in this many pixels read for the climate's coverage warning. */
const COVERAGE_STRIDE = 4;

/** The older bands a climate of its own replaces. */
const OLD_BANDS = Object.freeze(["temperature", "moisture", "height"]);

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
     * A new culture's fields: the default culture's (open 0.5, density 1, no limits: its climate is
     * chosen biomes, none yet), the Generate panel's name style (so the first culture keeps the
     * names the map had), and the first region preset colour no culture uses yet.
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
            habitat: { climate: CLIMATES.BIOMES, biomes: [], zones: [], relief: null, coast: FIELDS.coast.default, river: FIELDS.river.default },
            homelands: [],
        };
    }

    /** The template's context. */
    static #context(app, culture) {
        const { FIELDS } = FILRODENSWMB.GENERATOR.CULTURES;
        const habitat = culture.habitat ?? {};
        const band = (range, min, max) => (Array.isArray(range) ? { lo: Math.max(min, range[0]), hi: Math.min(max, range[1]) } : { lo: min, hi: max });
        const reliefMax = FIELDS.relief.max;
        let from = 0;
        const reliefZones = RELIEF_ZONES.map(({ key, to }) => {
            const zone = { label: `FILRODENSWMB.UI.CultureRelief${key}`, from, to: to ?? reliefMax };
            from = zone.to;
            return zone;
        });
        const climate = climateOf(habitat);
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
                relief: { ...band(habitat.relief, 0, reliefMax), min: 0, max: reliefMax, step: STEP / 2, zones: reliefZones },
            },
            climate: this.#climateContext(app, climate),
            homelands: (culture.homelands ?? []).map((point, index) => ({ index, label: platform.i18n.format("FILRODENSWMB.UI.CultureHomelandAt", { number: index + 1, x: Math.round(point.x), y: Math.round(point.y) }) })),
            picking: CultureMarkers.picking(app, culture.id),
            canAddHomeland: (culture.homelands ?? []).length < FILRODENSWMB.GENERATOR.CULTURES.MAX_HOMELANDS,
        };
    }

    /**
     * The Habitat section's climate: the choice, the map's land biomes to choose from (built-in,
     * then custom, each with its colour), each zone's ranges, and whether the climate
     * takes in most of the map's land (a warning that it does little).
     */
    static #climateContext(app, climate) {
        const chosen = new Set(climate.biomes);
        const named = new Map((app.uiState.customBiomes ?? []).map((biome) => [biome.id, biome]));
        const keys = new Map(Object.entries(FILRODENSWMB.BIOME_IDS).map(([key, id]) => [id, key]));
        const biomes = landBiomeIds(app.uiState.customBiomes).map((id) => {
            const custom = named.get(id);
            const key = keys.get(id);
            const rgb = custom ? custom.color : (app.customBiomeColors?.[key] ?? FILRODENSWMB.BIOMES[key] ?? [0, 0, 0]);
            return { id, name: custom ? custom.name : platform.i18n.localize(`FILRODENSWMB.BIOMES.${key}`), hex: ColorMath.rgbToHex(rgb), checked: chosen.has(id) };
        });
        const zones = climate.zones.map((zone, index) => ({ label: platform.i18n.format("FILRODENSWMB.UI.CultureZoneNumber", { number: index + 1 }), axes: this.#zoneAxes(zone) }));
        const coverage = this.#coverage(app, climate);
        return {
            biomesMode: climate.mode === CLIMATES.BIOMES,
            choices: [
                { value: CLIMATES.BIOMES, label: "FILRODENSWMB.UI.CultureClimateBiomes", selected: climate.mode === CLIMATES.BIOMES },
                { value: CLIMATES.ZONES, label: "FILRODENSWMB.UI.CultureClimateZones", selected: climate.mode === CLIMATES.ZONES },
            ],
            biomes,
            zones,
            wide: coverage > FILRODENSWMB.GENERATOR.CULTURES.CLIMATE_WIDE,
        };
    }

    /** A zone's ranges, an axis a line each: its name and its ranges ("0.45–1.00", or Any for no limit). */
    static #zoneAxes(zone) {
        const axes = [
            ["elevation", "FILRODENSWMB.UI.RuleEditorElevation"],
            ["moisture", "FILRODENSWMB.UI.RuleEditorMoisture"],
            ["temperature", "FILRODENSWMB.UI.RuleEditorTemperature"],
        ];
        const ranges = (segments) => {
            if (!segments.length || segments.some(([min, max]) => min <= 0 && max >= 1)) return platform.i18n.localize("FILRODENSWMB.UI.CultureAny");
            return segments.map(([min, max]) => `${min.toFixed(2)}–${max.toFixed(2)}`).join(", ");
        };
        return axes.map(([axis, label]) => ({ label: platform.i18n.localize(label), value: ranges(zone[axis]) }));
    }

    /**
     * The share of the map's land the culture's climate takes in, from the terrain as it is now (a
     * chosen biome's zone worked out as a run works it out; see CultureClimate.biomeZones), or 0
     * with no terrain or no limit.
     */
    static #coverage(app, climate) {
        const { currentElevationData: elevation, currentMoistureData: moisture, currentTemperatureData: temperature } = app;
        if (!elevation || !moisture || !temperature) return 0;
        const seaLevel = Number(app.uiState.seaLevel ?? 0);
        const water = app.bufferWaterMask;
        const isLand = (pixel) => elevation[pixel] >= seaLevel && !(water?.[pixel] > 0);
        const map = { elevation, moisture, temperature, seaLevel, isLand };
        if (climate.mode !== CLIMATES.BIOMES) return zoneCoverage(climate.zones, map, COVERAGE_STRIDE);
        if (!climate.biomes.length) return 0;
        const shown = this.#shownBiomes(app, isLand);
        return shown ? zoneCoverage(biomeZones(climate.biomes, { shown, elevation, moisture, temperature }), map, COVERAGE_STRIDE) : 0;
    }

    /** The biome every COVERAGE_STRIDE-th land pixel shows (0 elsewhere), or null without the map's parameters. */
    static #shownBiomes(app, isLand) {
        let params;
        try {
            params = MapStateManager.getDerivedMapParameters(app.uiState, app.customBiomeColors ?? {}).params;
        } catch {
            return null;
        }
        const { currentElevationData: elevation, currentMoistureData: moisture, currentTemperatureData: temperature, currentBiomeOverrides: overrides } = app;
        const shown = new Uint8Array(elevation.length);
        for (let pixel = 0; pixel < elevation.length; pixel += COVERAGE_STRIDE) {
            if (!isLand(pixel)) continue;
            const { land } = ProceduralEngine.resolveBiomeLookup(overrides?.[pixel] ?? 0, elevation[pixel], moisture[pixel], temperature[pixel], params.seaLevel, app.bufferWaterMask, pixel, params.customBiomeRules, params.biomePalette, params.biomeSides);
            shown[pixel] = typeof land === "string" ? (FILRODENSWMB.BIOME_IDS[land] ?? 0) : Number(land) || 0;
        }
        return shown;
    }

    /**
     * The habitat's climate as the form holds it: the choice, and the chosen biomes when they are
     * shown; zones are kept as they are (they change only through the zones editor), an older
     * culture's bands becoming its one zone. The older bands are then dropped.
     */
    static #readClimate(habitat, form) {
        const climate = climateOf(habitat);
        const mode = Object.values(CLIMATES).includes(form.elements.habitatClimate?.value) ? form.elements.habitatClimate.value : climate.mode;
        const boxes = [...form.querySelectorAll('input[name="habitatBiome"]')];
        const biomes = boxes.length ? boxes.filter((box) => box.checked).map((box) => Number(box.value)).filter(Number.isInteger) : climate.biomes;
        const read = { ...habitat, climate: mode, biomes, zones: climate.zones };
        for (const key of OLD_BANDS) delete read[key];
        return read;
    }

    /** The culture's fields as the form holds them (a band at its whole track read as none). */
    static #read(app, culture, form) {
        const { FIELDS } = FILRODENSWMB.GENERATOR.CULTURES;
        const number = (field, fallback) => {
            const value = Number(form.elements[field]?.value);
            return Number.isFinite(value) ? value : fallback;
        };
        const habitat = this.#readClimate(culture.habitat ?? {}, form);
        const parts = String(form.elements[RELIEF_FIELD]?.value ?? "").split(",").map(Number);
        if (parts.length === 2 && parts.every(Number.isFinite)) {
            const max = FIELDS.relief.max;
            const lo = Math.max(0, Math.min(...parts));
            const hi = Math.min(max, Math.max(...parts));
            habitat.relief = lo <= 1e-9 && hi >= max - 1e-9 ? null : [lo, hi];
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

    /**
     * What Generate reads of a culture, to compare: everything but its name and colour, its habitat
     * by the climate it means (an older culture's bands and the one zone they become read the same).
     */
    static #generatorReading(culture) {
        const { name: _name, color: _color, habitat = {}, ...rest } = culture;
        const { mode, biomes, zones } = climateOf(habitat);
        const { relief = null, coast = 0, river = 0 } = habitat;
        return JSON.stringify([rest, mode, biomes, zones, relief, coast, river]);
    }

    /**
     * Applies what changed, as one undo step. A run made before is then out of date, unless only
     * the culture's name or colour changed: Generate reads neither (places are named in its name
     * style, and what a run made names its cultures by id), so the map is drawn again at once in
     * the new colour instead (the Culture layer and its legend take the map culture's own).
     */
    static #apply(app, culture, form) {
        const values = typed("culture", this.#read(app, culture, form), culture);
        if (!InspectorFields.differs(culture, values)) return false;
        const generatorReads = this.#generatorReading(culture) !== this.#generatorReading({ ...culture, ...values });
        MapStateManager.pushVectorState(app);
        Object.assign(culture, values);
        if (generatorReads) app.markGeneratorStale?.();
        else app._repaintVectors?.();
        app.view?.render(["context"]);
        app.markDirty();
        return true;
    }

    /** Edit zones: the rule editor on the culture's zones; on Accept, they are its climate, as one undo step. */
    static async #editZones(app, culture) {
        const climate = climateOf(culture.habitat);
        const zones = await RuleEditorDialog.editZones(app, { name: culture.name, color: culture.color, zones: climate.zones });
        if (!zones || !CultureEditor.find(app, culture.id)) return;
        const habitat = { ...(culture.habitat ?? {}), climate: CLIMATES.ZONES, biomes: climate.biomes, zones };
        for (const key of OLD_BANDS) delete habitat[key];
        const values = typed("culture", { ...culture, habitat }, culture);
        if (!InspectorFields.differs(culture, values)) return;
        MapStateManager.pushVectorState(app);
        Object.assign(culture, values);
        app.markGeneratorStale?.();
        app.view?.render(["context"]);
        app.markDirty();
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
            // Edit zones: the rule editor on its climate zones
            editZones: (app, culture) => CultureEditor.#editZones(app, culture),
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
