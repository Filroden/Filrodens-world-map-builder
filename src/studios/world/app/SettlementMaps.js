import { platform } from "../../../platform/index.js";
import { SettlementSource } from "../settlement/SettlementSource.js";
import { MapStateManager } from "./MapStateManager.js";
import { UserFigures } from "./UserFigures.js";

/**
 * The World studio's side of settlement maps (L-surface step 2a; `claude/v5-l-surface-step2-plan.md`
 * §2): the open world mounts the Local studio's controller in its frame while one of its settlement
 * maps is open. The World studio stays the host: it keeps the world, its bar, Save world and the
 * Surface map (unchanged while a settlement map is open), and hands the controller what it needs
 * of them as plain functions (`#host`), so neither studio imports the other (the shell's registry
 * gives the World studio the Local studio's `create`).
 *
 * Here: the controller made once per world; the settlement source kept while the Surface map is
 * unchanged; Make settlement map (with the population question) and opening one; going back to the
 * pin; and what the frame's regions, the world bar's Settlement maps menu, a pin's card and the
 * overview show of the world's settlement maps.
 */
export class SettlementMaps {
    /** Each studio's Local controller and source, by the studio. */
    static #state = new WeakMap();

    static #of(app) {
        let state = this.#state.get(app);
        if (!state) {
            state = { controller: null, source: undefined };
            this.#state.set(app, state);
        }
        return state;
    }

    /** Whether settlement maps can be made here: the Local studio is registered with the shell. */
    static available(app) {
        return typeof app.shell?.registry?.get?.("local")?.create === "function";
    }

    /** The Local studio's controller for the open world, made when first asked for. */
    static controller(app) {
        if (!this.available(app)) return null;
        const state = this.#of(app);
        state.controller ??= app.shell.registry.get("local").create(app.shell, this.#host(app));
        return state.controller;
    }

    /** The controller if one is made (without making one). */
    static existing(app) {
        return this.#state.get(app)?.controller ?? null;
    }

    /** Whether a settlement map (or Make settlement map's choice) is open. */
    static isOpen(app) {
        return !!this.existing(app)?.isOpen;
    }

    /** The world closes or another opens: its settlement maps' controller and workers go. */
    static reset(app) {
        const state = this.#state.get(app);
        state?.controller?.destroy();
        this.#state.delete(app);
    }

    /** The Surface map changed: the source is read again when next asked for. */
    static invalidate(app) {
        const state = this.#state.get(app);
        if (state) state.source = undefined;
    }

    /** The Surface map's settlement source, kept while the map is unchanged (see invalidate). */
    static source(app) {
        const state = this.#of(app);
        if (state.source === undefined) state.source = SettlementSource.of(app);
        return state.source;
    }

    /** What the Local controller asks of the world (see LocalController's class comment). */
    static #host(app) {
        const { i18n } = platform;
        return {
            source: () => this.source(app),
            pin: (pinId) => SettlementSource.pin(app, pinId),
            pinOf: (pinId) => app.mapPins?.find((pin) => pin.id === pinId) ?? null,
            world: () => app.world,
            surfaceMapId: () => app.currentSaveId ?? null,
            mapName: () => i18n.localize("FILRODENSWMB.UI.LayerSurfaceFull"),
            changed: () => app.settlementsChanged(),
            render: (regions) => app.view?.render(regions),
            goToPin: (pinId) => this.goToPin(app, pinId),
            leave: () => this.leave(app),
        };
    }

    // ------------------------------------------------------------------ opening and leaving

    /**
     * Make settlement map… from a pin: its population asked for first when it has none (written to
     * the pin, one undo step), then the four versions.
     * @param {object} app
     * @param {string} pinId
     */
    static async make(app, pinId) {
        const pin = app.mapPins?.find((each) => each.id === pinId);
        const controller = this.controller(app);
        if (!pin || !controller || !app.meshSession?.mesh) return false;
        if (UserFigures.shown(pin) === null) {
            const population = await this.#askPopulation(pin);
            if (population === null) return false;
            MapStateManager.pushVectorState(app);
            pin.userFigures = { ...(pin.userFigures ?? {}), population };
            this.invalidate(app);
            app._repaintVectors?.();
            app.markDirty();
        }
        await app.enterSettlement(() => controller.make(pinId));
        return true;
    }

    /**
     * Opens one of the world's settlement maps.
     * @param {object} app
     * @param {string} id - The settlement map's id.
     */
    static async open(app, id) {
        const controller = this.controller(app);
        if (!controller) return false;
        await app.enterSettlement(() => controller.open(id));
        return true;
    }

    /** Back to the Surface map: the settlement map (or the choice) closed. */
    static leave(app) {
        if (!this.isOpen(app)) return false;
        this.existing(app).close();
        app.leaveSettlement();
        return true;
    }

    /** The settlement bar's way back: the Surface map, the pin in its inspector. */
    static async goToPin(app, pinId) {
        await app.leaveSettlementForPin(pinId);
    }

    /** The population question (board L1b): a whole number of people, or null for Cancel. */
    static async #askPopulation(pin) {
        const { i18n } = platform;
        const name = pin.name || i18n.localize("FILRODENSWMB.UI.UnnamedPin");
        const content = await platform.templates.render("modules/filrodens-world-map-builder/templates/world/dialogs/settlement-population.hbs", { name, max: UserFigures.MAX });
        const answer = await platform.dialogs.prompt({
            title: i18n.format("FILRODENSWMB.UI.MakeSettlementMapOf", { name: pin.name || "" }),
            content,
            confirmLabel: i18n.localize("FILRODENSWMB.UI.MakeSettlementMap"),
            confirmIcon: "fwmb-icon fwmb-icon--location-city",
            onSubmit: (form) => UserFigures.parse(form.elements.settlementPopulation?.value),
        });
        return Number.isFinite(answer) && answer > 0 ? answer : null;
    }

    // ------------------------------------------------------------------ what the frame shows

    /**
     * The frame's regions while a settlement map is open: the Local controller's rail, panel, bar
     * and the line over its canvas, in place of the Surface map's.
     * @param {object} app
     * @param {string} regionId
     * @param {object} context - The region's context, changed in place.
     */
    static regionContext(app, regionId, context) {
        const controller = this.existing(app);
        if (regionId === "mapbar") {
            context.mapBar = controller?.isOpen ? controller.barContext() : null;
            return;
        }
        if (!controller?.isOpen) return;
        if (regionId === "toolbar") {
            const rail = controller.railContext();
            Object.assign(context, { railWorld: false, railStages: rail.railStages, activeTool: rail.activeTool, railOccasional: (context.railOccasional ?? []).filter((entry) => !entry.tool) });
        }
        if (regionId === "context") Object.assign(context, controller.panelContext(), { activeTool: controller.tool });
        if (regionId === "editToolbar") {
            context.toolbarPartial = "modules/filrodens-world-map-builder/templates/local/toolbar-settlement.hbs";
            context.settlementLine = controller.toolbarContext();
            if (context.bar) context.bar.state = null;
        }
    }

    /**
     * The world bar's Settlement maps menu (board L3): the world's settlement maps by name, kind and
     * people, the open one marked; the button names it while one is open.
     */
    static menuContext(app) {
        const { i18n } = platform;
        const controller = this.existing(app);
        const cards = controller ? controller.cards() : this.#savedCards(app);
        const open = controller?.isOpen ? (controller.openCard?.id ?? null) : null;
        const lang = i18n.lang;
        const rows = cards
            .map((card) => {
                const pin = app.mapPins?.find((each) => each.id === card.pinId);
                const name = pin?.name || card.name || "";
                return {
                    id: card.id,
                    name,
                    meta: i18n.format("FILRODENSWMB.UI.SettlementMenuMeta", { kind: this.tierLabel(card.tier), people: (card.people ?? 0).toLocaleString(lang) }),
                    current: card.id === open,
                    search: name.toLocaleLowerCase(lang),
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name, lang, { numeric: true, sensitivity: "base" }));
        const openRow = rows.find((row) => row.current);
        const choosing = controller?.isOpen && controller.mode === "choosing";
        const label = openRow?.name ?? (choosing ? (app.mapPins?.find((pin) => pin.id === controller.pinId)?.name ?? "") : null);
        return {
            enabled: this.available(app) && rows.length > 0,
            open: !!controller?.isOpen,
            label: label || i18n.localize("FILRODENSWMB.UI.SettlementMaps"),
            count: rows.length,
            rows,
            tooltip: !this.available(app) ? null : rows.length ? i18n.localize("FILRODENSWMB.UI.SettlementMapsHint") : i18n.localize("FILRODENSWMB.UI.SettlementMapsNone"),
        };
    }

    static #savedCards(app) {
        return Array.isArray(app.world?.settlements) ? app.world.settlements : [];
    }

    /** A pin tier's name ("Town"), from its built-in style's. */
    static tierLabel(tier) {
        const key = tier ? `FILRODENSWMB.UI.PinStyle${tier.charAt(0).toUpperCase()}${tier.slice(1)}` : null;
        const name = key ? platform.i18n.localize(key) : null;
        return name && name !== key ? name : platform.i18n.localize("FILRODENSWMB.UI.SettlementPlace");
    }

    /**
     * A pin's Settlement map card (board L1, L1b), or null on a pin that is not a settlement.
     * In step 2a: none yet (Make settlement map…, asking for a population first where it has none)
     * and kept (Open settlement map); a held regional world's waits for step 2b.
     */
    static pinCard(app, pin) {
        if (!this.available(app) || !SettlementSource.isSettlement(app, pin)) return null;
        const { i18n } = platform;
        const controller = this.existing(app);
        const cards = controller ? controller.cards() : this.#savedCards(app);
        const card = cards.find((each) => each.pinId === pin.id) ?? null;
        const name = pin.name || i18n.localize("FILRODENSWMB.UI.UnnamedPin");
        if (app.world?.held) return { held: true, later: i18n.format("FILRODENSWMB.UI.NotBuiltYet", { name: i18n.localize("FILRODENSWMB.UI.SettlementMapHeld") }) };
        if (card) {
            return {
                card: true,
                id: card.id,
                name,
                line: i18n.format("FILRODENSWMB.UI.SettlementCardLine", { kind: this.tierLabel(card.tier), people: (card.people ?? 0).toLocaleString(i18n.lang) }),
                unsaved: !!controller && !app.world?.settlements?.some?.((saved) => saved.id === card.id),
            };
        }
        // Read lazily: the source is worked out only when a settlement map is made
        const noMesh = !app.meshSession?.mesh;
        return {
            none: true,
            hint: UserFigures.shown(pin) === null ? i18n.format("FILRODENSWMB.UI.SettlementCardNoPopulation", { name }) : i18n.format("FILRODENSWMB.UI.SettlementCardNone", { name }),
            off: noMesh ? i18n.localize("FILRODENSWMB.UI.SettlementCardNoMesh") : null,
        };
    }

    /**
     * The world overview's settlement maps (board L4): a table of them, searchable, scrolling past
     * five rows.
     */
    static overview(app) {
        const { i18n } = platform;
        const controller = this.existing(app);
        const cards = controller ? controller.cards() : this.#savedCards(app);
        const lang = i18n.lang;
        return cards
            .map((card) => {
                const pin = app.mapPins?.find((each) => each.id === card.pinId);
                const name = pin?.name || card.name || "";
                return { id: card.id, name, kind: this.tierLabel(card.tier), people: (card.people ?? 0).toLocaleString(lang), from: i18n.localize("FILRODENSWMB.UI.LayerSurfaceFull"), search: name.toLocaleLowerCase(lang) };
            })
            .sort((a, b) => a.name.localeCompare(b.name, lang, { numeric: true, sensitivity: "base" }));
    }

    /**
     * A search typed into a settlement maps list (the world bar's menu, the overview's table):
     * rows not matching hidden, in place.
     */
    static filter(event) {
        const field = event.target;
        if (!field?.matches?.("[data-settlement-search]")) return false;
        const list = field.closest("[data-settlement-list]");
        const query = field.value.trim().toLocaleLowerCase();
        for (const row of list?.querySelectorAll("[data-settlement-row]") ?? []) row.hidden = !!query && !row.dataset.search.includes(query);
        return true;
    }
}
