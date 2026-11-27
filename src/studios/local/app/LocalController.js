import { FILRODENSWMB } from "../../../config.js";
import { platform } from "../../../platform/index.js";
import { WorldRecord } from "../../../kernel/worlds/WorldRecord.js";
import { LocalWorkers } from "../LocalWorkers.js";
import { autoWalled, inputFrom } from "../engine/LocalInput.js";
import { SettlementRecord } from "../data/SettlementRecord.js";
import { OutOfDate } from "./OutOfDate.js";
import { SettlementCanvas } from "./SettlementCanvas.js";
import { HouseholdsView } from "./HouseholdsView.js";
import { cultureRoofs, figuresOf, legendOf, panelOf } from "./Households.js";
import { PICTURE_LAYERS, VersionChoice, estimateMs } from "./VersionChoice.js";
import { drawTown } from "../render/CanvasTown.js";
import { styleOf } from "../LocalTasks.js";
import { ExportDialog } from "../../../kernel/export/ExportDialog.js";
import { LocalExport } from "./LocalExport.js";
import { Report, measurer } from "./Report.js";

const TEMPLATES = "modules/filrodens-world-map-builder/templates/local/";

/** Compass points, for the bearings the panel names. */
const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const pointOf = (bearing) => POINTS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];

/**
 * The Local studio's controller (L-surface step 2a; `claude/v5-l-surface-step2-plan.md` §2): the
 * settlement map the open world shows, mounted by the World studio in its frame. The World studio
 * stays the host (its world, world bar, Save world and Surface map) and hands this controller what
 * it needs of the world as plain functions (`host`, see SettlementMaps in the World studio); this
 * gives back its rail, panel, bar, the top line over its canvas, and its canvas.
 *
 * Its states: **choosing** (Make settlement map: four versions, nothing kept yet), **building**
 * (a kept settlement map being built to show), **open**, or none. A version kept makes a record
 * (SettlementRecord) that joins the world unsaved; Save world writes it (`changes`, `saved`).
 *
 * Keeping it in step (step 2b): each settlement map's **Out of date** state against its pin as it
 * is now (`states`, see OutOfDate), worked out when the host asks and forgotten when the Surface
 * map changes (`sourceChanged`); **Generate again** (`generateAgain`, and `regenerate` for Generate
 * all) takes the input the pin gives now with the kept seed, one undo step on the settlement map
 * (`undo`, `redo`); **Delete settlement map…** (`deleteMap`). A held regional world's settlement
 * map is its parent world's, opened read only (`open(id, { owner })`).
 *
 * The host:
 *   source() → the Surface map's settlement source (kept while the map is unchanged), or null
 *   pin(pinId) → { id, biome } for the engine, or null; pinOf(pinId) → the pin, or null
 *   world() → the world record (its settlement cards); surfaceMapId() → the Surface map's id
 *   mapName() → the map a settlement map is made from, by name ("the Surface map")
 *   changed() → the world has unsaved changes (the settlement maps'); render(regions)
 *   goToPin(pinId) → the Surface map, the pin in its inspector; leave() → back to the Surface map
 *   openOwner(owner, id) → the world that owns a held world's settlement map, opening it there
 *   worldName() → the open world's name, for the deletion's confirmation
 *   cultureColours() → each of the world's cultures' colours, by name (the households' views)
 *   inset(box, width, height) → the Surface map's picture of a box for a report's inset:
 *     { picture, box (kept on the map), scale }, or null
 *
 * Households and supply (step 3): the version shown keeps its households (sent back once at
 * Keep); Explore's tool shows its figures (Households.js), the card over its canvas
 * (HouseholdsView), and the map controls' Thematic views colour its houses (`setView`, for the
 * session: a settlement map opens with none, Ken 2026-11-24).
 *
 * Map setup (step 4; boards L3, L3b, L2b): the map's Walls (Automatic, On, Off: the map built
 * again from its own input with its walls forced, keeping its seed) and its look (the atlas or the
 * studio's theme, followed as the theme changes: only the pictures are drawn again), each one undo
 * step; Choose another version… (the kept version as the Default beside three new alternatives,
 * built from the map's own input: keeping one changes only its seed, Ken 2026-11-25); and
 * Generate again in the panel's foot.
 *
 * Export (step 5; boards X3a, X2a, X2b): the kernel's export dialogue on the open map (`export`,
 * see LocalExport), drawn from the version shown in its worker and held there until it ends; while
 * it draws, that map's changes wait (`exportWait`), and everything else stays free.
 */
export class LocalController {
    /** "choosing", "building", "open", or null. */
    mode = null;
    /** The tool open on the rail: Map setup, Export or Households and supply. */
    tool = "mapSetup";

    #shell;
    #host;
    #definition;
    #workers = null;
    /** The pin the open settlement map (or the choice) is of. */
    #pinId = null;
    /** The open settlement map's record (kept, perhaps not yet saved). */
    #record = null;
    /** The choice, while choosing. */
    #choice = null;
    /** A version opened alone from the choice (double-click), or null. */
    #alone = null;
    /** The settlement maps kept or changed since the last save, by id: their records. */
    #pending = new Map();
    /** The ids deleted since the last save (2b). */
    #deleted = new Set();
    /** Settlement maps built this session, by record id: { versionId, key, result }, oldest first. */
    #built = new Map();
    /** What the open map is drawn from: its version id and build result. */
    #shown = null;
    /** The map region's element for the settlement (cards or canvas). */
    #stage = null;
    #canvas = null;
    /** Whether the canvas shows the town view ("town"), or null after a pan or zoom. */
    #framing = "town";
    /** The open version's thumbnail, as an object URL, for Map setup. */
    #thumbUrl = null;
    /** Redraws the cards' progress while any is drawing. */
    #ticking = null;
    /** The map's own title, scale bar and north arrow as last drawn, kept while the view stays: { key, canvas }. */
    #labels = null;
    /** The line over the canvas, redrawn at most once a frame while the view moves. */
    #lineFrame = null;
    /** The building card's progress (a kept map built to show). */
    #building = null;
    /** Each settlement map's Out of date state, by id (see OutOfDate), or null until worked out. */
    #states = null;
    /** Each settlement map's undo and redo this session, by id: { undo: [], redo: [] } of { input, parts, name }. */
    #history = new Map();
    /** The world that owns the open settlement map when it is not this one's (a held world's parent's): { worldId, name }. */
    #owner = null;
    /** The household view shown (Styles.js HOUSEHOLD_VIEWS), or null. */
    #view = null;
    /** Who lives where over the canvas (HouseholdsView), once the shown version's households are in. */
    #people = null;
    /** Choose another version… open over this kept record (step 4), or null. */
    #another = null;
    /** The studio theme's colours as last read, by their key (the theme look). */
    #themes = new Map();
    /** Watching the studio's theme while a map in the theme look is shown. */
    #themeWatch = null;
    /** The export drawing from a settlement map (step 5): { id, name, versionId }, or null. */
    #export = null;
    /** The export dialogue open (one at a time). */
    #exportOpen = false;
    /** Versions let go while an export drew from them: released when it ends. */
    #releaseLater = new Set();

    /** The engine's input from a source (LocalInput.inputFrom; a stand-in in tests). */
    #inputFrom;

    /**
     * @param {object} shell
     * @param {object} host - See the class comment.
     * @param {object} definition - The Local studio's definition.
     * @param {object} [options] - For tests: `workers` (LocalWorkers' calls) and `inputFrom`.
     */
    constructor(shell, host, definition, { workers = null, inputFrom: input = inputFrom } = {}) {
        this.#shell = shell;
        this.#host = host;
        this.#definition = definition;
        this.#workers = workers;
        this.#inputFrom = input;
    }

    /** Whether a settlement map (or the choice) is open. */
    get isOpen() {
        return this.mode !== null;
    }

    /** Whether settlement maps were kept, changed or deleted since the last save. */
    get isDirty() {
        return this.#pending.size > 0 || this.#deleted.size > 0;
    }

    /** The pin the open settlement map is of. */
    get pinId() {
        return this.#pinId;
    }

    // ------------------------------------------------------------------ the world's settlement maps

    /**
     * The world's settlement maps as the lists show them: the saved cards, those kept since in
     * their place, those deleted since left out.
     * @returns {object[]}
     */
    cards() {
        const saved = WorldRecord.settlementCards(this.#host.world());
        const cards = saved.filter((card) => !this.#deleted.has(card.id)).map((card) => (this.#pending.has(card.id) ? SettlementRecord.card(this.#pending.get(card.id)) : card));
        for (const [id, record] of this.#pending) if (!saved.some((card) => card.id === id)) cards.push(SettlementRecord.card(record));
        return cards;
    }

    /** A pin's settlement map card, or null. */
    cardOfPin(pinId) {
        return this.cards().find((card) => card.pinId === pinId) ?? null;
    }

    /**
     * Each of the world's settlement maps' Out of date state against its pin as it is now (see
     * OutOfDate): worked out when first asked for after the Surface map changed (the source read
     * again, about half a second on a large map, then a few ms a settlement map), else null when
     * `compute` is false.
     * @param {{compute?: boolean}} [options]
     * @returns {Map<string, {changed: string[], pinGone: boolean, people: object|null}>|null}
     */
    states({ compute = true } = {}) {
        if (!this.#states && compute) {
            // No source yet (the Surface map's mesh still loading): nothing known, nothing kept
            const source = this.#host.source();
            if (!source) return null;
            this.#states = OutOfDate.of({ source, cards: this.cards(), pinFor: (pinId) => this.#host.pin(pinId), inputFrom: this.#inputFrom });
        }
        return this.#states;
    }

    /** A settlement map's Out of date state, or null when not worked out (or `compute`, worked out now). */
    stateOf(id, { compute = false } = {}) {
        return this.states({ compute })?.get(id) ?? null;
    }

    /** The Surface map changed (or loaded): every state is worked out again when next asked for. */
    sourceChanged() {
        this.#states = null;
    }

    /** A settlement map made from its pin as it is now. */
    #fresh(id) {
        this.#states?.set(id, { changed: [], pinGone: false, people: null });
    }

    /** The open settlement map's card, or null. */
    get openCard() {
        return this.#record ? SettlementRecord.card(this.#record) : null;
    }

    /**
     * What Save world writes of the settlement maps (see Worlds.save): those kept or changed, each
     * with its card and readable page, and the ids deleted.
     */
    async changes(pageOf) {
        // What is Out of date at this save, kept on each card for a held regional world's form,
        // which cannot work it out (its parent's Surface map is not open there)
        const states = this.cards().length ? this.states() : null;
        const stale = Object.fromEntries([...(states ?? new Map())].map(([id, state]) => [id, state.changed]));
        const saved = [];
        for (const record of this.#pending.values()) saved.push({ record: structuredClone(record), card: SettlementRecord.card(record, stale[record.id] ?? []), page: (await pageOf?.(record)) ?? {} });
        return { saved, deleted: [...this.#deleted], stale: states ? stale : null };
    }

    /**
     * Saved: the ids each settlement map was saved under (Save as gives new ones), so the open one
     * follows its record.
     * @param {Array<{from: string, id: string}>} ids
     */
    saved(ids = []) {
        const renamed = new Map(ids.map(({ from, id }) => [from, id]));
        if (this.#record && renamed.has(this.#record.id)) {
            const id = renamed.get(this.#record.id);
            const built = this.#built.get(this.#record.id);
            if (built) {
                this.#built.delete(this.#record.id);
                this.#built.set(id, built);
            }
            const history = this.#history.get(this.#record.id);
            if (history) {
                this.#history.delete(this.#record.id);
                this.#history.set(id, history);
            }
            this.#record = { ...this.#record, id };
        }
        this.#pending.clear();
        this.#deleted.clear();
        // Save as gives every settlement map a new id: their states are worked out again
        if (renamed.size && [...renamed].some(([from, id]) => from !== id)) this.#states = null;
        // Map setup no longer says the open one is waiting to be saved
        if (this.isOpen) this.#host.render(["context"]);
    }

    /** Unsaved settlement maps given up (the world's changes discarded, or another world opened). */
    forgetChanges() {
        this.#pending.clear();
        this.#deleted.clear();
        this.#history.clear();
        this.#states = null;
    }

    // ------------------------------------------------------------------ opening and leaving

    /**
     * Make settlement map: the choice of four versions for a pin (it has a population: the host
     * asks first when it has none).
     * @param {string} pinId
     */
    async make(pinId) {
        this.#leaveCurrent();
        const source = this.#host.source();
        const pin = this.#host.pin(pinId);
        if (!source || !pin) return false;
        this.#pinId = pinId;
        this.#record = null;
        this.mode = "choosing";
        this.tool = "mapSetup";
        const defaultSeed = `${source.mapSeed}:${pinId}`;
        this.#choice = new VersionChoice({
            workers: this.#workersNow(),
            inputFor: (seed) => this.#inputFrom(source, pin, { seed }),
            pinId,
            defaultSeed,
            onChange: () => this.#choiceChanged(),
        });
        this.#drawStage();
        this.#tick();
        return true;
    }

    /**
     * Opens a kept settlement map: built again from its record (or from the version still held,
     * when it was built this session from the same input) and drawn. A held regional world's
     * settlement map is its parent world's (`owner`), opened read only.
     * @param {string} id - The settlement map's id.
     * @param {{owner?: {worldId: string, name: string}|null}} [options]
     */
    async open(id, { owner = null } = {}) {
        this.#leaveCurrent();
        const record = owner ? await this.#load(id, owner.worldId) : (this.#pending.get(id) ?? (await this.#load(id)));
        if (!record) {
            platform.notify.warn(platform.i18n.localize("FILRODENSWMB.UI.SettlementMapMissing"));
            return false;
        }
        this.#owner = owner;
        this.#record = record;
        this.#pinId = record.pinId;
        // A world open view only (WL) explores its settlement maps: Map setup changes them
        this.tool = this.#viewOnly() ? "households" : "mapSetup";
        return this.#showRecord(record, { render: false });
    }

    /**
     * Shows a record on the canvas: the version held for it when it was built from the same input,
     * else built in a worker (its card showing its progress), its households worked out, and drawn.
     * A newer build asked for meanwhile (Generate again, Undo) wins: this one is dropped.
     */
    async #showRecord(record, { render = true } = {}) {
        const key = JSON.stringify(record.input);
        const held = this.#built.get(record.id);
        this.#canvas?.destroy();
        this.#canvas = null;
        this.#shown = null;
        if (held && held.key === key) {
            this.#shown = held;
            this.mode = "open";
            this.#drawStage();
            await this.#showTown();
            if (render) this.#host.render(["toolbar", "context", "editToolbar", "mapbar"]);
            return true;
        }
        this.mode = "building";
        this.#building = { startedAt: performance.now(), population: record.input.population };
        this.#drawStage();
        this.#tick();
        if (render) this.#host.render(["context", "editToolbar"]);
        const versionId = `open-${record.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const current = () => this.#record?.id === record.id && JSON.stringify(this.#record.input) === key;
        try {
            const result = await this.#workersNow().build(versionId, record.input);
            if (!current()) {
                this.#letGo(versionId);
                return false;
            }
            const kept = await this.#workersNow().keep(versionId);
            if (!current()) {
                this.#letGo(versionId);
                return false;
            }
            this.#remember(record.id, { versionId, key, result, kept });
            this.#shown = this.#built.get(record.id);
            this.mode = "open";
            this.#building = null;
            this.#drawStage();
            await this.#showTown();
            this.#host.render(["toolbar", "context", "editToolbar", "mapbar"]);
            return true;
        } catch (error) {
            if (!current()) return false;
            console.error("FWMB | A settlement map could not be built:", error);
            platform.notify.error(platform.i18n.localize("FILRODENSWMB.UI.SettlementMapFailed"));
            this.mode = "open";
            this.#building = null;
            this.#drawStage();
            return false;
        }
    }

    // ------------------------------------------------------------------ keeping it in step (2b)

    /**
     * Whether the open settlement map is this world's to change: not a held world's parent's, and
     * its world not open view only (WL).
     */
    get canChange() {
        return !!this.#record && !this.#owner && this.mode !== "choosing" && !this.#viewOnly();
    }

    /** Whether the world is open view only here (WL): its settlement maps are explored, never changed. */
    #viewOnly() {
        return this.#host.viewOnly?.() === true;
    }

    /** The world that owns the open settlement map when it is not this one's, or null. */
    get owner() {
        return this.#owner;
    }

    /**
     * Generate again (step 2b): the open settlement map made again from its pin as it is now,
     * with its kept seed, one undo step on the settlement map; rebuilt and drawn.
     */
    async generateAgain() {
        if (!this.canChange || this.exportWait()) return false;
        const next = this.#inputNow(this.#record);
        if (!next) return false;
        this.#step(this.#record.id, next);
        await this.#showRecord(this.#record);
        return true;
    }

    /**
     * Generate all's part (step 2b): each settlement map given is made again from its pin as it is
     * now, without being opened (nothing generated is stored, so nothing is built), each one undo
     * step on its settlement map; the open one is drawn again.
     * @param {string[]} ids
     * @returns {Promise<number>} How many were made again.
     */
    async regenerate(ids) {
        let made = 0;
        for (const id of ids) {
            // A map whose export is drawing waits for it (step 5)
            if (this.exportWait(id)) continue;
            const record = this.#pending.get(id) ?? (await this.#load(id));
            const next = record ? this.#inputNow(record) : null;
            if (!next) continue;
            if (this.#record?.id === id && !this.#owner) this.#record = record;
            this.#step(id, next, record);
            made++;
        }
        if (made && this.#record && !this.#owner && ids.includes(this.#record.id) && this.mode === "open") await this.#showRecord(this.#pending.get(this.#record.id));
        return made;
    }

    /** Whether the open settlement map has a step to undo, or to redo. */
    get canUndo() {
        return this.canChange && !this.exportWait() && (this.#history.get(this.#record.id)?.undo.length ?? 0) > 0;
    }

    get canRedo() {
        return this.canChange && !this.exportWait() && (this.#history.get(this.#record.id)?.redo.length ?? 0) > 0;
    }

    /** How many steps the open settlement map can undo and redo, and why they wait (its export drawing), or null. */
    get historyCounts() {
        const history = this.canChange ? this.#history.get(this.#record.id) : null;
        const counts = { undo: history?.undo.length ?? 0, redo: history?.redo.length ?? 0 };
        const waiting = this.canChange ? this.exportWait() : null;
        return waiting ? { ...counts, waiting } : counts;
    }

    /** Undo on the open settlement map: its input before its last Generate again, drawn again. */
    async undo() {
        return this.#travel("undo", "redo");
    }

    /** Redo on the open settlement map. */
    async redo() {
        return this.#travel("redo", "undo");
    }

    async #travel(from, to) {
        if (!this.canChange || this.exportWait()) return false;
        const id = this.#record.id;
        const history = this.#history.get(id);
        const entry = history?.[from].pop();
        if (!entry) return false;
        history[to].push(this.#snapshot(this.#record));
        const sameInput = JSON.stringify(entry.input) === JSON.stringify(this.#record.input);
        this.#apply(id, entry, this.#record);
        // A look undone or redone: only the pictures are drawn again (the view stays where it is)
        if (sameInput && this.#shown) {
            await this.#showLook();
            this.#host.render(["context", "editToolbar"]);
            return true;
        }
        // Its state against the pin: worked out again for it alone
        this.#states?.delete(id);
        const state = OutOfDate.of({ source: this.#host.source(), cards: [SettlementRecord.card(this.#record)], pinFor: (pinId) => this.#host.pin(pinId), inputFrom: this.#inputFrom }).get(id);
        if (state) this.#states?.set(id, state);
        await this.#showRecord(this.#record);
        return true;
    }

    /**
     * Delete settlement map… (step 2b; board L1b): after its confirmation, the settlement map goes
     * from the world at the next Save world; the pin stays. Its seed is named, to make it again.
     * @param {string} id
     * @returns {Promise<boolean>} Whether it was deleted.
     */
    async deleteMap(id) {
        const { i18n } = platform;
        const card = this.cards().find((each) => each.id === id);
        if (!card) return false;
        const record = this.#pending.get(id) ?? (await this.#load(id));
        const pin = this.#host.pinOf(card.pinId);
        const name = pin?.name || card.name || i18n.localize("FILRODENSWMB.UI.UnnamedPin");
        const world = this.#host.worldName?.() || i18n.localize("FILRODENSWMB.UI.UnnamedWorld");
        const lines = [i18n.format(pin ? "FILRODENSWMB.UI.DeleteSettlementMapBody" : "FILRODENSWMB.UI.DeleteSettlementMapBodyNoPin", { name, world })];
        if (record?.seed) lines.push(i18n.format("FILRODENSWMB.UI.DeleteSettlementMapSeed", { seed: record.seed }));
        const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
        const confirmed = await platform.dialogs.confirm({
            title: i18n.format("FILRODENSWMB.UI.DeleteSettlementMapTitle", { name }),
            content: `<p>${escape(lines[0])}</p>${lines[1] ? `<p class="fwmb-hint">${escape(lines[1])}</p>` : ""}`,
            confirmLabel: i18n.localize("FILRODENSWMB.UI.Delete"),
            confirmIcon: "fwmb-icon fwmb-icon--delete",
            destructive: true,
        });
        if (!confirmed) return false;
        const saved = WorldRecord.settlementCards(this.#host.world()).some((each) => each.id === id);
        this.#pending.delete(id);
        if (saved) this.#deleted.add(id);
        this.#history.delete(id);
        this.#states?.delete(id);
        const built = this.#built.get(id);
        if (built) {
            this.#built.delete(id);
            this.#letGo(built.versionId);
        }
        if (this.#record?.id === id) this.#host.leave();
        this.#host.changed();
        return true;
    }

    /** Opens the open settlement map in the world that owns it (a held world's parent). */
    openInOwner() {
        if (!this.#owner || !this.#record) return null;
        return this.#host.openOwner?.(this.#owner, this.#record.id);
    }

    /** The input a record's pin gives now, with its kept seed and its own walls, or null when its pin has gone. */
    #inputNow(record) {
        const source = this.#host.source();
        const pin = this.#host.pin(record.pinId);
        if (!source || !pin) return null;
        try {
            return withWalls(this.#inputFrom(source, pin, { seed: record.seed }), record.settings?.walls);
        } catch (error) {
            console.warn(`FWMB | Settlement map ${record.id} could not be made again from its pin:`, error);
            return null;
        }
    }

    #snapshot(record) {
        return { input: record.input, parts: record.parts, name: record.name, settings: record.settings, look: record.look, keptAt: record.keptAt };
    }

    /**
     * One undo step: the record's input replaced (it joins the world's changes), and its settings,
     * look or keeping time where given (step 4); its state made fresh where the input came from its pin.
     */
    #step(id, input, record = this.#record, { settings = record.settings, look = record.look, keptAt = record.keptAt, fresh = true } = {}) {
        const history = this.#history.get(id) ?? { undo: [], redo: [] };
        history.undo.push(this.#snapshot(record));
        history.redo = [];
        this.#history.set(id, history);
        const pin = this.#host.pinOf(record.pinId);
        this.#apply(id, { input: structuredClone(input), parts: SettlementRecord.parts(input), name: pin?.name || record.name, settings, look, keptAt }, record);
        if (fresh) this.#fresh(id);
    }

    #apply(id, { input, parts, name, settings = record.settings, look = record.look, keptAt = record.keptAt }, record) {
        const next = { ...record, input, parts, name, settings, look, keptAt, seed: input.seed ?? record.seed };
        this.#pending.set(id, next);
        if (this.#record?.id === id && !this.#owner) this.#record = next;
        this.#host.changed();
    }

    /** Leaves the settlement map (or the choice): the choice's versions released, nothing kept. */
    close() {
        this.#leaveCurrent();
        this.mode = null;
        this.#pinId = null;
        this.#record = null;
        this.#owner = null;
        this.#stage?.remove();
        this.#stage = null;
    }

    /** The studio closes, or another world opens: every worker ended. */
    destroy() {
        this.close();
        this.#watchTheme(false);
        this.#workers?.close();
        this.#workers = null;
        this.#built.clear();
        this.forgetChanges();
        if (this.#thumbUrl) URL.revokeObjectURL(this.#thumbUrl);
        this.#thumbUrl = null;
    }

    /**
     * The settlement's element in the map region (the host's `.fwmb-map-preview`): the cards while
     * choosing, the canvas once open.
     * @param {HTMLElement} container
     */
    mountCanvas(container) {
        this.#container = container;
        this.#drawStage();
    }

    #container = null;

    // ------------------------------------------------------------------ the host's regions

    /** The rail: its stages and tools from the studio's definition; those not built yet drawn off. */
    railContext() {
        const { i18n } = platform;
        // View only (WL): Explore's tool and Export, never Map setup
        const viewOnly = this.#viewOnly();
        const stages = this.#definition.railStages("settlement").map((stage) => ({
            ...stage,
            tools: stage.tools.filter((tool) => !viewOnly || tool.id !== "mapSetup").map((tool) => ({
                ...tool,
                disabled: !!tool.later || (this.mode === "choosing" && tool.id !== "mapSetup"),
                tooltip: tool.later ? i18n.format("FILRODENSWMB.UI.NotBuiltYet", { name: i18n.localize(tool.label) }) : i18n.localize(tool.label),
            })),
        }));
        return { railWorld: false, railStages: stages.filter((stage) => stage.tools.length), activeTool: this.tool };
    }

    /** The panel's frame (context.hbs) and the Local studio's own context for its templates. */
    panelContext() {
        const { i18n } = platform;
        const entry = this.#definition.tool(this.tool);
        const stage = entry?.stage ? this.#definition.stage(entry.stage) : null;
        const tools = this.#definition.stageTools(this.tool, "settlement").map((each) => each.id);
        const meta = stage ? (stage.numbered ? i18n.format("FILRODENSWMB.UI.PanelStep", { stage: i18n.localize(stage.label), step: tools.indexOf(this.tool) + 1, count: tools.length }) : i18n.localize(stage.label)) : "";
        const choosing = this.mode === "choosing";
        const name = this.#settlementName();
        return {
            panel: {
                title: choosing ? i18n.localize(this.#another ? "FILRODENSWMB.UI.ChooseAnotherVersionTitle" : "FILRODENSWMB.UI.MakeSettlementMap") : i18n.localize(entry?.label ?? ""),
                lede: choosing ? i18n.format(this.#another ? "FILRODENSWMB.UI.LedeChooseAnotherVersion" : "FILRODENSWMB.UI.LedeMakeSettlementMap", { name }) : entry?.lede ? i18n.format(entry.lede, { name }) : null,
                notice: this.#notice(),
                tag: entry?.mode === "explore" ? i18n.localize("FILRODENSWMB.UI.ExploreReadOnly") : null,
                meta,
                state: null,
                next: null,
            },
            toolPartial: `${TEMPLATES}tools-${this.tool}.hbs`,
            // Keep and Cancel while choosing; Generate again once open (step 4, board L3)
            panelFootPartial: choosing || (this.tool === "mapSetup" && this.mode === "open" && this.#record) ? `${TEMPLATES}tools-mapSetup-foot.hbs` : null,
            panelHeadPartial: null,
            local: { ...this.#mapSetupContext(), households: this.tool === "households" ? this.#householdsContext() : null, export: { off: this.exportOff } },
        };
    }

    /**
     * Households and supply's panel (board L6): the figures of the version shown, worked out once;
     * while its households are still being worked out, a line saying so.
     */
    #householdsContext() {
        const shown = this.#shown;
        if (!shown?.kept) return { working: true };
        if (!shown.panel) {
            const { i18n } = platform;
            const t = { lang: i18n.lang, localize: (key) => i18n.localize(key), format: (key, data) => i18n.format(key, data) };
            const input = this.#record?.input ?? this.#input();
            const roofs = this.#roofsOf(shown);
            shown.panel = panelOf(t, figuresOf(shown.kept.households, { supply: input?.supply ?? null, land: shown.kept.land }), { colours: Object.fromEntries(Object.entries(roofs).map(([name, style]) => [name, style.roof])) });
        }
        return shown.panel;
    }

    /** Each culture's roof for the Culture view (and the panel's and legend's colours): the world's colours, kept with the version. */
    #roofsOf(shown) {
        shown.roofs ??= cultureRoofs(shown.kept?.households, this.#host.cultureColours?.() ?? {});
        return shown.roofs;
    }

    /**
     * The action notice at the head of the settlement map's panel (the shell's rule, decision
     * record Q6; board L3b), in any of its tools: Out of date naming what changed, with Generate
     * again; its pin gone, with Delete settlement map…; or a held world's parent's map, read only,
     * with Open in <parent world>.
     */
    #notice() {
        const { i18n } = platform;
        if (this.mode === "choosing" || !this.#record) return null;
        // A world open view only (WL): its notice, in every panel
        const viewOnly = this.#host.viewOnlyNotice?.();
        if (viewOnly) return viewOnly;
        const name = this.#settlementName();
        const local = (action, label, icon) => ({ action: "local", data: { local: action }, label, icon });
        if (this.#owner) {
            const lines = [i18n.format("FILRODENSWMB.UI.SettlementHeldLine", { world: this.#host.worldName?.() ?? "", owner: this.#owner.name })];
            if (this.#owner.stale?.length) lines.push(i18n.format("FILRODENSWMB.UI.SettlementHeldStale", { owner: this.#owner.name, changes: this.describe({ changed: this.#owner.stale, people: null }) }));
            return { title: i18n.format("FILRODENSWMB.UI.SettlementHeldTitle", { owner: this.#owner.name }), icon: "lock", lines, actions: [local("openInOwner", i18n.format("FILRODENSWMB.UI.OpenInWorld", { world: this.#owner.name }), "open-in-new")] };
        }
        const state = this.stateOf(this.#record.id, { compute: true });
        if (state?.pinGone) {
            return { title: i18n.localize("FILRODENSWMB.UI.MarkPinGone"), icon: "warning-mark", lines: [i18n.format("FILRODENSWMB.UI.SettlementPinGoneLine", { name, map: this.#host.mapName() })], actions: [local("deleteMap", i18n.localize("FILRODENSWMB.UI.DeleteSettlementMapEllipsis"), "delete")] };
        }
        if (state?.changed.length) {
            const again = { ...local("generateAgain", i18n.localize("FILRODENSWMB.UI.GenerateAgain"), "run"), off: this.exportWait() };
            return { title: i18n.localize("FILRODENSWMB.UI.MarkOutOfDate"), icon: "warning-mark", lines: [i18n.format("FILRODENSWMB.UI.SettlementStaleLine", { name, changes: this.describe(state) }), i18n.localize("FILRODENSWMB.UI.SettlementStaleKeeps")], actions: [again] };
        }
        return null;
    }

    /**
     * What changed, in words: "its population (2,900 to 3,400) and a road".
     * @param {{changed: string[], people?: {was: number, now: number}|null}} state
     */
    describe(state) {
        const { i18n } = platform;
        const lang = i18n.lang;
        const phrases = (state?.changed ?? []).map((part) =>
            part === "people" && state.people
                ? i18n.format("FILRODENSWMB.UI.SettlementChangedPeople", { was: state.people.was.toLocaleString(lang), now: state.people.now.toLocaleString(lang) })
                : i18n.localize(`FILRODENSWMB.UI.SettlementChanged.${part}`),
        );
        try {
            return new Intl.ListFormat(lang, { style: "long", type: "conjunction" }).format(phrases);
        } catch {
            return phrases.join(", ");
        }
    }

    /**
     * The settlement bar (board L3): the way back to the pin and what it is. The view is the
     * canvas's own controls' (Ken, 2026-11-24: the bar's Town view, Hinterland view and Reset view
     * only repeated them); Export offers the framings (step 5).
     */
    barContext() {
        const { i18n } = platform;
        const pin = this.#host.pinOf(this.#pinId);
        const name = this.#settlementName();
        const input = this.#input();
        return {
            back: i18n.format("FILRODENSWMB.UI.SettlementBackToPin", { name: pin?.name ?? name }),
            name,
            what: input ? this.#kindLine(input) : "",
            from: i18n.format("FILRODENSWMB.UI.SettlementMadeFrom", { map: this.#host.mapName() }),
            pinGone: !pin,
        };
    }

    /** The line over the canvas (the edit toolbar's place): what is shown, its size and detail. */
    toolbarContext() {
        const { i18n } = platform;
        if (this.mode === "choosing" && !this.#alone) {
            return { lead: i18n.localize("FILRODENSWMB.UI.ChooseVersionLine"), hint: i18n.localize("FILRODENSWMB.UI.ChooseVersionHint") };
        }
        const view = this.#canvas?.view;
        if (!view) return { lead: i18n.localize("FILRODENSWMB.UI.SettlementDrawing"), hint: "" };
        const width = view.rect[2] - view.rect[0];
        const height = view.rect[3] - view.rect[1];
        const size = (m) => (m >= 1000 ? i18n.format("FILRODENSWMB.UI.SettlementKm", { km: (m / 1000).toLocaleString(i18n.lang, { maximumFractionDigits: 1 }) }) : i18n.format("FILRODENSWMB.UI.SettlementM", { m: Math.round(m).toLocaleString(i18n.lang) }));
        const shown = i18n.format("FILRODENSWMB.UI.SettlementSize", { width: size(width), height: size(height) });
        const ratio = globalThis.devicePixelRatio || 1;
        const detail = Math.max(FILRODENSWMB.LOCAL.CANVAS.FINEST_M, view.mPerPx / ratio);
        // Households and supply (board L6): how to read a household, and the view shown
        const pointing = this.tool === "households" && !!this.#people;
        const viewName = this.#view ? i18n.format("FILRODENSWMB.UI.HouseholdsViewShown", { view: i18n.localize(`FILRODENSWMB.UI.SettlementView.${this.#view}`) }) : null;
        return {
            lead: pointing ? i18n.localize("FILRODENSWMB.UI.HouseholdsPoint") : this.#framing === "town" ? i18n.format("FILRODENSWMB.UI.SettlementViewingTown", { size: shown }) : i18n.format("FILRODENSWMB.UI.SettlementViewing", { size: shown }),
            hint: viewName ?? i18n.format("FILRODENSWMB.UI.SettlementDetail", { m: detail.toLocaleString(i18n.lang, { maximumFractionDigits: 1 }) }),
            back: this.#alone ? i18n.localize("FILRODENSWMB.UI.BackToVersions") : null,
        };
    }

    // ------------------------------------------------------------------ actions

    /** Changes the rail's tool; the households card opens only in Households and supply. */
    changeTool(tool) {
        if (!this.#definition.offers(tool, "settlement") || this.#definition.tool(tool)?.later) return false;
        if (tool === "mapSetup" && this.#viewOnly()) return false;
        this.tool = tool;
        if (this.#people) this.#people.enabled = tool === "households";
        this.#host.render(["toolbar", "context", "editToolbar"]);
        return true;
    }

    /** The household view shown, or null. */
    get view() {
        return this.#view;
    }

    /**
     * Shows a household view on the canvas ("none" for none): each house in its household's
     * colour, drawn in the worker as every tile is; kept for the session.
     * @param {string} id - One of Styles.js HOUSEHOLD_VIEWS, or "none".
     */
    async setView(id) {
        const view = id === "none" || !id ? null : id;
        if (view && !this.#shown?.kept) return false;
        if (view === this.#view) return false;
        this.#view = view;
        this.#people?.showLegend(view);
        this.#syncViews();
        this.#host.render(["editToolbar"]);
        await this.#canvas?.setVariant(this.#variant());
        return true;
    }

    // ------------------------------------------------------------------ Export (step 5)

    /** The settlement map whose export is drawing (its id), or null. */
    get exporting() {
        return this.#export?.id ?? null;
    }

    /**
     * Why a change to a settlement map waits, or null (step 5): its export is drawing. Generate
     * again, Choose another version…, Walls, Look, Undo and Redo wait; looking round the map,
     * Households and supply and the world's other maps don't.
     * @param {string} [id] - The settlement map's id (the open one's by default).
     */
    exportWait(id = this.#record?.id) {
        if (!id || !this.#export || this.#export.id !== id) return null;
        return platform.i18n.format("FILRODENSWMB.UI.ExportWaiting", { name: this.#export.name });
    }

    /** Why the open settlement map can't be exported now (an export drawing, or the map not drawn), or null. */
    get exportOff() {
        const { i18n } = platform;
        if (this.#export) return i18n.format("FILRODENSWMB.UI.ExportWaiting", { name: this.#export.name });
        if (this.mode !== "open" || !this.#shown?.result || !this.#canvas) return i18n.localize("FILRODENSWMB.UI.SettlementExportWhenDrawn");
        return null;
    }

    /**
     * Export (step 5; boards X3a, X3b, X2a, X2b): the kernel's export dialogue given the settlement
     * map's parts (see LocalExport): **Map only** or **Report** (the map part with the parent map
     * inset and the information block, see Report.js), and the **Legend** while a household
     * view is on. The image is drawn from the version shown, in its worker, in the look and
     * household view shown now; the version is held until the drawing ends.
     */
    async export() {
        if (this.exportOff || this.#exportOpen) return false;
        const { i18n } = platform;
        const shown = this.#shown;
        const id = this.#record?.id ?? null;
        const name = this.#settlementName();
        const frame = shown.result.frame;
        const theme = this.#view;
        const lookKey = this.#lookKey();
        const style = this.#styleFor(lookKey);
        const cultures = theme === "culture" ? this.#roofsOf(shown) : {};
        const town = this.#labelTown(shown);
        const tile = (view) => this.#workersNow().tile(shown.versionId, view, { style, layers: PICTURE_LAYERS, theme, cultures });
        const { EXPORT } = FILRODENSWMB.LOCAL;
        const look = styleOf(style);
        // The legend of the household view shown (step 5b), and the report's block, once the households are worked out
        const legend = theme && shown.kept ? legendOf(this.#words(), theme, shown.kept.households, Object.fromEntries(Object.entries(this.#roofsOf(shown)).map(([culture, roof]) => [culture, roof.roof]))) : null;
        const others = legend ? Report.legendColumns(legend).more : 0;
        const othersText = others ? i18n.format("FILRODENSWMB.UI.LegendOthers", { count: others.toLocaleString(i18n.lang) }) : "";
        const rows = shown.kept ? this.#reportRows(shown, look) : null;
        const blockHeight = rows ? Report.blockHeight(rows) : 0;
        const record = this.#record;
        const drawMap = (area, scale, { onTile, signal, options }) =>
            LocalExport.draw({
                area,
                scale,
                frame,
                tile,
                onTile,
                signal,
                labels: (ctx, view) => {
                    drawTown(ctx, town, view, look, { layers: ["labels"], words: this.#mapWords(town) });
                    if (legend && options?.legend) Report.drawLegend(ctx, legend, look, othersText);
                },
            });
        this.#exportOpen = true;
        try {
            return await ExportDialog.open({
                kind: "png",
                title: i18n.format("FILRODENSWMB.UI.ExportNamed", { name }),
                name,
                map: LocalExport.mapOf(frame),
                view: null,
                smallestLabelPx: null,
                kmPerPx: EXPORT.M_PER_PX / 1000,
                unit: "km",
                rasterPx: null,
                ceiling: LocalExport.ceiling(),
                tileLimit: EXPORT.TILE_PX,
                presets: LocalExport.presets(frame, { town: shown.result.townView.rect, screen: this.#canvas?.view.rect ?? null }),
                stops: LocalExport.stops(),
                scaleName: (scale) => LocalExport.scaleName(scale),
                measure: LocalExport.measure(),
                recommended: { scale: EXPORT.RECOMMENDED, reason: i18n.localize("FILRODENSWMB.UI.SettlementExportReason") },
                scaleNote: i18n.format("FILRODENSWMB.UI.SettlementExportNote", { m: FILRODENSWMB.LOCAL.CANVAS.FINEST_M.toLocaleString(i18n.lang) }),
                kinds: [
                    { id: "map", label: i18n.localize("FILRODENSWMB.UI.ExportMapOnly"), action: i18n.localize("FILRODENSWMB.UI.ExportPNG"), settings: { preset: EXPORT.SETTINGS.PRESET, aspect: EXPORT.SETTINGS.ASPECT } },
                    {
                        id: "report",
                        label: i18n.localize("FILRODENSWMB.UI.ExportReport"),
                        action: i18n.localize("FILRODENSWMB.UI.ExportReportAction"),
                        settings: { preset: EXPORT.SETTINGS.PRESET_REPORT, aspect: EXPORT.SETTINGS.ASPECT_REPORT },
                        off: rows ? null : i18n.localize("FILRODENSWMB.UI.ExportReportWaiting"),
                        sheet: (part) => Report.layout(part, blockHeight),
                    },
                ],
                kindSetting: EXPORT.SETTINGS.WHAT,
                options: legend ? [{ id: "legend", label: i18n.localize("FILRODENSWMB.UI.ExportLegend"), hint: i18n.format("FILRODENSWMB.UI.ExportLegendHint", { view: legend.title }), setting: EXPORT.SETTINGS.LEGEND }] : [],
                fileName: ({ preset, scale, kind }) => LocalExport.fileName({ name, preset, scale, kind }),
                // The whole frame, at the preview's size, as the version cards are drawn
                drawPreview: async (side) => {
                    const mPerPx = Math.max(frame.width, frame.height) / side;
                    const widthPx = Math.max(1, Math.round(frame.width / mPerPx));
                    const heightPx = Math.max(1, Math.round(frame.height / mPerPx));
                    const rect = [-frame.width / 2, -frame.height / 2, frame.width / 2, frame.height / 2];
                    return LocalExport.canvasOf(await tile({ rect, mPerPx, widthPx, heightPx }));
                },
                samples: async (area, scale, choice) => {
                    const { views, pixels } = LocalExport.samples(area, scale, frame);
                    const tiles = [];
                    for (const view of views) tiles.push(LocalExport.canvasOf(await tile(view)));
                    // A report's pixels are its whole sheet's
                    if (choice?.kind !== "report") return { tiles, pixels };
                    const part = LocalExport.views(area, scale, frame);
                    const layout = Report.layout({ width: part.width, height: part.height }, blockHeight);
                    return { tiles, pixels: layout.width * layout.height };
                },
                draw: async (area, scale, choice) => {
                    const map = await drawMap(area, scale, choice);
                    if (!map || choice.kind !== "report" || !rows) return map;
                    return this.#drawReport({ map, rows, blockHeight, look, record, input: shown.input ?? this.#record?.input ?? this.#input(), frame, signal: choice.signal });
                },
                hold: (on) => this.#holdForExport(on ? { id, name, versionId: shown.versionId } : null),
            });
        } finally {
            this.#exportOpen = false;
        }
    }

    /** The words' functions the Households helpers take. */
    /**
     * The words the renderer draws on the map (its title's line under the name, the scale bar's
     * length, the north arrow's letter), in the module's language: the line as the report's
     * ("Large town of 7,987 people"), by the settlement's tier.
     */
    #mapWords(town) {
        const { i18n } = platform;
        const input = this.#record?.input ?? town.input;
        const number = (value) => value.toLocaleString(i18n.lang);
        return {
            sub: i18n.format("FILRODENSWMB.UI.ReportSub", { kind: tierName(input.tier, { start: true }), people: number(input.population ?? town.input.population ?? 0) }),
            length: (metres) => (metres >= 1000 ? i18n.format("FILRODENSWMB.UI.LengthKm", { value: number(metres / 1000) }) : i18n.format("FILRODENSWMB.UI.LengthM", { value: number(metres) })),
            north: i18n.localize("FILRODENSWMB.UI.North"),
        };
    }

    #words() {
        const { i18n } = platform;
        return { lang: i18n.lang, localize: (key) => i18n.localize(key), format: (key, data) => i18n.format(key, data) };
    }

    /** The report's information block (board X3b): its rows, wrapped in the look's face. */
    #reportRows(shown, look) {
        const { i18n } = platform;
        const input = this.#record?.input ?? this.#input();
        const panel = this.#householdsContext();
        if (!input || panel?.working) return null;
        const kept = this.#record?.keptAt ? new Date(this.#record.keptAt).toLocaleDateString(i18n.lang, { day: "numeric", month: "short", year: "numeric" }) : null;
        const seed = this.#record?.seed ?? input.seed ?? "";
        return Report.blockRows(
            {
                heading: this.#settlementName(),
                sub: i18n.format("FILRODENSWMB.UI.ReportSub", { kind: tierName(input.tier, { start: true }), people: (input.population ?? 0).toLocaleString(i18n.lang) }),
                panel,
                titles: { totals: i18n.localize("FILRODENSWMB.UI.SectionHouseholdsTotals"), cultures: i18n.localize("FILRODENSWMB.UI.SectionHouseholdsCultures"), trades: i18n.localize("FILRODENSWMB.UI.SectionHouseholdsTrades"), supply: i18n.localize("FILRODENSWMB.UI.SectionHouseholdsSupply") },
                standIn: panel.supply?.standIn ? i18n.localize("FILRODENSWMB.UI.SettlementStandInTitle") : null,
                foot: kept ? i18n.format("FILRODENSWMB.UI.ReportFoot", { seed, date: kept }) : i18n.format("FILRODENSWMB.UI.ReportFootSeed", { seed }),
            },
            look.font,
            measurer(),
        );
    }

    /**
     * The report's sheet: the map part, the parent map inset (the World studio's picture of the
     * Surface map round the settlement, with its supply drawn over it) and the information block.
     * On a held world's parent's map the supply's ways are in the parent's pixels, so the inset
     * shows the frame's place without them, saying where they are.
     */
    async #drawReport({ map, rows, blockHeight, look, record, input, frame, signal }) {
        const { i18n } = platform;
        const layout = Report.layout({ width: map.width, height: map.height }, blockHeight);
        const { REPORT } = FILRODENSWMB.LOCAL.EXPORT;
        const pin = record ? this.#host.pinOf(record.pinId) : null;
        const kmPerPx = this.#host.source()?.map?.kmPerPx ?? null;
        const held = !!this.#owner;
        const supply = input?.supply ?? null;
        let inset = { picture: null, area: null, scale: 1 };
        if (pin && kmPerPx > 0) {
            const framePx = { width: frame.width / 1000 / kmPerPx, height: frame.height / 1000 / kmPerPx };
            const ways = held ? [] : (supply?.fromPlaces ?? []).filter((flow) => flow.way?.length > 1);
            const cells = held ? [] : (supply?.countryCells ?? []);
            const out = held || !(supply?.out?.way?.length > 1) ? null : supply.out;
            const points = [...cells.map((cell) => [cell.x, cell.y]), ...ways.flatMap((flow) => flow.way), ...(out?.way ?? [])];
            const box = Report.insetBox({ x: pin.x, y: pin.y }, framePx, points);
            // Drawn at the column's size, so it stays sharp beside a great city's map part
            const density = layout.factor ?? 1;
            const drawn = (await this.#host.inset?.(box, layout.inset.width, layout.inset.height)) ?? null;
            if (signal?.aborted) return null;
            const scale = drawn?.scale ? drawn.scale / density : Math.min(REPORT.SIDE_PX / box.width, REPORT.INSET_PX / box.height);
            inset = { picture: drawn?.picture ?? null, density, area: drawn?.box ?? box, scale, at: { x: pin.x, y: pin.y }, frame: framePx, cells, ways, out };
        }
        const words = { foodIn: i18n.localize("FILRODENSWMB.UI.ReportFoodIn"), soldOn: i18n.localize("FILRODENSWMB.UI.ReportSoldOn"), note: held && this.#owner ? i18n.format("FILRODENSWMB.UI.ReportSupplyElsewhere", { world: this.#owner.name }) : null };
        const sheet = Object.assign(globalThis.document.createElement("canvas"), { width: layout.width, height: layout.height });
        Report.drawSheet(sheet.getContext("2d"), layout, { map, inset: (ctx, box) => Report.drawInset(ctx, box, inset, look, words), block: (ctx, box) => Report.drawBlock(ctx, rows, box, look) }, look);
        return sheet;
    }

    /** While an export draws: the map's changes wait (see exportWait); after, any version let go meanwhile is released. */
    #holdForExport(held) {
        this.#export = held;
        if (!held && this.#releaseLater.size) {
            const inUse = new Set([...this.#built.values()].map((entry) => entry.versionId));
            const gone = [...this.#releaseLater].filter((versionId) => !inUse.has(versionId));
            this.#releaseLater.clear();
            if (gone.length && this.#workers) this.#workers.release(gone).catch(() => {});
        }
        this.#host.render(["context", "editToolbar"]);
    }

    // ------------------------------------------------------------------ Map setup (step 4)

    /** The open map's Walls: "auto", "on" or "off". */
    get walls() {
        return this.#record?.settings?.walls ?? "auto";
    }

    /** The open map's look: "atlas" or "theme". */
    get look() {
        return this.#record?.look ?? "atlas";
    }

    /**
     * Walls (board L3): Automatic, On or Off. The map is built again from its own input with its
     * walls forced (or the engine's rule), keeping its seed, as one undo step; a parent's changes
     * still come only through Generate again.
     */
    async setWalls(value) {
        if (!this.canChange || this.exportWait() || !["auto", "on", "off"].includes(value) || value === this.walls) return false;
        const record = this.#record;
        this.#step(record.id, withWalls(record.input, value), record, { settings: { ...record.settings, walls: value }, fresh: false });
        await this.#showRecord(this.#record);
        return true;
    }

    /**
     * Look (board L3): the atlas or the studio's theme. Only the pictures are drawn again (the
     * map's tiles are kept by look), as one undo step.
     */
    async setLook(value) {
        if (!this.canChange || this.exportWait() || !["atlas", "theme"].includes(value) || value === this.look) return false;
        const record = this.#record;
        this.#step(record.id, record.input, record, { look: value, fresh: false });
        await this.#showLook();
        this.#host.render(["context", "editToolbar"]);
        return true;
    }

    /** The open map's pictures in its look as it is now: the canvas's, its labels', Map setup's picture; the theme watched. */
    async #showLook() {
        this.#watchTheme(this.look === "theme");
        this.#labels = null;
        await this.#canvas?.setVariant(this.#variant());
        this.#thumbnailOfShown();
    }

    /** The canvas's pictures' key: the household view and the look ("theme:" with the theme's colours). */
    #variant() {
        return `${this.#view ?? ""}|${this.#lookKey()}`;
    }

    #lookKey() {
        if (this.look !== "theme") return "atlas";
        const theme = this.#readTheme();
        return theme ? theme.key : "atlas";
    }

    /** A picture's style, from its key's look part (LocalTasks.styleOf's description). */
    #styleFor(lookKey) {
        if (!lookKey || lookKey === "atlas") return { name: "atlas" };
        const theme = this.#themes.get(lookKey) ?? this.#readTheme();
        return theme ? { name: "theme", tokens: theme.tokens, mode: theme.mode } : { name: "atlas" };
    }

    /** The look's style now (for the labels, the cards and Map setup's picture). */
    #lookStyle() {
        return this.#styleFor(this.#lookKey());
    }

    /**
     * The studio's theme as it stands on the settlement map's stage: the colours the theme style
     * reads, light or dark by its base surface, and a key naming them. Null with no stage.
     */
    #readTheme() {
        const element = this.#stage ?? this.#container;
        const view = element?.ownerDocument?.defaultView;
        if (!element || !view) return null;
        const computed = view.getComputedStyle(element);
        const tokens = {};
        for (const name of THEME_TOKENS) tokens[name] = computed.getPropertyValue(name).trim();
        if (!/^#[0-9a-f]{6}$/i.test(tokens["--fwmb-bg-base"] ?? "")) return null;
        const mode = luminance(tokens["--fwmb-bg-base"]) < 0.5 ? "dark" : "light";
        const key = `theme:${mode}:${THEME_TOKENS.map((name) => tokens[name]).join(",")}`;
        if (!this.#themes.has(key)) this.#themes.set(key, { key, tokens, mode });
        return this.#themes.get(key);
    }

    /**
     * While the map is in the theme look, a change of theme (Appearance's light or dark, gold or
     * blue; Foundry's own theme, or the system's while the theme is Automatic) draws it again in
     * the new colours (Ken, 2026-11-25).
     */
    #watchTheme(on) {
        if (!on) {
            this.#themeWatch?.stop();
            this.#themeWatch = null;
            return;
        }
        if (this.#themeWatch) return;
        const doc = (this.#stage ?? this.#container)?.ownerDocument;
        const view = doc?.defaultView;
        if (!doc || !view) return;
        let frame = null;
        const changed = () => {
            if (frame !== null) return;
            frame = view.requestAnimationFrame(() => {
                frame = null;
                if (this.look !== "theme" || !this.#canvas) return;
                const variant = this.#variant();
                if (variant === this.#canvas.variant) return;
                this.#labels = null;
                this.#canvas.setVariant(variant);
                this.#thumbnailOfShown();
            });
        };
        const observer = new view.MutationObserver(changed);
        const frameElement = (this.#stage ?? this.#container)?.closest?.("[data-fwmb-hue]");
        for (const element of new Set([doc.documentElement, doc.body, frameElement].filter(Boolean))) observer.observe(element, { attributes: true, attributeFilter: ["class", "data-fwmb-theme", "data-fwmb-hue"] });
        const media = view.matchMedia?.("(prefers-color-scheme: dark)");
        media?.addEventListener?.("change", changed);
        this.#themeWatch = {
            stop: () => {
                observer.disconnect();
                media?.removeEventListener?.("change", changed);
                if (frame !== null) view.cancelAnimationFrame(frame);
            },
        };
    }

    /**
     * Choose another version… (board L2b): the kept version as the Default, ready at once, beside
     * three new alternatives, each built from the map's own input (its walls too): keeping one
     * changes only the map's seed (Ken, 2026-11-25). Cancel goes back to the map as it was.
     */
    async chooseAnother() {
        if (!this.canChange || this.mode !== "open" || this.exportWait()) return false;
        const record = this.#record;
        const built = this.#built.get(record.id);
        const held = built && built.key === JSON.stringify(record.input) ? built : null;
        const style = this.#lookStyle();
        // The Default's card: the kept version's picture, drawn from the version its worker holds
        let thumbnail = null;
        if (held) {
            try {
                thumbnail = await this.#cardPicture(held, style);
            } catch (error) {
                console.warn("FWMB | The kept version's card could not be drawn:", error);
            }
        }
        const view = this.#view;
        this.#leaveCurrent();
        this.#view = view;
        this.#record = record;
        this.#another = { record };
        this.#pinId = record.pinId;
        this.mode = "choosing";
        this.tool = "mapSetup";
        const kept = record.keptAt ? new Date(record.keptAt).toLocaleDateString(platform.i18n.lang, { day: "numeric", month: "short" }) : null;
        this.#choice = new VersionChoice({
            workers: this.#workersNow(),
            inputFor: (seed) => ({ ...structuredClone(record.input), seed }),
            pinId: record.pinId,
            defaultSeed: record.seed,
            prebuilt: held ? { id: held.versionId, input: record.input, result: held.result, thumbnail, kept } : null,
            style,
            onChange: () => this.#choiceChanged(),
        });
        this.#drawStage();
        this.#tick();
        this.#host.render(["toolbar", "context", "editToolbar", "mapbar"]);
        return true;
    }

    /** A version's card picture: its town view at the card's size, in the look given. */
    async #cardPicture(built, style) {
        const { widthPx, heightPx } = FILRODENSWMB.LOCAL.THUMBNAIL;
        const view = built.result.townView;
        const mPerPx = Math.max(view.width / widthPx, view.height / heightPx);
        const cx = (view.rect[0] + view.rect[2]) / 2;
        const cy = (view.rect[1] + view.rect[3]) / 2;
        const rect = [cx - (widthPx * mPerPx) / 2, cy - (heightPx * mPerPx) / 2, cx + (widthPx * mPerPx) / 2, cy + (heightPx * mPerPx) / 2];
        return this.#workersNow().tile(built.versionId, { rect, mPerPx, widthPx, heightPx }, { style, layers: PICTURE_LAYERS });
    }

    /**
     * Keep <version> in Choose another version…: the Default with its seed unchanged goes back to
     * the map; another version's seed becomes the map's, as one undo step, its households worked
     * out in its worker.
     */
    async #keepAnother() {
        const slot = this.#choice?.chosen;
        if (!slot) return;
        const { record } = this.#another;
        const choice = this.#choice;
        this.#choice = null;
        this.#another = null;
        choice.keep();
        this.#alone = null;
        this.#canvas?.destroy();
        this.#canvas = null;
        if (slot.owned) {
            // The version kept already, still held: nothing changes
            await this.#showRecord(record);
            return;
        }
        // Another seed becomes the map's (one undo step); the kept seed drawn again changes nothing
        if (slot.seed !== record.seed) this.#step(record.id, slot.input, record, { keptAt: new Date().toISOString(), fresh: false });
        const next = this.#record;
        this.mode = "building";
        this.#building = { startedAt: performance.now(), population: next.input.population, keeping: true };
        this.#drawStage();
        this.#host.render(["context", "editToolbar"]);
        let kept = null;
        try {
            kept = await this.#workersNow().keep(slot.id);
        } catch (error) {
            console.error("FWMB | A settlement's households could not be worked out:", error);
        }
        if (this.#record !== next) return;
        this.#remember(next.id, { versionId: slot.id, key: JSON.stringify(next.input), result: slot.result, kept });
        await this.#showRecord(next);
    }

    /** Cancel in Choose another version…: back to the map as it was (its version still held). */
    async #cancelAnother() {
        const { record } = this.#another;
        this.#choice?.destroy();
        this.#choice = null;
        this.#another = null;
        this.#alone = null;
        this.#canvas?.destroy();
        this.#canvas = null;
        await this.#showRecord(record);
    }

    /**
     * The map controls' Thematic views (map.hbs, its settlementViews group): the view shown
     * checked and named on the button; the views off, with their note, until the households of
     * the version shown are in.
     */
    #syncViews() {
        const group = this.#container?.querySelector('[data-layer-group="settlementViews"]');
        if (!group) return;
        const { i18n } = platform;
        const ready = !!this.#shown?.kept;
        for (const row of group.querySelectorAll('[data-local="setView"]')) {
            const id = row.dataset.view;
            row.setAttribute("aria-checked", String((id === "none" ? null : id) === this.#view));
            if (id !== "none") row.setAttribute("aria-disabled", String(!ready));
        }
        group.querySelector("[data-settlement-views-note]")?.classList.toggle("fwmb-hidden", ready);
        const name = group.querySelector("[data-settlement-view-name]");
        if (name) name.textContent = i18n.localize(this.#view ? `FILRODENSWMB.UI.SettlementView.${this.#view}` : "FILRODENSWMB.UI.SettlementViews");
    }

    /**
     * An action from the Local studio's templates (data-action="local", data-local="…").
     * @param {string} name
     * @param {HTMLElement} target
     */
    async act(name, target) {
        switch (name) {
            case "pickVersion":
                this.#choice?.pick(Number(target.dataset.index));
                return;
            case "newAlternatives":
                this.#choice?.newAlternatives();
                this.#tick();
                return;
            case "keep":
                return this.#another ? this.#keepAnother() : this.#keep();
            case "cancel":
                return this.#another ? this.#cancelAnother() : this.#host.goToPin(this.#pinId);
            case "backToPin":
                return this.#host.goToPin(this.#pinId);
            case "backToVersions":
                return this.#backToVersions();
            case "generateAgain":
                return this.generateAgain();
            case "deleteMap":
                return this.#record ? this.deleteMap(this.#record.id) : undefined;
            case "openInOwner":
                return this.openInOwner();
            case "setView":
                return this.setView(target.dataset.view);
            case "setWalls":
                return this.setWalls(target.dataset.value);
            case "setLook":
                return this.setLook(target.dataset.value);
            case "chooseAnother":
                return this.chooseAnother();
            case "export":
                return this.export();
            default:
                return undefined;
        }
    }

    /** A field in the panel committed: the Default's seed. */
    field(event) {
        const field = event.target;
        if (field?.name !== "settlementSeed" || event.type !== "change" || !this.#choice) return false;
        if (this.#choice.setDefaultSeed(field.value)) this.#tick();
        return true;
    }

    zoomIn() {
        this.#canvas?.zoom(FILRODENSWMB.LOCAL.CANVAS.ZOOM_STEP);
    }

    zoomOut() {
        this.#canvas?.zoom(1 / FILRODENSWMB.LOCAL.CANVAS.ZOOM_STEP);
    }

    /** The canvas's own Reset view (and the 0 key): back to the town view. */
    resetView() {
        const result = this.#shown?.result;
        if (!result || !this.#canvas) return;
        this.#canvas.show(result.townView.rect);
        this.#framing = "town";
        this.#host.render(["editToolbar"]);
    }

    // ------------------------------------------------------------------ inside

    #workersNow() {
        this.#workers ??= new LocalWorkers();
        return this.#workers;
    }

    async #load(id, worldId = this.#host.world()?.id) {
        if (!worldId) return null;
        const raw = await platform.store.loadSettlementMap(worldId, id);
        return raw ? this.#shell?.registry?.get("local")?.rules?.check(raw) ?? raw : null;
    }

    /** Ends the choice (its versions released) and the canvas, before something else is shown. */
    #leaveCurrent() {
        this.#people?.destroy();
        this.#people = null;
        this.#view = null;
        this.#another = null;
        this.#watchTheme(false);
        this.#choice?.destroy();
        this.#choice = null;
        this.#alone = null;
        this.#canvas?.destroy();
        this.#canvas = null;
        this.#shown = null;
        this.#building = null;
        this.#framing = "town";
        if (this.#ticking !== null) cancelAnimationFrame(this.#ticking);
        this.#ticking = null;
        if (this.#lineFrame !== null) cancelAnimationFrame(this.#lineFrame);
        this.#lineFrame = null;
        this.#labels = null;
        if (this.#thumbUrl) URL.revokeObjectURL(this.#thumbUrl);
        this.#thumbUrl = null;
    }

    /** Keeps a built settlement map's version in its worker, dropping the oldest past KEEP_BUILT. */
    #remember(id, entry) {
        const old = this.#built.get(id);
        if (old && old.versionId !== entry.versionId) this.#letGo(old.versionId);
        this.#built.delete(id);
        this.#built.set(id, entry);
        while (this.#built.size > FILRODENSWMB.LOCAL.KEEP_BUILT) {
            const [oldest, gone] = this.#built.entries().next().value;
            this.#built.delete(oldest);
            this.#letGo(gone.versionId);
        }
    }

    /** A version dropped from its worker; one an export is drawing from is dropped when it ends (step 5). */
    #letGo(versionId) {
        if (this.#export?.versionId === versionId) {
            this.#releaseLater.add(versionId);
            return;
        }
        this.#workersNow().release([versionId]).catch(() => {});
    }

    /** Keep <version>: households worked out in its worker, the record made, the map opened. */
    async #keep() {
        const slot = this.#choice?.chosen;
        if (!slot) return;
        const choice = this.#choice;
        this.#choice = null;
        choice.keep();
        this.#alone = null;
        this.#canvas?.destroy();
        this.#canvas = null;
        const pin = this.#host.pinOf(this.#pinId);
        const existing = this.cardOfPin(this.#pinId);
        const record = SettlementRecord.create({
            id: existing?.id ?? platform.utils.randomID(),
            pinId: this.#pinId,
            sourceMapId: this.#host.surfaceMapId(),
            name: pin?.name || slot.input.name,
            input: slot.input,
        });
        this.#record = record;
        this.#pending.set(record.id, record);
        this.#history.delete(record.id);
        this.#fresh(record.id);
        this.mode = "building";
        this.#building = { startedAt: performance.now(), population: record.input.population, keeping: true };
        this.#drawStage();
        this.#host.changed();
        let kept = null;
        try {
            kept = await this.#workersNow().keep(slot.id);
        } catch (error) {
            console.error("FWMB | A settlement's households could not be worked out:", error);
        }
        if (this.#record !== record) return;
        this.#remember(record.id, { versionId: slot.id, key: JSON.stringify(record.input), result: slot.result, kept });
        this.#shown = this.#built.get(record.id);
        this.mode = "open";
        this.#building = null;
        this.#drawStage();
        await this.#showTown();
        this.#host.render(["toolbar", "context", "editToolbar", "mapbar", "worldbar"]);
    }

    /** A version opened alone from the choice (double-click), panned and zoomed on the canvas. */
    #openAlone(index) {
        const slot = this.#choice?.slots[index];
        if (slot?.state !== "ready") return;
        this.#choice.pick(index);
        this.#alone = slot;
        this.#shown = { versionId: slot.id, result: slot.result };
        this.#drawStage();
        this.#showTown();
        this.#host.render(["editToolbar", "mapbar", "context"]);
    }

    #backToVersions() {
        if (!this.#alone) return;
        this.#alone = null;
        this.#shown = null;
        this.#canvas?.destroy();
        this.#canvas = null;
        this.#framing = "town";
        this.#drawStage();
        this.#host.render(["editToolbar", "mapbar"]);
    }

    /** The canvas over the shown version: its coarse picture, then the town view. */
    async #showTown() {
        const shown = this.#shown;
        const surface = this.#stage?.querySelector(".fwmb-settlement-surface");
        if (!shown?.result || !surface) return;
        this.#canvas?.destroy();
        this.#people?.destroy();
        this.#people = null;
        const { result, versionId } = shown;
        // A household view needs the version's households: none on a version opened alone from the choice
        if (!shown.kept) this.#view = null;
        this.#canvas = new SettlementCanvas(surface, {
            frame: result.frame,
            label: platform.i18n.format("FILRODENSWMB.UI.SettlementCanvasLabel", { name: this.#settlementName() }),
            variant: this.#variant(),
            // A picture's key holds its household view and its look (see #variant)
            draw: (view, variant) => {
                const [household, lookKey] = String(variant ?? "|atlas").split("|");
                return this.#workersNow().tile(versionId, view, { style: this.#styleFor(lookKey), layers: PICTURE_LAYERS, theme: household || null, cultures: household === "culture" ? this.#roofsOf(shown) : {} });
            },
            // The map's own title, scale bar and north arrow, once over the tiles: the renderer's
            // labels layer, from what the build said of the settlement (the pin's name as it is now)
            decorate: (ctx, view) => this.#decorate(ctx, view, shown),
            // The outline of the house whose household is shown, and pointing at houses (step 3)
            overlay: (ctx, toCanvas) => this.#people?.drawOutline(ctx, toCanvas),
            onPoint: (point) => this.#people?.point(point),
            onTap: (point) => this.#people?.tap(point),
            onView: ({ moved }) => {
                if (moved) this.#framing = null;
                this.#people?.moved(moved);
                this.#lineLater();
            },
        });
        if (shown.kept) {
            this.#people = new HouseholdsView(surface, {
                canvas: () => this.#canvas,
                kept: shown.kept,
                place: { name: this.#settlementName(), kind: result.kind, walled: !!result.label?.wall, cave: false },
                colours: Object.fromEntries(Object.entries(this.#roofsOf(shown)).map(([name, style]) => [name, style.roof])),
            });
            this.#people.enabled = this.tool === "households";
            this.#people.showLegend(this.#view);
        }
        this.#syncViews();
        this.#watchTheme(this.look === "theme" && !this.#alone && this.mode === "open");
        this.#canvas.show(result.townView.rect, { home: true });
        this.#framing = "town";
        await this.#canvas.drawCoarse().catch((error) => console.warn("FWMB | The settlement's picture could not be drawn:", error));
        this.#thumbnailOfShown();
        this.#host.render(["mapbar", "editToolbar"]);
    }

    /** The line over the canvas (its view and detail), redrawn once the frame's moves are in. */
    #lineLater() {
        if (this.#lineFrame !== null) return;
        this.#lineFrame = requestAnimationFrame(() => {
            this.#lineFrame = null;
            if (this.#canvas) this.#host.render(["editToolbar"]);
        });
    }

    /**
     * The map's own title, scale bar and north arrow over the canvas: on the part of the frame in
     * view (zoomed out, they stay on the map rather than the surround), kept clear of the map
     * controls along the canvas's foot. Drawn on a canvas that size, then laid over; drawn again
     * only when the view, the canvas's size or the name changes: the canvas is painted again as
     * each tile arrives, and a canvas the size of the view for each would be tens of MB each.
     */
    #decorate(ctx, view, shown) {
        const controls = this.#container?.querySelector(".fwmb-map-controls");
        const ratio = view.widthPx / Math.max(1, this.#container?.clientWidth ?? view.widthPx);
        const foot = controls ? Math.round((controls.offsetHeight + 8) * ratio) : 0;
        // The frame's part in view, in canvas pixels
        const { width: fw, height: fh } = shown.result.frame;
        const m = view.mPerPx;
        const left = Math.max(0, Math.round((-fw / 2 - view.rect[0]) / m));
        const top = Math.max(0, Math.round((-fh / 2 - view.rect[1]) / m));
        const right = Math.min(view.widthPx, Math.round((fw / 2 - view.rect[0]) / m));
        const bottom = Math.min(view.heightPx - foot, Math.round((fh / 2 - view.rect[1]) / m));
        const widthPx = right - left;
        const heightPx = bottom - top;
        if (widthPx < 1 || heightPx < 1) return;
        const rect = [view.rect[0] + left * m, view.rect[1] + top * m, view.rect[0] + right * m, view.rect[1] + bottom * m];
        const town = this.#labelTown(shown);
        const lookKey = this.#alone ? "atlas" : this.#lookKey();
        const key = [shown.versionId, town.name, lookKey, widthPx, heightPx, m, ...rect].join("|");
        if (this.#labels?.key !== key) {
            const same = this.#labels?.canvas.width === widthPx && this.#labels.canvas.height === heightPx;
            const layer = same ? this.#labels.canvas : typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(widthPx, heightPx) : Object.assign(globalThis.document.createElement("canvas"), { width: widthPx, height: heightPx });
            const layerCtx = layer.getContext("2d");
            layerCtx.setTransform(1, 0, 0, 1, 0, 0);
            layerCtx.clearRect(0, 0, widthPx, heightPx);
            drawTown(layerCtx, town, { rect, mPerPx: m, widthPx, heightPx }, styleOf(this.#styleFor(lookKey)), { layers: ["labels"], words: this.#mapWords(town) });
            this.#labels = { key, canvas: layer, left, top };
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(this.#labels.canvas, this.#labels.left, this.#labels.top);
    }

    /** What the renderer's labels layer reads of a settlement: its name, kind, input, wall and shore. */
    #labelTown(shown) {
        const label = shown.result.label ?? {};
        const input = this.#record?.input ?? this.#alone?.input ?? shown.input ?? this.#input();
        return { name: this.#settlementName() || label.name || "", kind: label.kind ?? shown.result.kind, input, wall: label.wall ? {} : null, shore: label.shore ? {} : null };
    }

    /** Map setup's picture of the open version: its town view, small. */
    async #thumbnailOfShown() {
        if (this.mode !== "open" || !this.#shown) return;
        const { result, versionId } = this.#shown;
        const widthPx = 192;
        const heightPx = 144;
        const view = result.townView;
        const mPerPx = Math.max(view.width / widthPx, view.height / heightPx);
        const cx = (view.rect[0] + view.rect[2]) / 2;
        const cy = (view.rect[1] + view.rect[3]) / 2;
        const rect = [cx - (widthPx * mPerPx) / 2, cy - (heightPx * mPerPx) / 2, cx + (widthPx * mPerPx) / 2, cy + (heightPx * mPerPx) / 2];
        try {
            const bitmap = await this.#workersNow().tile(versionId, { rect, mPerPx, widthPx, heightPx }, { style: this.#lookStyle(), layers: PICTURE_LAYERS });
            const url = await toUrl(bitmap, widthPx, heightPx);
            if (this.#thumbUrl) URL.revokeObjectURL(this.#thumbUrl);
            this.#thumbUrl = url;
            this.#host.render(["context"]);
        } catch (error) {
            console.warn("FWMB | The settlement's picture for Map setup could not be drawn:", error);
        }
    }

    #choiceChanged() {
        this.#updateCards();
        this.#host.render(["context"]);
        this.#tick();
    }

    /** Redraws the drawing cards' progress each frame while any is drawing. */
    #tick() {
        if (this.#ticking !== null) return;
        const step = () => {
            this.#ticking = null;
            this.#updateCards();
            if (this.#choice?.busy || this.#building) this.#ticking = requestAnimationFrame(step);
        };
        this.#ticking = requestAnimationFrame(step);
    }

    // ------------------------------------------------------------------ the stage (map region)

    /** Draws the settlement's element in the map region for the state it is in. */
    #drawStage() {
        if (!this.#container) return;
        if (!this.#stage) {
            this.#stage = this.#container.ownerDocument.createElement("div");
            this.#stage.className = "fwmb-settlement-stage";
            this.#stage.addEventListener("click", (event) => this.#onStageClick(event));
            this.#stage.addEventListener("dblclick", (event) => this.#onStageDoubleClick(event));
            this.#stage.addEventListener("keydown", (event) => this.#onStageKey(event));
            this.#container.prepend(this.#stage);
        }
        const kind = this.mode === "choosing" && !this.#alone ? "versions" : this.mode === "building" ? "building" : "surface";
        if (this.#stage.dataset.kind !== kind) {
            this.#stage.dataset.kind = kind;
            this.#stage.replaceChildren();
            if (kind === "versions") this.#stage.append(this.#versionsElement());
            else if (kind === "building") this.#stage.append(this.#buildingElement());
            else {
                const surface = this.#stage.ownerDocument.createElement("div");
                surface.className = "fwmb-settlement-surface";
                this.#stage.append(surface);
            }
        }
        this.#updateCards();
        this.#syncViews();
    }

    #versionsElement() {
        const grid = this.#stage.ownerDocument.createElement("div");
        grid.className = "fwmb-versions";
        grid.setAttribute("role", "radiogroup");
        grid.setAttribute("aria-label", platform.i18n.localize("FILRODENSWMB.UI.FourVersions"));
        for (let index = 0; index < 4; index++) grid.append(this.#cardElement(index));
        return grid;
    }

    #cardElement(index) {
        const doc = this.#stage.ownerDocument;
        const card = doc.createElement("div");
        card.className = "fwmb-version";
        card.dataset.index = String(index);
        card.innerHTML = `<canvas class="fwmb-version-picture" aria-hidden="true"></canvas>
<button type="button" class="fwmb-version-label" role="radio" aria-checked="false" data-index="${index}"><span class="fwmb-version-radio" aria-hidden="true"></span><b></b><span class="fwmb-version-meta"></span></button>
<div class="fwmb-version-progress"><span class="fwmb-version-status"></span><span class="fwmb-version-bar"><b></b></span></div>`;
        return card;
    }

    #buildingElement() {
        const doc = this.#stage.ownerDocument;
        const card = doc.createElement("div");
        card.className = "fwmb-version fwmb-version--building";
        card.innerHTML = `<div class="fwmb-version-label"><b></b></div><div class="fwmb-version-progress"><span class="fwmb-version-status"></span><span class="fwmb-version-bar"><b></b></span></div>`;
        return card;
    }

    /** The cards' names, radios, pictures and progress, in place. */
    #updateCards() {
        const { i18n } = platform;
        if (!this.#stage) return;
        if (this.#stage.dataset.kind === "building" && this.#building) {
            const card = this.#stage.querySelector(".fwmb-version--building");
            const progress = Math.min(FILRODENSWMB.LOCAL.BUILD_ESTIMATE.MOST, (performance.now() - this.#building.startedAt) / estimateMs(this.#building.population));
            card.querySelector(".fwmb-version-label b").textContent = this.#settlementName();
            card.querySelector(".fwmb-version-status").textContent = i18n.format(this.#building.keeping ? "FILRODENSWMB.UI.VersionKeeping" : "FILRODENSWMB.UI.VersionDrawing", { percent: Math.round(progress * 100) });
            card.querySelector(".fwmb-version-bar b").style.width = `${Math.round(progress * 100)}%`;
            return;
        }
        if (this.#stage.dataset.kind !== "versions" || !this.#choice) return;
        const choice = this.#choice;
        const now = performance.now();
        for (const slot of choice.slots) {
            const card = this.#stage.querySelector(`.fwmb-version[data-index="${slot.index}"]`);
            if (!card) continue;
            const selected = choice.selected === slot.index;
            card.classList.toggle("fwmb-is-selected", selected);
            card.dataset.state = slot.state;
            const label = card.querySelector(".fwmb-version-label");
            label.setAttribute("aria-checked", String(selected));
            label.querySelector("b").textContent = versionName(slot.index);
            // The Default: the kept version in Choose another version… (its date), else the map's seed
            const meta = slot.index !== 0 ? i18n.localize("FILRODENSWMB.UI.VersionRandomSeed") : slot.owned && slot.kept ? i18n.format("FILRODENSWMB.UI.VersionKept", { date: slot.kept }) : this.#another ? i18n.localize("FILRODENSWMB.UI.VersionItsSeed") : i18n.localize("FILRODENSWMB.UI.VersionMapSeed");
            label.querySelector(".fwmb-version-meta").textContent = ` · ${meta}`;
            label.dataset.tooltip = i18n.format("FILRODENSWMB.UI.VersionSeedHint", { seed: slot.seed });
            const picture = card.querySelector(".fwmb-version-picture");
            if (slot.state === "ready" && slot.thumbnail && picture.dataset.version !== slot.id) {
                picture.width = slot.thumbnail.width;
                picture.height = slot.thumbnail.height;
                picture.getContext("2d").drawImage(slot.thumbnail, 0, 0);
                picture.dataset.version = slot.id;
            } else if (slot.state !== "ready" && picture.dataset.version) {
                delete picture.dataset.version;
                picture.getContext("2d").clearRect(0, 0, picture.width, picture.height);
            }
            const progress = choice.progress(slot, now);
            const status = card.querySelector(".fwmb-version-status");
            if (slot.state === "waiting") status.textContent = i18n.localize("FILRODENSWMB.UI.VersionWaiting");
            else if (slot.state === "drawing") status.textContent = i18n.format("FILRODENSWMB.UI.VersionDrawing", { percent: Math.round(progress * 100) });
            else if (slot.state === "failed") status.textContent = i18n.localize("FILRODENSWMB.UI.VersionFailed");
            else status.textContent = "";
            card.querySelector(".fwmb-version-bar b").style.width = `${Math.round(progress * 100)}%`;
        }
    }

    #onStageClick(event) {
        const label = event.target.closest?.(".fwmb-version-label[data-index], .fwmb-version[data-index]");
        if (!label || !this.#choice) return;
        this.#choice.pick(Number(label.dataset.index));
    }

    #onStageDoubleClick(event) {
        const card = event.target.closest?.(".fwmb-version[data-index]");
        if (!card || !this.#choice) return;
        this.#openAlone(Number(card.dataset.index));
    }

    /** The cards are one radio group: the arrow keys move the choice, Enter opens one alone. */
    #onStageKey(event) {
        const label = event.target.closest?.(".fwmb-version-label[data-index]");
        if (!label || !this.#choice) return;
        const index = Number(label.dataset.index);
        const moves = { ArrowRight: 1, ArrowDown: 2, ArrowLeft: -1, ArrowUp: -2 };
        if (moves[event.key] !== undefined) {
            const next = (index + moves[event.key] + 4) % 4;
            this.#choice.pick(next);
            this.#stage.querySelector(`.fwmb-version-label[data-index="${next}"]`)?.focus();
        } else if (event.key === "Enter") this.#openAlone(index);
        else return;
        event.preventDefault();
        event.stopPropagation();
    }

    // ------------------------------------------------------------------ Map setup's context

    #input() {
        return this.#record?.input ?? this.#choice?.slots[0]?.input ?? this.#alone?.input ?? null;
    }

    #settlementName() {
        return this.#host.pinOf(this.#pinId)?.name || this.#record?.name || this.#input()?.name || "";
    }

    /** "town of 2,900" */
    #kindLine(input) {
        const { i18n } = platform;
        return i18n.format("FILRODENSWMB.UI.SettlementKindLine", { kind: tierName(input.tier), people: (input.population ?? 0).toLocaleString(i18n.lang) });
    }

    #mapSetupContext() {
        const { i18n } = platform;
        const input = this.#input();
        const choice = this.#choice;
        const chosen = choice ? choice.slots[choice.selected] : null;
        const ready = choice ? choice.slots.filter((slot) => slot.state === "ready").length : 0;
        const keepName = chosen ? (chosen.index === 0 ? i18n.localize("FILRODENSWMB.UI.KeepDefault") : i18n.format("FILRODENSWMB.UI.KeepAltVersion", { n: chosen.index })) : i18n.localize("FILRODENSWMB.UI.KeepDefault");
        return {
            choosing: this.mode === "choosing",
            open: this.mode === "open",
            building: this.mode === "building",
            from: input ? this.#fromThePin(input) : null,
            standIn: !!input?.supply?.withoutRun,
            seed: choice?.slots[0]?.seed ?? this.#record?.seed ?? "",
            readyLine: choice ? i18n.format("FILRODENSWMB.UI.VersionsReady", { ready, count: choice.slots.length }) : "",
            keep: { label: keepName, off: !choice?.chosen ? i18n.localize("FILRODENSWMB.UI.KeepWhenReady") : null },
            // While choosing, the cards are the versions: the version kept shows again once one is kept or the choice cancelled.
            version: this.#record && this.mode !== "choosing"
                ? {
                      name: i18n.localize("FILRODENSWMB.UI.VersionDefault"),
                      seed: this.#record.seed,
                      kept: this.#record.keptAt ? new Date(this.#record.keptAt).toLocaleDateString(i18n.lang, { day: "numeric", month: "short", year: "numeric" }) : null,
                      picture: this.#thumbUrl,
                      unsaved: this.#pending.has(this.#record.id),
                  }
                : null,
            mapName: this.#host.mapName(),
            settings: this.#settingsContext(),
        };
    }

    /**
     * Map setup's Walls and Look, its Choose another version… and Generate again (step 4, board
     * L3): once a map is open, off on a held world's (board L3b).
     */
    #settingsContext() {
        if (this.mode !== "open" || !this.#record || this.#alone) return null;
        const { i18n } = platform;
        const { PALISADE_BELOW } = FILRODENSWMB.LOCAL.WALLS;
        const walls = this.walls;
        const look = this.look;
        const state = this.#owner ? null : this.stateOf(this.#record.id);
        return {
            // A held world's parent's map, or its export drawing (step 5)
            off: this.#owner ? i18n.format("FILRODENSWMB.UI.SettlementHeldOff", { owner: this.#owner.name }) : this.exportWait(),
            stale: !!state && (state.changed.length > 0 || state.pinGone),
            redraws: i18n.localize("FILRODENSWMB.UI.SettlementRedraws"),
            walls: ["auto", "on", "off"].map((id) => ({ id, on: id === walls, label: i18n.localize(`FILRODENSWMB.UI.SettlementWalls.${id}`) })),
            wallsHint: i18n.format("FILRODENSWMB.UI.SettlementWallsHint", { people: PALISADE_BELOW.toLocaleString(i18n.lang) }),
            looks: ["atlas", "theme"].map((id) => ({ id, on: id === look, label: i18n.localize(`FILRODENSWMB.UI.SettlementLook.${id}`) })),
            pinPath: `${i18n.localize("FILRODENSWMB.UI.ToolInfrastructure")} › ${this.#settlementName()}`,
        };
    }

    /** From the pin (board L2): the settlement, its cultures, water, roads, land and frame. */
    #fromThePin(input) {
        const { i18n } = platform;
        const lang = i18n.lang;
        const percent = (share) => `${Math.round(share * 100)}%`;
        const water = [];
        if (input.river) water.push(i18n.format("FILRODENSWMB.UI.FromPinRiver", { from: pointOf(input.river.from), to: pointOf(input.river.to) }));
        if (input.shore) water.push(i18n.format(input.shore.body === "sea" ? "FILRODENSWMB.UI.FromPinSea" : "FILRODENSWMB.UI.FromPinLake", { side: pointOf(input.shore.side) }));
        const roads = input.roads.map((road) => pointOf(road.bearing));
        const biome = i18n.localize(`FILRODENSWMB.BIOMES.${input.biome}`);
        const lie = i18n.localize(`FILRODENSWMB.UI.FromPinLie.${input.relief.lie}`);
        const km = (m) => (m / 1000).toLocaleString(lang, { maximumFractionDigits: 1 });
        return {
            settlement: i18n.format("FILRODENSWMB.UI.FromPinSettlement", { name: this.#settlementName(), what: this.#kindLine(input) }),
            cultures: input.cultures.map((culture) => `${culture.name} ${percent(culture.share)}`).join(", "),
            water: water.length ? water.join("; ") : i18n.localize("FILRODENSWMB.UI.FromPinNoWater"),
            roads: roads.length ? i18n.format("FILRODENSWMB.UI.FromPinRoads", { count: roads.length, ways: [...new Set(roads)].join(", ") }) : i18n.localize("FILRODENSWMB.UI.FromPinNoRoads"),
            land: `${biome}, ${lie}`,
            frame: i18n.format("FILRODENSWMB.UI.FromPinFrame", { width: km(input.frame.width), height: km(input.frame.height) }),
        };
    }
}

/** The theme's colours the theme style reads (Styles.js themeStyle). */
const THEME_TOKENS = Object.freeze(["--fwmb-bg-base", "--fwmb-bg-panel", "--fwmb-bg-raised", "--fwmb-bg-hover", "--fwmb-bg-highlight", "--fwmb-accent-main", "--fwmb-fill-accent", "--fwmb-accent-secondary", "--fwmb-fill-secondary", "--fwmb-border-main", "--fwmb-border-strong", "--fwmb-text-primary", "--fwmb-text-muted"]);

/** A colour's relative lightness, 0 to 1 (#rrggbb). */
function luminance(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * A settlement's input with its walls as Map setup sets them (step 4): forced on or off, or the
 * engine's own rule for Automatic.
 * @param {object} input
 * @param {"auto"|"on"|"off"} [walls]
 */
export function withWalls(input, walls = "auto") {
    const walled = walls === "on" ? true : walls === "off" ? false : autoWalled(input);
    return input.walled === walled ? input : { ...input, walled };
}

/** A version's name: the Default, or Alt. version 1 to 3. */
function versionName(index) {
    return index === 0 ? platform.i18n.localize("FILRODENSWMB.UI.VersionDefault") : platform.i18n.format("FILRODENSWMB.UI.VersionAlt", { n: index });
}

/**
 * A pin tier's name, lower case for running text ("town"), or with `start` as the pin style
 * writes it, for a line that begins with it ("Large town of 7,987 people").
 */
export function tierName(tier, { start = false } = {}) {
    const key = tier ? `FILRODENSWMB.UI.PinStyle${tier.charAt(0).toUpperCase()}${tier.slice(1)}` : null;
    const name = key ? platform.i18n.localize(key) : null;
    const word = name && name !== key ? name : platform.i18n.localize("FILRODENSWMB.UI.SettlementPlace");
    return start ? word : word.toLocaleLowerCase(platform.i18n.lang);
}

/** A picture as an object URL (for an <img>), through a canvas the size given. */
async function toUrl(bitmap, width, height) {
    if (typeof OffscreenCanvas !== "undefined") {
        const canvas = new OffscreenCanvas(width, height);
        canvas.getContext("2d").drawImage(bitmap, 0, 0);
        bitmap.close?.();
        return URL.createObjectURL(await canvas.convertToBlob({ type: "image/webp", quality: 0.9 }));
    }
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(URL.createObjectURL(blob)), "image/webp", 0.9));
}
