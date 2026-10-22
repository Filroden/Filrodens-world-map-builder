import { platform } from "../platform/index.js";

/**
 * The panel's long lists (pins, routes and labels; see parts/list-query.hbs and the
 * parts/list-rows-*.hbs templates): their search and filters, and how their rows are drawn.
 *
 * Search and filters: each list keeps what its reader typed and chose for the session
 * (app.listQueries[list]): a name to search for, who made the items (generated or by hand), and
 * one kind of item. Every row that matches is listed.
 *
 * Drawing: a map can hold thousands of generated places, and the panel is drawn again after every
 * edit, undo and selection. A list's rows are therefore rendered on their own (ListQuery.html) and
 * the result kept with a version made from everything the rows show. The panel's template draws
 * the list empty with that version; while it is the same the rows on the page are left untouched,
 * and when it changes the kept HTML is put in, in one go (see StudioView, data-list-version). What
 * changes most often, the row in the inspector and Mass Edit's ticks, is marked on the rows after
 * each draw (ListQuery.settle), so neither renders the rows again.
 *
 * A row is a plain object with `name`, `generated` (whether a run made it) and `kind`, and may
 * list other kinds it also counts as in `also` (a label with no room is found by No room).
 */

/** Who made the items a list shows. */
const ORIGINS = Object.freeze({
    all: "FILRODENSWMB.UI.ListOriginAll",
    generated: "FILRODENSWMB.UI.ListOriginGenerated",
    handmade: "FILRODENSWMB.UI.ListOriginHandmade",
});

/** How long typing in a search field waits before the list is drawn again, in milliseconds. */
const SEARCH_DELAY_MS = 250;

const ALL = "all";

/** FNV-1a's offset basis and prime, for a list's version (a short hash of what its rows show). */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const HEX = 16;

/** A short, stable hash of a string. */
function hashOf(text) {
    let hash = FNV_OFFSET;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, FNV_PRIME);
    }
    return (hash >>> 0).toString(HEX);
}

export class ListQuery {
    /**
     * A list's search and filters for the session, with their defaults.
     * @param {object} app
     * @param {string} list - "pin", "route" or "label".
     * @returns {{search: string, origin: string, kind: string}}
     */
    static of(app, list) {
        app.listQueries ??= {};
        app.listQueries[list] ??= { search: "", origin: ALL, kind: ALL };
        return app.listQueries[list];
    }

    /**
     * The rows that match a list's search and filters, in their order.
     * @param {object[]} rows
     * @param {{search: string, origin: string, kind: string}} query
     * @returns {object[]}
     */
    static matching(rows, query) {
        const needle = query.search.trim().toLocaleLowerCase();
        return rows.filter((row) => {
            if (query.origin === "generated" && !row.generated) return false;
            if (query.origin === "handmade" && row.generated) return false;
            if (query.kind !== ALL && row.kind !== query.kind && !row.also?.includes(query.kind)) return false;
            return !needle || String(row.name ?? "").toLocaleLowerCase().includes(needle);
        });
    }

    /**
     * What a list shows: its matching rows and its controls, with how many match while it is
     * filtered ("120 of 3,368").
     * @param {object} app
     * @param {string} list
     * @param {object[]} rows - Every row of the list, in order.
     * @param {Object<string, string>} kinds - The kinds offered (value to localisation key), besides All.
     * @returns {{rows: object[], total: number, matched: number, controls: object}}
     */
    static view(app, list, rows, kinds) {
        const query = this.of(app, list);
        if (query.kind !== ALL && !Object.hasOwn(kinds, query.kind)) query.kind = ALL;
        const matched = this.matching(rows, query);
        const format = (count) => count.toLocaleString(platform.i18n.lang);
        const filtered = query.search.trim() !== "" || query.origin !== ALL || query.kind !== ALL;
        return {
            rows: matched,
            total: rows.length,
            matched: matched.length,
            controls: {
                list,
                search: query.search,
                origins: Object.entries(ORIGINS).map(([value, label]) => ({ value, label, selected: value === query.origin })),
                kinds: [{ value: ALL, label: "FILRODENSWMB.UI.ListKindAll", selected: query.kind === ALL }, ...Object.entries(kinds).map(([value, label]) => ({ value, label, selected: value === query.kind }))],
                counted: filtered ? platform.i18n.format("FILRODENSWMB.UI.ListMatching", { matched: format(matched.length), total: format(rows.length) }) : null,
                noMatches: filtered && matched.length === 0 && rows.length > 0,
            },
        };
    }

    /**
     * A list's rows as HTML, with their version: rendered from the list's rows template only when
     * what the rows show has changed since the list was last drawn, the kept HTML otherwise.
     * @param {object} app
     * @param {string} list
     * @param {string} template - The rows template's path.
     * @param {object} context - What the template reads (rows and the list's own fields).
     * @param {function(object): Array} shown - The fields of a row the template shows.
     * @returns {Promise<{html: string, version: string}>}
     */
    static async html(app, list, template, context, shown) {
        const { rows, ...rest } = context;
        const version = hashOf(JSON.stringify([rest, rows.map(shown)]));
        app.listHtml ??= {};
        const kept = app.listHtml[list];
        if (kept?.version === version) return kept;
        const html = await platform.templates.render(template, context);
        app.listHtml[list] = { version, html };
        return app.listHtml[list];
    }

    /**
     * After a draw: each versioned list marks the row its data-list-selected names as selected, and
     * ticks the rows Mass Edit has chosen.
     * @param {object} app
     * @param {ParentNode} root
     */
    static settle(app, root) {
        for (const list of root.querySelectorAll("[data-list-rows]")) {
            const selected = list.dataset.listSelected;
            for (const row of list.querySelectorAll('[aria-selected="true"]')) if (row.dataset.id !== selected) row.setAttribute("aria-selected", "false");
            if (selected) list.querySelector(`[data-list-item][data-id="${CSS.escape(selected)}"]`)?.setAttribute("aria-selected", "true");
            const chosen = app.massEditSelection?.[list.dataset.listRows];
            if (!chosen) continue;
            for (const box of list.querySelectorAll("input[data-mass-type]")) box.checked = chosen.has(box.closest("[data-id]")?.dataset.id);
        }
    }

    /**
     * A list's search field or filter changed: the list is drawn again. Typing waits a moment,
     * so the list is not drawn at every key.
     * @param {object} app
     * @param {Event} event
     * @returns {boolean} Whether the field was a list's.
     */
    static handleInput(app, event) {
        const target = event.target;
        const list = target?.dataset?.listQuery;
        const field = target?.dataset?.queryField;
        if (!list || !["search", "origin", "kind"].includes(field)) return false;
        const query = this.of(app, list);
        if (field === "search") {
            query.search = target.value;
            clearTimeout(app.listSearchTimer);
            app.listSearchTimer = setTimeout(() => app.view?.render(["context"]), event.type === "input" ? SEARCH_DELAY_MS : 0);
            return true;
        }
        if (event.type !== "change") return true;
        query[field] = target.value;
        app.view?.render(["context"]);
        return true;
    }
}
