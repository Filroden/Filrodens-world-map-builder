import { RegionalExtractor } from "./RegionalExtractor.js";
import { INFLUENCE_KINDS } from "../mesh/Influences.js";
import { routeMarkedLine } from "../mesh/Resample.js";

/**
 * The crop fingerprint (`claude/v5-s0-shell-handoff.md` §4, rule 1): a hash of what a cut takes
 * from its parent for one crop, so a held regional world can tell when its parent was saved with
 * changes that reach it.
 *
 * What the cut takes is read by the cut's own code (RegionalExtractor.createPayload), so the
 * fingerprint cannot disagree with what a cut would deliver: the land inputs and terrain settings,
 * the strokes, faults, rivers and masks, the pins, labels and decorations the crop keeps, the
 * parent run's cells for the crop, the upwind margin and the rivers flowing in. The regions and
 * routes are left out of that payload, since carrying them means building the regional map's own
 * mesh (the slow part of a cut); they are read from the parent instead: the owner of every parent
 * cell under the crop (with a margin of two cells, so a cell whose site is just outside but whose
 * area reaches in is counted), the regions those cells name, the influences painted on them, and
 * every route whose line passes there.
 *
 * Left out, because they are not the parent's content in the crop: the world settings (the style
 * lists, the cultures but their homelands, the Generate settings but the events' places), which a
 * changed settingsRevision covers (rule 2); the detail level, which is how the map is viewed; the
 * parent's id; and whether the cut was asked to fill in.
 */
export class CropFingerprint {
    /** Payload fields that are not the parent's content in the crop (see the class comment). */
    static #LEFT_OUT = new Set(["parentId", "infillPending", "detailLevel", "customBiomes", "customRouteStyles", "customPinStyles", "customLabelStyles", "customRegionStyles", "cultures", "generatorSettings"]);

    /**
     * The fingerprint of a crop on the open map.
     * @param {object} app - The studio, with the parent map open and drawn.
     * @param {{crop: {x: number, y: number, width: number, height: number}, width: number}} cut -
     *     The crop in the parent's pixels (as the cut fitted it) and the regional map's width.
     * @returns {string} 8 hex digits.
     */
    static of(app, { crop, width }) {
        const { payload, plan } = RegionalExtractor.createPayload(app, crop, { targetWidth: width, mesh: false });
        const hash = new Hasher();
        hash.value(this.#content(payload));
        this.#regions(hash, app, plan.cropBox);
        return hash.hex();
    }

    /** The payload's content, the world settings but their per-map parts left out. */
    static #content(payload) {
        const content = {};
        for (const [key, value] of Object.entries(payload)) if (!this.#LEFT_OUT.has(key)) content[key] = value;
        content.homelands = (payload.cultures ?? []).map((culture) => [culture.id, culture.homelands]);
        content.eventPlaces = (payload.generatorSettings?.ages ?? []).map((age) => (age.events ?? []).map((event) => [event.kind, event.place ?? null]));
        return content;
    }

    /** The regions, influences and routes on the parent's cells under the crop. */
    static #regions(hash, app, crop) {
        const session = app.meshSession;
        if (!session?.mesh) return hash.value(null);
        const mesh = session.mesh;
        const margin = 2 * Math.sqrt((mesh.width * mesh.height) / Math.max(1, mesh.cellCount));
        const left = crop.x - margin;
        const top = crop.y - margin;
        const right = crop.x + crop.width + margin;
        const bottom = crop.y + crop.height + margin;
        const inside = (x, y) => x >= left && x <= right && y >= top && y <= bottom;
        const cells = [];
        for (let cell = 0; cell < mesh.cellCount; cell++) if (inside(mesh.siteX(cell), mesh.siteY(cell))) cells.push(cell);

        for (const set of app.layerSets ?? []) {
            hash.value({ ...set, levels: null });
            for (const level of set.levels ?? []) {
                const owners = session.layer(level.id)?.owners;
                hash.value({ ...level, regions: null });
                if (!owners) continue;
                const present = new Set();
                for (const cell of cells) {
                    hash.number(owners[cell]);
                    present.add(owners[cell]);
                }
                for (const region of level.regions ?? []) if (present.has(region.key)) hash.value(region);
            }
        }

        const influences = session.influences;
        if (influences?.any()) for (const kind of INFLUENCE_KINDS) for (const cell of cells) hash.number(influences.levelAt(kind, cell));

        for (const route of app.mapRoutes ?? []) {
            if (!route.legs && !route.waypoints) continue;
            if (routeMarkedLine(route, mesh).some((point) => inside(point.x, point.y))) hash.value(route);
        }
    }
}

/**
 * A 32-bit FNV-1a over a value's canonical form: an object's keys in sorted order (a saved and
 * reloaded map may hold them in another), numbers by their 64 bits, undefined left out as JSON
 * leaves it.
 */
class Hasher {
    #hash = 0x811c9dc5;
    #view = new DataView(new ArrayBuffer(8));

    hex() {
        return (this.#hash >>> 0).toString(16).padStart(8, "0");
    }

    byte(value) {
        this.#hash = Math.imul(this.#hash ^ value, 16777619);
    }

    number(value) {
        this.#view.setFloat64(0, value);
        for (let i = 0; i < 8; i++) this.byte(this.#view.getUint8(i));
    }

    text(value) {
        for (let i = 0; i < value.length; i++) {
            const code = value.charCodeAt(i);
            this.byte(code & 0xff);
            this.byte(code >>> 8);
        }
        this.byte(0);
    }

    value(value) {
        if (value === null || value === undefined) return this.byte(1);
        if (typeof value === "number") {
            this.byte(2);
            return this.number(value);
        }
        if (typeof value === "string") {
            this.byte(3);
            return this.text(value);
        }
        if (typeof value === "boolean") return this.byte(value ? 4 : 5);
        if (ArrayBuffer.isView(value)) {
            this.byte(6);
            for (let i = 0; i < value.length; i++) this.number(value[i]);
            return this.byte(7);
        }
        if (Array.isArray(value)) {
            this.byte(8);
            for (const item of value) this.value(item);
            return this.byte(9);
        }
        if (value instanceof Map) return this.value([...value.entries()]);
        this.byte(10);
        for (const key of Object.keys(value).sort()) {
            if (value[key] === undefined || typeof value[key] === "function") continue;
            this.text(key);
            this.value(value[key]);
        }
        this.byte(11);
    }
}
