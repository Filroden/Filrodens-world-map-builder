import { FILRODENSWMB } from "../config.js";
import { platform } from "../platform/index.js";
import { cleanUnit } from "../data/MapUnit.js";
import { decodeModelRun } from "../generator/ModelRun.js";
import { GeneratorRevision } from "../generator/GeneratorRevision.js";
import { blendValues, blendWeights } from "../thematic/ThematicData.js";
import { dayRings, edgeDays, flagRoute, groundPace, travelConditions, travelFrom, travelTo, wayTo } from "../travel/TravelTime.js";
import { Generation } from "./Generation.js";
import { RunCells } from "./RunCells.js";
import { TravelNetwork } from "./TravelNetwork.js";

/**
 * The Travel tool (templates/tools-travel.hbs): how long a journey takes from a start chosen on the
 * map, by a way of travel over land (on foot, by wagon, by fast mount), with rivers and the sea at
 * their own speeds. The times come from the generator's own travel network and the run's roads
 * (see TravelTime and TravelNetwork), so they explain the network the run built.
 *
 * While the tool is open: a click on the map sets the start; the land is coloured by days of
 * travel (drawn in the thematic layer's place, so the thematic colour layers are set aside), and a
 * line marks each whole day. The information bar gives the time from the start to the pointer and
 * back again (the two differ: rivers, winds and climbs run one way). Shift+click (or the panel's
 * button) shows or hides the quickest way to the pointer, drawn on the map as it moves; hidden at
 * first, so the bands read on their own. A click near a place starts there; elsewhere the journey starts at the point
 * clicked, with the walk to the network's nearest cell added. The bands are a day wide or more
 * (automatic by the map's size, or chosen). The way of travel, the map's speeds, the band width,
 * the start and the season are saved with the map (uiState.travel).
 *
 * On a map that follows generator revision 2 (see GeneratorRevision.rules, travelCosts), climbs,
 * the winds at sea and the season chosen count too (see TravelTime.travelConditions); an older
 * map keeps the times it was made with, and the panel says generating again brings the new ones.
 */

const T = FILRODENSWMB.TRAVEL_TIME;
const TRANSPORT = Object.freeze({ land: "road", river: "river", sea: "sea" });
const MODE_LABELS = Object.freeze({ foot: "FILRODENSWMB.UI.TravelModeFoot", wagon: "FILRODENSWMB.UI.TravelModeWagon", mount: "FILRODENSWMB.UI.TravelModeMount" });
const SPEED_LABELS = Object.freeze({
    foot: "FILRODENSWMB.UI.TravelModeFoot",
    wagon: "FILRODENSWMB.UI.TravelModeWagon",
    mount: "FILRODENSWMB.UI.TravelModeMount",
    riverDown: "FILRODENSWMB.UI.TravelRiverDown",
    riverUp: "FILRODENSWMB.UI.TravelRiverUp",
    sea: "FILRODENSWMB.UI.TravelSea",
    boat: "FILRODENSWMB.UI.TravelBoat",
});
const SEASON_LABELS = Object.freeze({ year: "FILRODENSWMB.UI.TravelSeasonYear", summer: "FILRODENSWMB.UI.TravelSeasonSummer", winter: "FILRODENSWMB.UI.TravelSeasonWinter" });
/** The season within a sentence ("in winter"), for the legend and an export's name; none all year. */
const SEASON_PHRASES = Object.freeze({ summer: "FILRODENSWMB.UI.TravelPhraseSummer", winter: "FILRODENSWMB.UI.TravelPhraseWinter" });
/** The way of travel within a sentence ("on foot"), for the legend and an export's name. */
const MODE_PHRASES = Object.freeze({ foot: "FILRODENSWMB.UI.TravelPhraseFoot", wagon: "FILRODENSWMB.UI.TravelPhraseWagon", mount: "FILRODENSWMB.UI.TravelPhraseMount" });
const FIELD_PREFIX = "travel.speeds.";
const INTERVAL_FIELD = "travel.interval";
const AUTO = "auto";
const HOURS = 24;
const NO_VALUE = "–";

/** Per studio: the journey last worked out, with what it was worked out from. */
const journeys = new WeakMap();
/** Per studio: the pointer tool that sets the start, while the tool is open. */
const pickTools = new WeakMap();
/** Studios showing the way to the pointer (for the session; hidden at first). */
const waysShown = new WeakSet();

export class TravelView {
    /** Whether the Travel tool is open. */
    static active(app) {
        return app.activeTool === "travel";
    }

    /**
     * The map's setting made valid: a known way of travel, every speed within its range (the
     * preset where missing), a band width (null for automatic), a start on the map or none, and a
     * known season (all year where missing).
     * @returns {{mode: string, speeds: Object<string, number>, interval: number|null, start: {x: number, y: number}|null, season: string}}
     */
    static setting(app) {
        const saved = app.uiState?.travel ?? {};
        const mode = T.MODES.includes(saved.mode) ? saved.mode : T.MODES[0];
        const { MIN, MAX } = T.SPEED_RANGE;
        const speeds = Object.fromEntries(Object.entries(T.SPEEDS).map(([key, preset]) => {
            const value = Number(saved.speeds?.[key]);
            return [key, Number.isFinite(value) ? Math.min(MAX, Math.max(MIN, value)) : preset];
        }));
        const start = Number.isFinite(saved.start?.x) && Number.isFinite(saved.start?.y) ? { x: saved.start.x, y: saved.start.y } : null;
        const interval = T.INTERVALS.includes(saved.interval) ? saved.interval : null;
        const season = T.SEASONS.includes(saved.season) ? saved.season : T.SEASONS[0];
        return { mode, speeds, interval, start, season };
    }

    /**
     * Whether the map's times count climbs, winds and seasons: from generator revision 2, which a
     * regional map takes from its parent (see GeneratorRevision).
     */
    static hasConditions(app) {
        return GeneratorRevision.rules(GeneratorRevision.of(app.uiState)).travelCosts;
    }

    /** The season the times are for: the one chosen, or all year on an older map. */
    static season(app) {
        return this.hasConditions(app) ? this.setting(app).season : T.SEASONS[0];
    }

    /** The automatic band width for the map: by its longer side in km (TRAVEL_TIME.AUTO_KM). */
    static autoInterval(app) {
        const span = Math.max(app.mapWidth ?? 0, app.mapHeight ?? 0) * (app.meshSession?.mesh?.kmPerPx ?? 1);
        const at = T.AUTO_KM.findIndex((limit) => span < limit);
        return T.INTERVALS[at < 0 ? T.INTERVALS.length - 1 : at];
    }

    /** The band width shown, in days. */
    static interval(app) {
        return this.setting(app).interval ?? this.autoInterval(app);
    }

    static #save(app, changes) {
        app.uiState.travel = { ...this.setting(app), ...changes };
        app.markDirty?.();
    }

    // ------------------------------------------------------------------ the tool opening and closing

    /**
     * Brings the tool's pointer and network up to date after the tool changed: while it is open a
     * click sets the start, and the network is built if it is not yet (the map is drawn again once
     * it is); when it closes, the pointer goes back to the map's tools.
     */
    static toolChanged(app) {
        const engine = app.canvasEngine;
        if (!engine) return;
        if (!this.active(app)) {
            if (engine.pickPointerTool && engine.pickPointerTool === pickTools.get(app)) {
                engine.pickPointerTool = null;
                this.#setCursor(app, "default");
            }
            engine.renderTravel?.(null);
            return;
        }
        const tool = {
            down: (x, y, event) => (event?.shiftKey ? this.toggleWay(app) : this.setStart(app, x, y)),
            move: () => {},
            up: () => {},
            hover: () => this.#setCursor(app, "crosshair"),
            doubleClick: () => {},
            leave: () => this.#setCursor(app, "default"),
        };
        pickTools.set(app, tool);
        engine.pickPointerTool = tool;
        if (!TravelNetwork.ready(app)) {
            TravelNetwork.graph(app).then(() => {
                if (!this.active(app)) return;
                app._repaintVectors?.();
                app.view?.render(["context"]);
            }, (error) => console.error("FWMB | The travel network could not be built:", error));
        }
    }

    /** Whether the pointer sets the start (for the canvas hint). */
    static picking(app) {
        return this.active(app) && !!app.canvasEngine?.pickPointerTool && app.canvasEngine.pickPointerTool === pickTools.get(app);
    }

    static #setCursor(app, cursor) {
        const canvas = app.canvasEngine?.app?.canvas ?? app.canvasEngine?.app?.view;
        if (canvas && canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    }

    // ------------------------------------------------------------------ the panel's choices

    /**
     * Sets the start where the map was clicked, or at the place the click fell on (within
     * TRAVEL_TIME.SNAP_PX on screen), since a journey nearly always starts at a place.
     */
    static setStart(app, x, y) {
        if (!(x >= 0 && y >= 0 && x < app.mapWidth && y < app.mapHeight)) return;
        const reach = T.SNAP_PX / this.#screenScale(app);
        const place = this.#nearestPin(app, { x, y });
        const start = place && Math.hypot(place.x - x, place.y - y) <= reach ? { x: place.x, y: place.y } : { x, y };
        this.#save(app, { start: { x: Math.round(start.x), y: Math.round(start.y) } });
        app._repaintVectors?.();
        app.view?.render(["context"]);
    }

    /** Whether the way to the pointer is drawn. */
    static wayShown(app) {
        return waysShown.has(app);
    }

    /** Shows or hides the way to the pointer (Shift+click, or the panel's button). */
    static toggleWay(app) {
        if (waysShown.has(app)) waysShown.delete(app);
        else waysShown.add(app);
        const journey = this.journey(app);
        if (!this.wayShown(app)) app.canvasEngine?.renderTravel?.(journey?.rings ?? null, null, journey?.start ?? null);
        app.view?.render(["context"]);
    }

    /** Clears the start. */
    static clearStart(app) {
        this.#save(app, { start: null });
        app._repaintVectors?.();
        app.view?.render(["context"]);
    }

    /** Chooses the way of travel over land. */
    static chooseMode(app, mode) {
        if (!T.MODES.includes(mode)) return;
        this.#save(app, { mode });
        app._repaintVectors?.();
        app.view?.render(["context"]);
    }

    /** Chooses the season (see TRAVEL_TIME.SEASONS). */
    static chooseSeason(app, season) {
        if (!T.SEASONS.includes(season)) return;
        this.#save(app, { season });
        app._repaintVectors?.();
        app.view?.render(["context"]);
    }

    /** Puts every speed back to its preset. */
    static resetSpeeds(app) {
        this.#save(app, { speeds: { ...T.SPEEDS } });
        app._repaintVectors?.();
        app.view?.render(["context"]);
    }

    /** Screen pixels to a map pixel at the canvas's zoom. */
    static #screenScale(app) {
        const engine = app.canvasEngine;
        if (!engine?.stage?.toGlobal) return 1;
        const from = engine.stage.toGlobal({ x: 0, y: 0 });
        const to = engine.stage.toGlobal({ x: 1, y: 0 });
        const resolution = engine.app?.renderer?.resolution || 1;
        return Math.max(1e-6, Math.abs(to.x - from.x) / resolution);
    }

    /**
     * A field changed in the panel: a speed (named "travel.speeds.<key>", kept within its range)
     * or the band width ("travel.interval"), saved and the journey worked out again. True when the
     * field was one of these.
     */
    static handleInput(app, event) {
        const name = event.target?.name ?? "";
        if (name === INTERVAL_FIELD) {
            if (event.type !== "change") return true;
            const value = Number(event.target.value);
            this.#save(app, { interval: T.INTERVALS.includes(value) ? value : null });
            app._repaintVectors?.();
            app.view?.render(["context"]);
            return true;
        }
        if (!name.startsWith(FIELD_PREFIX)) return false;
        if (event.type !== "change") return true;
        const key = name.slice(FIELD_PREFIX.length);
        if (!Object.hasOwn(T.SPEEDS, key)) return true;
        const value = Number(event.target.value);
        const { MIN, MAX } = T.SPEED_RANGE;
        const speeds = { ...this.setting(app).speeds, [key]: Number.isFinite(value) ? Math.min(MAX, Math.max(MIN, value)) : T.SPEEDS[key] };
        this.#save(app, { speeds });
        app._repaintVectors?.();
        app.view?.render(["context"]);
        return true;
    }

    // ------------------------------------------------------------------ the journey

    /**
     * The journey from the start: each model cell's days, the way back from each, the day rings,
     * the time blended per display cell, and the bands as one byte per display cell. Worked out
     * again only when the network, the way of travel, the speeds, the band width, the start or the
     * run change. Null while the tool is closed, with no start, or before the network is built.
     */
    static journey(app) {
        if (!this.active(app)) return null;
        const graph = TravelNetwork.ready(app);
        const { mode, speeds, start } = this.setting(app);
        const interval = this.interval(app);
        const mesh = app.meshSession?.mesh;
        if (!graph || !start || !mesh) return null;
        const conditioned = this.hasConditions(app);
        const season = this.season(app);
        const freezing = app.uiState?.freezingThreshold;
        const key = JSON.stringify([mode, speeds, interval, start, conditioned, season, freezing, app.modelRun?.run ?? app.parentRun?.run ?? null]);
        const cached = journeys.get(app);
        if (cached?.graph === graph && cached.key === key && cached.modelRun === app.modelRun) return cached.journey;
        const display = app.meshSession.cellAt(start.x, start.y);
        const { grid } = graph;
        const startCell = display >= 0 ? grid.of[display] : -1;
        const run = this.#runNetwork(app, graph);
        const conditions = conditioned ? travelConditions(graph, { season, freezing: Number.isFinite(freezing) ? freezing : undefined }) : null;
        const options = { speeds, mode, ...run, conditions, maxKm: T.MAX_EDGE_SPACINGS * grid.spacingPx * mesh.kmPerPx };
        const days = edgeDays(graph, options);
        const reach = travelFrom(graph, days, startCell);
        // And from every cell back to the start, each step timed the way it is travelled
        const home = travelTo(graph, days, startCell);
        // The journey starts at the point itself: the way to the cell's site is added to every time
        let startClosed = false;
        if (startCell >= 0) {
            const km = Math.hypot(grid.sites[startCell * 2] - start.x, grid.sites[startCell * 2 + 1] - start.y) * mesh.kmPerPx;
            const wet = graph.water[startCell] === 1;
            const pace = wet ? speeds.boat : groundPace(graph, options, startCell);
            const slowed = conditions ? (wet ? conditions.water : conditions.land)[startCell] : 1;
            // A start snowbound or in ice goes nowhere this season
            startClosed = !Number.isFinite(slowed);
            const lead = startClosed ? Infinity : km === 0 ? 0 : (km / pace) * slowed;
            for (let cell = 0; cell < reach.days.length; cell++) {
                reach.days[cell] += lead;
                home.days[cell] += lead;
            }
        }
        const rings = dayRings(grid.delaunay.triangles, (cell) => grid.sites[cell * 2], (cell) => grid.sites[cell * 2 + 1], reach.days, T.MAX_DAYS, interval);
        const weights = blendWeights(grid);
        const blended = blendValues(reach.days, weights);
        const blendedBack = blendValues(home.days, weights);
        const bands = new Uint8Array(blended.length);
        for (let cell = 0; cell < blended.length; cell++) bands[cell] = this.#band(blended[cell], interval);
        const journey = { graph, reach, home, rings, blended, blendedBack, bands, interval, start, startCell, season, startClosed, hasRoads: run.road.includes(1) || run.lane.includes(1) };
        journeys.set(app, { graph, key, modelRun: app.modelRun, journey });
        return journey;
    }

    /** A time's band: 1 for the first, up to MAX_DAYS; 0 beyond them or unreached. */
    static #band(days, interval) {
        const band = Math.floor(Math.max(0, days) / interval);
        return Number.isFinite(days) && band < T.MAX_DAYS ? band + 1 : 0;
    }

    /**
     * What the map gives the network: its routes as roads, sea routes and trading rivers (edge
     * flags, by each route's transport, along the cells its legs pass through), the travel cells of
     * its generated towns (whose harbours give passage soon), and each travel cell's share of
     * cleared land from the run (none without one). The routes are the map's own, so routes drawn
     * or deleted by hand count, and a regional map's routes (it has no run of its own) are used.
     */
    static #runNetwork(app, graph) {
        const { grid } = graph;
        const road = new Uint8Array(graph.edgeA.length);
        const lane = new Uint8Array(graph.edgeA.length);
        const river = new Uint8Array(graph.edgeA.length);
        const flags = { road, sea: lane, river };
        for (const route of app.mapRoutes ?? []) {
            const cells = (route.legs?.length ? route.legs.flat() : route.waypoints) ?? [];
            flagRoute(graph, cells.map((display) => (Number.isInteger(display) && display >= 0 && display < grid.of.length ? grid.of[display] : -1)), flags[route.transport] ?? road);
        }
        const towns = new Set();
        const mesh = app.meshSession.mesh;
        for (const pin of app.mapPins ?? []) {
            if (pin.generated?.kind !== "town" || !Number.isFinite(pin.x) || !Number.isFinite(pin.y)) continue;
            const display = app.meshSession.cellAt(pin.x, pin.y);
            if (display >= 0) towns.add(grid.of[display]);
        }
        // The run's cleared land, from the map's own run or a regional map's copy of its parent's
        const source = RunCells.of(app);
        const run = source ? decodeModelRun(source.run) : {};
        let cleared = null;
        if (run.cleared) {
            cleared = new Float32Array(grid.count);
            const runCellOf = (cell) => source.cells.parentOf[grid.siteCell?.[cell] ?? mesh.cellAt(grid.sites[cell * 2], grid.sites[cell * 2 + 1])];
            for (let cell = 0; cell < grid.count; cell++) cleared[cell] = run.cleared[runCellOf(cell)] ?? 0;
        }
        return { road, lane, river, towns, cleared };
    }

    /** The day bands as the thematic layer draws them (values and a lookup), or null. */
    static bandsDisplay(app, opacity) {
        const journey = this.journey(app);
        if (!journey) return null;
        return { values: journey.bands, lookup: this.#lookup(), opacity };
    }

    /** The bands' colours: step n (day n) its ramp colour, step 0 none. */
    static #lookup() {
        this.#lookupCache ??= (() => {
            const lookup = new Uint8Array(256 * 4);
            T.RAMP.forEach((hex, at) => {
                const value = Number.parseInt(hex.slice(1), 16);
                lookup.set([(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff, 0xff], (at + 1) * 4);
            });
            return lookup;
        })();
        return this.#lookupCache;
    }

    static #lookupCache = null;

    /** Draws the rings (the bands are drawn with the thematic layer; see ThematicView.render). */
    static render(app) {
        if (!this.active(app)) {
            app.canvasEngine?.renderTravel?.(null);
            return;
        }
        const journey = this.journey(app);
        app.canvasEngine?.renderTravel?.(journey?.rings ?? null, null, journey?.start ?? null);
    }

    // ------------------------------------------------------------------ the information bar

    /**
     * The time from the start to the point under the pointer, and from there back to the start, in
     * the information bar (blended between the network's cells, as the bands are); a dash where no
     * journey reaches. With the way shown (see toggleWay), the way there is drawn on the map from
     * the start to the pointer.
     */
    static readout(app, x, y) {
        const there = app.root?.querySelector("[data-travel-readout]");
        const backElement = app.root?.querySelector("[data-travel-back-readout]");
        const journey = this.journey(app);
        there?.classList.toggle("fwmb-hidden", !journey);
        backElement?.classList.toggle("fwmb-hidden", !journey);
        if (!journey) return;
        const display = x === null || y === null ? -1 : app.meshSession.cellAt(x, y);
        const { grid } = journey.graph;
        const cell = display >= 0 ? grid.of[display] : -1;
        const timeOf = (blendedDays, cellDays) => {
            const blended = display >= 0 ? blendedDays[display] : Infinity;
            return Number.isFinite(blended) ? blended : cell >= 0 ? cellDays[cell] : Infinity;
        };
        const days = timeOf(journey.blended, journey.reach.days);
        const backDays = timeOf(journey.blendedBack, journey.home.days);
        const word = (value) => (Number.isFinite(value) ? this.duration(value) : NO_VALUE);
        if (there) there.querySelector("[data-travel-value]").textContent = word(days);
        if (backElement) backElement.querySelector("[data-travel-back-value]").textContent = word(backDays);
        let way = null;
        if (this.wayShown(app) && Number.isFinite(days) && cell >= 0) {
            const route = wayTo(journey.graph, journey.reach, cell);
            const water = (at) => (journey.graph.water[at] ? "sea" : "road");
            const points = [journey.start.x, journey.start.y];
            for (const step of route.cells) points.push(grid.sites[step * 2], grid.sites[step * 2 + 1]);
            points.push(x, y);
            // The first and last stretches, to and from the network's cells, go as their cells do
            const kinds = [water(route.cells[0]), ...route.steps.map((step) => TRANSPORT[step]), water(cell)];
            way = { points, kinds };
        }
        app.canvasEngine?.renderTravel?.(journey.rings, way, journey.start);
        const band = this.#band(days, journey.interval);
        for (const item of app.root?.querySelectorAll('[data-thematic-legend="travel"] [data-travel-band]') ?? []) item.classList.toggle("fwmb-is-current", band > 0 && Number(item.dataset.travelBand) === band);
    }

    /** A time in days as the bar words it: hours under a day, else days and hours. */
    static duration(days) {
        const hours = Math.round(days * HOURS);
        const whole = Math.floor(hours / HOURS);
        const rest = hours - whole * HOURS;
        const hourText = (count) => platform.i18n.format(count === 1 ? "FILRODENSWMB.UI.TravelHour" : "FILRODENSWMB.UI.TravelHours", { count });
        const dayText = (count) => platform.i18n.format(count === 1 ? "FILRODENSWMB.UI.TravelDay" : "FILRODENSWMB.UI.TravelDays", { count });
        if (whole === 0) return hourText(Math.max(1, rest));
        if (rest === 0) return dayText(whole);
        return platform.i18n.format("FILRODENSWMB.UI.TravelDaysHours", { days: dayText(whole), hours: hourText(rest) });
    }

    // ------------------------------------------------------------------ the legend

    /** What the legend shows, for ThematicView's signature (it is written again when this changes). */
    static legendSignature(app) {
        const journey = this.journey(app);
        return journey ? `${this.setting(app).mode}:${journey.interval}:${journey.season}` : null;
    }

    /**
     * The legend: a swatch per band, each named by its last day, the band under the pointer
     * marked, and the way of travel.
     */
    static legendBody(app, make) {
        const body = make("div", "fwmb-classes fwmb-travel-days");
        const interval = this.interval(app);
        T.RAMP.slice(0, T.MAX_DAYS).forEach((colour, at) => {
            const item = make("span", "");
            item.dataset.travelBand = String(at + 1);
            const swatch = make("i", "");
            swatch.style.background = colour;
            item.append(swatch, make("span", "", String((at + 1) * interval)));
            body.append(item);
        });
        const mode = platform.i18n.localize(MODE_PHRASES[this.setting(app).mode]);
        const season = SEASON_PHRASES[this.season(app)];
        const caption = make("div", "fwmb-ramp-unit", season ? platform.i18n.format("FILRODENSWMB.UI.TravelLegendUnitSeason", { mode, season: platform.i18n.localize(season) }) : platform.i18n.format("FILRODENSWMB.UI.TravelLegendUnit", { mode }));
        const wrap = make("div", "");
        wrap.append(body, caption);
        return wrap;
    }

    // ------------------------------------------------------------------ the panel

    /** The panel's context. */
    static context(app) {
        const { mode, speeds, interval, start } = this.setting(app);
        const season = this.season(app);
        const conditioned = this.hasConditions(app);
        const unit = cleanUnit(app.uiState?.mapUnit);
        const auto = this.autoInterval(app);
        const ready = !!TravelNetwork.ready(app);
        const journey = this.journey(app);
        return {
            ready,
            modes: T.MODES.map((id) => ({ id, label: MODE_LABELS[id], chosen: id === mode })),
            // The seasons on a map that follows revision 2; an older map says how to bring them
            seasons: conditioned ? T.SEASONS.map((id) => ({ id, label: SEASON_LABELS[id], chosen: id === season })) : null,
            older: conditioned ? null : Generation.heldByParent(app) ? "FILRODENSWMB.UI.TravelOlderRegional" : "FILRODENSWMB.UI.TravelOlder",
            startClosed: !!journey?.startClosed,
            speeds: Object.keys(T.SPEEDS).map((key) => ({ name: `${FIELD_PREFIX}${key}`, label: SPEED_LABELS[key], value: speeds[key], min: T.SPEED_RANGE.MIN, max: T.SPEED_RANGE.MAX, unit: platform.i18n.format("FILRODENSWMB.UI.TravelPerDay", { unit }) })),
            intervals: [
                { value: AUTO, label: platform.i18n.format("FILRODENSWMB.UI.TravelIntervalAuto", { days: this.#days(auto) }), chosen: interval === null },
                ...T.INTERVALS.map((value) => ({ value, label: this.#days(value), chosen: interval === value })),
            ],
            start: start ? { near: this.#nearest(app, start) } : null,
            wayShown: this.wayShown(app),
            noRoads: ready && !!start && journey && !journey.hasRoads,
            canExport: !!journey,
        };
    }

    /** A number of days as the panel words it ("1 day", "5 days"). */
    static #days(count) {
        return platform.i18n.format(count === 1 ? "FILRODENSWMB.UI.TravelDay" : "FILRODENSWMB.UI.TravelDays", { count });
    }

    /** The name of the named pin nearest a point, or null. */
    static #nearest(app, point) {
        return this.#nearestPin(app, point)?.name ?? null;
    }

    /** The named pin nearest a point, or null. */
    static #nearestPin(app, point) {
        let best = null;
        let bestDistance = Infinity;
        for (const pin of app.mapPins ?? []) {
            if (!pin.name || !Number.isFinite(pin.x) || !Number.isFinite(pin.y)) continue;
            const distance = Math.hypot(pin.x - point.x, pin.y - point.y);
            if (distance < bestDistance) {
                best = pin;
                bestDistance = distance;
            }
        }
        return best;
    }

    /**
     * An export's name while the tool shows a journey: the map's, with the way of travel and the
     * start ("Westmarch, on foot from Ashby").
     */
    static exportName(app, name) {
        if (!this.journey(app)) return name;
        const { mode, start } = this.setting(app);
        const near = this.#nearest(app, start);
        const season = SEASON_PHRASES[this.season(app)];
        const way = platform.i18n.localize(MODE_PHRASES[mode]);
        const how = season ? platform.i18n.format("FILRODENSWMB.UI.TravelPhraseModeSeason", { mode: way, season: platform.i18n.localize(season) }) : way;
        return near ? platform.i18n.format("FILRODENSWMB.UI.TravelExportName", { name, mode: how, place: near }) : platform.i18n.format("FILRODENSWMB.UI.TravelExportNameNoPlace", { name, mode: how });
    }
}
