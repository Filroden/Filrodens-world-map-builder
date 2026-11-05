import { FILRODENSWMB } from "../config.js";
import { Inspector } from "./Inspector.js";
import { MapStateManager } from "./MapStateManager.js";
import { BiomePlacement } from "../generation/BiomePlacement.js";
import { ColorMath } from "../tools/ColorMath.js";
import { Sanitize } from "../data/Sanitize.js";
import { startingNumbers } from "../generator/ModelBiomes.js";
import { platform } from "../platform/index.js";
import { typed } from "../data/MapRules.js";

const TEMPLATE = "modules/filrodens-world-map-builder/templates/parts/inspector-biome.hbs";

/**
 * A custom biome in the inspector (see Inspector), opened from its row in Biomes' Edit biomes
 * section or as it is added: its name, code, colour and placement; what Generate makes of it
 * (Behaves like, and Own numbers with a slider per property, GENERATOR.BIOME_PROPERTIES); and
 * Delete. Rules are edited for every biome at once in the rule editor, from the Edit biomes section.
 *
 * Each field applies when committed, as one undo step (the undo history keeps the custom biomes,
 * see MapStateManager.getVectorStateSnapshot). The map is repainted, since a biome's colour and
 * placement show on it, and the panel's list and the bar's biome choices are drawn again, since
 * they name it. A change to what Generate reads of the biome marks a run Out of date.
 *
 * Until Own numbers is ticked its sliders are hidden and hold Behaves like's numbers, so ticking
 * it starts from the numbers the biome has been using; clearing it drops the biome's own numbers.
 */
export class BiomeEditor {
    /**
     * @param {object} app
     * @param {number} id - The custom biome's id.
     * @param {object} [options] - As Inspector.open's.
     * @returns {Promise<boolean>}
     */
    static open(app, id, options) {
        return Inspector.open(app, this.KIND, { id: Number(id) }, options);
    }

    static find(app, id) {
        return (app.uiState.customBiomes ?? []).find((biome) => biome.id === Number(id)) ?? null;
    }

    static KIND = Object.freeze({
        id: "biome",
        template: TEMPLATE,
        find: (app, { id }) => BiomeEditor.find(app, id),
        header: (_app, biome) => ({ title: biome.name, subtitle: platform.i18n.localize("FILRODENSWMB.UI.InspectorSubtitleBiome"), swatch: ColorMath.rgbToHex(biome.color) }),
        context: (_app, biome) => BiomeEditor.#context(biome),
        apply: (app, biome, _ref, form) => BiomeEditor.#apply(app, biome, form.elements),
        actions: {
            delete: (app, biome) => BiomeEditor.delete(app, biome.id),
        },
    });

    static #context(biome) {
        const numbers = startingNumbers(biome);
        return {
            biome: { ...biome, hex: ColorMath.rgbToHex(biome.color) },
            palette: FILRODENSWMB.LABELS?.PRESETS || [],
            placements: Object.values(FILRODENSWMB.BIOME_PLACEMENT).map((value) => ({ value, label: BiomePlacement.labelOf(value), selected: value === BiomePlacement.placementOfCustom(biome) })),
            behaviours: BiomeEditor.behavesLikeChoices(biome.behavesLike),
            ownNumbers: !!biome.properties,
            properties: FILRODENSWMB.GENERATOR.BIOME_PROPERTIES.map((property) => ({ ...property, name: `biomeProperty.${property.key}`, value: numbers[property.key] })),
        };
    }

    /**
     * The choices for a custom biome's Behaves like: the biome the climate gives where it lies
     * (the default), then each built-in land biome the generator knows, by name.
     * @param {string|null|undefined} selected - A key of GENERATOR.BIOMES, or none.
     * @returns {Array<{value: string, label: string, selected: boolean}>}
     */
    static behavesLikeChoices(selected) {
        const keys = Object.keys(FILRODENSWMB.GENERATOR.BIOMES);
        const current = keys.includes(selected) ? selected : "";
        return [{ value: "", label: "FILRODENSWMB.UI.BiomeBehavesLikeUnderlying", selected: current === "" }, ...keys.map((key) => ({ value: key, label: `FILRODENSWMB.BIOMES.${key}`, selected: key === current }))];
    }

    /** What Generate reads of a custom biome (its Behaves like and own numbers), to compare. */
    static #generatorReading(biome) {
        return JSON.stringify([biome?.behavesLike ?? null, biome?.properties ?? null]);
    }

    /** The biome's fields as the form holds them, checked as an import is (see MapRules.typed). */
    static #read(biome, elements) {
        let properties = null;
        if (elements.biomeOwnNumbers?.checked) {
            properties = {};
            for (const property of FILRODENSWMB.GENERATOR.BIOME_PROPERTIES) {
                const value = Number.parseFloat(elements[`biomeProperty.${property.key}`]?.value);
                properties[property.key] = Number.isFinite(value) ? value : startingNumbers(biome)[property.key];
            }
        }
        const values = typed(
            "customBiome",
            {
                name: elements.biomeName.value.trim() || biome.name,
                code: elements.biomeCode.value.trim() || null,
                color: ColorMath.hexToRgb(elements.biomeColor.value),
                placement: elements.biomePlacement.value,
                behavesLike: elements.biomeBehavesLike.value || null,
                properties,
            },
            biome,
        );
        return values;
    }

    static #apply(app, biome, elements) {
        const values = BiomeEditor.#read(biome, elements);
        const current = { name: biome.name, code: biome.code ?? null, color: biome.color, placement: BiomePlacement.placementOfCustom(biome), behavesLike: biome.behavesLike ?? null, properties: biome.properties ?? null };
        if (JSON.stringify(current) === JSON.stringify({ ...current, ...values })) return false;
        const readBefore = BiomeEditor.#generatorReading(biome);
        MapStateManager.pushVectorState(app);
        Object.assign(biome, values);
        // Superseded by `placement`, which takes priority over it anyway (see
        // BiomePlacement.placementOfCustom); dropped so an older map's flag is not carried forward
        // once the biome has been edited
        delete biome.solidOverWater;
        if (BiomeEditor.#generatorReading(biome) !== readBefore) app.markGeneratorStale?.();
        BiomeEditor.#redraw(app);
        return true;
    }

    /** After a change: the map (the biome's colour and placement), the panel's list and the bar's choices. */
    static #redraw(app) {
        app._repaintCanvas();
        app.view?.render(["context", "editToolbar"]);
        app.markDirty();
    }

    /**
     * Adds a custom biome with the next free id and opens it in the inspector, as one undo step.
     * It has no rules, so it only lies where it is painted until the rule editor gives it some.
     * @returns {Promise<number>} Its id.
     */
    static async add(app) {
        MapStateManager.pushVectorState(app);
        const id = MapStateManager.getNextCustomBiomeId(app.uiState);
        const name = platform.i18n.format("FILRODENSWMB.UI.NewCustomBiomeName", { number: (app.uiState.customBiomes ?? []).length + 1 });
        app.uiState.customBiomes ??= [];
        app.uiState.customBiomes.push({ id, name, code: null, color: [128, 128, 128], placement: FILRODENSWMB.BIOME_PLACEMENT.LAND, rules: [] });
        BiomeEditor.#redraw(app);
        await BiomeEditor.open(app, id);
        return id;
    }

    /**
     * Deletes a custom biome, after asking, as one undo step.
     *
     * Only `uiState.customBiomes` changes: painted pixels and brush strokes naming the biome's id
     * are left as they are, since the undo history cannot restore raster data. A pixel whose id
     * names no biome is drawn as the map's own biome there (see ProceduralEngine.resolveBiomeLookup)
     * and paints itself back if the biome returns by undo; so the id stays spent (see
     * MapStateManager.getNextCustomBiomeId).
     * @returns {Promise<boolean>} Whether it was deleted.
     */
    static async delete(app, id) {
        const biome = BiomeEditor.find(app, id);
        if (!biome) return false;
        const confirmed = await platform.dialogs.confirm({
            title: platform.i18n.localize("FILRODENSWMB.UI.Warning"),
            content: `<p>${Sanitize.escapeHtml(platform.i18n.localize("FILRODENSWMB.UI.DeleteBiomeConfirm"))}</p>`,
        });
        if (!confirmed) return false;
        MapStateManager.pushVectorState(app);
        // Its land now behaves as the biome beneath, so a run made while it behaved as another, or
        // with numbers of its own, is out of date
        if (biome.behavesLike || biome.properties) app.markGeneratorStale?.();
        app.uiState.customBiomes = app.uiState.customBiomes.filter((each) => each.id !== biome.id);
        if (Number(app.uiState.brushBiome) === biome.id) app.uiState.brushBiome = FILRODENSWMB.BIOME_IDS.GRASSLAND;
        if (Inspector.shows(app, "biome", biome.id)) Inspector.close(app);
        app._repaintCanvas();
        app.view?.render(["toolbar", "context", "editToolbar"]);
        app.markDirty();
        return true;
    }
}
