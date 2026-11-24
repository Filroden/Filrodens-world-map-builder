import { platform } from "../../../platform/index.js";
import { Generation } from "./Generation.js";
import { RunInputs } from "./RunInputs.js";
import { SettlementMaps } from "./SettlementMaps.js";
import { WorldsPanel } from "./WorldsPanel.js";

/**
 * The order the world's maps are run in (board S2): the surface first, as everything else reads
 * it, then what lies under it and over it, then the settlement maps, which read the maps they sit
 * on. In S0 a world has its Surface map only; the other types come with their tracks.
 */
export const MAP_ORDER = Object.freeze(["surface", "underground", "aerial", "settlement"]);

const DIALOG_TEMPLATE = "modules/filrodens-world-map-builder/templates/world/dialogs/generate-all.hbs";

/**
 * Generate all (v5, S0 step 4b; board S2): every map of the world that needs a run, in order
 * (MAP_ORDER), each as Generate again would run it, keeping its edited and locked items. A map
 * needs a run when it has none yet or when what its last run read has changed since (Out of
 * date). Held regional worlds are left out, being their parent's: the dialogue names them.
 * **Save world when it finishes** saves the world once every run is done.
 *
 * The same order serves the single Generate's guard (GenerateGuard), its other caller.
 */
export class GenerateAll {
    /**
     * Maps in the order they are run (MAP_ORDER; maps of one type keep the order given, and a type
     * the order does not know goes last).
     * @template {{type: string}} T
     * @param {T[]} maps
     * @returns {T[]}
     */
    static order(maps) {
        const rank = (map) => {
            const index = MAP_ORDER.indexOf(map.type);
            return index === -1 ? MAP_ORDER.length : index;
        };
        return maps.map((map, at) => ({ map, at })).sort((a, b) => rank(a.map) - rank(b.map) || a.at - b.at).map((entry) => entry.map);
    }

    /**
     * What Generate all would do: the maps to run, in order, the maps already up to date, and the
     * held regional worlds left out.
     * @param {{maps: {id: string, type: string, name: string, state: "noRun"|"stale"|"current"}[], held?: string[]}} world
     * @returns {{run: object[], current: object[], held: string[]}}
     */
    static plan({ maps, held = [] }) {
        const ordered = this.order(maps);
        return { run: ordered.filter((map) => map.state !== "current"), current: ordered.filter((map) => map.state === "current"), held: [...held] };
    }

    /**
     * The open world's maps as Generate all sees them: the Surface map, then its settlement maps
     * that are Out of date (L-surface step 2b; their pin gone, a map has nothing to be made from).
     * `compute` works Out of date out now (the dialogue); otherwise only what is known is counted.
     */
    static mapsOf(app, { compute = false } = {}) {
        const { i18n } = platform;
        const state = !app.modelRun ? "noRun" : RunInputs.stale(app) ? "stale" : "current";
        const settlements = SettlementMaps.forGenerateAll(app, { compute }).map((map) => ({ ...map, name: i18n.format("FILRODENSWMB.UI.GenerateAllSettlementName", { name: map.name }) }));
        return [{ id: "surface", type: "surface", name: i18n.localize("FILRODENSWMB.UI.LayerSurfaceFull"), state }, ...settlements];
    }

    /** The names of the regional worlds this world holds, which Generate all leaves out. */
    static heldOf(app) {
        const node = app.world ? WorldsPanel.find(app, app.world.id) : null;
        return (node?.children ?? []).filter((child) => child.held).map((child) => WorldsPanel.named(child));
    }

    /** How many maps Generate all would run now. */
    static count(app) {
        return this.plan({ maps: this.mapsOf(app) }).run.length;
    }

    /** Generate all's label in Peoples and realms' Run: with how many maps it would run. */
    static buttonLabel(app) {
        const count = this.count(app);
        return count ? platform.i18n.format("FILRODENSWMB.UI.GenerateAllCount", { count }) : platform.i18n.localize("FILRODENSWMB.UI.GenerateAll");
    }

    /** What the dialogue reads (dialogs/generate-all.hbs). */
    static context(plan) {
        const { i18n } = platform;
        const stateLine = { noRun: "FILRODENSWMB.UI.GenerateAllNoRun", stale: "FILRODENSWMB.UI.GenerateAllStale", current: "FILRODENSWMB.UI.GenerateAllCurrent" };
        const row = (map, index) => ({ ...map, step: index + 1, line: i18n.localize(stateLine[map.state]) });
        return {
            run: plan.run.map(row),
            current: plan.current.map((map) => row(map, -1)),
            held: plan.held,
            heldLine: plan.held.length ? i18n.format("FILRODENSWMB.UI.GenerateAllHeld", { names: plan.held.join(", ") }) : null,
            nothing: plan.run.length === 0,
        };
    }

    /**
     * Generate all: the dialogue, then each map's run in order and, when ticked, Save world.
     * A held regional world has nothing to run (its parent's runs are its own).
     * @returns {Promise<boolean>} Whether anything ran.
     */
    static async open(app) {
        const { i18n } = platform;
        if (app.world?.held || Generation.heldByParent(app)) {
            platform.notify.warn(i18n.localize("FILRODENSWMB.UI.GenerateAllHeldWorld"));
            return false;
        }
        const plan = this.plan({ maps: this.mapsOf(app, { compute: true }), held: this.heldOf(app) });
        const context = this.context(plan);
        const content = await platform.templates.render(DIALOG_TEMPLATE, context);
        const buttons = [{ action: "cancel", label: i18n.localize(context.nothing ? "FILRODENSWMB.UI.Close" : "FILRODENSWMB.UI.Cancel"), callback: () => null }];
        if (!context.nothing) {
            buttons.push({ action: "run", label: i18n.format(plan.run.length === 1 ? "FILRODENSWMB.UI.GenerateAllRunOne" : "FILRODENSWMB.UI.GenerateAllRun", { count: plan.run.length }), icon: "fwmb-icon fwmb-icon--run", default: true, callback: (form) => ({ save: !!(form.closest("dialog") ?? form).querySelector('input[name="saveWhenDone"]')?.checked }) });
        }
        const answer = await platform.dialogs.choose({
            classes: ["fwmb", "fwmb-generate-all-dialog"],
            // Board S2: Generate all names the world it runs
            title: i18n.format("FILRODENSWMB.UI.GenerateAllTitle", { world: app.world?.name || i18n.localize("FILRODENSWMB.UI.UnnamedWorld") }),
            content,
            buttons,
            dismissed: null,
        });
        if (!answer) return false;
        let ran = false;
        for (const map of plan.run) {
            // The Surface map, the one open; later map types are opened in turn (Layers 1)
            if (map.type !== "surface") continue;
            const done = await Generation.run(app, { confirmed: true });
            if (!done) return ran;
            ran = true;
        }
        // Then the settlement maps Out of date now (the Surface map's run may have changed more
        // of them): each made again from its pin, without being opened (L-surface step 2b)
        if (plan.run.some((map) => map.type === "settlement") || ran) {
            if ((await SettlementMaps.regenerateStale(app)) > 0) ran = true;
        }
        app.view?.render(["context", "toolbar"]);
        if (ran && answer.save) await app.saveCurrentMap?.();
        return ran;
    }
}
