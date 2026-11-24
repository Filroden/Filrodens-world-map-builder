import { FILRODENSWMB } from "../../../config.js";
import { SettlementRecord } from "../data/SettlementRecord.js";

/**
 * Out of date (L-surface step 2b; `claude/v5-l-surface-step2-plan.md` §6.1): each settlement map's
 * input as its pin would give it now, by part, against the parts it was made from. A map whose
 * parts differ is Out of date, naming what changed; a map whose pin has gone cannot be compared.
 * Nothing is redrawn by itself: Generate again takes the input the pin gives now.
 *
 * The input the parent gives does not hang on the seed (no part holds it), so the comparison needs
 * the card alone (its pin, parts and supply figures), never the record. Its supply is compared by
 * its main figures within LOCAL.SUPPLY_TOLERANCE (see SettlementRecord), so a change elsewhere on
 * the map does not mark every settlement map.
 *
 * Pure: the source, the pins and the input's maker are handed in.
 */
export const OutOfDate = Object.freeze({
    /**
     * Each card's state against the parent as it is now.
     * @param {object} options
     * @param {object|null} options.source - The Surface map's settlement source, or null (no mesh yet).
     * @param {object[]} options.cards - The settlement maps' cards ({ id, pinId, parts, supply, people }).
     * @param {(pinId: string) => object|null} options.pinFor - A pin as the engine reads it, or null when it has gone.
     * @param {(source: object, pin: object, options: object) => object} options.inputFrom - LocalInput.inputFrom.
     * @returns {Map<string, {changed: string[], pinGone: boolean, people: {was: number, now: number}|null}>}
     */
    of({ source, cards, pinFor, inputFrom }) {
        const states = new Map();
        if (!source) return states;
        for (const card of cards) {
            const pin = pinFor(card.pinId);
            if (!pin) {
                states.set(card.id, { changed: [], pinGone: true, people: null });
                continue;
            }
            let input;
            try {
                input = inputFrom(source, pin, { seed: "" });
            } catch (error) {
                // A pin the source no longer reads as a settlement (its style changed to a castle's or a ruin's)
                console.warn(`FWMB | Settlement map ${card.id} could not be compared with its pin:`, error);
                states.set(card.id, { changed: ["style"], pinGone: false, people: null });
                continue;
            }
            const changed = SettlementRecord.changed(card.parts, SettlementRecord.parts(input));
            if (SettlementRecord.supplyChanged(card.supply ?? null, SettlementRecord.supplyOf(input), FILRODENSWMB.LOCAL.SUPPLY_TOLERANCE)) changed.push("supply");
            states.set(card.id, { changed, pinGone: false, people: changed.includes("people") ? { was: card.people ?? 0, now: input.population ?? 0 } : null });
        }
        return states;
    },
});
