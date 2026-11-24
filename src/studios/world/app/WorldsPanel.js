import { Worlds } from "../../../kernel/worlds/Worlds.js";
import { Inspector } from "./Inspector.js";
import { WorldThumbnails } from "./WorldThumbnails.js";
import { ListQuery } from "./ListQuery.js";
import { platform } from "../../../platform/index.js";

/** The marks a world can carry here (WorldRecord.marks), as they show: one set everywhere. */
const MARKS = Object.freeze({
    held: Object.freeze({ kind: "held", icon: "lock", label: "FILRODENSWMB.UI.MarkRegionalWorld" }),
    older: Object.freeze({ kind: "older", icon: "history", label: "FILRODENSWMB.UI.MarkOlderGenerator" }),
    noRun: Object.freeze({ kind: "older", icon: "generate", label: "FILRODENSWMB.UI.MarkNoRun" }),
    // A held regional world whose parent changed what it shows (RegionalRecord.staleness, S0 step 5)
    stale: Object.freeze({ kind: "stale", icon: "sync", label: "FILRODENSWMB.UI.MarkOutOfDate" }),
});

/** Out of date's reasons (RegionalRecord.staleness), by rule. */
const STALE_REASONS = Object.freeze({
    crop: "FILRODENSWMB.UI.StaleCrop",
    settings: "FILRODENSWMB.UI.StaleSettings",
    above: "FILRODENSWMB.UI.StaleAbove",
});

/** The terrain engines' short names (World setup). */
const ENGINES = Object.freeze({
    standard: "FILRODENSWMB.UI.EngineShortStandard",
    flat: "FILRODENSWMB.UI.EngineShortFlat",
    advanced: "FILRODENSWMB.UI.EngineShortAdvanced",
    guided: "FILRODENSWMB.UI.EngineShortGuided",
});

/**
 * Worlds (v5, S0 step 3b; board W9): the worlds saved here, opened from the world bar's name menu
 * or the bar's Open world, and what the studio opens on. It fills the studio's body beside the
 * docked inspector (the `manage` tool, which lights no rail button, the rail and the map hidden).
 *
 * A card per world of its own, with its Surface map's thumbnail (or its map type's icon, for a
 * world not saved since v5), its marks, a line of what it is (its engine, its maps, when saved)
 * and its regional worlds counted. Search (as the panel's other lists, ListQuery) keeps the
 * families in which a world matches, the card naming each regional world that matched as a chip
 * to choose. A card or chip chosen shows the world in the inspector (WorldEditor): Open, what it
 * is, the family's tree and its actions.
 *
 * What a card shows is read from Worlds.tree() each time the panel is drawn, and kept (by studio)
 * for the inspector, whose `find` cannot wait on the store.
 */
export class WorldsPanel {
    /** The worlds as last drawn, by studio: world id to its tree node, with its parent's name. */
    static #index = new WeakMap();

    /** The search as last drawn, by studio, so the inspector's tree can mark what matched. */
    static #needle = new WeakMap();

    /** Names being saved, by studio: world id to its new name, shown until the store has it. */
    static #renaming = new WeakMap();

    /**
     * What the panel's templates read (tools-manage.hbs, its head and foot).
     * @param {object} app
     * @returns {Promise<object>}
     */
    static async context(app) {
        const tree = await WorldsPanel.load(app);
        const index = this.#index.get(app);

        const query = ListQuery.of(app, "worlds").search;
        const needle = query.trim().toLocaleLowerCase();
        this.#needle.set(app, needle);
        const selected = Inspector.inspected(app).world ?? null;
        const selectedRoot = index.get(selected)?.rootId ?? null;
        const { i18n } = platform;

        const cards = [];
        for (const node of tree) {
            const family = WorldsPanel.#family(node);
            const top = WorldsPanel.matches(node, needle);
            const inside = needle ? family.slice(1).filter((member) => WorldsPanel.matches(member, needle)) : [];
            if (needle && !top && !inside.length) continue;
            const count = family.length - 1;
            cards.push({
                id: node.id,
                name: WorldsPanel.named(node),
                thumbnail: node.thumbnail,
                marks: WorldsPanel.marks(node),
                meta: WorldsPanel.summary(node),
                regional: count ? i18n.format(count === 1 ? "FILRODENSWMB.UI.WorldRegionalOne" : "FILRODENSWMB.UI.WorldRegionalCount", { count }) : null,
                // The regional worlds the search found in this family, each chosen from its chip
                matches: inside.map((member) => ({ id: member.id, name: WorldsPanel.named(member), selected: member.id === selected })),
                // The card is lit for its own world or any regional world under it
                selected: node.id === selectedRoot,
            });
        }

        // Where the worlds are kept, and how many there are of each kind (the header's line)
        const web = platform.module?.host === "web";
        const regionalCount = index.size - tree.length;
        const summary = [
            i18n.localize(web ? "FILRODENSWMB.UI.WorldsSavedWeb" : "FILRODENSWMB.UI.WorldsSavedFoundry"),
            ...(index.size ? [tree.length === 1 ? i18n.localize("FILRODENSWMB.UI.WorldsCountOne") : i18n.format("FILRODENSWMB.UI.WorldsCount", { count: tree.length })] : []),
            ...(regionalCount ? [regionalCount === 1 ? i18n.localize("FILRODENSWMB.UI.WorldRegionalOne") : i18n.format("FILRODENSWMB.UI.WorldRegionalCount", { count: regionalCount })] : []),
        ].join(" · ");
        // Worlds whose Surface map's card has no thumbnail yet (made from 4.3 maps), for Draw
        // thumbnails in the foot (S0 step 8d), shown only while there are any
        const missing = WorldThumbnails.missing(tree).length;
        const thumbnails = missing ? { label: i18n.format("FILRODENSWMB.UI.DrawThumbnails", { count: missing }), hint: i18n.localize("FILRODENSWMB.UI.DrawThumbnailsHint") } : null;
        return { query, web, summary, empty: index.size === 0, noMatches: index.size > 0 && cards.length === 0, cards, thumbnails };
    }

    /**
     * Reads the worlds saved here (Worlds.tree) and keeps them, by studio, for the inspector
     * (WorldEditor's find, which cannot wait on the store): Worlds and the world overview both
     * show a world in it.
     * @returns {Promise<object[]>} The tree's top-level worlds.
     */
    static async load(app) {
        const tree = await Worlds.tree();
        const index = new Map();
        const renaming = this.#renaming.get(app);
        const walk = (nodes, parent, root) => {
            for (const node of nodes) {
                if (renaming?.has(node.id)) node.name = renaming.get(node.id);
                index.set(node.id, { ...node, parentName: parent?.name ?? null, rootId: root?.id ?? node.id });
                walk(node.children, node, root ?? node);
            }
        };
        walk(tree, null, null);
        this.#index.set(app, index);
        return tree;
    }

    /** A world and every regional world under it, the world first. */
    static #family(node) {
        return [node, ...node.children.flatMap((child) => WorldsPanel.#family(child))];
    }

    /** A world's name, or the unnamed one's. */
    static named(node) {
        return node.name || platform.i18n.localize("FILRODENSWMB.UI.UnnamedMap");
    }

    /** Whether a world's name holds the search (always, with no search). */
    static matches(node, needle) {
        return !needle || WorldsPanel.named(node).toLocaleLowerCase().includes(needle);
    }

    /** A world's marks, as they show (MARKS). */
    static marks(node) {
        return (node.marks ?? [])
            .map((mark) => MARKS[mark])
            .filter(Boolean)
            .map((mark) => ({ ...mark, label: platform.i18n.localize(mark.label), ...(mark.kind === "stale" ? { tooltip: WorldsPanel.staleLines(node).join(" ") } : {}) }));
    }

    /**
     * Why a world is Out of date, a sentence a rule (RegionalRecord.staleness), with when where it
     * is known: "Aethoria was saved with changes inside this crop (saved today)." Empty when it is not.
     * @param {{stale?: object[]}} node
     * @returns {string[]}
     */
    static staleLines(node) {
        const { i18n } = platform;
        return (node?.stale ?? []).map((reason) => {
            const time = Date.parse(reason.at ?? "");
            const line = i18n.format(STALE_REASONS[reason.rule], { name: reason.parentName || i18n.localize("FILRODENSWMB.UI.UnnamedWorld") });
            return Number.isFinite(time) ? i18n.format("FILRODENSWMB.UI.StaleWhen", { line, when: WorldsPanel.savedLabel(time) }) : i18n.format("FILRODENSWMB.UI.StaleLine", { line });
        });
    }

    /** A card's line: its engine, its maps, when it was last saved changed (board W9). */
    static summary(node) {
        const { i18n } = platform;
        const engine = ENGINES[node.setup?.engine];
        const count = node.maps.length;
        const saved = WorldsPanel.lastSaved(node);
        // A world with no maps yet (board N3) has no engine to name: its Surface map is not made
        if (!count) return [i18n.localize("FILRODENSWMB.UI.WorldNoMapsYet"), saved ? WorldsPanel.savedLabel(saved) : null].filter(Boolean).join(" · ");
        // Its settlement maps (L-surface), counted where it has any
        const settlements = node.settlements ?? 0;
        return [
            engine ? i18n.localize(engine) : null,
            count === 1 ? i18n.localize("FILRODENSWMB.UI.WorldMapsOne") : i18n.format("FILRODENSWMB.UI.WorldMapsCount", { count }),
            settlements ? (settlements === 1 ? i18n.localize("FILRODENSWMB.UI.WorldSettlementsOne") : i18n.format("FILRODENSWMB.UI.WorldSettlementsCount", { count: settlements })) : null,
            saved ? WorldsPanel.savedLabel(saved) : null,
        ]
            .filter(Boolean)
            .join(" · ");
    }

    /** When anything of a world was last saved changed: its settings or one of its maps. */
    static lastSaved(node) {
        const times = [node.settingsSavedAt, ...node.maps.map((map) => map.savedAt)].map((value) => Date.parse(value ?? "")).filter(Number.isFinite);
        return times.length ? Math.max(...times) : null;
    }

    /** "saved today", "saved yesterday" or "saved 10 Nov" (with the year when it is not this one), the date in the reader's own form. */
    static savedLabel(time, now = Date.now()) {
        const { i18n } = platform;
        const day = (value) => {
            const date = new Date(value);
            return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
        };
        const ago = day(now) - day(time);
        if (ago === 0) return i18n.localize("FILRODENSWMB.UI.WorldSavedToday");
        if (ago === 1) return i18n.localize("FILRODENSWMB.UI.WorldSavedYesterday");
        const sameYear = new Date(time).getFullYear() === new Date(now).getFullYear();
        const date = new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
        return i18n.format("FILRODENSWMB.UI.WorldSavedOn", { date });
    }

    /** The world as last drawn (see #index), or null. */
    static find(app, worldId) {
        return this.#index.get(app)?.get(worldId) ?? null;
    }

    /** The search as last drawn (lower case, trimmed; empty with none). */
    static needle(app) {
        return this.#needle.get(app) ?? "";
    }

    /** A card, chip or tree row chosen: the world in the inspector. */
    /**
     * Worlds keeps the inspector's column (Ken, S0 step 8c; board W9 draws it always there): with no
     * world chosen, an empty column of the inspector's width and surface stands at the body's end
     * and says what choosing a card shows, so the cards never move when one is chosen (the grid
     * would otherwise lose a column, and the pointer land on another world). The stylesheet hides
     * it while the inspector itself is open. Outside Worlds it goes.
     * @param {object} app
     * @param {boolean} shown - Whether Worlds is what the studio shows.
     */
    static reserve(app, shown) {
        const body = app.root?.querySelector(":scope > .fwmb-studio-body");
        if (!body) return;
        let column = body.querySelector(":scope > .fwmb-inspector-reserve");
        if (!shown) {
            column?.remove();
            return;
        }
        if (column) return;
        column = body.ownerDocument.createElement("aside");
        column.className = "fwmb-inspector-reserve";
        const text = body.ownerDocument.createElement("p");
        text.className = "fwmb-hint";
        text.textContent = platform.i18n.localize("FILRODENSWMB.UI.WorldsChooseHint");
        column.append(text);
        // Before any docked dialogue, so the inspector opens in its place
        const docked = body.querySelector(":scope > .fwmb-overlay-docked");
        if (docked) docked.before(column);
        else body.append(column);
    }

    static select(app, worldId) {
        if (!this.find(app, worldId)) return false;
        return Inspector.open(app, WorldEditor, { id: worldId }, { keepFocus: true });
    }

    /**
     * Renames a world from the inspector: the new name shows at once, while the world and its maps
     * are written (see MapStudio.worldAction).
     */
    static async rename(app, world, name) {
        let renaming = this.#renaming.get(app);
        if (!renaming) this.#renaming.set(app, (renaming = new Map()));
        renaming.set(world.id, name);
        app.view?.render(["context"]);
        try {
            await app.worldAction("rename", world.mapId, world.name, name, world.id);
        } finally {
            if (renaming.get(world.id) === name) renaming.delete(world.id);
        }
    }
}

/**
 * A world in the inspector, chosen in Worlds or among the world overview's regional worlds: its
 * name, renamed in place; Open; what it is; its family as a tree (the world it belongs to at the
 * top, each regional world under the one it was cut from), each row chosen to show that world,
 * this one lit and the search's matches marked; its actions (Cut again…, until step 5 off; Clone
 * as new…, for a regional world; Duplicate; Export world); Delete… apart. What a world holds (its
 * maps, its settings) is the world overview's, once it is open. Each action is the studio's
 * (MapStudio.worldAction).
 */
export const WorldEditor = Object.freeze({
    id: "world",
    template: "modules/filrodens-world-map-builder/templates/world/parts/inspector-world.hbs",
    find: (app, ref) => WorldsPanel.find(app, ref.id),
    header: (_app, world) => ({
        title: WorldsPanel.named(world),
        subtitle: platform.i18n.localize(world.held ? "FILRODENSWMB.UI.WorldKindRegional" : world.parentId ? "FILRODENSWMB.UI.WorldKindCut" : "FILRODENSWMB.UI.WorldKindWorld"),
        swatch: null,
    }),
    context: (app, world) => ({
        world,
        family: WorldEditor.family(app, world),
        about: WorldEditor.about(world),
        isOpen: app.world?.id === world.id,
        held: world.held,
        hasMap: !!world.mapId,
        stale: WorldsPanel.staleLines(world),
        cutAgain: WorldEditor.cutAgain(app, world),
    }),
    apply: (app, world, _ref, form) => {
        const name = String(form.elements.worldName?.value ?? "").trim();
        if (!name || name === world.name) return false;
        WorldsPanel.rename(app, world, name);
        return false;
    },
    actions: {
        open: (app, world) => app.openWorld(world.mapId, world.name, world.id),
        showWorld: (app, _world, _ref, button) => WorldsPanel.select(app, button.dataset.worldId),
        cutAgain: (app, world) => app.cutAgain(world.id),
        cloneAsNew: (app, world) => app.worldAction("promote", world.mapId, world.name, undefined, world.id),
        duplicate: (app, world) => app.worldAction("duplicate", world.mapId, world.name, undefined, world.id),
        exportWorld: (app, world) => app.worldAction("export", world.mapId, world.name, undefined, world.id),
        delete: (app, world) => app.worldAction("delete", world.mapId, world.name, undefined, world.id),
    },

    /**
     * The world's family as rows of a tree, from the world it belongs to down (each regional world
     * under the one it was cut from, a level deeper), with nothing for a world of its own that has
     * no regional worlds: there would be only itself.
     */
    family(app, world) {
        const root = WorldsPanel.find(app, world.rootId ?? world.id);
        if (!root || (!root.children.length && root.id === world.id)) return [];
        const needle = WorldsPanel.needle(app);
        const rows = [];
        const walk = (node, depth) => {
            rows.push({
                id: node.id,
                name: WorldsPanel.named(node),
                depth,
                level: depth + 1,
                icon: node.parentId ? "crop" : "public",
                held: node.held,
                // Its zoom against the world it was cut from ("×4"), and whether it is Out of date
                zoom: node.parentId && Number.isFinite(node.zoom) ? platform.i18n.format("FILRODENSWMB.UI.RegionalZoomValue", { zoom: new Intl.NumberFormat(platform.i18n.lang, { maximumFractionDigits: 1 }).format(node.zoom) }) : null,
                stale: (node.stale ?? []).length > 0 ? WorldsPanel.staleLines(node).join(" ") : null,
                current: node.id === world.id,
                match: !!needle && WorldsPanel.matches(node, needle),
            });
            for (const child of node.children) walk(child, depth + 1);
        };
        walk(root, 0);
        return rows;
    },

    /**
     * Cut again… for a held regional world (null for any other): off, with why, while the world it
     * was cut from is not saved or the crop is not known (a world cut before v5 whose crop could
     * not be recovered); for a world cut before v5, its note says v5 cannot tell what changed.
     */
    cutAgain(app, world) {
        if (!world.held || !world.parentId) return null;
        const { i18n } = platform;
        if (!WorldsPanel.find(app, world.parentId)) return { off: i18n.localize("FILRODENSWMB.UI.CutAgainNoParent") };
        if (!world.cropKnown) return { off: i18n.localize("FILRODENSWMB.UI.CutAgainNoCrop") };
        return { note: i18n.localize(world.migrated ? "FILRODENSWMB.UI.CutAgainMigrated" : "FILRODENSWMB.UI.CutAgainNote") };
    },

    /** What the world is, in a sentence: a world, a regional world held by its parent, or one only cut from it. */
    about(world) {
        if (world.held && world.parentName) return platform.i18n.format("FILRODENSWMB.UI.WorldAboutHeld", { name: world.parentName });
        if (world.parentName) return platform.i18n.format("FILRODENSWMB.UI.WorldAboutCut", { name: world.parentName });
        return platform.i18n.localize("FILRODENSWMB.UI.WorldAboutWorld");
    },
});
