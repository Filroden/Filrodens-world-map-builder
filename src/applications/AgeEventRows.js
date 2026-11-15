import { FILRODENSWMB } from "../config.js";
import { EVENT_ORDER } from "../generator/GeneratorSettings.js";
import { platform } from "../platform/index.js";
import { CultureMarkers } from "./CultureMarkers.js";

/**
 * An age's events (see GENERATOR.EVENTS and AgeEvents) as the age inspector shows them (see
 * AgeEditor): their rows, making an event of a kind, and choosing an event's place on the map.
 *
 * - **Rows:** each event's kind (grouped Peoples, Hardship, Realms, Prosperity; a kind already in
 *   the age, and the peoples events while the map has no cultures, cannot be chosen), what it does,
 *   then its culture for a peoples event or its place for an event that acts somewhere, and
 *   Remove. An age holds each kind at most once, listed in the Ages list's order whatever order
 *   they were added in.
 * - **Choose on map:** the next click on the map's land sets the event's place (a point, saved with
 *   the age) and ends the pick; a click on water is refused with a notice. Escape, the button
 *   again, the inspector closing, or another pick ends it with nothing set. While the Generate
 *   tool is open, every event's place is marked on the map (see markers).
 */

/** Each group's events, as the Ages list offers them. */
const GROUPS = FILRODENSWMB.GENERATOR.EVENTS.GROUPS;
const PEOPLES = new Set(FILRODENSWMB.GENERATOR.EVENTS.PEOPLES);
const PLACED = new Set(FILRODENSWMB.GENERATOR.EVENTS.PLACED);
/** The colour of an event's place on the map: a red target, apart from every culture's own colour. */
const PLACE_COLOR = "#e0403a";

const capitalise = (word) => word.charAt(0).toUpperCase() + word.slice(1);

export class AgeEventRows {
    /** The event whose place the next click sets ({ age (its id), event (its index), tool, set }), by studio. */
    static #picking = new WeakMap();

    /** Whether an event of this kind names a culture, or may name a place. */
    static isPeoples(kind) {
        return PEOPLES.has(kind);
    }

    static isPlaced(kind) {
        return PLACED.has(kind);
    }

    /**
     * An event as a line ("Hillfolk invade", "Civil war"), for the Ages list and the History panel;
     * null for a peoples event naming a culture the map (or run) does not know.
     * @param {object} event - { kind, culture? }.
     * @param {{id: string, name: string}[]} cultures
     * @returns {string|null}
     */
    static label(event, cultures) {
        if (!event?.kind) return null;
        if (!PEOPLES.has(event.kind)) return platform.i18n.localize(`FILRODENSWMB.UI.GenerateEventKind${capitalise(event.kind)}`);
        const culture = cultures.find((entry) => entry.id === event.culture);
        return culture ? platform.i18n.format(`FILRODENSWMB.UI.GenerateEvent${capitalise(event.kind)}`, { name: culture.name }) : null;
    }

    /**
     * An age's event rows (see the class comment) as its inspector draws them, each field named
     * `event.<index>.kind` or `event.<index>.culture`, and whether another may be added.
     * After a run, an event of the present that acts on a realm names it, as the map shows the run's
     * realms: the realm holding its place, or the largest realm (an earlier age's realms are not the
     * map's, so its events say only what they act on).
     * @param {object} app
     * @param {{id: string, events: object[]}} age - The age as the panel keeps it.
     * @param {{present?: boolean}} [options] - Whether the age is the present.
     */
    static rows(app, age, { present = false } = {}) {
        const cultures = app.uiState.cultures ?? [];
        const used = new Set(age.events.map((event) => event.kind));
        const rows = age.events.map((event, index) => {
            const peoples = PEOPLES.has(event.kind);
            const placed = PLACED.has(event.kind);
            // A culture another peoples event of the age names cannot be chosen here
            const taken = new Set(age.events.filter((other, at) => at !== index && other.culture).map((other) => other.culture));
            const placeLabel = placed ? this.#placeLabel(app, event, present) : null;
            const group = Object.keys(GROUPS).find((key) => GROUPS[key].includes(event.kind));
            const culture = peoples ? cultures.find((each) => each.id === event.culture) : null;
            return {
                index,
                number: index + 1,
                // Its folding section, remembered by age and kind (an age holds each kind once)
                section: `ageEvent-${age.id}-${event.kind}`,
                // Its summary line: its group, and its culture or what it acts on
                summary: [platform.i18n.localize(`FILRODENSWMB.UI.GenerateEventGroup${capitalise(group)}`), culture?.name ?? (peoples ? platform.i18n.localize("FILRODENSWMB.UI.GenerateEventCultureMissing") : null), placeLabel].filter(Boolean).join(" · "),
                title: this.label(event, cultures) ?? platform.i18n.localize(`FILRODENSWMB.UI.GenerateEventKind${capitalise(event.kind)}`),
                groups: Object.entries(GROUPS).map(([group, kinds]) => ({
                    label: `FILRODENSWMB.UI.GenerateEventGroup${capitalise(group)}`,
                    kinds: kinds.map((kind) => ({
                        value: kind,
                        label: `FILRODENSWMB.UI.GenerateEventKind${capitalise(kind)}`,
                        selected: kind === event.kind,
                        disabled: kind !== event.kind && (used.has(kind) || (PEOPLES.has(kind) && !cultures.length)),
                    })),
                })),
                hint: `FILRODENSWMB.UI.GenerateEventHint${capitalise(event.kind)}`,
                cultures: peoples
                    ? cultures.map((culture) => ({ value: culture.id, label: culture.name, selected: culture.id === event.culture, disabled: taken.has(culture.id) }))
                    : null,
                // A peoples event naming a culture since deleted shows as unchosen, and is ignored by the run
                cultureMissing: peoples && !cultures.some((culture) => culture.id === event.culture),
                placed,
                hasPlace: placed && !!event.place,
                placeLabel,
                picking: this.picking(app, age.id, index),
            };
        });
        return { rows, canAdd: !!this.firstFree(age, cultures) };
    }

    /**
     * What an event that acts somewhere acts on, as its place row says: with a place, the realm the
     * last run drew there (a realm event or trade war of the present), else the marked place; with
     * none, the largest realm by name (likewise), else what it falls back to.
     */
    static #placeLabel(app, event, present) {
        const named = present && event.kind !== "disaster" && app.modelRun ? this.#runRealms(app) : null;
        if (event.place) {
            const realm = named ? this.#realmAt(app, named, event.place) : null;
            if (realm) return platform.i18n.format("FILRODENSWMB.UI.GenerateEventPlaceInRealm", { name: realm.name });
            return platform.i18n.localize(named ? "FILRODENSWMB.UI.GenerateEventPlaceNearestRealm" : "FILRODENSWMB.UI.GenerateEventPlaceChosen");
        }
        if (named?.largest && event.kind !== "tradeWar") return platform.i18n.format("FILRODENSWMB.UI.GenerateEventPlaceLargestNamed", { name: named.largest.name });
        return platform.i18n.localize(this.#fallbackKey(event.kind));
    }

    /** The last run's realms on the map: their level, and the most populous. Null when the map shows none. */
    static #runRealms(app) {
        const runId = app.modelRun?.run;
        for (const set of app.meshSession?.layerSets ?? app.layerSets ?? []) {
            const level = set.levels?.[0];
            const regions = level?.regions?.filter((region) => region.generated?.run === runId && region.generated.kind === "realm") ?? [];
            if (!regions.length) continue;
            const largest = regions.reduce((best, region) => ((region.generated.population ?? 0) > (best.generated.population ?? 0) ? region : best));
            return { level, largest };
        }
        return null;
    }

    /** The region of the run's realm level under a point, or null. */
    static #realmAt(app, named, place) {
        return app.meshSession?.regionAt?.(named.level.id, place.x, place.y) ?? null;
    }

    /** What an event with no place acts on, as its place row says. */
    static #fallbackKey(kind) {
        if (kind === "disaster") return "FILRODENSWMB.UI.GenerateEventPlaceLargestTown";
        return kind === "tradeWar" ? "FILRODENSWMB.UI.GenerateEventPlaceAllRealms" : "FILRODENSWMB.UI.GenerateEventPlaceLargestRealm";
    }

    /** A new event for the age: the first kind it lacks (a peoples event only with a culture free for it), or null. */
    static firstFree(age, cultures) {
        const used = new Set(age.events.map((event) => event.kind));
        for (const kind of EVENT_ORDER) {
            if (used.has(kind)) continue;
            const event = this.fresh(kind, null, age, cultures);
            if (event) return event;
        }
        return null;
    }

    /**
     * An event of `kind` in place of `old` (or new): a peoples event keeps the old one's culture
     * (or `culture`, when given and free), else takes the first culture no other peoples event of
     * the age names; an event that acts somewhere keeps the old one's place. Null for a peoples
     * event with no culture to name.
     */
    static fresh(kind, old, age, cultures, culture = null) {
        if (PEOPLES.has(kind)) {
            const taken = new Set(age.events.filter((other) => other !== old && other.culture).map((other) => other.culture));
            const known = (id) => id && !taken.has(id) && cultures.some((each) => each.id === id);
            const chosen = known(culture) ? culture : known(old?.culture) ? old.culture : cultures.find((each) => !taken.has(each.id))?.id;
            return chosen ? { kind, culture: chosen } : null;
        }
        if (PLACED.has(kind)) return { kind, place: old?.place ?? null };
        return { kind };
    }

    // ------------------------------------------------------------------ the place on the map

    /**
     * Every event's place, to mark while the Generate tool is open (see HomelandMarkers): a hollow
     * red marker, filled for the event being picked again.
     * @returns {{x: number, y: number, color: string, filled: boolean}[]}
     */
    static markers(app) {
        if (app.activeTool !== "generate") return [];
        const markers = [];
        for (const age of app.uiState.generatorSettings?.ages ?? []) {
            (age.events ?? []).forEach((event, index) => {
                if (event.place && Number.isFinite(event.place.x) && Number.isFinite(event.place.y)) markers.push({ x: event.place.x, y: event.place.y, color: PLACE_COLOR, filled: this.picking(app, age.id, index) });
            });
        }
        return markers;
    }

    /** Whether the next click sets this event's place (or any event's, with none named). */
    static picking(app, ageId = null, index = null) {
        let current = this.#picking.get(app) ?? null;
        // Another pick (a culture's homeland) took the map's clicks since: this one has ended
        if (current && app.canvasEngine?.pickPointerTool !== current.tool) current = null;
        if (ageId === null) return current !== null;
        return current?.age === ageId && current?.event === index;
    }

    /**
     * Choose on map: the next click on land sets the event's place, through `set(place)`; pressed
     * again, it stops.
     * @param {object} app
     * @param {string} ageId
     * @param {number} index
     * @param {function({x: number, y: number}): void} set
     */
    static togglePick(app, ageId, index, set) {
        if (this.picking(app, ageId, index)) this.stopPick(app);
        else this.#startPick(app, ageId, index, set);
    }

    static #startPick(app, ageId, index, set) {
        if (!app.canvasEngine) return;
        CultureMarkers.stopPick(app);
        const tool = {
            down: (x, y) => this.#place(app, x, y),
            move: () => {},
            up: () => {},
            hover: () => this.#setCursor(app, "crosshair"),
            doubleClick: () => {},
            leave: () => this.#setCursor(app, "default"),
        };
        this.#picking.set(app, { age: ageId, event: index, tool, set });
        app.canvasEngine.pickPointerTool = tool;
        this.#setCursor(app, "crosshair");
        app.refreshCanvasHint?.();
    }

    /** Ends a pick, setting nothing. */
    static stopPick(app) {
        if (!this.#picking.has(app)) return;
        const mine = this.picking(app);
        this.#picking.delete(app);
        if (!mine) return;
        if (app.canvasEngine) app.canvasEngine.pickPointerTool = null;
        this.#setCursor(app, "default");
        app.refreshCanvasHint?.();
    }

    /** Escape ends a pick. Returns whether the key was used. */
    static handleKey(app, event) {
        if (event.key !== "Escape" || !this.picking(app)) return false;
        this.stopPick(app);
        app.view?.render(["context"]);
        return true;
    }

    /** A click while picking: the event's place on land, and the pick ends; on water, a notice and nothing. */
    static #place(app, x, y) {
        const pick = this.#picking.get(app);
        if (!pick) return;
        if (!CultureMarkers.isLand(app, x, y)) {
            platform.notify.warn(platform.i18n.localize("FILRODENSWMB.UI.GenerateEventPlaceOnWater"));
            return;
        }
        this.stopPick(app);
        pick.set({ x: Math.round(x), y: Math.round(y) });
    }

    static #setCursor(app, cursor) {
        const canvas = app.canvasEngine?.app?.canvas ?? app.canvasEngine?.app?.view;
        if (canvas && canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    }
}
