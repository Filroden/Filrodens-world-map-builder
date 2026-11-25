/**
 * Who lives where, over a settlement map's canvas (L-surface step 3; boards L6 and L6b): the
 * households card, the outline of the house it is of, the line naming it, the household views'
 * legend, and the state of the map controls' Thematic views menu.
 *
 * - **The card** opens beside the house a mouse or pen points at, on whichever side has room and
 *   never across the canvas's edges, else over the house (Ken, board L6); it follows the pointer
 *   from house to house. **A click keeps it** where it is until Escape, a click elsewhere or a click
 *   on another house (which opens that one); a pan or zoom closes a card that is not kept, and
 *   moves a kept one with its house. **On touch** a tap opens it as a sheet from the canvas's foot,
 *   with Close (board L6b). The card opens only while the tool is Households and supply (Ken,
 *   2026-11-24: Map setup's clicks stay quiet); the views work with any tool.
 * - **Its words** are Households.js's; built here as elements with their text set, so no name a
 *   culture's lists made up is read as markup.
 *
 * Made once a settlement map's households have come back (LocalTasks.keep), one for the version
 * shown, and destroyed with its canvas.
 */
import { FILRODENSWMB } from "../../../config.js";
import { platform } from "../../../platform/index.js";
import { HouseIndex } from "./HouseIndex.js";
import { cardOf, legendOf, readoutOf } from "./Households.js";

export class HouseholdsView {
    #surface;
    #canvas;
    #households;
    #homes;
    #place;
    #colours;
    #t;
    #index = null;
    /** The card: its home, whether it is kept, whether it is the touch sheet, and its element. */
    #card = null;
    #cardElement = null;
    #readout = null;
    #legend = null;
    /** The legends folded by the reader, by view (for the session). */
    #folded = new Set();
    #enabled = false;
    #onDocument = null;
    #onKey = null;

    /**
     * @param {HTMLElement} surface - The canvas's element (the card, line and legend are laid over it).
     * @param {object} options
     * @param {() => object|null} options.canvas - The canvas (SettlementCanvas) now.
     * @param {{households: object, homes: {points: Float32Array, offsets: Uint32Array}}} options.kept
     * @param {{name: string, kind: string, walled: boolean, cave: boolean}} options.place
     * @param {Object<string, string>} [options.colours] - Each culture's colour, by name.
     */
    constructor(surface, { canvas, kept, place, colours = {} }) {
        this.#surface = surface;
        this.#canvas = canvas;
        this.#households = kept.households;
        this.#homes = kept.homes;
        this.#place = place;
        this.#colours = colours;
        const { i18n } = platform;
        this.#t = { lang: i18n.lang, localize: (key) => i18n.localize(key), format: (key, data) => i18n.format(key, data) };
    }

    /** The homes' index, made when first pointed at (the houses, then the farmhouses). */
    get index() {
        this.#index ??= new HouseIndex(this.#homes);
        return this.#index;
    }

    /** A home by its number in the index. */
    home(k) {
        const { houses, farms } = this.#households;
        return k < houses.length ? houses[k] : farms[k - houses.length] ?? null;
    }

    /** Whether the card opens (the tool is Households and supply); closed when it stops. */
    set enabled(on) {
        this.#enabled = !!on;
        if (!on) this.close();
    }

    get enabled() {
        return this.#enabled;
    }

    // ------------------------------------------------------------------ pointing

    /** A mouse or pen over the canvas (null as it leaves). */
    point(point) {
        if (!this.#enabled || this.#card?.kept) return;
        const k = point ? this.index.at(point.x, point.y) : -1;
        if (k < 0) {
            if (this.#card) this.close();
            return;
        }
        if (this.#card?.home === k) return;
        this.#open(k, { kept: false, sheet: false });
    }

    /** A tap or click on the canvas: keeps the card of the house there, or closes the card. */
    tap(point) {
        if (!this.#enabled) return;
        const k = this.index.at(point.x, point.y);
        if (k < 0) {
            this.close();
            return;
        }
        this.#open(k, { kept: true, sheet: !!point.touch });
    }

    /** The canvas's view moved: a card not kept closes; a kept one goes with its house. */
    moved(moved) {
        if (!this.#card) return;
        if (moved && !this.#card.kept) this.close();
        else if (!this.#card.sheet) this.#place_();
    }

    /** Closes the card, its outline and its line. */
    close() {
        if (!this.#card) return;
        this.#card = null;
        this.#cardElement?.remove();
        this.#cardElement = null;
        this.#readout?.remove();
        this.#readout = null;
        this.#listen(false);
        this.#canvas()?.redrawOverlay();
    }

    /** The open card's home, or -1 (for tests and the checks). */
    get shown() {
        return this.#card?.home ?? -1;
    }

    get kept() {
        return !!this.#card?.kept;
    }

    /** Draws the outline of the house the card is of (the canvas's overlay). */
    drawOutline(ctx, toCanvas) {
        if (!this.#card) return;
        const points = this.index.footprint(this.#card.home);
        if (points.length < 3) return;
        const style = this.#surface.ownerDocument.defaultView.getComputedStyle(this.#surface);
        const accent = style.getPropertyValue("--fwmb-accent-secondary").trim() || "#b0378f";
        const ratio = globalThis.devicePixelRatio || 1;
        ctx.beginPath();
        points.forEach(([x, y], k) => {
            const [px, py] = toCanvas(x, y);
            if (k === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineJoin = "round";
        ctx.lineWidth = 2 * ratio;
        ctx.strokeStyle = accent;
        ctx.stroke();
    }

    #open(k, { kept, sheet }) {
        const h = this.home(k);
        if (!h) return;
        this.#card = { home: k, kept, sheet };
        this.#cardElement?.remove();
        this.#cardElement = this.#cardOf(h, { kept, sheet });
        this.#surface.append(this.#cardElement);
        this.#readoutOf(h);
        if (!sheet) this.#place_();
        this.#listen(kept);
        this.#canvas()?.redrawOverlay();
    }

    /** The line over the canvas naming the house (board L6: top left). */
    #readoutOf(h) {
        if (!this.#readout) {
            this.#readout = this.#surface.ownerDocument.createElement("div");
            this.#readout.className = "fwmb-household-readout";
            this.#readout.setAttribute("aria-live", "polite");
            this.#surface.append(this.#readout);
        }
        this.#readout.textContent = readoutOf(this.#t, h, this.#place);
    }

    /** Places the card beside its house: on the side with room, else over it; never across the edges. */
    #place_() {
        const card = this.#cardElement;
        const canvas = this.#canvas();
        if (!card || !canvas || this.#card?.sheet) return;
        const { CARD_GAP_PX: gap } = FILRODENSWMB.LOCAL.HOUSEHOLDS;
        const [x0, y0, x1, y1] = this.index.bounds(this.#card.home);
        const [left, top] = canvas.toCss(x0, y0);
        const [right, bottom] = canvas.toCss(x1, y1);
        const W = this.#surface.clientWidth;
        const H = this.#surface.clientHeight;
        const w = card.offsetWidth;
        const h = card.offsetHeight;
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        const cy = clamp((top + bottom) / 2 - h / 2, gap, H - h - gap);
        const cx = clamp((left + right) / 2 - w / 2, gap, W - w - gap);
        let x, y;
        if (right + gap + w <= W - gap) [x, y] = [right + gap, cy];
        else if (left - gap - w >= gap) [x, y] = [left - gap - w, cy];
        else if (bottom + gap + h <= H - gap) [x, y] = [cx, bottom + gap];
        else if (top - gap - h >= gap) [x, y] = [cx, top - gap - h];
        else [x, y] = [cx, cy];
        card.style.left = `${Math.round(clamp(x, gap, Math.max(gap, W - w - gap)))}px`;
        card.style.top = `${Math.round(clamp(y, gap, Math.max(gap, H - h - gap)))}px`;
    }

    /** While a card is kept: Escape, or a press outside the card and the canvas, closes it. */
    #listen(on) {
        const doc = this.#surface.ownerDocument;
        if (this.#onDocument) {
            doc.removeEventListener("pointerdown", this.#onDocument, true);
            doc.removeEventListener("keydown", this.#onKey, true);
            this.#onDocument = this.#onKey = null;
        }
        if (!on) return;
        this.#onDocument = (event) => {
            if (this.#cardElement?.contains(event.target) || this.#surface.contains(event.target)) return;
            this.close();
        };
        this.#onKey = (event) => {
            if (event.key !== "Escape" || !this.#card) return;
            event.stopPropagation();
            event.preventDefault();
            this.close();
            this.#canvas()?.element.focus();
        };
        doc.addEventListener("pointerdown", this.#onDocument, true);
        doc.addEventListener("keydown", this.#onKey, true);
    }

    /** The card's element (boards L6, L6b). */
    #cardOf(h, { kept, sheet }) {
        const doc = this.#surface.ownerDocument;
        const t = this.#t;
        const card = cardOf(t, h, this.#place);
        const make = (tag, className, text) => {
            const element = doc.createElement(tag);
            if (className) element.className = className;
            if (text != null) element.textContent = text;
            return element;
        };
        const root = make("div", `fwmb-household-card${kept ? " fwmb-is-kept" : ""}${sheet ? " fwmb-household-card--sheet" : ""}`);
        root.setAttribute("role", "dialog");
        root.setAttribute("aria-label", t.format("FILRODENSWMB.UI.HouseholdCardLabel", { house: card.title }));
        // A card that follows the pointer is read in the line over the canvas, not as a dialogue
        if (!kept) root.setAttribute("aria-hidden", "true");
        const head = make("div", "fwmb-household-head");
        const icon = make("span", "fwmb-icon fwmb-icon--location-city");
        icon.setAttribute("aria-hidden", "true");
        head.append(icon, make("b", "fwmb-household-title", card.title), make("span", "fwmb-household-wealth", card.wealth));
        if (sheet) {
            const close = make("button", "fwmb-btn fwmb-btn--square");
            close.type = "button";
            close.setAttribute("aria-label", t.localize("FILRODENSWMB.UI.Close"));
            const x = make("span", "fwmb-icon fwmb-icon--cancel");
            x.setAttribute("aria-hidden", "true");
            close.append(x);
            close.addEventListener("click", () => this.close());
            head.append(close);
        }
        const body = make("div", "fwmb-household-body");
        const lead = (key, text) => {
            const p = make("p");
            p.append(make("b", null, t.localize(key)), doc.createTextNode(` ${text}`));
            return p;
        };
        body.append(lead("FILRODENSWMB.UI.HouseholdLead", card.line));
        const group = (key, lines) => {
            if (!lines.length) return;
            body.append(make("span", "fwmb-household-group", t.localize(key)));
            const list = make("ul");
            for (const line of lines) {
                const item = make("li");
                item.append(doc.createTextNode(line.before), make("b", null, line.name), doc.createTextNode(line.after));
                if (line.culture) item.append(make("span", "fwmb-household-own", ` ${t.format("FILRODENSWMB.UI.HouseholdOwnCulture", { culture: line.culture })}`));
                list.append(item);
            }
            body.append(list);
        };
        group("FILRODENSWMB.UI.HouseholdFamily", card.family);
        group("FILRODENSWMB.UI.HouseholdWorking", card.working);
        group("FILRODENSWMB.UI.HouseholdLodging", card.lodging);
        if (card.trade) body.append(lead("FILRODENSWMB.UI.HouseholdTradeLead", card.trade));
        root.append(head, body);
        if (!sheet) root.append(make("div", "fwmb-household-foot", t.localize(kept ? "FILRODENSWMB.UI.HouseholdFootKept" : "FILRODENSWMB.UI.HouseholdFootHover")));
        return root;
    }

    // ------------------------------------------------------------------ the views' legend

    /** Shows a household view's legend over the canvas (none: no legend). */
    showLegend(view) {
        this.#legend?.remove();
        this.#legend = null;
        const legend = view ? legendOf(this.#t, view, this.#households, this.#colours) : null;
        if (!legend) return;
        const doc = this.#surface.ownerDocument;
        const root = doc.createElement("div");
        root.className = "fwmb-settlement-legend";
        root.toggleAttribute("data-folded", this.#folded.has(view));
        const head = doc.createElement("div");
        head.className = "fwmb-settlement-legend-head";
        const title = doc.createElement("b");
        title.textContent = legend.title;
        const fold = doc.createElement("button");
        fold.type = "button";
        fold.className = "fwmb-btn fwmb-btn--square fwmb-btn--subtle fwmb-settlement-legend-fold";
        const icon = doc.createElement("span");
        icon.className = "fwmb-icon fwmb-icon--arrow-drop-down";
        icon.setAttribute("aria-hidden", "true");
        fold.append(icon);
        const sync = () => {
            const folded = this.#folded.has(view);
            root.toggleAttribute("data-folded", folded);
            fold.setAttribute("aria-expanded", String(!folded));
            fold.setAttribute("aria-label", platform.i18n.localize(folded ? "FILRODENSWMB.UI.SettlementLegendUnfold" : "FILRODENSWMB.UI.SettlementLegendFold"));
        };
        fold.addEventListener("click", () => {
            if (this.#folded.has(view)) this.#folded.delete(view);
            else this.#folded.add(view);
            sync();
        });
        head.append(title, fold);
        const list = doc.createElement("ul");
        list.className = "fwmb-settlement-legend-keys";
        for (const item of legend.items) {
            const li = doc.createElement("li");
            const swatch = doc.createElement("i");
            swatch.style.setProperty("--swatch", item.colour);
            li.append(swatch, doc.createTextNode(item.label));
            list.append(li);
        }
        root.append(head, list);
        sync();
        this.#surface.append(root);
        this.#legend = root;
    }

    destroy() {
        this.close();
        this.#legend?.remove();
        this.#legend = null;
    }
}
