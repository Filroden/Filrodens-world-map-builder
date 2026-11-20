import { platform } from "../../../platform/index.js";

/**
 * The world settings editors (v5, S0 step 4; round 4c's pages, step 4c-1; boards C1, C4 to C9): the
 * world's settings, each on a page of its own beside the world's rail. The world's settings need
 * no view of a map, so a page has no canvas: the layout itself says the world, not one of its maps,
 * is being worked on. Each edits settings groups of the world record (see WorldSettings), and its
 * page opens with the same head:
 * - the world's name, the page's title and the **World** tag;
 * - whether this sitting has changed it, and **Revert changes**: its groups as they were before the
 *   first change in the sitting (since the world was opened, made or last saved), in one step.
 *   World settings are not in the map's undo, but for Styles and icons: a style's change reaches the
 *   map's own objects, so it stays an undo step of the map, and its head has Undo and Redo;
 * - the lede, then **Read by**: each map tool that reads the page, with a Go to it (`readBy`, the
 *   mirror of Peoples and realms' Read from the world);
 * - on a held regional world, the held banner naming the world it reads its settings from, the
 *   page read only (its World setup is its own but fixed by its crop).
 *
 * Here is what the studio needs to know of each editor; the studio itself captures and restores a
 * group (MapStudio.revertWorldGroup), since that needs its private redraws.
 */
export const WORLD_EDITORS = Object.freeze({
    // The frame's latitudes reach the climate, and through it the biomes (the Surface map's Climate
    // tool from step 4c-2); its area factor and unit the scale bar, travel and the run's areas
    worldSetup: Object.freeze({ groups: ["setup"], icon: "tune", label: "FILRODENSWMB.UI.WorldSetup", lede: "FILRODENSWMB.UI.WorldSetupLede", readBy: ["biomes", "cartography", "travel", "generate"] }),
    // The cultures and the default naming style, one page (round 4c): every random name reads them
    worldCultures: Object.freeze({ groups: ["cultures", "nameStyle"], icon: "groups", label: "FILRODENSWMB.UI.WorldCultures", lede: "FILRODENSWMB.UI.WorldCulturesLede", readBy: ["generate", "history", "infrastructure", "regions", "labels", "features"] }),
    worldAges: Object.freeze({ groups: ["ages"], icon: "history", label: "FILRODENSWMB.UI.WorldAges", lede: "FILRODENSWMB.UI.WorldAgesLede", readBy: ["generate", "history"] }),
    // A style's change reaches the map's own objects that use it (its cascade), so Styles and icons
    // keeps the map's undo rather than Revert changes (Ken, 2026-11-19)
    library: Object.freeze({ groups: ["styles", "icons"], icon: "palette", label: "FILRODENSWMB.UI.ToolLibrary", lede: "FILRODENSWMB.UI.WorldStylesLede", undo: true, readBy: ["infrastructure", "regions", "labels", "generate"] }),
    worldBiomes: Object.freeze({ groups: ["biomes"], icon: "forest", label: "FILRODENSWMB.UI.WorldBiomes", lede: "FILRODENSWMB.UI.WorldBiomesLede", readBy: ["biomes", "generate", "travel"] }),
    // Until step 4c-2 makes it the Surface map's Climate tool
    worldClimate: Object.freeze({ groups: ["climate"], icon: "water-drop", label: "FILRODENSWMB.UI.WorldClimate", lede: "FILRODENSWMB.UI.WorldClimateLede", readBy: ["biomes", "generate"] }),
});

/** The tools off every rail, with a Close back to the tool left: Worlds. */
const ASIDES = Object.freeze(new Set(["manage"]));

/**
 * The state each group's editor writes, as uiState keys (and the biome colours, kept beside it),
 * so a group can be put back as it was. World setup's engine, seed and frame make a new world
 * (Create new world), so only its in-place fields are kept: the latitudes, the area factor and the
 * unit.
 */
const STATE = Object.freeze({
    setup: Object.freeze(["latTop", "latBottom", "mapUnit", "world.areaFactor"]),
    cultures: Object.freeze(["cultures"]),
    ages: Object.freeze(["generatorSettings.ages"]),
    nameStyle: Object.freeze(["generatorSettings.nameBase"]),
    biomes: Object.freeze(["customBiomes", "nextCustomBiomeId", "@customBiomeColors"]),
    climate: Object.freeze(["globalTemp", "seasonOffset", "altCooling", "freezingThreshold", "globalMoisture", "noise.moisture.scale"]),
});

/** Reads a key of the studio's state: a dotted path into uiState, or "@name" for one of the studio's own fields. */
function read(app, key) {
    if (key.startsWith("@")) return app[key.slice(1)];
    if (Object.hasOwn(app.uiState ?? {}, key)) return app.uiState[key];
    const [head, ...rest] = key.split(".");
    let node = app.uiState?.[head];
    for (const part of rest) node = node?.[part];
    return node;
}

function write(app, key, value) {
    if (key.startsWith("@")) {
        app[key.slice(1)] = value;
        return;
    }
    if (Object.hasOwn(app.uiState, key) || !key.includes(".")) {
        app.uiState[key] = value;
        return;
    }
    const [head, ...rest] = key.split(".");
    app.uiState[head] = { ...(app.uiState[head] ?? {}) };
    let node = app.uiState[head];
    for (const part of rest.slice(0, -1)) {
        node[part] = { ...(node[part] ?? {}) };
        node = node[part];
    }
    node[rest.at(-1)] = value;
}

export class WorldEditors {
    /**
     * Whether the world's settings are read only here: on a held regional world, which reads them
     * from the world above it. Each editor's changes check it before they write.
     */
    static readOnly(app) {
        return !!app?.world?.held;
    }

    /** Whether a tool is a world settings editor. */
    static isEditor(tool) {
        return Object.hasOwn(WORLD_EDITORS, tool);
    }

    /** Whether a tool is off every rail, closing back to the tool left (Worlds). */
    static isAside(tool) {
        return ASIDES.has(tool);
    }

    /** The editor for a tool, or null. */
    static of(tool) {
        return WORLD_EDITORS[tool] ?? null;
    }

    /** A copy of the state every group's editor writes, as it is now (see STATE). */
    static capture(app) {
        return Object.fromEntries(Object.entries(STATE).map(([group, keys]) => [group, Object.fromEntries(keys.map((key) => [key, structuredClone(read(app, key))]))]));
    }

    /** Writes a captured group back into the studio's state (the studio then redraws what it reaches). */
    static restore(app, captured, group) {
        const values = captured?.[group];
        if (!values) return false;
        for (const [key, value] of Object.entries(values)) write(app, key, structuredClone(value));
        return true;
    }

    /**
     * More rows than this and a page's table may shrink to scroll on a short window, down to its
     * minimum height (the stylesheet's fwmb-world-table-wrap--scroll); a shorter one keeps its
     * height, so it never collapses (Ken, 2026-11-20).
     */
    static SCROLL_ROWS = 4;

    /**
     * The page's head and intro, as its templates read them (parts/world-page-head.hbs and
     * parts/world-editor-head.hbs).
     * @param {object} app
     * @param {object} options
     * @param {string} options.tool - The editor's tool id.
     * @param {boolean} options.changed - Whether one of its groups has changed in this sitting.
     * @param {number} options.heldCount - How many regional worlds this world holds.
     * @param {string|null} options.heldBy - For a held regional world, the world its settings come from.
     * @param {object[]} [options.readBy] - Its Read by chips (see MapStudio's #readByChips).
     */
    static head(app, { tool, changed, heldCount, heldBy, readBy = [] }) {
        const { i18n } = platform;
        const editor = WORLD_EDITORS[tool];
        let changes = i18n.localize("FILRODENSWMB.UI.WorldNoChanges");
        if (editor.undo) changes = i18n.localize("FILRODENSWMB.UI.WorldStylesUndo");
        else if (changed) changes = i18n.localize("FILRODENSWMB.UI.WorldChangedRuns");
        return {
            tool,
            lede: i18n.localize(editor.lede),
            changes,
            changed,
            // The regional worlds a change reaches too, after the map tools that read it
            heldReach: heldCount && !heldBy ? i18n.format(heldCount === 1 ? "FILRODENSWMB.UI.ReadByHeldOne" : "FILRODENSWMB.UI.ReadByHeld", { count: heldCount }) : null,
            readBy,
            held: !!heldBy,
            heldBanner: heldBy ? i18n.format(editor.groups.includes("setup") ? "FILRODENSWMB.UI.WorldHeldSetup" : "FILRODENSWMB.UI.WorldHeldBanner", { name: heldBy }) : null,
            // Styles and icons: Undo, not Revert changes, takes a change back (see WORLD_EDITORS)
            undo: !!editor.undo,
            canRevert: changed && !heldBy && !editor.undo,
        };
    }
}
