import { SHELL_PARTS } from "./config.js";
import { buildMapCard, placeMapCard } from "./MapCard.js";

/**
 * Reading a map at a point (EX1, Inspect): the shell's part, for any map type a studio registers
 * an `inspect` for (see StudioRegistry's InspectKind). The studio's tool hands it the pointer's
 * moves, presses and releases in map pixels and tells it when the camera moves; it gathers every
 * kind's things at a point into one list, in the registration's order with the ground last, and:
 *
 * - **Rest:** once the pointer has stayed within INSPECT_STILL_PX screen pixels for
 *   INSPECT_REST_MS, the map card shows beside it. While it shows, a move that leaves the list the
 *   same (compared by the items' keys) leaves it be; a move that changes the list rebuilds it in
 *   place beside the pointer. It hides when the pointer leaves the map, on a press, on a pan or a
 *   zoom, and while the studio says a fold's outline is showing (suspend).
 * - **Hold:** a primary press and release that moves less than the drag threshold holds the point:
 *   the card goes and the studio is told (onHold) with the list, to drop its marker and list it in
 *   its panel. A press that moves further does nothing. A click off the map lets go. On touch (a
 *   press from a finger) the list also opens as a sheet at the canvas's foot, with Close.
 * - **Let go:** Ctrl+click on the map (as Ctrl+click removes in the map's other tools), Close,
 *   the studio's own Clear and a tool change (destroy); the studio is told (onLetGo). Not Escape,
 *   which Foundry keeps for closing its windows (Ken, EX1 testing).
 *
 * Nothing here knows a studio: the kinds' functions are called with the `app` handed in.
 */
export class MapReader {
    #app;
    #inspect;
    #surface;
    #t;
    #toScreen;
    #onHold;
    #onLetGo;
    #dragPx;

    #rest = null;
    #restTimer = null;
    #card = null;
    #cardKeys = "";
    #frame = null;
    #pending = null;
    #press = null;
    #held = null;
    #sheet = null;
    #suspended = false;

    /**
     * @param {object} options
     * @param {object} options.app - Handed to every kind's functions.
     * @param {{kinds: object[], ground: object}} options.inspect - The map type's registration.
     * @param {HTMLElement} options.surface - The element the card is laid over (the canvas's container).
     * @param {{localize: function(string): string, format: function(string, object): string}} options.t - The host's strings.
     * @param {function(number, number): {x: number, y: number}} options.toScreen - A map point's place on the surface, in CSS pixels.
     * @param {function(object): void} [options.onHold] - Told the held point ({x, y, list, touch}).
     * @param {function(): void} [options.onLetGo] - Told the point is let go.
     * @param {number} [options.dragPx] - How far a press may move and still be a click.
     */
    constructor({ app, inspect, surface, t, toScreen, onHold = () => {}, onLetGo = () => {}, dragPx = SHELL_PARTS.INSPECT_STILL_PX }) {
        this.#app = app;
        this.#inspect = inspect;
        this.#surface = surface;
        this.#t = t;
        this.#toScreen = toScreen;
        this.#onHold = onHold;
        this.#onLetGo = onLetGo;
        this.#dragPx = dragPx;
    }

    // ------------------------------------------------------------------ reading

    /**
     * Everything at a map point, in the list's order: each kind's things, nearest first, then the
     * ground. Each entry is `{ kind, icon, item, row, key }`.
     * @param {number} x
     * @param {number} y
     * @returns {object[]}
     */
    gather(x, y) {
        const list = [];
        for (const kind of this.#inspect.kinds) {
            for (const item of kind.at(this.#app, x, y) ?? []) list.push({ kind, icon: kind.icon, item, row: kind.row(this.#app, item), key: item.key });
        }
        const ground = this.#inspect.ground;
        const here = ground.at(this.#app, x, y);
        if (here) list.push({ kind: ground, icon: ground.icon, item: here, row: { ...ground.row(this.#app, here), ground: true }, key: here.key ?? "ground" });
        return list;
    }

    /** The held point ({x, y, list, touch}), or null. */
    get held() {
        return this.#held;
    }

    /** Whether the card shows (for the checks). */
    get cardShown() {
        return !!this.#card;
    }

    // ------------------------------------------------------------------ the pointer

    /** The pointer moved over the map without a press. */
    hover(x, y, event) {
        if (this.#press) return;
        const screen = { x: event?.clientX ?? 0, y: event?.clientY ?? 0 };
        if (this.#card) {
            this.#queueUpdate(x, y);
            return;
        }
        if (this.#rest && Math.hypot(screen.x - this.#rest.screen.x, screen.y - this.#rest.screen.y) <= SHELL_PARTS.INSPECT_STILL_PX) return;
        this.#startRest(x, y, screen);
    }

    /** A primary press on the map. */
    down(x, y, event) {
        this.#hideCard();
        this.#cancelRest();
        this.#press = { x, y, screen: { x: event?.clientX ?? 0, y: event?.clientY ?? 0 }, touch: event?.pointerType === "touch", clear: !!(event?.ctrlKey || event?.metaKey) };
    }

    /** The pointer moved with the press held: nothing (a drag does nothing in Inspect). */
    move() {}

    /** The press lifted: a click (within the drag threshold) holds the point. */
    up(x, y, event) {
        const press = this.#press;
        this.#press = null;
        if (!press) return;
        const screen = { x: event?.clientX ?? press.screen.x, y: event?.clientY ?? press.screen.y };
        if (Math.hypot(screen.x - press.screen.x, screen.y - press.screen.y) > this.#dragPx) return;
        if (press.clear) this.letGo();
        else this.hold(press.x, press.y, { touch: press.touch });
    }

    /** The pointer left the map. */
    leave() {
        this.#cancelRest();
        this.#hideCard();
    }

    /** The camera moved (a pan, the wheel, a pinch or a framing): the card hides until the next rest. */
    cameraMoved() {
        this.#cancelRest();
        this.#hideCard();
    }

    /** Hides the card while the studio shows a fold's outline (on), and lets it show again (off). */
    suspend(on) {
        this.#suspended = !!on;
        if (on) {
            this.#cancelRest();
            this.#hideCard();
        }
    }

    // ------------------------------------------------------------------ holding

    /**
     * Holds a map point: the card goes, the studio is told the list (onHold). A point off the map
     * (with no ground) lets go instead.
     */
    hold(x, y, { touch = false } = {}) {
        this.#hideCard();
        this.#cancelRest();
        const list = this.gather(x, y);
        if (!list.length) {
            this.letGo();
            return;
        }
        this.#held = { x, y, list, touch };
        this.#showSheet(touch ? list : null);
        this.#onHold(this.#held);
    }

    /** Lets go of the held point, if any, and closes the sheet. */
    letGo() {
        this.#showSheet(null);
        if (!this.#held) return;
        this.#held = null;
        this.#onLetGo();
    }

    /** Ends reading: the card and the sheet go, the hold is let go. */
    destroy() {
        this.#cancelRest();
        this.#hideCard();
        if (this.#frame !== null) this.#surface.ownerDocument.defaultView?.cancelAnimationFrame(this.#frame);
        this.#frame = null;
        this.letGo();
    }

    // ------------------------------------------------------------------ the card

    #startRest(x, y, screen) {
        this.#cancelRest();
        this.#rest = { x, y, screen };
        const view = this.#surface.ownerDocument.defaultView;
        this.#restTimer = view.setTimeout(() => {
            this.#restTimer = null;
            if (this.#suspended || this.#press || !this.#rest) return;
            this.#showCard(this.#rest.x, this.#rest.y);
        }, SHELL_PARTS.INSPECT_REST_MS);
    }

    #cancelRest() {
        if (this.#restTimer !== null) this.#surface.ownerDocument.defaultView?.clearTimeout(this.#restTimer);
        this.#restTimer = null;
        this.#rest = null;
    }

    /** Reads the point under a moving pointer at most once a frame while the card shows. */
    #queueUpdate(x, y) {
        this.#pending = { x, y };
        if (this.#frame !== null) return;
        const view = this.#surface.ownerDocument.defaultView;
        this.#frame = view.requestAnimationFrame(() => {
            this.#frame = null;
            const point = this.#pending;
            this.#pending = null;
            if (!point || !this.#card) return;
            const list = this.gather(point.x, point.y);
            if (keysOf(list) === this.#cardKeys) return;
            if (!list.length) this.#hideCard();
            else this.#showCard(point.x, point.y, list);
        });
    }

    #showCard(x, y, list = this.gather(x, y)) {
        if (!list.length) {
            this.#hideCard();
            return;
        }
        const card = buildMapCard(this.#surface.ownerDocument, list, { t: this.#t });
        if (this.#card) this.#card.replaceWith(card);
        else this.#surface.append(card);
        this.#card = card;
        this.#cardKeys = keysOf(list);
        placeMapCard(card, this.#surface, this.#toScreen(x, y), SHELL_PARTS.INSPECT_CARD_GAP_PX);
    }

    #hideCard() {
        this.#card?.remove();
        this.#card = null;
        this.#cardKeys = "";
    }

    /** The touch sheet at the canvas's foot, with the held list (none closes it). */
    #showSheet(list) {
        this.#sheet?.remove();
        this.#sheet = null;
        if (!list) return;
        this.#sheet = buildMapCard(this.#surface.ownerDocument, list, { t: this.#t, sheet: true, onClose: () => this.letGo() });
        this.#surface.append(this.#sheet);
    }
}

/** A list's identity: its items' keys in order. */
function keysOf(list) {
    return list.map((entry) => entry.key).join("|");
}
