import { FILRODENSWMB } from "../../../config.js";
import { platform } from "../../../platform/index.js";
import { cleanUnit, formatDistance } from "../../../kernel/data/MapUnit.js";
import { ProceduralEngine } from "../generation/ProceduralEngine.js";
import { MapStateManager } from "./MapStateManager.js";
import { ThematicRun } from "./ThematicRun.js";

/** A share as a percentage. */
const PERCENT = 100;

/**
 * The ground at a map point, read once for both the information bar (MapStudio's hover) and
 * Inspect's last row (SurfaceKinds), so the two never disagree: its elevation, moisture and
 * temperature, the biome seen from above, and, where the map has a run, the people living there
 * (the run cell's leading culture and its share) and how densely.
 */
export class GroundReading {
    /**
     * The ground at a map point, or null off the map or before the terrain is made.
     * @param {object} app
     * @param {number} x - Map pixels.
     * @param {number} y
     * @param {{people?: boolean}} [options] - people: read the run's culture and density too (the
     *     information bar does not show them, and leaves them out on every move).
     * @returns {{x: number, y: number, elevation: number, moisture: number, temperature: number, biome: string, land: boolean, culture: {name: string, share: number}|null, density: number|null}|null}
     */
    static at(app, x, y, { people = false } = {}) {
        if (x === null || y === null || !app.currentElevationData) return null;
        const px = Math.floor(x);
        const py = Math.floor(y);
        if (px < 0 || py < 0 || px >= app.mapWidth || py >= app.mapHeight) return null;

        const index = py * app.mapWidth + px;
        const elevation = app.currentElevationData[index];
        const moisture = app.currentMoistureData ? app.currentMoistureData[index] : 0;
        const temperature = app.currentTemperatureData ? app.currentTemperatureData[index] : 0;
        const seaLevel = app.uiState.seaLevel;

        // The same priority-chain lookup the biome layer itself paints with
        // (ProceduralEngine.createBiomesMap): a hand-painted override, then a matching custom
        // rule, then the built-in default. getBiomeKey() alone gives only the default, so a
        // painted or rule-made biome would read wrong. The derived parameters are read directly,
        // not through the DOM-syncing getMapParameters(), since this runs on every pointer move.
        const overrideId = app.currentBiomeOverrides ? app.currentBiomeOverrides[index] : 0;
        const { params } = MapStateManager.getDerivedMapParameters(app.uiState, app.customBiomeColors);
        // The biome seen from above: under water that is the surface biome (such as Pack Ice)
        // when there is one, otherwise the bed's
        const { visible: lookupKey } = ProceduralEngine.resolveBiomeLookup(overrideId, elevation, moisture, temperature, seaLevel, app.bufferWaterMask, index, params.customBiomeRules, params.biomePalette, params.biomeSides);

        const land = Number.isFinite(elevation) && elevation >= Number(seaLevel ?? 0) && !(app.bufferWaterMask?.[index] > 0);
        const reading = { x: px, y: py, elevation, moisture, temperature, biome: this.biomeName(app, lookupKey), land, culture: null, density: null };
        if (people && land) Object.assign(reading, this.#people(app, px, py));
        return reading;
    }

    /** The run's people in the display cell under a point: its leading culture and how many live there per square unit. */
    static #people(app, x, y) {
        const source = app.meshSession ? ThematicRun.source(app) : null;
        if (!source) return {};
        const cell = app.meshSession.mesh.cellAt(x, y);
        const culture = source.cultureAt(cell);
        const density = source.valueAt("population", cell);
        return { culture: culture?.name ? { name: culture.name, share: culture.share } : null, density: Number.isFinite(density) ? density : null };
    }

    /** A share as the information bar writes it ("Valefolk (80%)"). */
    static cultureText(culture) {
        return culture ? platform.i18n.format("FILRODENSWMB.UI.ThematicCultureValue", { name: culture.name, share: Math.round(culture.share * PERCENT) }) : null;
    }

    /** A density as the thematic view writes it ("12 per km²"). */
    static densityText(app, density) {
        return Number.isFinite(density) ? platform.i18n.format("FILRODENSWMB.UI.ThematicPerArea", { value: formatDistance(density), unit: cleanUnit(app.uiState?.mapUnit) }) : null;
    }

    /** A fraction as the information bar writes it: uncapped, so elevation pushed past the old range reads honestly. */
    static percentText(value) {
        return `${Math.round((value ?? 0) * PERCENT)}%`;
    }

    /**
     * Resolves a ProceduralEngine.resolveBiomeLookup() `lookupKey` to the text a person should
     * see. A built-in default comes back as its i18n key name (e.g. "GRASSLAND", from
     * getBiomeKey()) and localises directly. A hand-painted or rule-matched override comes back
     * as a numeric id instead, which can name either a built-in biome (still an i18n key, just
     * addressed by number rather than name here) or a custom biome (a plain name the GM typed
     * in, never localised).
     */
    static biomeName(app, lookupKey) {
        if (typeof lookupKey === "number") {
            const custom = app.uiState.customBiomes?.find((c) => c.id === lookupKey);
            if (custom) return custom.name;

            const builtInKey = Object.keys(FILRODENSWMB.BIOME_IDS).find((key) => FILRODENSWMB.BIOME_IDS[key] === lookupKey);
            return builtInKey ? platform.i18n.localize(`FILRODENSWMB.BIOMES.${builtInKey}`) : "";
        }
        return platform.i18n.localize(`FILRODENSWMB.BIOMES.${lookupKey}`);
    }
}
