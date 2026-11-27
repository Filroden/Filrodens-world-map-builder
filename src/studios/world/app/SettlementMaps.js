import { FILRODENSWMB } from "../../../config.js";
import { platform } from "../../../platform/index.js";
import { Worlds } from "../../../kernel/worlds/Worlds.js";
import { WorldRecord } from "../../../kernel/worlds/WorldRecord.js";
import { SettlementSource } from "../settlement/SettlementSource.js";
import { ExportArea } from "../../../kernel/export/ExportScale.js";
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
 *
 * Keeping them in step (step 2b): **Out of date** is worked out by the Local studio from the
 * source; here it is asked for once the Surface map has been left alone for a moment
 * (LOCAL.STATES_AFTER_MS, then when the window is idle), never while it is being edited, and only
 * when the world has settlement maps; Save world and Generate all ask for it at once. **A held
 * regional world** reaches its parent world's settlement maps by pin id (its pins keep their
 * parent's ids): read only here, made in the parent; Fill in's own pins are its own.
 */
export class SettlementMaps {
    /** Each studio's Local controller and source, by the studio. */
    static #state = new WeakMap();

    static #of(app) {
        let state = this.#state.get(app);
        if (!state) {
            state = { controller: null, source: undefined, timer: null, chain: null };
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
        if (state?.timer) clearTimeout(state.timer);
        state?.controller?.destroy();
        this.#state.delete(app);
    }

    /** The Surface map changed: the source is read again when next asked for, and Out of date worked out again once it is left alone. */
    static invalidate(app) {
        const state = this.#state.get(app);
        if (!state) return;
        state.source = undefined;
        state.controller?.sourceChanged();
        this.#schedule(app);
    }

    // ------------------------------------------------------------------ Out of date (2b)

    /** The world's own settlement maps' cards (with those kept since), without making a controller. */
    static #ownCards(app) {
        const controller = this.existing(app);
        return controller ? controller.cards() : this.#savedCards(app);
    }

    /**
     * Out of date worked out once the Surface map has been left alone (LOCAL.STATES_AFTER_MS, then
     * when the window is idle), and the lists drawn again if a mark changed. Nothing is done for a
     * world with no settlement maps.
     */
    static #schedule(app) {
        if (!this.available(app) || !this.#ownCards(app).length) return;
        const state = this.#of(app);
        if (state.timer) clearTimeout(state.timer);
        state.timer = setTimeout(() => {
            state.timer = null;
            const idle = globalThis.requestIdleCallback ?? ((fn) => setTimeout(fn, 0));
            idle(() => this.#refreshStates(app), { timeout: 2000 });
        }, FILRODENSWMB.LOCAL.STATES_AFTER_MS);
    }

    /** Asks for Out of date while it is not known (the world just opened). */
    static #ensureStates(app) {
        const state = this.#state.get(app);
        if (state?.timer || this.existing(app)?.states({ compute: false })) return;
        this.#schedule(app);
    }

    static #refreshStates(app) {
        if (!this.#state.has(app)) return;
        // The Surface map still loading: asked again in a moment
        if (!app.meshSession?.mesh) {
            this.#schedule(app);
            return;
        }
        const controller = this.controller(app);
        if (!controller || controller.states({ compute: false })) return;
        const before = this.#marksPrint(app);
        controller.states();
        if (this.#marksPrint(app) !== before) app.view?.render(["worldbar", "context"]);
    }

    static #marksPrint(app) {
        return this.#ownCards(app)
            .map((card) => `${card.id}:${this.#marksOf(app, card).map((mark) => mark.label).join("+")}`)
            .join(",");
    }

    /** Every own settlement map's Out of date state, worked out now (Save world, Generate all). */
    static statesNow(app) {
        if (!this.#ownCards(app).length) return new Map();
        return this.controller(app)?.states() ?? new Map();
    }

    /**
     * A card's marks (the StateMarks card's): Out of date, its pin gone; a held world's parent's
     * map shows what was Out of date at the parent's last save.
     */
    static #marksOf(app, card) {
        const state = card.owner ? { changed: card.stale ?? [], pinGone: false } : this.existing(app)?.stateOf(card.id);
        if (!state) return [];
        if (state.pinGone) return [{ kind: "stale", icon: "warning-mark", label: "FILRODENSWMB.UI.MarkPinGone" }];
        if (state.changed?.length) return [{ kind: "stale", icon: "warning-mark", label: "FILRODENSWMB.UI.MarkOutOfDate" }];
        return [];
    }

    static #named(marks) {
        return marks.map((mark) => ({ ...mark, label: platform.i18n.localize(mark.label) }));
    }

    /** The settlement maps' Out of date, as Generate all lists them: those it would make again. */
    static forGenerateAll(app, { compute = false } = {}) {
        if (!this.available(app) || app.world?.held) return [];
        const states = compute ? this.statesNow(app) : this.existing(app)?.states({ compute: false });
        if (!states) return [];
        return this.#ownCards(app)
            .filter((card) => states.get(card.id)?.changed.length && !states.get(card.id)?.pinGone)
            .map((card) => ({ id: card.id, type: "settlement", name: this.#nameOf(app, card), state: "stale" }));
    }

    /** Generate all's last step: every settlement map Out of date now made again (see LocalController.regenerate). */
    static async regenerateStale(app) {
        if (app.viewOnly) return 0;
        const ids = this.forGenerateAll(app, { compute: true }).map((map) => map.id);
        if (!ids.length) return 0;
        const made = await this.controller(app).regenerate(ids);
        app.view?.render(["worldbar", "context"]);
        return made;
    }

    /**
     * Generate again on one row of the overview's table (L-surface step 4b, board L4b): the world's
     * own settlement map made again from its pin as it is now, without opening it (see
     * LocalController.regenerate), one undo step on its own history.
     */
    static async regenerate(app, id) {
        if (!this.available(app) || app.viewOnly) return false;
        const card = this.#ownCards(app).find((each) => each.id === id);
        const state = card ? this.existing(app)?.stateOf(id) : null;
        if (!state?.changed?.length || state.pinGone) return false;
        // Its export drawing (L-surface step 5): Generate again waits until it ends
        if (this.existing(app)?.exportWait(id)) return false;
        const made = await this.controller(app).regenerate([id]);
        app.view?.render(["worldbar", "context"]);
        return made > 0;
    }

    /** The pins with a settlement map of this world's own (kept since included), by id. */
    static linkedPinIds(app) {
        return new Set(this.#ownCards(app).map((card) => card.pinId));
    }

    /** How many of these pins have a settlement map (a pin's deletion says so). */
    static mapsOfPins(app, pinIds) {
        const linked = this.linkedPinIds(app);
        return [...pinIds].filter((id) => linked.has(id)).length;
    }

    /** Delete settlement map… (board L1b): after its confirmation, gone at the next Save world. */
    static async deleteMap(app, id) {
        if (app.viewOnly) return false;
        const controller = this.controller(app);
        if (!controller || !(await controller.deleteMap(id))) return false;
        app.view?.render(["worldbar", "context"]);
        return true;
    }

    // ------------------------------------------------------------------ a held regional world's (2b)

    /**
     * The settlement maps of the worlds above a held regional world whose pins are on its map,
     * each with the world that owns it ({ owner: { worldId, name } }); loaded once a world is open,
     * the lists drawn again when they arrive. None for a world that is not held.
     */
    static #chainCards(app) {
        const world = app.world;
        if (!world?.held || !world.parentWorldId) return [];
        const state = this.#of(app);
        if (state.chain?.for === world.id) return state.chain.cards ?? [];
        state.chain = { for: world.id, cards: null, parentName: null };
        this.#loadChain(world)
            .then(({ cards, parentName }) => {
                if (state.chain?.for !== world.id) return;
                state.chain.cards = cards;
                state.chain.parentName = parentName;
                app.view?.render(["worldbar", "context"]);
            })
            .catch((error) => console.warn("FWMB | The parent world's settlement maps could not be read:", error));
        return [];
    }

    static async #loadChain(world) {
        const cards = [];
        const seen = new Set([world.id]);
        let parentName = null;
        let at = world;
        while (at?.held && at.parentWorldId && !seen.has(at.parentWorldId)) {
            const parent = await Worlds.get(at.parentWorldId);
            if (!parent) break;
            seen.add(parent.id);
            const owner = { worldId: parent.id, name: parent.name || platform.i18n.localize("FILRODENSWMB.UI.UnnamedWorld") };
            parentName ??= owner.name;
            for (const card of WorldRecord.settlementCards(parent)) cards.push({ ...card, owner });
            at = parent;
        }
        return { cards, parentName };
    }

    /** The world's own settlement maps and, on a held world, its parent's for the pins on its map. */
    static #allCards(app) {
        const own = this.#ownCards(app);
        const chain = this.#chainCards(app);
        if (!chain.length) return own;
        const pins = new Set((app.mapPins ?? []).map((pin) => pin.id));
        const taken = new Set(own.map((card) => card.pinId));
        const inherited = [];
        for (const card of chain) {
            if (!pins.has(card.pinId) || taken.has(card.pinId)) continue;
            taken.add(card.pinId);
            inherited.push(card);
        }
        return [...own, ...inherited];
    }

    static #nameOf(app, card) {
        const pin = app.mapPins?.find((each) => each.id === card.pinId);
        return pin?.name || card.name || "";
    }

    /**
     * Make settlement map in <parent world>… (board L1b): the parent world opened on the pin. A pin
     * the parent's Surface map does not have was added on this one: its map is made here.
     */
    static async makeInOwner(app, pinId) {
        const parentId = app.world?.parentWorldId;
        const parent = parentId ? await Worlds.get(parentId) : null;
        const mapId = parent ? Worlds.mapOf(parent) : null;
        const data = mapId ? await platform.store.loadMapData(mapId) : null;
        if (!data?.mapPins?.some?.((pin) => pin?.id === pinId)) return this.make(app, pinId);
        return app.openWorldAt(parent.id, { pinId });
    }

    /** Whether a pin on a held regional world is its own (Fill in's) rather than its parent's. */
    static #ownPin(app, pin) {
        // Infilling.isInfill, read here so this module stays clear of the generator's
        return !app.world?.held || pin?.generated?.infill === true;
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
            openOwner: (owner, id) => app.openWorldAt(owner.worldId, { settlementId: id }),
            worldName: () => app.world?.name || i18n.localize("FILRODENSWMB.UI.UnnamedWorld"),
            // A world open view only (WL): explored, never changed, with its notice
            viewOnly: () => app.viewOnly === true,
            viewOnlyNotice: () => app.viewOnlyNotice?.() ?? null,
            // Each culture's colour, by name, for the households' Culture view (step 3)
            cultureColours: () => Object.fromEntries((app.uiState?.cultures ?? []).filter((c) => c?.name && c.color).map((c) => [c.name, c.color])),
            // The report's parent map inset (step 5b): the Surface map's picture of a box (kept on
            // the map), drawn as an export of it is, at the scale that fits it in width × height
            inset: (box, width, height) => this.#inset(app, box, width, height),
        };
    }

    /** The Surface map's picture of a box for a report's inset: { picture, box, scale }, or null. */
    static async #inset(app, box, width, height) {
        const engine = app.canvasEngine;
        if (!engine?.drawExport || !(engine.mapWidth > 0)) return null;
        const area = ExportArea.clip(box, { width: engine.mapWidth, height: engine.mapHeight });
        const scale = Math.min(width / area.width, height / area.height);
        try {
            const picture = await engine.drawExport(area, scale);
            return picture ? { picture, box: area, scale } : null;
        } catch (error) {
            console.warn("FWMB | The report's inset could not be drawn:", error);
            return null;
        }
    }

    // ------------------------------------------------------------------ opening and leaving

    /**
     * Make settlement map… from a pin: its population asked for first when it has none (written to
     * the pin, one undo step), then the four versions.
     * @param {object} app
     * @param {string} pinId
     */
    static async make(app, pinId) {
        // A world open view only (WL) makes nothing
        if (app.viewOnly) return false;
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
        // A held world's parent's settlement map opens read only (its owner named)
        const card = this.#allCards(app).find((each) => each.id === id);
        const owner = card?.owner ? { ...card.owner, stale: card.stale ?? [] } : null;
        await app.enterSettlement(() => controller.open(id, { owner }));
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
        this.#ensureStates(app);
        const cards = this.#allCards(app);
        const open = controller?.isOpen ? (controller.openCard?.id ?? null) : null;
        const lang = i18n.lang;
        const rows = cards
            .map((card) => {
                const name = this.#nameOf(app, card);
                const meta = i18n.format("FILRODENSWMB.UI.SettlementMenuMeta", { kind: this.tierLabel(card.tier), people: (card.people ?? 0).toLocaleString(lang) });
                return {
                    id: card.id,
                    name,
                    meta: card.owner ? i18n.format("FILRODENSWMB.UI.SettlementMenuOwner", { meta, owner: card.owner.name }) : meta,
                    marks: this.#named(this.#marksOf(app, card)),
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
        this.#ensureStates(app);
        const card = this.#allCards(app).find((each) => each.pinId === pin.id) ?? null;
        const name = pin.name || i18n.localize("FILRODENSWMB.UI.UnnamedPin");
        const lang = i18n.lang;
        if (card?.owner) {
            // A held world's parent's settlement map: read only here, or opened in its world
            return { heldOwn: true, id: card.id, owner: card.owner.name, ownerId: card.owner.worldId, name, stale: card.stale?.length ? this.#named(this.#marksOf(app, card)) : [] };
        }
        if (card) {
            const state = controller?.stateOf(card.id) ?? null;
            const marks = this.#named(this.#marksOf(app, card));
            return {
                card: true,
                id: card.id,
                name,
                line: i18n.format("FILRODENSWMB.UI.SettlementCardLine", { kind: this.tierLabel(card.tier), people: (card.people ?? 0).toLocaleString(lang) }),
                marks,
                staleLine: state?.changed.length ? i18n.format("FILRODENSWMB.UI.SettlementCardStale", { changes: controller.describe(state) }) : null,
                unsaved: !!controller && !app.world?.settlements?.some?.((saved) => saved.id === card.id),
            };
        }
        if (!this.#ownPin(app, pin)) {
            // Until the parent's name arrives with its settlement maps (see #chainCards)
            const parent = this.#state.get(app)?.chain?.parentName ?? "";
            return { heldNone: true, owner: parent };
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
        this.#ensureStates(app);
        const cards = this.#allCards(app);
        const lang = i18n.lang;
        const surface = i18n.localize("FILRODENSWMB.UI.LayerSurfaceFull");
        const controller = this.existing(app);
        // A world open view only (WL): its settlement maps opened, never made again or deleted
        const viewOnly = app.viewOnly === true;
        return cards
            .map((card) => {
                const name = this.#nameOf(app, card);
                const state = card.owner ? null : controller?.stateOf(card.id);
                return {
                    id: card.id,
                    name,
                    kind: this.tierLabel(card.tier),
                    people: (card.people ?? 0).toLocaleString(lang),
                    from: card.owner ? i18n.format("FILRODENSWMB.UI.SettlementMadeFromOwner", { owner: card.owner.name, map: surface }) : surface,
                    marks: this.#named(this.#marksOf(app, card)).map((mark) => ({ ...mark, tooltip: this.#markTip(app, card, mark, name) })),
                    // A held world's parent's map is deleted in its own world (Ken, 2026-11-24: Delete here too)
                    deletable: !card.owner && !viewOnly,
                    // Generate again on the row (step 4b): the world's own (a held world's Fill in maps
                    // included, as in their Map setup), Out of date, its pin there
                    again: !card.owner && !viewOnly && !!state?.changed?.length && !state.pinGone,
                    // …and waiting while its export draws (step 5)
                    waiting: card.owner ? null : (controller?.exportWait(card.id) ?? null),
                    search: name.toLocaleLowerCase(lang),
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name, lang, { numeric: true, sensitivity: "base" }));
    }

    /**
     * A mark's tooltip in the overview's table (board L4b): the state and what changed, as the
     * mark shows only its icon where the table is narrow.
     */
    static #markTip(app, card, mark, name) {
        const { i18n } = platform;
        const controller = this.existing(app);
        if (mark.label === i18n.localize("FILRODENSWMB.UI.MarkPinGone")) return i18n.format("FILRODENSWMB.UI.SettlementPinGoneLine", { name, map: i18n.localize("FILRODENSWMB.UI.LayerSurfaceFull") });
        const state = card.owner ? { changed: card.stale ?? [] } : controller?.stateOf(card.id);
        const changes = state?.changed?.length && controller ? controller.describe(state) : null;
        return changes ? i18n.format("FILRODENSWMB.UI.SettlementMarkChanged", { changes }) : mark.label;
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
