import { Worlds } from "../../../kernel/worlds/Worlds.js";
import { GeneratorRevision } from "../generator/GeneratorRevision.js";
import { platform } from "../../../platform/index.js";
import { Inspector } from "./Inspector.js";
import { RunInputs } from "./RunInputs.js";
import { WorldsPanel } from "./WorldsPanel.js";

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
 * the Surface map, Add a map drawn for Layers 1), its settlement maps (drawn for L-surface) and
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

        return {
            title: world?.name || i18n.localize("FILRODENSWMB.UI.OverviewUnsaved"),
            line: WorldOverview.line(app, dirtyGroups),
            maps: [surfaceCard],
            regional,
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
        const hasRun = !!app.modelRun || !!app.uiState?.parentRun;
        const stale = RunInputs.stale(app);
        const older = hasRun && GeneratorRevision.isOlder(app.uiState);
        const saved = Date.parse(map?.savedAt ?? "");
        return {
            name: i18n.localize("FILRODENSWMB.UI.LayerSurfaceFull"),
            thumbnail: (!app.isDirty && map?.thumbnail) || app.canvasEngine?.thumbnail?.() || map?.thumbnail || null,
            meta: i18n.localize(!hasRun ? "FILRODENSWMB.UI.OverviewNoRun" : stale ? "FILRODENSWMB.UI.OverviewRunEdited" : "FILRODENSWMB.UI.OverviewRun"),
            saved: [
                Number.isFinite(saved) ? WorldsPanel.savedLabel(saved) : i18n.localize("FILRODENSWMB.UI.OverviewNotSaved"),
                map?.revision ? i18n.format("FILRODENSWMB.UI.WorldMapRevision", { revision: map.revision }) : null,
            ].filter(Boolean).join(" · "),
            marks: [
                ...(stale ? [{ kind: "stale", icon: "warning-mark", label: i18n.localize("FILRODENSWMB.UI.MarkOutOfDate") }] : []),
                ...(older ? [{ kind: "older", icon: "history", label: i18n.localize("FILRODENSWMB.UI.MarkOlderGenerator") }] : []),
            ],
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
        const parts = [
            ENGINES[state.generationEngine] ? i18n.localize(ENGINES[state.generationEngine]) : null,
            state.mapSeed ? i18n.format("FILRODENSWMB.UI.OverviewSeed", { seed: state.mapSeed }) : null,
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
