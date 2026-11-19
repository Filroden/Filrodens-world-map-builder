import { platform } from "../../../platform/index.js";

/**
 * The world settings editors (v5, S0 step 4; boards W1 to W3): the world's settings, edited in the
 * panel beside the map in view. They are on the world's own rail (definition.js's world stages),
 * shown while World is chosen in the layer switcher, so the rail and the switcher both say the
 * world, not one of its maps, is being worked on. Each is one settings group of the world record
 * (see WorldSettings), and its panel opens with the same head:
 * - the **World** tag;
 * - what a change reaches (the world's maps, the regional worlds it holds) and whether this
 *   sitting's changes have marked a run out of date;
 * - **Revert changes**: the group as it was before the first change in the sitting (since the world
 *   was opened, made or last saved), in one step. World settings are not in the map's undo (W2:
 *   "World settings have no undo: Revert changes puts the group back").
 * - On a held regional world the editor is read only, under the held banner naming the world it
 *   reads its settings from (its World setup is its own but fixed by its crop).
 *
 * Here is what the studio needs to know of each editor; the studio itself captures and restores a
 * group (MapStudio.revertWorldGroup), since that needs its private redraws.
 */
export const WORLD_EDITORS = Object.freeze({
    worldSetup: Object.freeze({ group: "setup", icon: "tune", label: "FILRODENSWMB.UI.WorldSetup", lede: "FILRODENSWMB.UI.WorldSetupLede" }),
    worldNameStyle: Object.freeze({ group: "nameStyle", icon: "insert-text", label: "FILRODENSWMB.UI.WorldNameStyle", lede: "FILRODENSWMB.UI.WorldNameStyleLede" }),
    worldBiomes: Object.freeze({ group: "biomes", icon: "forest", label: "FILRODENSWMB.UI.WorldBiomes", lede: "FILRODENSWMB.UI.WorldBiomesLede" }),
    worldClimate: Object.freeze({ group: "climate", icon: "water-drop", label: "FILRODENSWMB.UI.WorldClimate", lede: "FILRODENSWMB.UI.WorldClimateLede" }),
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
     * The editor's head, as its template reads it (parts/world-editor-head.hbs).
     * @param {object} app
     * @param {object} options
     * @param {string} options.tool - The editor's tool id.
     * @param {boolean} options.changed - Whether its group has changed in this sitting.
     * @param {number} options.heldCount - How many regional worlds this world holds.
     * @param {string|null} options.heldBy - For a held regional world, the world its settings come from.
     */
    static head(app, { tool, changed, heldCount, heldBy }) {
        const { i18n } = platform;
        const editor = WORLD_EDITORS[tool];
        const surface = i18n.localize("FILRODENSWMB.UI.LayerSurfaceFull");
        const readers = heldCount
            ? i18n.format(heldCount === 1 ? "FILRODENSWMB.UI.WorldReachHeldOne" : "FILRODENSWMB.UI.WorldReachHeld", { map: surface, count: heldCount })
            : i18n.format("FILRODENSWMB.UI.WorldReach", { map: surface });
        return {
            group: editor.group,
            lede: i18n.localize(editor.lede),
            reach: readers,
            changed,
            changedLine: changed ? i18n.localize(editor.group === "nameStyle" ? "FILRODENSWMB.UI.WorldChangedNames" : "FILRODENSWMB.UI.WorldChangedRuns") : null,
            held: !!heldBy,
            heldBanner: heldBy ? i18n.format(editor.group === "setup" ? "FILRODENSWMB.UI.WorldHeldSetup" : "FILRODENSWMB.UI.WorldHeldBanner", { name: heldBy }) : null,
            canRevert: changed && !heldBy,
        };
    }
}
