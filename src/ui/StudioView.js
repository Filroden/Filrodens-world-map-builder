/**
 * Draws the studio's regions (the toolbar, the context panel, the map and the edit toolbar) from
 * their Handlebars templates, and routes clicks on [data-action] elements to the studio's action
 * handlers. It takes over the two jobs a Foundry ApplicationV2 window did for each of its parts,
 * so the same studio can run inside a Foundry window or straight in a web page.
 *
 * Each region's template renders one root element, which becomes the region's element: the
 * region's classes are added to it, as ApplicationV2 added a part's classes to its root. A region
 * is drawn into a placeholder the first time and updated in place after that: the newly rendered
 * HTML is compared with what is on the page and only the differences are applied (idiomorph). The
 * elements themselves persist, so focus, the caret, a value half-typed into a field and scroll
 * positions all survive a redraw, where replacing the region's HTML would lose them. Two
 * consequences for the code around it:
 *
 * - Listeners belong on the root (delegated), not on elements inside a region. A redraw keeps an
 *   element only while it still matches; a listener bound directly to one can be lost when the
 *   template's structure changes, or duplicated if it is bound again after each redraw.
 * - Anything a template does not write (a class or attribute set from code) is removed when its
 *   region is redrawn, exactly as a fresh render would. Elements marked data-morph-ignore (the
 *   map canvas) are never touched.
 *
 * Redraws are queued and merged: however many times render() is called in one task, the
 * templates run once per region and the page is updated once, in a microtask, with every region
 * asked for. Callers need not order or batch their calls.
 *
 * The view also keeps every slider inside the root (the studio's and any dialogue's drawn inside
 * it) in step with its value display and filled track, and returns a slider carrying data-default
 * to that value on double-click (see RangeDisplay).
 *
 * Nothing here touches the host's globals: the template renderer and the context builder are
 * passed in.
 */
import { Idiomorph } from "../../vendor/idiomorph/idiomorph.esm.js";
import { RangeDisplay } from "../tools/RangeDisplay.js";

/** Elements carrying this attribute are never changed or removed by a redraw. */
const MORPH_IGNORE_ATTRIBUTE = "data-morph-ignore";

/** Marks a region's element (and its placeholder before the first draw) with the region's id. */
const REGION_ATTRIBUTE = "data-region";

/**
 * @typedef {object} RegionSpec
 * @property {string} template - The template that draws the region (one root element).
 * @property {string[]} [classes] - Classes added to the region's root element.
 * @property {boolean} [once] - Drawn on the first render only (the map: its canvas is never rebuilt).
 * @property {string} [slot] - Where to create the region's placeholder when it has none yet: a
 *     selector within the root, whose element gets the placeholder as its first child. Without a
 *     slot the placeholder must already be in the root (`[data-region="<id>"]`).
 */

export class StudioView {
    /** @type {HTMLElement} */
    #root;

    /** @type {Record<string, RegionSpec>} */
    #regions;

    /** @type {(path: string, context: object) => Promise<string>} */
    #renderTemplate;

    /** @type {(regionId: string) => Promise<object> | object} */
    #buildContext;

    /** @type {Record<string, (event: Event, target: HTMLElement) => unknown>} */
    #actions;

    /** The object the action handlers run as. */
    #controller;

    /** @type {(regions: string[]) => void} */
    #afterRender;

    /** Regions asked for since the last flush, or null when none is queued. */
    #pending = null;

    /** Resolves when the queued flush has run; every render() call that joined it gets this. */
    #flushed = null;

    /** Regions drawn at least once. */
    #drawn = new Set();

    #destroyed = false;

    /**
     * @param {object} options
     * @param {HTMLElement} options.root - The element the regions live in; also where clicks are listened for.
     * @param {Record<string, RegionSpec>} options.regions - By region id, in drawing order.
     * @param {(path: string, context: object) => Promise<string>} options.renderTemplate
     * @param {(regionId: string) => Promise<object> | object} options.buildContext
     * @param {Record<string, Function>} options.actions - data-action name → handler `(event, target)`.
     * @param {object} options.controller - `this` for the handlers.
     * @param {(regions: string[]) => void} [options.afterRender] - Runs after each redraw with the
     *     regions that were drawn, for updates made straight to the page.
     */
    constructor({ root, regions, renderTemplate, buildContext, actions, controller, afterRender = () => {} }) {
        this.#root = root;
        this.#regions = regions;
        this.#renderTemplate = renderTemplate;
        this.#buildContext = buildContext;
        this.#actions = actions;
        this.#controller = controller;
        this.#afterRender = afterRender;

        root.addEventListener("click", this.#onClick);
        root.addEventListener("input", this.#onSliderInput);
        root.addEventListener("dblclick", this.#onSliderDoubleClick);
    }

    /** The element the regions live in. */
    get root() {
        return this.#root;
    }

    /**
     * Asks for regions to be redrawn. Calls made in the same task are merged into one redraw.
     *
     * @param {string[]} [regions] - Region ids; every region when omitted.
     * @returns {Promise<void>} Resolves once the page has been updated.
     */
    render(regions = Object.keys(this.#regions)) {
        if (this.#destroyed) return Promise.resolve();
        if (!this.#pending) {
            this.#pending = new Set();
            this.#flushed = Promise.resolve().then(() => this.#flush());
        }
        for (const id of regions) {
            if (!this.#regions[id]) throw new Error(`StudioView: unknown region "${id}"`);
            this.#pending.add(id);
        }
        return this.#flushed;
    }

    /** Draws every queued region, in the order the regions were declared. */
    async #flush() {
        const queued = this.#pending;
        this.#pending = null;
        this.#flushed = null;
        if (this.#destroyed) return;

        const ids = Object.keys(this.#regions).filter((id) => queued.has(id) && !(this.#regions[id].once && this.#drawn.has(id)));

        // Every template is rendered before the page changes, so it changes in one go
        const rendered = await Promise.all(ids.map(async (id) => ({ id, html: await this.#renderTemplate(this.#regions[id].template, await this.#buildContext(id)) })));
        if (this.#destroyed) return;

        // Regions are placed in order, so a region whose slot is inside another (the edit toolbar
        // in the map) finds it once that region has been drawn
        for (const { id, html } of rendered) this.#place(id, html);
        this.#drawn = new Set([...this.#drawn, ...ids]);

        RangeDisplay.syncAllFills(this.#root);
        this.#afterRender(ids);
    }

    /** Puts a region's newly rendered HTML on the page: into its placeholder, or over its current element. */
    #place(id, html) {
        const current = this.#regionElement(id);
        if (!current) throw new Error(`StudioView: nowhere to draw region "${id}"`);

        const next = this.#toRegionElement(id, html);
        Idiomorph.morph(current, next, {
            morphStyle: "outerHTML",
            // A value being typed (or a slider being dragged) is the newest value; the one the
            // template rendered a moment earlier would overwrite it
            ignoreActiveValue: true,
            callbacks: {
                beforeNodeMorphed: (oldNode, newNode) => StudioView.#allowMorph(oldNode, newNode),
                beforeNodeRemoved: (oldNode) => !StudioView.#isIgnored(oldNode),
            },
        });
    }

    /** The region's element, or its placeholder, creating the placeholder in its slot if needed. */
    #regionElement(id) {
        const existing = this.#root.querySelector(`[${REGION_ATTRIBUTE}="${id}"]`);
        if (existing) return existing;

        const slot = this.#regions[id].slot ? this.#root.querySelector(this.#regions[id].slot) : null;
        if (!slot) return null;
        const placeholder = slot.ownerDocument.createElement("div");
        placeholder.setAttribute(REGION_ATTRIBUTE, id);
        slot.prepend(placeholder);
        return placeholder;
    }

    /** Parses a region's HTML and marks its root element as the region (id and classes). */
    #toRegionElement(id, html) {
        const template = this.#root.ownerDocument.createElement("template");
        template.innerHTML = html.trim();
        const element = template.content.firstElementChild;
        if (!element || template.content.childElementCount !== 1) throw new Error(`StudioView: region "${id}" must render exactly one root element`);

        element.setAttribute(REGION_ATTRIBUTE, id);
        element.classList.add(...(this.#regions[id].classes ?? []));
        return element;
    }

    static #isIgnored(node) {
        return node.nodeType === Node.ELEMENT_NODE && node.hasAttribute(MORPH_IGNORE_ATTRIBUTE);
    }

    /**
     * Whether idiomorph may update an element itself. Ignored elements are left alone. A custom
     * element (a name with a hyphen, such as Foundry's <file-picker>) builds its own children when
     * it is added to the page, which the template never writes, so morphing its children would
     * strip them: only its attributes are brought up to date, and its value through its property
     * (custom inputs read the value attribute once, when they are created).
     */
    static #allowMorph(oldNode, newNode) {
        if (StudioView.#isIgnored(oldNode)) return false;
        if (oldNode.nodeType !== Node.ELEMENT_NODE || !oldNode.localName.includes("-")) return true;
        StudioView.#syncCustomElement(oldNode, newNode);
        return false;
    }

    static #syncCustomElement(oldElement, newElement) {
        for (const { name, value } of [...newElement.attributes]) {
            if (oldElement.getAttribute(name) === value) continue;
            oldElement.setAttribute(name, value);
            if (name === "value" && "value" in oldElement) oldElement.value = value;
        }
        for (const { name } of [...oldElement.attributes]) {
            if (!newElement.hasAttribute(name) && name !== REGION_ATTRIBUTE) oldElement.removeAttribute(name);
        }
    }

    /**
     * Action dispatch, as ApplicationV2 did it: the nearest [data-action] ancestor of a click names
     * the handler, which is called with the event and that element. The browser's own handling of
     * the click goes ahead (a checkbox still ticks). Clicks inside a dialogue drawn in the root are
     * left to the dialogue.
     */
    #onClick = (event) => {
        const target = event.target.closest?.("[data-action]");
        if (!target || !this.#root.contains(target) || target.closest("dialog")) return;
        const handler = this.#actions[target.dataset.action];
        if (handler) handler.call(this.#controller, event, target);
    };

    /** Keeps a slider's value display and filled track in step as it moves. */
    #onSliderInput = (event) => {
        if (StudioView.#isRange(event.target)) RangeDisplay.sync(event.target);
    };

    /**
     * Returns a slider carrying data-default to that value. The input event it sends updates the
     * display and track (above) and reaches whatever listens for changes, as a drag would. Sliders
     * without data-default are left to the studio.
     */
    #onSliderDoubleClick = (event) => {
        const target = event.target;
        if (!StudioView.#isRange(target)) return;
        if (target.dataset.default === undefined || target.value === target.dataset.default) return;
        target.value = target.dataset.default;
        target.dispatchEvent(new Event("input", { bubbles: true }));
    };

    static #isRange(element) {
        return element?.localName === "input" && element.type === "range";
    }

    /** Stops listening and drops any queued redraw. */
    destroy() {
        this.#destroyed = true;
        this.#root.removeEventListener("click", this.#onClick);
        this.#root.removeEventListener("input", this.#onSliderInput);
        this.#root.removeEventListener("dblclick", this.#onSliderDoubleClick);
    }
}
