import { FILRODENSWMB } from "../config.js";
import { infillInBackground } from "../generator/Generate.js";
import { panelSettings } from "../generator/GeneratorSettings.js";
import { RiverNetwork } from "../generation/RiverNetwork.js";
import { buildRoutes } from "../generator/MaterialiseRoutes.js";
import { stageRandom } from "../generator/Random.js";
import { clampAreaFactor } from "../mesh/Schema.js";
import { platform } from "../platform/index.js";
import { DetailLevel } from "./DetailLevel.js";
import { Generation } from "./Generation.js";
import { InfillInput } from "./InfillInput.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { PinStyles } from "./PinStyles.js";
import { Regeneration, isKept } from "./Regeneration.js";
import { TravelView } from "./TravelView.js";
import { VectorHistory } from "./VectorHistory.js";

/**
 * Fill in (the Generate panel's section on a regional map; see Infill): villages and market towns
 * between the places the regional map inherited, joined by lanes, worked out in the background
 * under the processing overlay and written onto the map as ordinary, editable pins and routes, as
 * one undo step.
 *
 * What it adds carries `generated` details like a run's (with `infill: true` and the fill-in's own
 * run id), so Generate and Remove generated content treat it as generated content. Filling in again
 * replaces what the last fill-in added, except what the reader has edited or locked, and never
 * touches what the map inherited.
 *
 * Pins take the map's Market town and Village styles and lanes its Lane style, each added from the
 * defaults when the map lacks it (see Generation's style finders).
 *
 * In-fill works on cells about INFILL.CELL_KM apart whose sites lie near the middles of a square
 * grid, so a place is set on one of the display cells within its in-fill cell, by chance (one
 * beside a river twice as likely), rather than on the site; otherwise its places would line up.
 * Never in a river as drawn (see InfillInput.dryCell): in-fill settles only in-fill cells with a
 * dry display cell, and a place stands on one of those.
 */
export class Infilling {
    /** Whether an item is in-fill's. */
    static isInfill(item) {
        return item?.generated?.infill === true;
    }

    /**
     * What the Generate panel's Fill in section shows: whether it is shown at all (a regional map),
     * whether in-fill is offered and, if not, why, and what the last fill-in added.
     * @param {object} app
     */
    static context(app) {
        const regional = !!(app.currentParentId || app.parentRun);
        if (!regional) return null;
        const offered = InfillInput.offered(app);
        let reason = null;
        if (!offered) reason = app.parentRun ? "FILRODENSWMB.UI.InfillTooCoarse" : "FILRODENSWMB.UI.InfillNoParentRun";
        const counts = this.counts(app);
        // As the panel shows them, grouped for the reader's language
        const shown = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, value.toLocaleString(platform.i18n.lang)]));
        return { offered, reason, counts, shown, again: counts.markets + counts.villages + counts.lanes > 0 };
    }

    /** What the map holds of in-fill's: market towns, villages and lanes. */
    static counts(app) {
        const counts = { markets: 0, villages: 0, lanes: 0 };
        for (const pin of app.mapPins ?? []) {
            if (!this.isInfill(pin)) continue;
            if (pin.generated.tier === "marketTown") counts.markets++;
            else counts.villages++;
        }
        for (const route of app.mapRoutes ?? []) if (this.isInfill(route)) counts.lanes++;
        return counts;
    }

    /**
     * Fills in the open regional map: asks first when it holds an earlier fill-in, then works it
     * out in the background and writes it onto the map.
     * @param {object} app
     * @param {{ask?: boolean}} [options] - ask: false skips the question (the fill-in asked for when the map was cut).
     * @returns {Promise<boolean>} Whether anything was added.
     */
    static async run(app, { ask = true } = {}) {
        if (!app.meshSession?.aggregates || !app.currentElevationData || !InfillInput.offered(app)) {
            platform.notify.warn(platform.i18n.localize("FILRODENSWMB.UI.InfillNotReady"));
            return false;
        }
        if (ask && !(await this.#confirmAgain(app))) return false;
        let made;
        try {
            made = await app.runCancellable(platform.i18n.localize("FILRODENSWMB.UI.InfillWorking"), (signal) => this.#work(app, signal));
        } catch (error) {
            console.error("FWMB | Fill in failed:", error);
            platform.notify.error(platform.i18n.localize("FILRODENSWMB.UI.InfillFailed"));
            return false;
        }
        if (!made) return false;
        platform.notify.info(platform.i18n.format("FILRODENSWMB.UI.InfillDone", { markets: made.markets.toLocaleString(platform.i18n.lang), villages: made.villages.toLocaleString(platform.i18n.lang) }));
        return true;
    }

    /** Before filling in again: what goes and what stays. True to go ahead (or when there is nothing to replace). */
    static async #confirmAgain(app) {
        const replaced = [...(app.mapPins ?? []), ...(app.mapRoutes ?? [])].filter((item) => this.isInfill(item) && !isKept(item)).length;
        if (!replaced) return true;
        return MapDialogManager._confirmDialog(platform.i18n.localize("FILRODENSWMB.UI.InfillAgainTitle"), platform.i18n.format("FILRODENSWMB.UI.InfillAgainMessage", { count: replaced.toLocaleString(platform.i18n.lang) }));
    }

    static async #work(app, signal) {
        const mesh = app.meshSession.mesh;
        const grid = InfillInput.grid(mesh);
        const settings = panelSettings(app.uiState.generatorSettings);
        const seed = `${settings.seed || app.uiState.mapSeed || ""}:infill`;
        const gatherInput = () =>
            InfillInput.gather({
                mesh,
                grid,
                parentRun: app.parentRun,
                payload: Generation.payload(app),
                pins: (app.mapPins ?? []).filter((pin) => !this.isInfill(pin)),
                routes: (app.mapRoutes ?? []).filter((route) => !this.isInfill(route)),
                speeds: TravelView.setting(app).speeds,
                seed,
                nameBase: settings.nameBase,
                areaFactor: clampAreaFactor(app.uiState.world?.areaFactor),
                land: app.meshSession.aggregates?.land ?? null,
                riverImage: app.bufferRivers ?? null,
            }).input;
        const result = await infillInBackground(gatherInput, { signal }).catch((error) => {
            if (error?.name === "AbortError") return null;
            throw error;
        });
        if (!result || signal.aborted) return null;
        return this.apply(app, result, grid, { seed });
    }

    /**
     * Writes a fill-in onto the map, replacing the last one (bar what the reader has made their
     * own), as one undo step.
     * @param {object} app
     * @param {object} result - Infill.runInfill's result.
     * @param {object} grid - The in-fill cells it was worked out on (see InfillInput.grid).
     * @param {{seed?: string}} [options] - seed: the fill-in's, for where in its cell each place goes.
     * @returns {{markets: number, villages: number, lanes: number}} What was added.
     */
    static apply(app, result, grid, { seed = "" } = {}) {
        const before = VectorHistory.snapshot(app);
        app.mapPins = (app.mapPins ?? []).filter((pin) => !this.isInfill(pin) || isKept(pin));
        app.mapRoutes = (app.mapRoutes ?? []).filter((route) => !this.isInfill(route) || isKept(route));
        const runId = platform.utils.randomID();
        const idFactory = () => platform.utils.randomID();
        const pinStyleFor = Generation.pinStyleFinder(app);
        const mesh = app.meshSession.mesh;
        const siteOf = this.#placeSites(app, result.places, grid, seed);
        const displayCell = (cell) => siteOf.get(cell) ?? grid.siteCell[cell];
        const pins = result.places.map((place, index) => {
            const cell = displayCell(place.cell);
            const pin = {
                id: idFactory(),
                name: place.name,
                description: "",
                icon: FILRODENSWMB.PINS.DEFAULT_ICON,
                x: mesh.siteX(cell),
                y: mesh.siteY(cell),
                scale: FILRODENSWMB.PINS.DEFAULT_SCALE,
                color: FILRODENSWMB.PINS.DEFAULT_COLOR,
                visibility: "all",
                pinStyle: null,
                label: { fontSize: FILRODENSWMB.PINS.DEFAULT_SCALE },
                cell,
                generated: { run: runId, kind: "town", tier: place.tier, sourceId: index, population: place.population, infill: true, edited: false, locked: false },
            };
            const style = pinStyleFor(place.tier);
            if (style) PinStyles.apply(app, pin, style);
            return pin;
        });
        const routeStyleFor = Generation.routeStyleFinder(app);
        const chains = result.lanes.map((lane) => ({ cells: lane.cells.map(displayCell), transport: "road", class: "minor" }));
        const routes = buildRoutes(app.meshSession, { routes: chains }, { runId, idFactory, styleFor: () => routeStyleFor("lane", "minor"), styleFields: (style) => MapDialogManager.routeStyleFields(style) });
        for (const route of routes) route.generated.infill = true;
        const placed = Regeneration.placesBeside(app, pins);
        app.mapPins.push(...placed);
        app.mapRoutes.push(...routes);
        VectorHistory.push(app, VectorHistory.composite([before]));
        // The map starts at the level its new places read at (a view setting, so not undone with it)
        app.setDetailLevel?.(this.startLevel(app, placed), { repaint: false });
        app._repaintVectors();
        app.view?.render(["context"]);
        app.markDirty();
        return { markets: placed.filter((pin) => pin.generated.tier === "marketTown").length, villages: placed.filter((pin) => pin.generated.tier !== "marketTown").length, lanes: routes.length };
    }

    /**
     * The detail level a fill-in starts the map at, as a run's does (see DetailLevel.forScale): the
     * most detailed whose filled-in places stand at least DETAIL.MIN_SPACING_PX apart on average
     * over the map's land. Everything when all of them do; Local when the market towns and large
     * villages do (those Local adds); otherwise the level the map's own towns allow, at most
     * Regional.
     * @param {object} app
     * @param {object[]} pins - The places the fill-in added.
     * @returns {number}
     */
    static startLevel(app, pins) {
        const { DETAIL } = FILRODENSWMB;
        const { count, land } = app.meshSession.aggregates ?? {};
        let landPx = 0;
        if (count && land) for (let cell = 0; cell < land.length; cell++) if (land[cell]) landPx += count[cell];
        if (!(landPx > 0)) landPx = (app.mapWidth ?? 0) * (app.mapHeight ?? 0);
        const apart = (places) => !places || Math.sqrt(landPx / places) >= DETAIL.MIN_SPACING_PX;
        if (apart(pins.length)) return DETAIL.EVERYTHING;
        if (apart(pins.filter((pin) => DetailLevel.ofPin(app, pin) <= DETAIL.LOCAL).length)) return DETAIL.LOCAL;
        return Math.min(DetailLevel.forScale(app.meshSession.mesh?.kmPerPx), DETAIL.LOCAL - 1);
    }

    /**
     * The display cell each place is set on: one of the dry cells within its in-fill cell (see
     * InfillInput.dryCell), by chance, one beside a river twice as likely (weighted reservoir
     * sampling, one pass over the display cells). Failing a dry cell, any land cell; failing that,
     * the in-fill cell's site.
     * @returns {Map<number, number>} In-fill cell to display cell.
     */
    static #placeSites(app, places, grid, seed) {
        const mesh = app.meshSession.mesh;
        const land = app.meshSession.aggregates?.land ?? null;
        const image = app.bufferRivers?.length === mesh.width * mesh.height * 4 ? app.bufferRivers : null;
        const inRiver = (cell) => !!image && RiverNetwork.isInChannel(image, Math.floor(mesh.siteY(cell)) * mesh.width + Math.floor(mesh.siteX(cell)));
        const random = stageRandom(seed, "infill-sites");
        const chosen = new Map(places.map((place) => [place.cell, -1]));
        const anyLand = new Map();
        const weights = new Map();
        for (let cell = 0; cell < grid.of.length; cell++) {
            const own = grid.of[cell];
            if (!chosen.has(own) || (land && !land[cell])) continue;
            if (!anyLand.has(own)) anyLand.set(own, cell);
            if (!InfillInput.dryCell(mesh, cell, land, image)) continue;
            const weight = mesh.neighbours(cell).some(inRiver) ? 2 : 1;
            const total = (weights.get(own) ?? 0) + weight;
            weights.set(own, total);
            if (random() * total < weight) chosen.set(own, cell);
        }
        for (const [own, cell] of chosen) if (cell < 0) chosen.set(own, anyLand.get(own) ?? grid.siteCell[own]);
        return chosen;
    }
}
