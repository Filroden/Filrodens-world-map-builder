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
    // The frame's latitudes reach the Surface map's Climate tool, and through it the biomes; its
    // area factor and unit the scale bar, travel and the run's areas
    worldSetup: Object.freeze({ groups: ["setup"], icon: "tune", label: "FILRODENSWMB.UI.WorldSetup", lede: "FILRODENSWMB.UI.WorldSetupLede", readBy: ["climate", "cartography", "travel", "generate"] }),
    // The cultures and the default naming style, one page (round 4c): every random name reads them
    worldCultures: Object.freeze({ groups: ["cultures", "nameStyle"], icon: "groups", label: "FILRODENSWMB.UI.WorldCultures", lede: "FILRODENSWMB.UI.WorldCulturesLede", readBy: ["generate", "history", "infrastructure", "regions", "labels", "features"] }),
    worldAges: Object.freeze({ groups: ["ages"], icon: "history", label: "FILRODENSWMB.UI.WorldAges", lede: "FILRODENSWMB.UI.WorldAgesLede", readBy: ["generate", "history"] }),
    // A style's change reaches the map's own objects that use it (its cascade), so Styles and icons
    // keeps the map's undo rather than Revert changes (Ken, 2026-11-19)
    library: Object.freeze({ groups: ["styles", "icons"], icon: "palette", label: "FILRODENSWMB.UI.ToolLibrary", lede: "FILRODENSWMB.UI.WorldStylesLede", undo: true, readBy: ["infrastructure", "regions", "labels", "generate"] }),
    worldBiomes: Object.freeze({ groups: ["biomes"], icon: "forest", label: "FILRODENSWMB.UI.WorldBiomes", lede: "FILRODENSWMB.UI.WorldBiomesLede", readBy: ["biomes", "generate", "travel"] }),
});

/** The tools off every rail, with a Close back to the tool left: Worlds. */
const ASIDES = Object.freeze(new Set(["manage"]));

/**
 * The state each group's editor writes, as uiState keys (and the biome colours, kept beside it),
 * so a group can be put back as it was. World setup's engine and seed make the Surface map again
 * (Map setup), so only its in-place fields are kept: the latitudes, the area factor and the unit.
 * The climate has no Revert changes: it is edited on the Surface map's Climate tool, whose sliders,
 * as Terrain's, go back to their defaults when double-clicked (Ken, 2026-11-20).
 */
const STATE = Object.freeze({
    setup: Object.freeze(["latTop", "latBottom", "mapUnit", "world.areaFactor"]),
    cultures: Object.freeze(["cultures"]),
    ages: Object.freeze(["generatorSettings.ages"]),
    nameStyle: Object.freeze(["generatorSettings.nameBase"]),
    biomes: Object.freeze(["customBiomes", "nextCustomBiomeId", "@customBiomeColors"]),
});

/**
 * The rest of the world's settings in the studio's state, which no world page puts back: the
 * climate (the Surface map's Climate tool, with no Revert changes) and the four style lists
 * (Styles and icons, which keeps the map's undo).
 */
const WORLD_ONLY = Object.freeze(["globalTemp", "seasonOffset", "altCooling", "freezingThreshold", "globalMoisture", "noise.moisture.scale", "customRouteStyles", "customLabelStyles", "customRegionStyles", "customPinStyles"]);

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

/** The cultures put back keep each culture's homelands as they are now (see WorldEditors.restore). */
function keepHomelands(restored, now) {
    if (!Array.isArray(restored)) return;
    const current = new Map((Array.isArray(now) ? now : []).filter((culture) => culture?.id).map((culture) => [culture.id, culture]));
    for (const culture of restored) {
        const live = culture?.id ? current.get(culture.id) : null;
        if (!live) continue;
        if (Object.hasOwn(live, "homelands")) culture.homelands = structuredClone(live.homelands);
        else delete culture.homelands;
    }
}

/** The ages put back keep each event's place as it is now, by age id and the event's kind. */
function keepPlaces(restored, now) {
    if (!Array.isArray(restored)) return;
    const current = new Map((Array.isArray(now) ? now : []).filter((age) => age?.id).map((age) => [age.id, age]));
    for (const age of restored) {
        const live = age?.id ? current.get(age.id) : null;
        if (!live || !Array.isArray(age.events)) continue;
        const byKind = new Map((live.events ?? []).filter((event) => event?.kind).map((event) => [event.kind, event]));
        for (const event of age.events) {
            const match = event?.kind ? byKind.get(event.kind) : null;
            if (!match) continue;
            if (Object.hasOwn(match, "place")) event.place = structuredClone(match.place);
            else delete event.place;
        }
    }
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

    /**
     * Writes a captured group back into the studio's state (the studio then redraws what it reaches).
     * A culture's homelands and an event's place are the map's, not the world's (S0 step 4c-2), so
     * putting the cultures or ages back keeps them as they are now: a culture or event that is
     * back keeps its points from before only when it has none now (it was deleted since).
     */
    static restore(app, captured, group) {
        const values = captured?.[group];
        if (!values) return false;
        for (const [key, value] of Object.entries(values)) {
            const restored = structuredClone(value);
            if (group === "cultures" && key === "cultures") keepHomelands(restored, read(app, key));
            if (group === "ages" && key === "generatorSettings.ages") keepPlaces(restored, read(app, key));
            write(app, key, restored);
        }
        return true;
    }

    /**
     * The world's settings as the studio's state holds them: every group's editor state (see
     * STATE), the climate and the style lists, so the Surface map can be made again while the
     * world stays as it is (Map setup's Make the Surface map again…, S0 step 4c-2).
     */
    static captureWorld(app) {
        const keys = [...Object.values(STATE).flat(), ...WORLD_ONLY];
        return Object.fromEntries(keys.map((key) => [key, structuredClone(read(app, key))]));
    }

    /**
     * Writes back what captureWorld kept, the cultures without their homelands and the events
     * without their places: those are the map's, drawn on it, and go with what else was drawn.
     */
    static restoreWorld(app, captured) {
        for (const [key, value] of Object.entries(captured ?? {})) {
            if (value === undefined) continue;
            const restored = structuredClone(value);
            if (key === "cultures" && Array.isArray(restored)) for (const culture of restored) delete culture?.homelands;
            if (key === "generatorSettings.ages" && Array.isArray(restored)) for (const age of restored) for (const event of age?.events ?? []) delete event?.place;
            write(app, key, restored);
        }
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
