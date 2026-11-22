import { FILRODENSWMB } from "../../../config.js";

/** Pin style tiers whose places have no people of their own to enter: castles and ruins. */
const NO_PEOPLE = new Set(["castle", "abandonedCastle", "ruinedCapital", "ruinedCity", "ruinedLargeTown", "ruinedTown"]);

/**
 * The figures a reader enters on a settlement pin (`userFigures`): today its population. The pin's
 * style says what the place is (its tier, and whether it is a capital, walled or a port); the
 * entered figure says how many live there. An entered figure is the one shown everywhere (the
 * inspector, journal pages, Fill in, the Local studio), and Generate builds the pin's town to it
 * (see Generation.seats, Trade); what the run made stays in the pin's `generated` or `modelled`
 * figures, as what the land and trade support.
 *
 * Only the inspector writes it (and, later, the Local studio's question for a missing population):
 * a run, Fill in, Remove generated content and a run's undo leave it as it is. A generated pin with
 * an entered figure is kept by Generate again, as an edited one is (see Regeneration.isKept).
 *
 * Nothing here touches Foundry globals, so it can be exercised directly from Node.
 */
export class UserFigures {
    /** The least population a world run makes a town of; an entered figure below it is a village's. */
    static get TOWN_MIN() {
        return FILRODENSWMB.GENERATOR.TOWNS.TIERS[2].minPop;
    }

    /** The most a population may be entered as (the rules' count range). */
    static get MAX() {
        return FILRODENSWMB.GENERATOR.USER_FIGURES.MAX_POPULATION;
    }

    /**
     * The pin's entered population, or null when it has none.
     * @param {object} pin
     * @returns {number|null}
     */
    static population(pin) {
        const value = pin?.userFigures?.population;
        return Number.isFinite(value) && value >= 0 ? value : null;
    }

    /** Whether the pin has any entered figure. */
    static has(pin) {
        return this.population(pin) !== null;
    }

    /**
     * Whether a pin on a style of this tier takes figures: every icon pin but a castle's or a ruin's
     * (no tier, a custom style, a village, a market town included).
     * @param {string|null|undefined} tier - The pin style's tier.
     */
    static takes(tier) {
        return !NO_PEOPLE.has(tier);
    }

    /** The population the run made of the pin's place (what the land and trade support), or null. */
    static made(pin) {
        const value = Number((pin?.generated ?? pin?.modelled)?.population);
        return Number.isFinite(value) && value >= 0 ? value : null;
    }

    /** The population to show and read for a pin: its entered figure, else the run's. */
    static shown(pin) {
        return this.population(pin) ?? this.made(pin);
    }

    /**
     * A population as typed into the inspector, as the record stores it: a whole number from 0 to
     * MAX, or null for none (an empty field, or one that is not a number).
     * @param {string} text
     * @returns {number|null}
     */
    static parse(text) {
        const cleaned = String(text ?? "").replace(/[\s,'’_]/g, "");
        if (!/^\d+(\.\d*)?$/.test(cleaned)) return null;
        const value = Math.round(Number(cleaned));
        return Number.isFinite(value) ? Math.min(this.MAX, value) : null;
    }
}
