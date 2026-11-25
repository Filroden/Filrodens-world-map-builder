import { Worlds } from "../../../kernel/worlds/Worlds.js";
import { platform } from "../../../platform/index.js";
import { Inspector } from "./Inspector.js";
import { MapMarks } from "./MapMarks.js";
import { WorldEditor, WorldsPanel } from "./WorldsPanel.js";
import { SettlementMaps } from "./SettlementMaps.js";
import { GenerateAll } from "./GenerateAll.js";

/** The engines' short names, as World setup and Worlds name them. */
const ENGINES = Object.freeze({
    standard: "FILRODENSWMB.UI.EngineShortStandard",
    flat: "FILRODENSWMB.UI.EngineShortFlat",
    advanced: "FILRODENSWMB.UI.EngineShortAdvanced",
    guided: "FILRODENSWMB.UI.EngineShortGuided",
});

/**
 * The world overview (v5, S0 step 4; board W1): the open world at a glance, the world's rail's
 * first tool. It fills the map's place beside that rail and the inspector: the world's maps (S0:
 * the Surface map, Add a map drawn for Layers 1), its settlement maps (a table, L-surface) and
 * its regional worlds (Cut regional world… drawn for step 5) as cards. A card is chosen as in
 * Worlds: one click shows it in the inspector (a map in WorldMapCard, a regional world in
 * WorldEditor), a second goes to the map or opens the world.
 */
export class WorldOverview {
    /**
     * What the overview's template reads (tools-worldOverview.hbs).
     * @param {object} app
     * @param {{dirtyGroups?: string[]}} [options]
     */
    static async context(app, { dirtyGroups = [] } = {}) {
        const { i18n } = platform;
        const world = app.world ?? null;
        // The worlds kept for the inspector, as Worlds keeps them, so a regional world can be shown there
        await WorldsPanel.load(app);
        const node = world ? WorldsPanel.find(app, world.id) : null;
        const inspected = Inspector.inspected(app);
        const surfaceCard = { ...WorldOverview.surface(app), selected: inspected.worldMap === "surface" };

        const regional = (node?.children ?? []).map((child) => ({
            id: child.id,
            mapId: child.mapId,
            name: WorldsPanel.named(child),
            thumbnail: child.thumbnail,
            marks: WorldsPanel.marks(child),
            meta: WorldsPanel.summary(child),
            selected: inspected.world === child.id,
        }));

        const name = world?.name || i18n.localize("FILRODENSWMB.UI.UnnamedWorld");
        return {
            title: world?.name || i18n.localize("FILRODENSWMB.UI.OverviewUnsaved"),
            // The two groups (round 4c, board C3): what is in the world, and the worlds cut from it
            inTitle: i18n.format("FILRODENSWMB.UI.OverviewInWorld", { name }),
            relatedTitle: i18n.format("FILRODENSWMB.UI.OverviewCutFrom", { name }),
            relatedHint: i18n.format("FILRODENSWMB.UI.OverviewCutFromHint", { name }),
            line: WorldOverview.line(app, dirtyGroups),
            // A world with no maps yet offers to make its Surface map (board N3)
            maps: app.surfaceMade === false ? [] : [surfaceCard],
            regional,
            // Cut regional world… (S0 step 5), off with why when the Surface map cannot be cut from
            cutOff: app.cutOff?.() ?? null,
            // A held regional world: what it was cut from, at what zoom, why it is Out of date, Cut again…
            cutFrom: node?.held && node.parentId ? WorldOverview.#cutFrom(app, node) : null,
            // Its settlement maps (L-surface; board L4), a searchable table
            settlements: SettlementMaps.overview(app),
            // What Generate all would run, at the head of the In group when anything needs a run (step 4b; board L4b)
            update: GenerateAll.overview(app),
            settlementsHere: SettlementMaps.available(app),
        };
    }

    /**
     * The open world's Surface map as its card and the inspector show it: its thumbnail (as it is
     * now when it has changed since it was saved, or was never saved), whether it has been
     * populated, its marks, and when it was saved with its revision.
     */
    static surface(app) {
        const { i18n } = platform;
        const map = app.world?.maps?.find((each) => each.type === "surface") ?? null;
        const state = MapMarks.state(app);
        const saved = Date.parse(map?.savedAt ?? "");
        return {
            name: i18n.localize("FILRODENSWMB.UI.LayerSurfaceFull"),
            thumbnail: (!app.isDirty && map?.thumbnail) || WorldOverview.#drawnThumbnail(app) || map?.thumbnail || null,
            meta: i18n.localize(!state.hasRun ? "FILRODENSWMB.UI.OverviewNoRun" : state.runEdited ? "FILRODENSWMB.UI.OverviewRunEdited" : "FILRODENSWMB.UI.OverviewRun"),
            saved: [
                Number.isFinite(saved) ? WorldsPanel.savedLabel(saved) : i18n.localize("FILRODENSWMB.UI.OverviewNotSaved"),
                map?.revision ? i18n.format("FILRODENSWMB.UI.WorldMapRevision", { revision: map.revision }) : null,
            ].filter(Boolean).join(" · "),
            // Its marks (MapMarks): No run is the line above, so not a mark here
            marks: MapMarks.named(MapMarks.of(state, { noRun: false })),
        };
    }

    /** The Surface map's thumbnail as it is now, by the map and its change stamp. */
    static #drawn = new WeakMap();

    /**
     * The Surface map drawn as it is now, kept until the map changes again (its surfaceStamp):
     * drawing it reads the whole map back from the GPU, so the overview does not draw it again on
     * each render while only a settlement map changed (L-surface step 4b).
     */
    static #drawnThumbnail(app) {
        const key = `${app.currentSaveId ?? ""}:${app.surfaceStamp ?? ""}`;
        const kept = WorldOverview.#drawn.get(app);
        if (kept?.key === key && kept.url) return kept.url;
        const url = app.canvasEngine?.thumbnail?.() ?? null;
        if (url) WorldOverview.#drawn.set(app, { key, url });
        return url;
    }

    /** A held regional world's "Cut from" note (see context). */
    static #cutFrom(app, node) {
        const { i18n } = platform;
        const parentName = node.parentName || i18n.localize("FILRODENSWMB.UI.UnnamedWorld");
        const zoom = Number.isFinite(node.zoom) ? i18n.format("FILRODENSWMB.UI.RegionalZoomValue", { zoom: new Intl.NumberFormat(i18n.lang, { maximumFractionDigits: 1 }).format(node.zoom) }) : null;
        return {
            id: node.id,
            line: zoom ? i18n.format("FILRODENSWMB.UI.OverviewCutFromZoom", { name: parentName, zoom }) : i18n.format("FILRODENSWMB.UI.OverviewCutFromLine", { name: parentName }),
            stale: WorldsPanel.staleLines(node),
            again: WorldEditor.cutAgain(app, node),
        };
    }

    /** A world's node in the tree of worlds (Worlds.tree), with its children, or null. */
    static async nodeOf(worldId) {
        const find = (nodes) => {
            for (const node of nodes) {
                if (node.id === worldId) return node;
                const found = find(node.children);
                if (found) return found;
            }
            return null;
        };
        return find(await Worlds.tree());
    }

    /** The header's line (W1): engine, seed, frame, area factor, latitudes, then when saved and what is unsaved. */
    static line(app, dirtyGroups = []) {
        const { i18n } = platform;
        const state = app.uiState ?? {};
        const latitude = (value) => `${Math.abs(Math.round(value))}° ${value >= 0 ? i18n.localize("FILRODENSWMB.UI.North") : i18n.localize("FILRODENSWMB.UI.South")}`;
        // The engine and seed are its Surface map's, once made
        const made = app.surfaceMade !== false;
        const parts = [
            made && ENGINES[state.generationEngine] ? i18n.localize(ENGINES[state.generationEngine]) : null,
            made && state.mapSeed ? i18n.format("FILRODENSWMB.UI.OverviewSeed", { seed: state.mapSeed }) : null,
            app.mapWidth && app.mapHeight ? `${app.mapWidth} × ${app.mapHeight}` : null,
            Number.isFinite(state.world?.areaFactor) ? i18n.format("FILRODENSWMB.UI.OverviewAreaFactor", { factor: state.world.areaFactor }) : null,
            Number.isFinite(state.latTop) && Number.isFinite(state.latBottom) ? i18n.format("FILRODENSWMB.UI.OverviewLatitudes", { from: latitude(state.latTop), to: latitude(state.latBottom) }) : null,
        ];
        const saved = app.world ? WorldsPanel.lastSaved(WorldsPanel.find(app, app.world.id) ?? { maps: app.world.maps ?? [], settingsSavedAt: app.world.settingsSavedAt }) : null;
        parts.push(saved ? WorldsPanel.savedLabel(saved) : i18n.localize("FILRODENSWMB.UI.OverviewNotSaved"));
        if (app.isDirty) parts.push(dirtyGroups.length ? i18n.format("FILRODENSWMB.UI.OverviewUnsavedGroups", { groups: dirtyGroups.join(", ") }) : i18n.localize("FILRODENSWMB.UI.OverviewUnsavedChanges"));
        return parts.filter(Boolean).join(" · ");
    }
}

/**
 * One of the open world's maps in the inspector, chosen from its card in the world overview (S0:
 * the Surface map): whether it has been populated, its marks, when it was saved, and Go to the map.
 */
export const WorldMapCard = Object.freeze({
    id: "worldMap",
    template: "modules/filrodens-world-map-builder/templates/world/parts/inspector-world-map.hbs",
    find: (app, ref) => (ref.id === "surface" && app.inWorld ? WorldOverview.surface(app) : null),
    header: (app, map) => ({ title: map.name, subtitle: app.world?.name || platform.i18n.localize("FILRODENSWMB.UI.OverviewUnsaved"), swatch: null }),
    context: (_app, map) => ({ map }),
    apply: () => false,
    actions: {
        showMap: (app) => app.showMap(),
    },
});
