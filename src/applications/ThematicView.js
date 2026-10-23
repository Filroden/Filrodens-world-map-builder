import { FILRODENSWMB } from "../config.js";
import { platform } from "../platform/index.js";
import { cleanUnit, formatDistance } from "../data/MapUnit.js";
import { LAYERS, ThematicSource, TradeIndex, scalePosition, tradeLines } from "../thematic/ThematicData.js";
import { CultureMarkers } from "./CultureMarkers.js";
import { HistoryView } from "./HistoryView.js";

/**
 * The studio side of the thematic layers: which colour layer is shown and how strongly, and which
 * line layers beside it (the map's `thematic` view setting), what the Thematic layers menu offers,
 * the values under the pointer in the information bar, and the legends under it.
 *
 * The layers read the map's last generator run (app.modelRun) on its display mesh. The run's
 * values are worked out once per run and mesh (see ThematicSource) and kept here, so a new run, an
 * undo of one, or another map opened gives a fresh source and nothing stale is drawn.
 *
 * A layer is a view, like the Detail level: chosen in the map controls, saved with the map, and
 * followed by the exports (it is drawn on the canvas's stage, which they render).
 */

const THEMATIC = FILRODENSWMB.THEMATIC;
const NONE = "none";
/** Why a row cannot be chosen, by ThematicSource.missing's answer (with no run, the menu's note says why). */
const MISSING_REASON = Object.freeze({ run: "FILRODENSWMB.UI.ThematicNeedsRerun", cultures: "FILRODENSWMB.UI.ThematicNoCultures" });
/** The same while the History tool shows an earlier age, which keeps its cultures alone. */
const PAST_REASON = Object.freeze({ run: "FILRODENSWMB.UI.ThematicPresentOnly", cultures: "FILRODENSWMB.UI.ThematicNoCultures" });
/** The studio's document, for making legend nodes. */
const doc = (app) => app.root.ownerDocument;
/** A dash for no value, as the information bar shows off the map. */
const NO_VALUE = "–";
const PERCENT = 100;
/** A trade legend sample's thickness per map pixel of the line it stands for (rem). */
const LINE_SAMPLE_REM = 0.0625;

/** What the generated routes are now, in brief: the trade lines follow their legs. */
function routeSignature(routes) {
    let signature = "";
    for (const route of routes ?? []) {
        if (!route?.generated || route.generated.oldRoad) continue;
        let cells = 0;
        for (const leg of route.legs ?? []) cells += leg.length;
        signature += `${route.id}:${route.waypoints?.length ?? 0}:${cells};`;
    }
    return signature;
}

/** The line layers' names in the menu. */
const LINE_LABELS = Object.freeze({ trade: "FILRODENSWMB.UI.ThematicTrade" });
/** Per studio: the source for its run and mesh (which keeps the layers' values and colours). */
const sources = new WeakMap();
/** Per studio: the legends folded by the user (by layer id), kept while the studio is open. */
const folded = new WeakMap();
/** Per studio: the trade lines and their index, with what they were made from (see #trade). */
const trades = new WeakMap();
const TRADE = THEMATIC.TRADE;

export class ThematicView {
    /**
     * A saved `thematic` setting made valid: a known colour layer or none, the known line layers
     * shown (each once), and an opacity within its range (the default when missing).
     * @param {*} saved
     * @returns {{fill: string|null, lines: string[], opacity: number}}
     */
    static valid(saved) {
        const fill = typeof saved?.fill === "string" && LAYERS.has(saved.fill) ? saved.fill : null;
        const lines = THEMATIC.LINES.filter((id) => Array.isArray(saved?.lines) && saved.lines.includes(id));
        const { MIN, MAX } = THEMATIC.OPACITY_RANGE;
        const opacity = Number.isFinite(saved?.opacity) ? Math.min(MAX, Math.max(MIN, saved.opacity)) : THEMATIC.OPACITY;
        return { fill, lines, opacity };
    }

    /** The map's setting, as it stands. */
    static setting(app) {
        return this.valid(app.uiState?.thematic);
    }

    /**
     * The source of the layers for the map's run and mesh, or null when there is no usable run.
     * While the History tool shows an earlier age, the run as that age left it (its cultures
     * alone; see HistoryView.thematicRun).
     */
    static source(app) {
        const modelRun = HistoryView.thematicRun(app) ?? app.modelRun ?? null;
        const mesh = app.meshSession?.mesh ?? null;
        const cached = sources.get(app);
        if (cached?.modelRun === modelRun && cached?.mesh === mesh) return cached.source;
        const source = ThematicSource.of(modelRun, mesh);
        sources.set(app, { modelRun, mesh, source });
        return source;
    }

    /** The colour layer drawn now: the chosen one, when the run holds what it needs. */
    static shownLayer(app) {
        const { fill } = this.setting(app);
        return fill && this.source(app)?.has(fill) ? LAYERS.get(fill) : null;
    }

    /** Whether the trade lines are drawn: chosen, and kept by the run (a run saved before trade was kept has none). */
    static tradeShown(app) {
        return this.setting(app).lines.includes("trade") && !!this.source(app)?.hasTrade();
    }

    /**
     * The trade lines and their index (see ThematicData.tradeLines), worked out again only when
     * the run or the generated routes they follow change (a route edited, deleted or undone).
     * @returns {{lines: object[], index: TradeIndex}|null}
     */
    static #trade(app) {
        const source = this.source(app);
        const trade = source?.trade();
        if (!trade) return null;
        const signature = routeSignature(app.mapRoutes);
        const cached = trades.get(app);
        if (cached?.source === source && cached.signature === signature) return cached;
        const lines = tradeLines(trade, app.meshSession.mesh, app.mapRoutes);
        const made = { source, signature, lines, index: new TradeIndex(lines, app.mapWidth) };
        trades.set(app, made);
        return made;
    }

    /**
     * Why the menu's layers cannot be shown, or null when they can: a map with no run (said
     * differently on a regional map, whose parent's run is not carried to it).
     * @returns {string|null} A localisation key.
     */
    static unavailableReason(app) {
        if (this.source(app)) return null;
        return app.uiState?.world?.zoom > 1 ? "FILRODENSWMB.UI.ThematicNoRunRegional" : "FILRODENSWMB.UI.ThematicNoRun";
    }

    /**
     * What the map controls show of the thematic layers (see MapControls.syncMapControls): each
     * colour layer's row, whether it can be chosen, and the note at the head of the menu.
     */
    static controlState(app) {
        const source = this.source(app);
        const { opacity } = this.setting(app);
        const reason = this.unavailableReason(app);
        const past = HistoryView.isPast(app);
        const reasons = past ? PAST_REASON : MISSING_REASON;
        const rows = THEMATIC.LAYERS.map((layer) => {
            const missing = source?.missing(layer.id);
            // An earlier age's cultures came later than its brief: an older run lacks them
            const why = past && layer.id === "culture" && missing === "run" ? "FILRODENSWMB.UI.ThematicNeedsRerunAge" : reasons[missing];
            // A row the run cannot show says why; one it can, what it shows
            return { id: layer.id, disabled: !source || !!missing, title: platform.i18n.localize(why ?? layer.hint) };
        });
        const lines = THEMATIC.LINES.map((id) => ({
            id,
            on: id === "trade" && this.tradeShown(app),
            disabled: !source?.hasTrade(),
            title: platform.i18n.localize(past ? "FILRODENSWMB.UI.ThematicPresentOnly" : source && !source.hasTrade() ? "FILRODENSWMB.UI.ThematicNeedsRerun" : "FILRODENSWMB.UI.ThematicTradeHint"),
        }));
        // The chosen layer stays the map's setting when the run cannot show it (a map opened before
        // generating), but the menu marks what is drawn: None
        return { fill: this.shownLayer(app)?.id ?? null, rows, lines, opacity, note: reason ? platform.i18n.localize(reason) : "" };
    }

    // ------------------------------------------------------------------ drawing

    /** Draws the shown layer on the canvas, or none, and brings the legend up to date. */
    static render(app) {
        const layer = this.shownLayer(app);
        const source = this.source(app);
        const display = layer ? { values: source.displayBytes(layer.id), lookup: source.lookup(layer.id), opacity: this.setting(app).opacity } : null;
        app.canvasEngine?.renderThematic(app.meshSession, display);
        app.canvasEngine?.renderTrade(this.tradeShown(app) ? (this.#trade(app)?.lines ?? null) : null);
        this.renderLegend(app);
    }

    // ------------------------------------------------------------------ the information bar

    /**
     * Writes the shown layer's value at a map point into the information bar, and moves the
     * legend's marker to it; off the map, on water or where the run has no value, a dash.
     * @param {object} app
     * @param {number|null} x - Map pixels, or null off the map.
     * @param {number|null} y
     */
    static readout(app, x, y) {
        this.#readTrade(app, x, y);
        const element = app.root?.querySelector("[data-thematic-readout]");
        if (!element) return;
        const layer = this.shownLayer(app);
        element.classList.toggle("fwmb-hidden", !layer);
        if (!layer) return;
        const cell = x === null || y === null || !CultureMarkers.isLand(app, x, y) ? -1 : app.meshSession.mesh.cellAt(x, y);
        const text = element.querySelector("[data-thematic-value]");
        if (ThematicSource.isClassLayer(layer.id)) {
            const culture = this.source(app).cultureAt(cell);
            text.textContent = culture ? platform.i18n.format("FILRODENSWMB.UI.ThematicCultureValue", { name: culture.name, share: Math.round(culture.share * PERCENT) }) : NO_VALUE;
            this.#markClass(app, layer, culture?.index ?? -1);
            return;
        }
        const value = this.source(app).valueAt(layer.id, cell);
        text.textContent = Number.isFinite(value) ? this.formatValue(app, layer, value) : NO_VALUE;
        this.#moveMarker(app, layer, value);
    }

    /**
     * The trade line under the pointer in the information bar: its class and transport ("Heavy
     * road trade"), from the nearest line within TRADE.HIT_PX screen pixels; a dash for none.
     */
    static #readTrade(app, x, y) {
        const element = app.root?.querySelector("[data-thematic-trade-readout]");
        if (!element) return;
        const shown = this.tradeShown(app);
        element.classList.toggle("fwmb-hidden", !shown);
        if (!shown) return;
        const trade = this.#trade(app);
        const zoom = app.canvasEngine?.stage?.scale?.x || 1;
        const index = x === null || y === null || !trade ? -1 : trade.index.nearest(x, y, TRADE.HIT_PX / zoom);
        const line = index >= 0 ? trade.lines[index] : null;
        const transport = line ? TRADE.TRANSPORTS[line.kind] ?? TRADE.TRANSPORTS[0] : null;
        element.querySelector("[data-thematic-trade-value]").textContent = line ? platform.i18n.format(transport.value, { class: platform.i18n.localize(TRADE.CLASSES[line.cls].label) }) : NO_VALUE;
        for (const item of app.root.querySelectorAll('[data-thematic-legend="trade"] [data-trade-class]')) item.classList.toggle("fwmb-is-current", !!line && Number(item.dataset.tradeClass) === line.cls);
    }

    /** A value as the information bar and the legend's ticks word it (see THEMATIC's READOUT). */
    static formatValue(app, layer, value) {
        if (layer.readout === "percent") return platform.i18n.format("FILRODENSWMB.UI.ThematicPercent", { value: Math.round(value * PERCENT) });
        const amount = formatDistance(value);
        if (layer.readout === "perArea") return platform.i18n.format("FILRODENSWMB.UI.ThematicPerArea", { value: amount, unit: cleanUnit(app.uiState?.mapUnit) });
        return amount;
    }

    /** A tick of a graded legend: a share as a percentage, anything else as the number. */
    static #tickText(layer, value) {
        return layer.readout === "percent" ? platform.i18n.format("FILRODENSWMB.UI.ThematicPercent", { value: Math.round(value * PERCENT) }) : formatDistance(value);
    }

    // ------------------------------------------------------------------ the legend

    /**
     * Writes the shown layer's legend under the information bar, or clears it. It is written
     * again only when what it shows changes (the layer, the unit, the run being out of date, the
     * reading direction, folding), so the pointer's marker, moved on every hover, is not lost.
     */
    static renderLegend(app) {
        const container = app.root?.querySelector(".fwmb-legends");
        const readout = app.root?.querySelector("[data-thematic-readout]");
        if (!container) return;
        const layer = this.shownLayer(app);
        const trade = this.tradeShown(app);
        if (readout) {
            readout.classList.toggle("fwmb-hidden", !layer);
            if (layer) readout.querySelector("[data-thematic-key]").textContent = platform.i18n.localize(layer.label);
        }
        app.root.querySelector("[data-thematic-trade-readout]")?.classList.toggle("fwmb-hidden", !trade);
        const rtl = app.root.ownerDocument?.documentElement?.dir === "rtl" || app.root.closest?.('[dir="rtl"]') !== null;
        const isFolded = (id) => folded.get(app)?.has(id) ?? false;
        // The run's id stands for its cultures, which the culture legend lists (an earlier age's
        // run has its own id; see HistoryView.thematicRun)
        const signature = layer || trade ? JSON.stringify([layer?.id ?? null, trade, (HistoryView.thematicRun(app) ?? app.modelRun)?.run ?? null, cleanUnit(app.uiState?.mapUnit), app.uiState?.generatorStale === true, rtl, layer ? isFolded(layer.id) : false, isFolded("trade")]) : "";
        if (container.dataset.signature === signature) return;
        container.dataset.signature = signature;
        const legends = [];
        if (layer) legends.push(this.#legend(app, layer, { rtl, isFolded: isFolded(layer.id) }));
        if (trade) legends.push(this.#legend(app, { id: "trade", label: "FILRODENSWMB.UI.ThematicTrade" }, { rtl, isFolded: isFolded("trade") }));
        container.replaceChildren(...legends);
    }

    /**
     * Folds or unfolds a legend (its title's button).
     * @param {object} app
     * @param {string} id - The legend's layer.
     */
    static toggleLegend(app, id) {
        if (!id) return;
        if (!folded.has(app)) folded.set(app, new Set());
        const set = folded.get(app);
        if (set.has(id)) set.delete(id);
        else set.add(id);
        this.renderLegend(app);
    }

    static #legend(app, layer, { rtl, isFolded }) {
        const doc = app.root.ownerDocument;
        const make = (tag, className, text) => {
            const element = doc.createElement(tag);
            if (className) element.className = className;
            if (text !== undefined) element.textContent = text;
            return element;
        };
        const section = make("section", `fwmb-legend${isFolded ? " fwmb-is-folded" : ""}`);
        section.dataset.thematicLegend = layer.id;

        const title = make("div", "fwmb-title");
        const name = make("span", "", platform.i18n.localize(layer.label));
        const toggle = make("button", "fwmb-toggle");
        toggle.type = "button";
        toggle.dataset.action = "toggleThematicLegend";
        toggle.dataset.thematicLegendId = layer.id;
        toggle.setAttribute("aria-expanded", String(!isFolded));
        const toggleLabel = platform.i18n.localize(isFolded ? "FILRODENSWMB.UI.ThematicLegendShow" : "FILRODENSWMB.UI.ThematicLegendHide");
        toggle.setAttribute("aria-label", toggleLabel);
        toggle.dataset.tooltip = toggleLabel;
        // One arrow, turned by the stylesheet while the legend is folded
        const arrow = make("span", "fwmb-icon fwmb-icon--arrow-drop-down");
        arrow.setAttribute("aria-hidden", "true");
        toggle.append(arrow);
        title.append(name, toggle);
        section.append(title, this.#legendBody(app, layer, make, rtl));

        if (app.uiState?.generatorStale === true) section.append(make("p", "fwmb-legend-note", platform.i18n.localize("FILRODENSWMB.UI.ThematicStale")));
        return section;
    }

    /**
     * A graded legend: the ramp as a bar, its ticks at their places on the layer's scale, the
     * unit, and the marker the pointer moves (hidden until there is a value). The gradient runs
     * with the reading direction, as the ticks' inline-start offsets do.
     */
    static #ramp(app, layer, make, rtl) {
        const ramp = make("div", "fwmb-ramp");
        const bar = make("div", "fwmb-ramp-bar");
        bar.style.background = `linear-gradient(to ${rtl ? "left" : "right"}, ${layer.ramp.join(", ")})`;
        const marker = make("span", "fwmb-ramp-marker fwmb-hidden");
        marker.dataset.thematicMarker = "";
        bar.append(marker);
        const ticks = make("div", "fwmb-ramp-ticks");
        for (const tick of layer.ticks) {
            const label = make("span", "", this.#tickText(layer, tick));
            label.style.insetInlineStart = `${scalePosition(layer.scale, tick) * PERCENT}%`;
            ticks.append(label);
        }
        const unit = make("div", "fwmb-ramp-unit", platform.i18n.format(layer.unit, { unit: cleanUnit(app.uiState?.mapUnit) }));
        ramp.append(bar, ticks, unit);
        return ramp;
    }

    /** A legend's body by its form: the trade key, a class list (culture) or a graded scale. */
    static #legendBody(app, layer, make, rtl) {
        if (layer.id === "trade") return this.#tradeKey(make);
        return ThematicSource.isClassLayer(layer.id) ? this.#classes(app, layer, make) : this.#ramp(app, layer, make, rtl);
    }

    /**
     * The trade legend: the line widths by class (in a neutral colour) and the colours by transport.
     * The class under the pointer is marked (see #readTrade).
     */
    static #tradeKey(make) {
        const wrapper = make("div", "fwmb-legend-classes");
        const widths = make("div", "fwmb-classes");
        TRADE.CLASSES.forEach((entry, index) => {
            const item = make("span");
            item.dataset.tradeClass = String(index);
            const sample = make("i", "fwmb-line-sample");
            sample.style.setProperty("--fwmb-line-rem", `${LINE_SAMPLE_REM * (1 + entry.widthPx)}rem`);
            item.append(sample, make("span", "", platform.i18n.localize(entry.label)));
            widths.append(item);
        });
        const colours = make("div", "fwmb-classes");
        for (const transport of TRADE.TRANSPORTS) {
            const item = make("span");
            const swatch = make("i");
            swatch.style.setProperty("--swatch", transport.color);
            item.append(swatch, make("span", "", platform.i18n.localize(transport.label)));
            colours.append(item);
        }
        wrapper.append(widths, colours, make("div", "fwmb-ramp-unit", platform.i18n.localize("FILRODENSWMB.UI.ThematicTradeUnit")));
        return wrapper;
    }

    /**
     * A class legend: each culture dominant somewhere on the map, as a swatch of its colour and
     * its name as the run recorded it, then the caption (paler where peoples mix). The culture
     * under the pointer is marked (see #markClass).
     */
    static #classes(app, layer, make) {
        const wrapper = make("div", "fwmb-legend-classes");
        const list = make("div", "fwmb-classes");
        for (const culture of this.source(app).cultureClasses()) {
            const item = make("span");
            item.dataset.thematicClass = String(culture.index);
            const swatch = make("i");
            swatch.style.setProperty("--swatch", culture.color);
            item.append(swatch, doc(app).createTextNode(culture.name));
            item.title = culture.name;
            list.append(item);
        }
        wrapper.append(list, make("div", "fwmb-ramp-unit", platform.i18n.localize(layer.unit)));
        return wrapper;
    }

    /** Marks the culture under the pointer in the class legend (-1 for none). */
    static #markClass(app, layer, index) {
        for (const item of app.root?.querySelectorAll(`[data-thematic-legend="${layer.id}"] [data-thematic-class]`) ?? []) item.classList.toggle("fwmb-is-current", Number(item.dataset.thematicClass) === index);
    }

    /** Puts the legend's marker at a value's place on the scale, or hides it for no value. */
    static #moveMarker(app, layer, value) {
        const marker = app.root?.querySelector(`[data-thematic-legend="${layer.id}"] [data-thematic-marker]`);
        if (!marker) return;
        const position = scalePosition(layer.scale, value);
        marker.classList.toggle("fwmb-hidden", Number.isNaN(position));
        if (!Number.isNaN(position)) marker.style.insetInlineStart = `${position * PERCENT}%`;
    }

    // ------------------------------------------------------------------ the menu

    /** The menu's colour layers, for the map region's template. */
    static menuContext() {
        const { MIN, MAX, STEP } = THEMATIC.OPACITY_RANGE;
        return {
            layers: THEMATIC.LAYERS.map((layer) => ({ id: layer.id, label: layer.label })),
            lines: THEMATIC.LINES.map((id) => ({ id, label: LINE_LABELS[id] })),
            none: NONE,
            opacity: { min: MIN, max: MAX, step: STEP, value: THEMATIC.OPACITY },
        };
    }

    /**
     * The setting with a colour layer chosen ("none" for none); a layer the run cannot show is
     * refused, so a disabled row does nothing.
     * @returns {{fill: string|null, opacity: number}|null} The new setting, or null for no change.
     */
    static withFill(app, id) {
        const setting = this.setting(app);
        const fill = id === NONE ? null : id;
        if (fill && !this.source(app)?.has(fill)) return null;
        if (fill === setting.fill) return null;
        return { ...setting, fill };
    }

    /**
     * The setting with a line layer shown or hidden; a layer the run cannot show is refused.
     * @returns {{fill: string|null, lines: string[], opacity: number}|null} The new setting, or null for no change.
     */
    static withLine(app, id) {
        const setting = this.setting(app);
        if (!THEMATIC.LINES.includes(id)) return null;
        const on = setting.lines.includes(id);
        if (!on && !this.source(app)?.hasTrade()) return null;
        return { ...setting, lines: on ? setting.lines.filter((line) => line !== id) : [...setting.lines, id] };
    }

    /** The setting with a new opacity (the menu's slider), or null for no change. */
    static withOpacity(app, value) {
        const setting = this.setting(app);
        const next = this.valid({ ...setting, opacity: Number(value) });
        return next.opacity === setting.opacity ? null : next;
    }
}
