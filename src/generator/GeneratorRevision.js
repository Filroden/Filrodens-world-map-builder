import { FILRODENSWMB } from "../config.js";

/**
 * Which revision of the generator's rules a map follows (see FILRODENSWMB.GENERATOR.REVISION).
 *
 * A saved run never runs again, so a change to the rules cannot alter a map's settlements,
 * routes or realms by itself. What is worked out live from the map can: the Travel tool's network
 * and a regional map's Fill in. Each map therefore records the revision it was last generated with
 * (`generatorRevision`), and those live readers follow it, so an older map keeps the results it
 * was made with until its owner generates again.
 *
 * A new map starts at the current revision, Generate sets the revision it ran, and a regional map
 * takes its parent's (its Fill in reads its parent's run). A map saved before maps recorded a
 * revision has none and reads as LEGACY.
 *
 * A generator payload carries the revision to run as `revision`; there an absent value means the
 * current one, since a payload is always a request made now (see buildGeneratorPayload).
 *
 * Nothing here touches Foundry globals, so it can be exercised directly from Node.
 */
export class GeneratorRevision {
    /** The current revision: what Generate runs, and what a new map starts at. */
    static get CURRENT() {
        return FILRODENSWMB.GENERATOR.REVISION;
    }

    /**
     * The revision a map follows: its saved `generatorRevision`, or LEGACY for a map saved before
     * the field existed (or holding something that is not a revision).
     * @param {object|null|undefined} source - A saved map payload or a uiState.
     * @returns {number}
     */
    static of(source) {
        const revision = source?.generatorRevision;
        return Number.isInteger(revision) && revision >= FILRODENSWMB.GENERATOR.REVISIONS.LEGACY ? revision : FILRODENSWMB.GENERATOR.REVISIONS.LEGACY;
    }

    /**
     * The revision a generator payload asks for: its own, or the current one when it names none.
     * @param {{revision?: number}|null|undefined} payload
     * @returns {number}
     */
    static ofPayload(payload) {
        const revision = payload?.revision;
        return Number.isInteger(revision) && revision >= FILRODENSWMB.GENERATOR.REVISIONS.LEGACY ? revision : this.CURRENT;
    }

    /**
     * Whether a map was made with an older generator than the current one, so generating again
     * would bring the current rules (the Generate panel's notice).
     * @param {object|null|undefined} source - A saved map payload or a uiState.
     */
    static isOlder(source) {
        return this.of(source) < this.CURRENT;
    }

    /**
     * Whether a revision (a map's, or a payload's) follows the rules introduced at `revision`.
     * @param {number} revision - What the map or payload follows (see of, ofPayload).
     * @param {number} since - The named revision a rule came in with (GENERATOR.REVISIONS).
     */
    static follows(revision, since) {
        return revision >= since;
    }

    /**
     * The model's rules at a revision, as plain values whose legacy settings reproduce the older
     * rules exactly, so the generator's stages read numbers rather than revisions:
     * - portWaterShare: the share of a land cell's pixels that must be sea or lake for it to load
     *   ships (see CellGraph.portCost); null for no such rule.
     * - fishingDensity: people fed per km² of a coastal cell's land by fishing.
     * - callKm, callShare: ports of call on long sea passages (see Trade); callKm null for none.
     * - shorePins: whether a port's place stands on its cell's shore, and a town on a navigable
     *   river beside the river, rather than on its cell's site (see CellValues, Materialise).
     * - seats: whether the map's settlement pins are seats the run must build on (see Pipeline.seatsOf).
     * - userRegions: whether the realms, duchies and counties the map's Political set holds as its
     *   own are fixed units the present age's realms are built round (see UserRealms).
     * @param {number} revision
     * @returns {{portWaterShare: number|null, fishingDensity: number, callKm: number|null, callShare: number, shorePins: boolean, seats: boolean, userRegions: boolean}}
     */
    static rules(revision) {
        const G = FILRODENSWMB.GENERATOR;
        const ports = this.follows(revision, G.REVISIONS.REVISION_2);
        return Object.freeze({
            portWaterShare: ports ? G.PORTS.WATER_SHARE : null,
            fishingDensity: ports ? G.VALUES.FISHING_DENSITY : G.VALUES.LEGACY_FISHING_DENSITY,
            callKm: ports ? G.PORTS.CALL_KM : null,
            callShare: G.PORTS.CALL_SHARE,
            shorePins: ports,
            seats: ports,
            userRegions: ports,
        });
    }

    /**
     * The revision a regional map cut from this map starts at: its parent's, since its Fill in
     * reads the parent's run and must read it by the rules it was made with.
     * @param {object} parentState - The parent map's uiState.
     * @returns {number}
     */
    static forRegional(parentState) {
        return this.of(parentState);
    }
}
