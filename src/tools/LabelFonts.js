import { DEFAULT_LABEL_FONT, hasStyle, hasWeight } from "../data/fonts.js";

/**
 * The face a map label is drawn in: its family (or the default label font when the host lacks it),
 * its weight and its slant, and making sure the face has loaded before a label is drawn in it.
 *
 * **Families.** A label names its family by name (`fontFamily`). The fonts offered are the
 * vendored label fonts plus, in Foundry, the world's own (platform.fonts.list()). A label naming
 * a family the host does not have (a Foundry world's font opened on the web) is drawn in
 * DEFAULT_LABEL_FONT, and keeps the name, so it comes back on a host that has the family.
 *
 * **Bold and italic.** A label's `bold` and `italic` are optional. Labels were always drawn bold
 * before they could choose, so a label without `bold` is bold; one without `italic` is upright. A
 * vendored family without an italic (or bold) face is drawn upright (or regular) whatever the label
 * holds, rather than slanted or thickened by the browser; the label keeps its setting, so it comes
 * back in a family that has the face (the inspector shows the control disabled meanwhile). A host's
 * own font is drawn as the label asks.
 *
 * **Loading.** The vendored faces are declared in the stylesheet, which costs nothing until a face
 * is used; the browser fetches a face when text in it is first laid out on the page. The map's
 * labels are drawn on the canvas instead, which takes whatever face is ready when the text is
 * made, so a face still loading would leave the label in the fallback. The canvas asks for the
 * faces it is about to use (load), and draws its labels again once they have arrived.
 */
export class LabelFonts {
    /** The families the host offers, or null before the studio has said (any family is then drawn as named). */
    static #available = null;

    /** Faces asked for already, so a face that cannot load is not asked for again on every draw. */
    static #requested = new Set();

    /**
     * Sets the families the host offers (platform.fonts.list()).
     * @param {string[]|null} names
     */
    static setAvailable(names) {
        this.#available = names ? new Set(names) : null;
    }

    /**
     * The family a label is drawn in.
     * @param {{fontFamily?: string}|null|undefined} label
     * @returns {string}
     */
    static family(label) {
        const name = label?.fontFamily;
        if (!name) return DEFAULT_LABEL_FONT;
        return !this.#available || this.#available.has(name) ? name : DEFAULT_LABEL_FONT;
    }

    /** "bold" unless the label has turned bold off, or its family has no bold face. */
    static weight(label) {
        return label?.bold === false || !hasWeight(this.family(label), 700) ? "normal" : "bold";
    }

    /** "italic" when the label has turned italic on and its family has an italic face. */
    static style(label) {
        return label?.italic === true && hasStyle(this.family(label), "italic") ? "italic" : "normal";
    }

    /**
     * A label's face as the start of a CSS font shorthand ("italic bold"), for measuring.
     * @returns {string}
     */
    static face(label) {
        return `${this.style(label)} ${this.weight(label)}`;
    }

    /**
     * The CSS font shorthand of a label's face at a size, as document.fonts takes it.
     * @param {object} label
     * @param {number} [sizePx]
     * @returns {string}
     */
    static spec(label, sizePx = 16) {
        return `${this.face(label)} ${sizePx}px "${this.family(label).replaceAll('"', "")}"`;
    }

    /**
     * The families labels name that the host does not have, each once, for the notice shown when
     * a map opens.
     * @param {object[]} labels - Label fields (standalone labels, and the labels of pins, routes and regions).
     * @returns {string[]}
     */
    static missing(labels) {
        if (!this.#available) return [];
        const missing = new Set();
        for (const label of labels) {
            const name = label?.fontFamily;
            if (name && !this.#available.has(name)) missing.add(name);
        }
        return [...missing];
    }

    /**
     * Asks for the faces of `labels` that have not loaded yet, once each. Resolves with whether any
     * face was asked for (so the labels are worth drawing again), once all have arrived or failed.
     *
     * @param {object[]} labels
     * @returns {Promise<boolean>}
     */
    static async load(labels) {
        const fonts = globalThis.document?.fonts;
        if (!fonts?.load) return false;
        const wanted = new Set(labels.map((label) => this.spec(label)));
        const pending = [...wanted].filter((spec) => {
            if (this.#requested.has(spec)) return false;
            try {
                return !fonts.check(spec);
            } catch {
                return false;
            }
        });
        if (pending.length === 0) return false;
        for (const spec of pending) this.#requested.add(spec);
        await Promise.allSettled(pending.map((spec) => fonts.load(spec)));
        return true;
    }

    /**
     * Resolves once every face `labels` use has loaded (or failed), however long ago it was asked
     * for: for an export, which must not draw a label in a fallback face.
     *
     * @param {object[]} labels
     * @returns {Promise<void>}
     */
    static async ready(labels) {
        const fonts = globalThis.document?.fonts;
        if (!fonts?.load) return;
        const specs = [...new Set(labels.map((label) => this.spec(label)))];
        await Promise.allSettled(specs.map((spec) => fonts.load(spec)));
    }
}
