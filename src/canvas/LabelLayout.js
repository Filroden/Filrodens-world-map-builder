import { FILRODENSWMB } from "../config.js";
import { placeLabels } from "./LabelPlacement.js";

/**
 * Where the map's names are drawn (StudioCanvas.renderLabels asks for every label it is about to
 * draw, measured): each one's candidate places, its turn and weight (LABELS.PLACEMENT), then
 * LabelPlacement finds the places, so names do not cover each other or the pins.
 *
 * - A label with its own position (dragged, or a standalone label) stays there, and so does every
 *   shown pin's icon; the others keep clear of them.
 * - A pin's name goes beside it (right first, then the other sides); a region's name at or a
 *   little off one of several deep places in its region, preferring the deepest and those not
 *   spilling over its border; a route's name above the middle of its line. Names are kept on
 *   the map.
 * - Capitals, then cities, are placed first; then realm names (always drawn) round them; then
 *   duchies, counties, other places and routes. A name with no room is dropped. A realm's name
 *   with no free place takes precedence over places' names (they move round their pins or are
 *   dropped), and a region's name may run over a place's dot when it must, so realm names are
 *   not crowded into the same gap.
 *
 * Results are kept per render pass (the studio, the player and the GM scene images), and each
 * starts from the last, so redrawing after a small change moves only the names near it. With
 * placement off, every label is drawn at its first place (as before placement).
 */

const { PLACEMENT } = FILRODENSWMB.LABELS;

/** A diagonal place sits this share of the pin's gap off both axes (at least half the pin's width). */
const DIAGONAL = 0.7;

/** A region name's box is tested at this many points a side (rows and columns) for spilling. */
const SPILL_SAMPLES = 3;

/** A deep place costs this much less than a shallow one, and a later place a little more. */
const DEPTH_COST = 0.6;
const RANK_COST = 0.1;

/** A region name may also sit a little off each deep place: above, below or to either side. */
const REGION_SHIFTS = Object.freeze([
    Object.freeze({ x: 0, y: 0, cost: 0 }),
    Object.freeze({ x: 0, y: -1.1, cost: 0.15 }),
    Object.freeze({ x: 0, y: 1.1, cost: 0.15 }),
    Object.freeze({ x: -0.25, y: 0, cost: 0.15 }),
    Object.freeze({ x: 0.25, y: 0, cost: 0.15 }),
    Object.freeze({ x: 0, y: -2.2, cost: 0.3 }),
    Object.freeze({ x: 0, y: 2.2, cost: 0.3 }),
    Object.freeze({ x: -0.5, y: 0, cost: 0.3 }),
    Object.freeze({ x: 0.5, y: 0, cost: 0.3 }),
]);

/** A region's or route's name partly off the map is moved just inside it, for this much more. */
const INSIDE_COST = 0.2;

/** A pin's name's place costs this much for each share of its box outside the map. */
const OFF_MAP_COST = 20;

/** Positions are compared to the half pixel, so a redraw at the same place reuses its result. */
const KEY_PRECISION = 2;

/**
 * @typedef {object} LabelItem
 * @property {string} id - "<type>:<owner id>", unique among the labels.
 * @property {string} type - "custom", "pin", "route" or "region".
 * @property {object} labelData - The label's own fields (x and y when it has its own position).
 * @property {number} w - Its drawn width, in map pixels (of its box, if rotated).
 * @property {number} h - Its drawn height.
 * @property {number} defaultX - Where it goes without placement (a pin's: where its name starts).
 * @property {number} defaultY
 * @property {object} [pin] - A pin's label: the pin.
 * @property {number} [pinWidth] - A pin's label: the pin's drawn width.
 * @property {object} [region] - A region's label: { levelId, key, depth (of its level in its set) }.
 */

export class LabelLayout {
    /** The last result of each render pass. */
    #results = new Map();

    /** Each region candidate list's spill costs, by box size. */
    #spills = new WeakMap();

    /**
     * Where each label goes.
     * @param {LabelItem[]} items
     * @param {object} context
     * @param {object[]} context.pins - The shown pins (their icons stay clear).
     * @param {function(object): number} context.pinWidth
     * @param {object|null} context.meshSession
     * @param {string} context.pass - The render pass, each with its own last result.
     * @param {boolean} context.avoid - Whether names avoid each other (the Detail menu's Avoid overlaps).
     * @param {{width: number, height: number}} [context.bounds] - The map's size: places off it cost more.
     * @returns {{position: function(LabelItem): ({x: number, y: number}|null), dropped: Set<string>, stats: object|null}}
     */
    layout(items, { pins = [], pinWidth, meshSession = null, pass = "normal", avoid = true, bounds = null }) {
        const requests = items.map((item) => this.#request(item, meshSession, avoid ? bounds : null));
        if (!avoid) {
            const first = new Map(requests.map((request) => [request.id, request.candidates[0] ?? null]));
            return { position: (item) => first.get(item.id) ?? null, dropped: new Set(), stats: null };
        }
        const icons = pins.filter((pin) => pin.icon).map((pin) => iconBox(pin, pinWidth(pin)));
        const ordered = [...icons, ...requests.map((request, index) => ({ request, index })).sort((a, b) => a.request.order - b.request.order || a.index - b.index).map(({ request }) => request)];
        const result = placeLabels(ordered, [], { seed: PLACEMENT.SEED, previous: this.#results.get(pass) ?? null });
        this.#results.set(pass, result);
        return { position: (item) => result.position(item.id), dropped: result.dropped, stats: result.stats };
    }

    /** A label's request for LabelPlacement: its candidates, turn and weight, and its key. */
    #request(item, meshSession, bounds) {
        if (item.type === "custom" || item.labelData.x !== undefined) {
            return fixedBox(item.id, item.labelData.x ?? item.defaultX, item.labelData.y ?? item.defaultY, item.w, item.h, PLACEMENT.REGION_DEPTHS[0].weight);
        }
        const rank = this.#rankOf(item);
        const candidates = bounds ? withinMap(this.#candidatesOf(item, meshSession), item, bounds) : this.#candidatesOf(item, meshSession);
        const beside = item.type === "pin" ? `icon:${item.pin.id}` : undefined;
        // A region's name may run over a place's dot when it must; a place's name never does
        const overMarkers = item.type === "region";
        return withKey({ id: item.id, w: item.w, h: item.h, candidates, order: rank.order, weight: rank.weight, mustShow: !!rank.mustShow, beside, overMarkers });
    }

    #rankOf(item) {
        if (item.type === "pin") return PLACEMENT.PIN_TIERS[item.pin?.generated?.tier] ?? PLACEMENT.OTHER_PIN;
        if (item.type === "region") return PLACEMENT.REGION_DEPTHS[Math.min(item.region.depth, PLACEMENT.REGION_DEPTHS.length - 1)];
        return PLACEMENT.ROUTE;
    }

    #candidatesOf(item, meshSession) {
        if (item.type === "pin") return pinCandidates(item);
        if (item.type === "region" && meshSession) {
            const candidates = this.#regionCandidates(item, meshSession);
            if (candidates.length) return candidates;
        }
        return [{ x: item.defaultX, y: item.defaultY, cost: 0 }];
    }

    /** A region name's places: its deep places, each costed by depth, rank and how far its box spills. */
    #regionCandidates(item, meshSession) {
        const places = meshSession.labelCandidates(item.region.levelId, item.region.key);
        if (!places.length) return [];
        const deepest = Math.max(1, places[0].depth);
        const spills = this.#spillsOf(places, item, meshSession);
        return places.flatMap((place, rank) =>
            REGION_SHIFTS.map((shift, turn) => ({
                x: place.x + shift.x * item.w,
                y: place.y + shift.y * item.h,
                cost: DEPTH_COST * (1 - place.depth / deepest) + RANK_COST * rank + shift.cost + PLACEMENT.SPILL_COST * spills[rank * REGION_SHIFTS.length + turn],
            })),
        );
    }

    /** The share of a name's box outside its region at each place (kept per box size). */
    #spillsOf(places, item, meshSession) {
        const bySize = this.#spills.get(places) ?? new Map();
        this.#spills.set(places, bySize);
        const size = `${Math.round(item.w)}x${Math.round(item.h)}`;
        if (!bySize.has(size)) {
            const owners = meshSession.layer(item.region.levelId).owners;
            const shifted = places.flatMap((place) => REGION_SHIFTS.map((shift) => ({ ...place, x: place.x + shift.x * item.w, y: place.y + shift.y * item.h })));
            bySize.set(size, shifted.map((place) => spillShare(meshSession.mesh, owners, item.region.key, place, item.w, item.h)));
        }
        return bySize.get(size);
    }
}

/** A box that stays where it is (an icon, or a label with its own position). */
function fixedBox(id, x, y, w, h, weight = PLACEMENT.REGION_DEPTHS[0].weight) {
    return withKey({ id, w, h, candidates: [{ x, y, cost: 0 }], order: -1, weight, fixed: true });
}

/**
 * A pin's icon, which names keep clear of. A capital's or city's is hard: no name covers it. Any
 * other's is soft: a name covers it only when it has no better place.
 */
function iconBox(pin, width) {
    const major = (PLACEMENT.PIN_TIERS[pin.generated?.tier] ?? PLACEMENT.OTHER_PIN).order <= MAJOR_ORDER;
    const box = fixedBox(`icon:${pin.id}`, pin.x, pin.y, width, width, major ? PLACEMENT.REGION_DEPTHS[0].weight : MINOR_ICON_WEIGHT);
    box.marker = true;
    if (!major) box.soft = true;
    return withKey(box);
}

/** Icons of places placed at or before this turn (capitals and cities) are hard. */
const MAJOR_ORDER = 1;

/** Covering a minor place's icon costs this much, per share of the icon covered. */
const MINOR_ICON_WEIGHT = 1;

/** A request with its key: everything placing reads, so an unchanged label is known. */
function withKey(request) {
    const round = (value) => Math.round(value * KEY_PRECISION);
    const places = request.candidates.map((candidate) => `${round(candidate.x)},${round(candidate.y)},${round(candidate.cost * 10)}`).join(";");
    request.key = `${round(request.w)}x${round(request.h)}|${request.weight}|${request.mustShow ? 1 : 0}${request.fixed ? "f" : ""}${request.soft ? "s" : ""}${request.marker ? "m" : ""}${request.overMarkers ? "o" : ""}|${places}`;
    return request;
}

/**
 * A pin's name's places (LABELS.PLACEMENT.PIN_CANDIDATES): beside the pin, starting the pin's gap
 * (PINS.LABEL_OFFSET of its width) from its centre.
 */
export function pinCandidates(item) {
    const { pin, w, h } = item;
    const gap = item.pinWidth * FILRODENSWMB.PINS.LABEL_OFFSET;
    return PLACEMENT.PIN_CANDIDATES.map(({ side, rise, cost }) => {
        const diagonal = side !== 0 && rise !== 0;
        // A diagonal place keeps its corner off the pin
        const along = diagonal ? Math.max(gap * DIAGONAL, item.pinWidth / 2) : gap;
        const x = side === 0 ? pin.x : pin.x + side * (along + w / 2);
        const y = rise === 0 ? pin.y : pin.y + rise * ((side === 0 ? gap : along) + h / 2);
        return { x, y, cost };
    });
}

/**
 * Names kept on the map: a region's or route's place partly off it is moved just inside, for a
 * little more; a pin's name keeps to its own places round the pin, those partly off the map
 * costing much more (a pin at the edge has its name on its other side).
 */
function withinMap(candidates, item, bounds) {
    const inside = (value, half, size) => Math.min(Math.max(value, half), Math.max(half, size - half));
    return candidates.map((candidate) => {
        const share = offMapShare(candidate, item.w, item.h, bounds);
        if (share === 0) return candidate;
        if (item.type === "pin") return { ...candidate, cost: candidate.cost + OFF_MAP_COST * share };
        return { x: inside(candidate.x, item.w / 2, bounds.width), y: inside(candidate.y, item.h / 2, bounds.height), cost: candidate.cost + INSIDE_COST };
    });
}

/** The share of a box (centred on a place) outside the map. */
function offMapShare(place, w, h, bounds) {
    const inside = Math.max(0, Math.min(place.x + w / 2, bounds.width) - Math.max(place.x - w / 2, 0)) * Math.max(0, Math.min(place.y + h / 2, bounds.height) - Math.max(place.y - h / 2, 0));
    return 1 - inside / Math.max(1, w * h);
}

/** The share of a box (centred on a place) whose sample points fall outside the region. */
function spillShare(mesh, owners, key, place, w, h) {
    let outside = 0;
    for (let row = 0; row < SPILL_SAMPLES; row++) {
        for (let column = 0; column < SPILL_SAMPLES; column++) {
            const x = place.x + w * (column / (SPILL_SAMPLES - 1) - 0.5);
            const y = place.y + h * (row / (SPILL_SAMPLES - 1) - 0.5);
            const cell = mesh.cellAt(x, y, place.cell);
            if (cell < 0 || owners[cell] !== key) outside++;
        }
    }
    return outside / (SPILL_SAMPLES * SPILL_SAMPLES);
}
