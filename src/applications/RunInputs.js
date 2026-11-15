import { FILRODENSWMB } from "../config.js";
import { MaskSettings } from "../generation/MaskSettings.js";
import { riverList } from "../generator/GeneratorInput.js";
import { INFLUENCE_KINDS, NO_INFLUENCE } from "../mesh/Influences.js";
import { Generation } from "./Generation.js";
import { Regeneration } from "./Regeneration.js";

/**
 * A short fingerprint of the map's own items a generator run reads, so the run can be shown out of
 * date once any of them changes, by whatever path: drawn, deleted, edited, mass edited or undone.
 *
 * Six kinds, each hashed on its own:
 * - routes: the routes the run's trade uses (see Generation.userRoutes);
 * - seats: the settlement pins it builds on (see Generation.seats);
 * - regions: the kept regions of the Political set it builds round (see Generation.userRegions),
 *   each level's kept regions by land display cell, with their keys and Independent choice;
 * - rivers: the traced rivers it reads (springs, custom rivers and the river settings all end
 *   there; see GeneratorInput.riverList);
 * - features: the drawn features that shape the terrain and rivers it reads: faults, custom
 *   rivers, land masks (in guided mode, the only engine they shape the land in) and river source
 *   pins, by what shapes the land (not their names, descriptions or visibility). With it kept, an
 *   edit to them marks a run out of date through the fingerprint alone, not through the lasting
 *   `generatorStale` flag (see MapStudio.requestTerrainUpdate), so undoing the edit clears it.
 * - influences: the values painted in the Influences tool (see Influences), by kind, cell and value.
 *
 * The fingerprint is taken once a run has been written onto the map (Generation.apply) and kept in
 * the saved run (`modelRun.inputs`). It describes the map as the run left it, not the run's own
 * input: a run adds only items it does not read on the next run (generated routes, pins and regions
 * it would replace), so the two agree, and a later change shows against the map the user saw.
 * Undoing a change brings the fingerprint back, and the run is no longer out of date for it. A run
 * saved without a fingerprint (made before it was kept) is never out of date by it.
 *
 * Only what the run reads counts: a route's name, style or visibility does not, nor a pin's look.
 */
export class RunInputs {
    /** The kinds, in the order they are listed. */
    static KINDS = Object.freeze(["routes", "seats", "regions", "rivers", "features", "influences"]);

    /**
     * The map's fingerprint now.
     * @param {object} app
     * @returns {{routes: string, seats: string, regions: string, rivers: string, features: string, influences: string}}
     */
    static of(app) {
        return {
            routes: hashText(JSON.stringify(Generation.userRoutes(app))),
            seats: hashText(JSON.stringify(Generation.seats(app))),
            regions: regionsHash(app),
            rivers: riversHash(app.currentRiverData),
            features: hashText(featureText(app)),
            influences: influencesHash(app.meshSession?.influences),
        };
    }

    /**
     * Whether the map's run keeps a fingerprint of the drawn terrain features, so an edit to them
     * shows it out of date without the lasting flag (a run saved before it was kept needs the flag).
     * @param {object} app
     */
    static tracksFeatures(app) {
        return typeof app.modelRun?.inputs?.features === "string";
    }

    /**
     * The kinds that differ from the fingerprint the map's run was saved with; none when the map
     * has no run, or its run has no fingerprint.
     * @param {object} app
     * @returns {string[]}
     */
    static changed(app) {
        const saved = app.modelRun?.inputs;
        if (!saved) return [];
        const now = this.of(app);
        return this.KINDS.filter((kind) => saved[kind] !== undefined && saved[kind] !== now[kind]);
    }

    /**
     * Whether the map's run is out of date: what it read has changed (`generatorStale`, set by the
     * terrain, climate, culture and Generate settings that change it), or the map's own items it
     * read differ from its fingerprint.
     * @param {object} app
     */
    static stale(app) {
        if (!app.modelRun) return false;
        return app.uiState?.generatorStale === true || this.changed(app).length > 0;
    }

    /** A text's fingerprint (eight hex digits), as each kind's (for Fill in's own; see Infilling.inputs). */
    static hash(text) {
        return hashText(text);
    }

    /** The painted influences' fingerprint, of every kind or of those given. */
    static influencesHash(influences, kinds = INFLUENCE_KINDS) {
        return influencesHash(influences, kinds);
    }
}

// ------------------------------------------------------------------ hashing

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const HEX_DIGITS = 8;

/** FNV-1a over 32-bit words, as an unsigned number. */
class Hash {
    #value = FNV_OFFSET;

    add(word) {
        this.#value = Math.imul(this.#value ^ (word | 0), FNV_PRIME) >>> 0;
        return this;
    }

    addAll(words) {
        for (const word of words) this.add(word);
        return this;
    }

    get hex() {
        return this.#value.toString(16).padStart(HEX_DIGITS, "0");
    }
}

function hashText(text) {
    const hash = new Hash();
    for (let at = 0; at < text.length; at++) hash.add(text.charCodeAt(at));
    return hash.hex;
}

/** Any number not a key: what the hash of no Political set starts from. */
const NO_REGION = -1;

/**
 * The kept regions of the Political set a run writes into (see Generation.userRegions), level by
 * level: each land display cell a kept region holds, with its region, and each kept region's key
 * and Independent choice. With no such set, or one whose levels are not a chain, the hash of none.
 */
function regionsHash(app) {
    const session = app.meshSession;
    const set = Regeneration.target(app);
    const levels = Regeneration.chain(set);
    // A hash all the same, so a set made later still shows (an empty value is no key, and is not kept)
    if (!session?.mesh || !session.aggregates || !levels) return new Hash().add(NO_REGION).hex;
    const kept = Regeneration.keptKeys(set);
    const land = session.aggregates.land;
    const hash = new Hash();
    levels.forEach((level, depth) => {
        const keys = kept[depth];
        hash.add(depth);
        for (const region of level.regions) if (keys.has(region.key)) hash.add(region.key).add(region.independent === true ? 1 : 0);
        const owners = session.layer(level.id).owners;
        // Only the land cells a kept region holds, so a change to the land elsewhere (a lake
        // a river source makes or takes away) does not count as a change to the regions
        for (let cell = 0; cell < owners.length; cell++) if (land[cell] === 1 && keys.has(owners[cell])) hash.add(cell).add(owners[cell]);
    });
    return hash.hex;
}

/** The traced rivers as the generator reads them: each river's points, lake flags, merging and flow. */
function riversHash(riverData) {
    const { pixelsPerBaseline, list } = riverList(riverData);
    const hash = new Hash().add(Math.round(pixelsPerBaseline * FLOW_SCALE)).add(list.length);
    for (const river of list) {
        hash.add(river.merges ? 1 : 0).add(river.x.length).addAll(river.x).addAll(river.y).addAll(river.lake);
        if (river.flow) hash.addAll(new Int32Array(river.flow.buffer, river.flow.byteOffset, river.flow.length));
    }
    return hash.hex;
}

/** Each painted cell of each kind of influence, with its value; unpainted cells count for nothing, so the hash costs what is painted. */
function influencesHash(influences, kinds = INFLUENCE_KINDS) {
    const hash = new Hash();
    INFLUENCE_KINDS.forEach((kind, index) => {
        if (!kinds.includes(kind)) return;
        hash.add(index);
        const levels = influences?.layer(kind)?.owners;
        if (!levels) return;
        for (let cell = 0; cell < levels.length; cell++) if (levels[cell] !== NO_INFLUENCE) hash.add(cell).add(levels[cell]);
    });
    return hash.hex;
}

/** Fields of a drawn feature that do not shape the land, left out of its fingerprint. */
const NOT_SHAPING = new Set(["name", "description", "visibility", "hidden", "journalPageId", "label"]);
const shaping = (key, value) => (NOT_SHAPING.has(key) ? undefined : value);

/** The fields of a river source pin (or a pin removing one) the rivers are traced from. */
const featurePinFields = (pin) => ({ type: pin.type ?? null, x: pin.x, y: pin.y, radius: pin.radius ?? null, inflow: pin.inflow ?? null });

/**
 * The drawn features that shape the terrain and rivers, as text: faults, custom rivers, guided
 * land masks with their settings, and the feature pins (pins without an icon: river sources and
 * the pins that remove one).
 */
function featureText(app) {
    const minVertices = FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES;
    const masks = app.uiState?.generationEngine === "guided" ? (app.landMasks ?? []).filter((mask) => mask.points?.length >= minVertices).map((mask) => [mask.operation, mask.points, ...MaskSettings.inputsOf(mask)]) : [];
    const pins = (app.mapPins ?? []).filter((pin) => !pin.icon).map(featurePinFields);
    return JSON.stringify([app.tectonicFaults ?? [], app.manualRivers ?? [], masks, pins], shaping);
}

/** pixelsPerBaseline as a whole number for hashing (its exact bits do not matter, its changes do). */
const FLOW_SCALE = 1000;
