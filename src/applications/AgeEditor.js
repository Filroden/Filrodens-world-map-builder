import { FILRODENSWMB } from "../config.js";
import { panelSettings, resolveEvents } from "../generator/GeneratorSettings.js";
import { platform } from "../platform/index.js";
import { AgeEventRows } from "./AgeEventRows.js";
import { Inspector } from "./Inspector.js";
import { MapStateManager } from "./MapStateManager.js";

/**
 * An age in the inspector (see Inspector), opened from its row in the Generate panel's Ages
 * section: in folding sections, its era (with what the chosen era does), its strife (likewise)
 * and its events (see AgeEventRows: each event's kind, what it does, its culture or its place, and
 * + Event).
 *
 * Each field applies when committed, as one undo step (the undo snapshot holds the ages; see
 * MapStateManager.getVectorStateSnapshot), and marks a run made before it out of date. An age is
 * found by its id (GeneratorSettings.panelAges), so it stays open as the ages move.
 */

const TEMPLATE = "modules/filrodens-world-map-builder/templates/parts/inspector-age.hbs";

const capitalise = (word) => word.charAt(0).toUpperCase() + word.slice(1);

export class AgeEditor {
    /**
     * Opens the inspector on an age.
     * @param {object} app
     * @param {string} id
     * @param {object} [options] - As Inspector.open's.
     */
    static open(app, id, options) {
        return Inspector.open(app, this.KIND, { id }, options);
    }

    /** The map's ages as the panel keeps them, written back so the ids given stay. */
    static ages(app) {
        app.uiState.generatorSettings = panelSettings(app.uiState.generatorSettings);
        return app.uiState.generatorSettings.ages;
    }

    /** An age by id, or null. */
    static find(app, id) {
        return this.ages(app).find((age) => age.id === id) ?? null;
    }

    /** An age's name in the list ("Age 1", "Age 3: the present"). */
    static label(ages, index) {
        const present = index === ages.length - 1 && ages.length > 1;
        return platform.i18n.format(present ? "FILRODENSWMB.UI.GenerateAgePresent" : "FILRODENSWMB.UI.GenerateAgeNumber", { number: index + 1 });
    }

    /** An age in brief, for its row: its era and strife, and how many events it holds ("High medieval · Troubled · 2 events"). */
    static summary(age) {
        const parts = [
            platform.i18n.localize(`FILRODENSWMB.UI.GenerateEra${capitalise(age.era)}`),
            platform.i18n.localize(`FILRODENSWMB.UI.GenerateStrife${capitalise(age.strife)}`),
        ];
        const count = age.events.length;
        const key = "FILRODENSWMB.UI.GenerateAgeEvents";
        if (count) parts.push(platform.i18n.format(count === 1 ? `${key}One` : key, { count }));
        return parts.join(" · ");
    }

    /** The template's context. */
    static #context(app, age) {
        const G = FILRODENSWMB.GENERATOR;
        const choices = (presets, chosen, prefix) => Object.keys(presets).map((value) => ({ value, label: `${prefix}${capitalise(value)}`, selected: value === chosen }));
        return {
            age,
            eras: choices(G.ERAS, age.era, "FILRODENSWMB.UI.GenerateEra"),
            eraHint: `FILRODENSWMB.UI.GenerateEraHint${capitalise(age.era)}`,
            strifes: choices(G.STRIFES, age.strife, "FILRODENSWMB.UI.GenerateStrife"),
            strifeHint: `FILRODENSWMB.UI.GenerateStrifeHint${capitalise(age.strife)}`,
            events: AgeEventRows.rows(app, age, { present: this.#isPresent(app, age) }),
            // Events that act on a realm or a town name them only after a run
            noRun: !app.modelRun,
            eventCount: age.events.length,
        };
    }

    /** Whether the age is the present (the last of several, or the only one). */
    static #isPresent(app, age) {
        return this.ages(app).at(-1)?.id === age.id;
    }

    /** The age's era, strife and events as the form holds them (an event whose kind changed made again for it). */
    static #read(app, age, form) {
        const G = FILRODENSWMB.GENERATOR;
        const cultures = app.uiState.cultures ?? [];
        const pick = (field, presets, fallback) => (Object.hasOwn(presets, form.elements[field]?.value) ? form.elements[field].value : fallback);
        const events = age.events.map((event, index) => {
            const kind = form.elements[`event.${index}.kind`]?.value ?? event.kind;
            const culture = form.elements[`event.${index}.culture`]?.value || null;
            if (kind !== event.kind) return AgeEventRows.fresh(kind, event, age, cultures) ?? event;
            if (AgeEventRows.isPeoples(kind) && culture && culture !== event.culture) return AgeEventRows.fresh(kind, event, age, cultures, culture) ?? event;
            return event;
        });
        return { ...age, era: pick("ageEra", G.ERAS, age.era), strife: pick("ageStrife", G.STRIFES, age.strife), events };
    }

    /**
     * Writes an age changed (by `change`, given a copy) as one undo step, the run marked out of date
     * and the panel drawn again (the inspector with it). Returns whether anything changed.
     */
    static change(app, id, change) {
        const ages = this.ages(app);
        const index = ages.findIndex((age) => age.id === id);
        if (index < 0) return false;
        const next = structuredClone(ages[index]);
        change(next);
        next.events = resolveEvents(next);
        if (JSON.stringify(next) === JSON.stringify(ages[index])) return false;
        MapStateManager.pushVectorState(app);
        ages[index] = next;
        app.uiState.generatorSettings = panelSettings(app.uiState.generatorSettings);
        app.markGeneratorStale?.();
        app.markDirty();
        app.view?.render(["context"]);
        return true;
    }

    static #apply(app, age, form) {
        const values = this.#read(app, age, form);
        return this.change(app, age.id, (copy) => Object.assign(copy, values));
    }

    static KIND = Object.freeze({
        id: "age",
        template: TEMPLATE,
        find: (app, ref) => AgeEditor.find(app, ref.id),
        header: (app, age) => {
            const ages = AgeEditor.ages(app);
            return { title: AgeEditor.label(ages, ages.findIndex((each) => each.id === age.id)), subtitle: platform.i18n.localize("FILRODENSWMB.UI.GenerateAgeKind"), swatch: null };
        },
        context: (app, age) => AgeEditor.#context(app, age),
        apply: (app, age, _ref, form) => AgeEditor.#apply(app, age, form),
        // A pick under way ends with the inspector (another object, a tool change, Escape, closing)
        closed: (app) => AgeEventRows.stopPick(app),
        actions: {
            // + Event: the first kind the age lacks
            addEvent: (app, age) => {
                const event = AgeEventRows.firstFree(age, app.uiState.cultures ?? []);
                if (event) AgeEditor.change(app, age.id, (copy) => copy.events.push(event));
            },
            removeEvent: (app, age, _ref, button) => {
                const index = Number(button.dataset.index);
                if (!age.events[index]) return;
                if (AgeEventRows.picking(app, age.id, index)) AgeEventRows.stopPick(app);
                AgeEditor.change(app, age.id, (copy) => copy.events.splice(index, 1));
            },
            clearPlace: (app, age, _ref, button) => {
                const index = Number(button.dataset.index);
                AgeEditor.change(app, age.id, (copy) => {
                    if (copy.events[index]) copy.events[index].place = null;
                });
            },
            // Choose on map: the next click on land sets the event's place
            pickPlace: (app, age, _ref, button) => {
                const index = Number(button.dataset.index);
                const kind = age.events[index]?.kind;
                if (!AgeEventRows.isPlaced(kind)) return;
                AgeEventRows.togglePick(app, age.id, index, (place) => {
                    AgeEditor.change(app, age.id, (copy) => {
                        if (copy.events[index]?.kind === kind) copy.events[index].place = place;
                    });
                });
                app.view?.render(["context"]);
            },
        },
    });
}
