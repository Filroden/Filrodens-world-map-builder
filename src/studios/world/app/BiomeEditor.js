import { FILRODENSWMB } from "../../../config.js";
import { Inspector } from "./Inspector.js";
import { WorldEditors } from "./WorldEditors.js";
import { MapStateManager } from "./MapStateManager.js";
import { BiomePlacement } from "../generation/BiomePlacement.js";
import { ColorMath } from "../../../kernel/util/ColorMath.js";
import { Sanitize } from "../../../kernel/data/Sanitize.js";
import { anyUsesBiomes } from "../generator/CultureClimate.js";
import { startingNumbers } from "../generator/ModelBiomes.js";
import { platform } from "../../../platform/index.js";
import { typed } from "../data/MapRules.js";

const TEMPLATE = "modules/filrodens-world-map-builder/templates/world/parts/inspector-biome.hbs";
const TEMPLATE_BUILT_IN = "modules/filrodens-world-map-builder/templates/world/parts/inspector-biome-builtin.hbs";

/** How a number Generate reads is shown in the Biomes page's table. */
const shown = (value) => (Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "–");

/**
 * A custom biome in the inspector (see Inspector), opened from its row in Biomes' Edit biomes
 * section or as it is added: its name, code, colour and placement; what Generate makes of it
 * (Behaves like, and Own numbers with a slider per property, GENERATOR.BIOME_PROPERTIES); and
 * Delete. Rules are edited for every biome at once in the rule editor, from the Edit biomes section.
 *
 * Each field applies when committed. The biomes are the world's (World › Biomes, S0 step 4), so a
 * change is not an undo step of the map: Revert changes puts the table back (see WorldEditors).
 * The map is repainted, since a biome's colour and
 * placement show on it, and the panel's list and the bar's biome choices are drawn again, since
 * they name it. A change to what Generate reads of the biome marks a run Out of date: its Behaves
 * like and own numbers, and, while a culture's climate is chosen biomes (see CultureClimate), its
 * placement too, since that changes where each biome shows and so the climates worked out from them.
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

    /**
     * A built-in biome in the inspector (S0 step 4c-1, board C1): its name, its colour (the one
     * thing of it the world changes), where it can lie and the numbers Generate reads of it, read
     * only, and the rule editor, since the climate places it.
     */
    static openBuiltIn(app, key, options) {
        return Inspector.open(app, this.BUILT_IN, { key: String(key ?? "") }, options);
    }

    /** A built-in biome by its key, as the inspector and the table show it, or null. */
    static builtIn(app, key) {
        if (!Object.hasOwn(FILRODENSWMB.BIOMES, key) || !Object.hasOwn(FILRODENSWMB.BIOME_IDS, key) || key.toLowerCase().startsWith("custom")) return null;
        const rgb = app.customBiomeColors?.[key] || FILRODENSWMB.BIOMES[key];
        const numbers = FILRODENSWMB.GENERATOR.BIOMES[key] ?? null;
        return {
            key,
            name: platform.i18n.localize(`FILRODENSWMB.BIOMES.${key}`),
            hex: ColorMath.rgbToHex(rgb),
            where: platform.i18n.localize(BiomePlacement.labelOf(BiomePlacement.placementOfBuiltIn(key))),
            properties: numbers ? FILRODENSWMB.GENERATOR.BIOME_PROPERTIES.map((property) => ({ label: property.label, hint: property.hint, value: shown(numbers[property.key]) })) : null,
        };
    }

    static BUILT_IN = Object.freeze({
        id: "builtInBiome",
        template: TEMPLATE_BUILT_IN,
        find: (app, { key }) => BiomeEditor.builtIn(app, key),
        header: (_app, biome) => ({ title: biome.name, subtitle: platform.i18n.localize("FILRODENSWMB.UI.InspectorSubtitleBuiltInBiome"), swatch: biome.hex }),
        context: (_app, biome) => ({ biome, palette: FILRODENSWMB.LABELS?.PRESETS || [] }),
        apply: (app, biome, _ref, form) => BiomeEditor.#applyBuiltIn(app, biome, form.elements),
        actions: {},
    });

    /** A built-in biome's colour, as the world's: the map repainted, the table drawn again. */
    static #applyBuiltIn(app, biome, elements) {
        const hex = elements.biomeColor?.value;
        if (!hex || hex.toLowerCase() === biome.hex.toLowerCase() || WorldEditors.readOnly(app)) return false;
        app.customBiomeColors[biome.key] = ColorMath.hexToRgb(hex);
        BiomeEditor.#redraw(app);
        return true;
    }

    /**
     * The Biomes page's table (S0 step 4c-1, board C1): a row a biome, built-in then custom, with its
     * kind, where it can lie and the four numbers Generate reads; a custom biome with no numbers of
     * its own says which biome it behaves like.
     * @param {object} app
     * @param {object[]} biomeList - The studio's biomes as the panels list them (built-in, then custom).
     */
    static table(app, biomeList) {
        const { i18n } = platform;
        const shownNow = Inspector.current(app);
        const builtInKind = i18n.localize("FILRODENSWMB.UI.BiomeKindBuiltIn");
        const customKind = i18n.localize("FILRODENSWMB.UI.BiomeKindCustom");
        const keys = FILRODENSWMB.GENERATOR.BIOME_PROPERTIES.map((property) => property.key);
        let builtIns = 0;
        const rows = biomeList.map((entry) => {
            const where = i18n.localize(BiomePlacement.labelOf(entry.placement));
            if (!entry.isCustom) {
                builtIns += 1;
                const numbers = FILRODENSWMB.GENERATOR.BIOMES[entry.key];
                return { key: entry.key, isCustom: false, name: i18n.localize(entry.label), hex: entry.hex, kind: builtInKind, where, numbers: keys.map((key) => shown(numbers?.[key])), selected: shownNow?.kind === BiomeEditor.BUILT_IN && shownNow.ref.key === entry.key };
            }
            const biome = BiomeEditor.find(app, entry.id);
            const row = { id: entry.id, isCustom: true, name: entry.label, code: biome?.code ?? null, hex: entry.hex, kind: customKind, where, hasRules: (biome?.rules ?? []).length > 0, selected: shownNow?.kind === BiomeEditor.KIND && shownNow.ref.id === entry.id };
            if (biome?.properties) return { ...row, numbers: keys.map((key) => shown(startingNumbers(biome)[key])) };
            const like = biome?.behavesLike && FILRODENSWMB.GENERATOR.BIOMES[biome.behavesLike] ? i18n.localize(`FILRODENSWMB.BIOMES.${biome.behavesLike}`) : i18n.localize("FILRODENSWMB.UI.BiomeBehavesLikeUnderlying").toLowerCase();
            return { ...row, behaves: i18n.format("FILRODENSWMB.UI.BiomeBehavesLikeRow", { name: like }) };
        });
        const custom = rows.length - builtIns;
        return {
            rows,
            properties: FILRODENSWMB.GENERATOR.BIOME_PROPERTIES.map((property) => ({ label: property.label, hint: property.hint })),
            count: i18n.format("FILRODENSWMB.UI.BiomeTableCount", { builtIn: builtIns, custom }),
        };
    }

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

    /**
     * What Generate reads of a custom biome, to compare: its Behaves like and own numbers, and, when
     * a culture's climate is chosen biomes, its placement (where it may show).
     */
    static #generatorReading(app, biome) {
        const placement = anyUsesBiomes(app.uiState.cultures) ? BiomePlacement.placementOfCustom(biome) : null;
        return JSON.stringify([biome?.behavesLike ?? null, biome?.properties ?? null, placement]);
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
        const readBefore = BiomeEditor.#generatorReading(app, biome);
        Object.assign(biome, values);
        // Superseded by `placement`, which takes priority over it anyway (see
        // BiomePlacement.placementOfCustom); dropped so an older map's flag is not carried forward
        // once the biome has been edited
        delete biome.solidOverWater;
        if (BiomeEditor.#generatorReading(app, biome) !== readBefore) app.markGeneratorStale?.();
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
     * Adds a custom biome with the next free id and opens it in the inspector,.
     * It has no rules, so it only lies where it is painted until the rule editor gives it some.
     * @returns {Promise<number>} Its id.
     */
    static async add(app) {
        const id = MapStateManager.getNextCustomBiomeId(app.uiState);
        const name = platform.i18n.format("FILRODENSWMB.UI.NewCustomBiomeName", { number: (app.uiState.customBiomes ?? []).length + 1 });
        app.uiState.customBiomes ??= [];
        app.uiState.customBiomes.push({ id, name, code: null, color: [128, 128, 128], placement: FILRODENSWMB.BIOME_PLACEMENT.LAND, rules: [] });
        BiomeEditor.#redraw(app);
        await BiomeEditor.open(app, id);
        return id;
    }

    /**
     * Deletes a custom biome, after asking,.
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
        // Its land now behaves as the biome beneath, so a run made while it behaved as another, or
        // with numbers of its own, is out of date; and so is one with a culture whose climate is
        // chosen biomes, since its land now shows the biome beneath
        if (biome.behavesLike || biome.properties || anyUsesBiomes(app.uiState.cultures)) app.markGeneratorStale?.();
        app.uiState.customBiomes = app.uiState.customBiomes.filter((each) => each.id !== biome.id);
        if (Number(app.uiState.brushBiome) === biome.id) app.uiState.brushBiome = FILRODENSWMB.BIOME_IDS.GRASSLAND;
        if (Inspector.shows(app, "biome", biome.id)) Inspector.close(app);
        app._repaintCanvas();
        app.view?.render(["toolbar", "context", "editToolbar"]);
        app.markDirty();
        return true;
    }
}
