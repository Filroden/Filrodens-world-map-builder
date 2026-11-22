import { platform } from "../../../platform/index.js";
import { GenerateAll } from "./GenerateAll.js";

/** The client setting keeping the reader's answer once Ask each time is unticked. */
export const GUARD_SETTING = "generateGuard";

/** What the setting may hold: ask each time, or always one of the two choices. */
const PREFERENCES = Object.freeze(["ask", "chain", "only"]);

const DIALOG_TEMPLATE = "modules/filrodens-world-map-builder/templates/world/dialogs/generate-guard.hbs";

/**
 * The single Generate's guard (v5, S0 step 4b; board B4). A map can read another map's run (an
 * Underground map reads the Surface map's settlements, a settlement map the map it sits on).
 * When one it reads is out of date, Generate on it asks first: **Run the maps this one reads,
 * then this one** (in Generate all's order) or **Run this map only** (reading the other maps as
 * they were last run). **Ask each time**, at the dialogue's footer, is ticked at first; unticked,
 * the choice is kept and no longer asked (a client setting).
 *
 * No map reads another until Layers 1 adds a second map, so in S0 the decision always comes out
 * "run" and the dialogue is never shown: both are here, and tested, so Layers 1 has only to say
 * which maps a map reads (readsOf).
 */
export class GenerateGuard {
    /** Registers the kept answer (client scope, not listed in Foundry's settings sheet). */
    static registerSettings() {
        platform.settings.register(GUARD_SETTING, { scope: "client", config: false, type: String, default: "ask" });
    }

    /** The reader's kept answer: "ask", "chain" or "only". */
    static preference() {
        let value;
        try {
            value = platform.settings.get(GUARD_SETTING);
        } catch {
            value = "ask";
        }
        return PREFERENCES.includes(value) ? value : "ask";
    }

    /**
     * What Generate does on a map, given the maps it reads and the kept answer.
     * - `run`: nothing it reads needs a run, so it runs at once;
     * - `chain`: run what it reads that needs it (in Generate all's order), then it;
     * - `only`: run it alone;
     * - `ask`: show the dialogue.
     * @param {{reads: {id: string, type: string, name: string, state: "noRun"|"stale"|"current"}[], preference?: string}} input
     * @returns {{action: "run"|"chain"|"only"|"ask", chain: object[]}}
     */
    static decide({ reads = [], preference = "ask" }) {
        const upstream = GenerateAll.plan({ maps: reads }).run;
        if (!upstream.length) return { action: "run", chain: [] };
        if (preference === "chain") return { action: "chain", chain: upstream };
        if (preference === "only") return { action: "only", chain: [] };
        return { action: "ask", chain: upstream };
    }

    /** The maps a map reads (S0: none; Layers 1 gives an Underground map the Surface map, and so on). */
    static readsOf(_app) {
        return [];
    }

    /** What the dialogue reads (dialogs/generate-guard.hbs). */
    static context({ target, chain, chainTime = null, onlyTime = null }) {
        return {
            lede: platform.i18n.format("FILRODENSWMB.UI.GuardLede", { map: target, maps: chain.map((map) => map.name).join(", ") }),
            target,
            chain,
            chainTime,
            onlyTime,
        };
    }

    /**
     * The dialogue: which way to run, and whether to ask again. Resolves with `{choice, remember}`
     * ("chain" or "only"; remember when Ask each time was unticked), or null when cancelled. A
     * kept answer is stored as the reader's setting.
     */
    static async ask({ target, chain, chainTime, onlyTime }) {
        const { i18n } = platform;
        const content = await platform.templates.render(DIALOG_TEMPLATE, this.context({ target, chain, chainTime, onlyTime }));
        const answer = await platform.dialogs.choose({
            classes: ["fwmb", "fwmb-guard-dialog"],
            // Board B4: the dialogue names the map it generates
            title: i18n.format("FILRODENSWMB.UI.GuardTitle", { map: target }),
            content,
            // Ask each time (the content's .fwmb-start) goes to the footer after Cancel (see Overlay)
            onRender: (element) => GenerateGuard.bindChoices(element),
            buttons: [
                { action: "cancel", label: i18n.localize("FILRODENSWMB.UI.Cancel"), callback: () => null },
                {
                    action: "generate",
                    label: i18n.localize("FILRODENSWMB.UI.GenerateRun"),
                    icon: "fwmb-icon fwmb-icon--run",
                    default: true,
                    callback: (form) => {
                        const root = form.closest("dialog") ?? form;
                        return { choice: root.querySelector('input[name="guardChoice"]:checked')?.value ?? "chain", remember: !root.querySelector('input[name="askEachTime"]')?.checked };
                    },
                },
            ],
            dismissed: null,
        });
        if (answer?.remember) await platform.settings.set(GUARD_SETTING, answer.choice);
        return answer;
    }

    /** Keeps each choice card's aria-checked with its radio, as the design system draws a chosen card. */
    static bindChoices(element) {
        const sync = () => {
            for (const card of element.querySelectorAll(".fwmb-choice")) card.setAttribute("aria-checked", String(!!card.querySelector("input")?.checked));
        };
        element.addEventListener("change", sync);
        sync();
    }

    /**
     * Before Generate on a map: what to run. Resolves with the maps to run first (in order), an
     * empty list to run the map alone, or null when the reader cancelled.
     * @returns {Promise<object[]|null>}
     */
    static async before(app, target) {
        const decision = this.decide({ reads: this.readsOf(app), preference: this.preference() });
        if (decision.action === "run" || decision.action === "only") return [];
        if (decision.action === "chain") return decision.chain;
        const answer = await this.ask({ target, chain: decision.chain });
        if (!answer) return null;
        return answer.choice === "chain" ? decision.chain : [];
    }
}
