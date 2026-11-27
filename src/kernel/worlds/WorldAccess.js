import { platform } from "../../platform/index.js";

/**
 * Who may write a world (WL, one window per world). A world open for editing is claimed through
 * the host's world locks (platform.worldLocks): one tab of the web version, or one Foundry client,
 * holds it while it is open, and opening it anywhere else opens it view only. This is the one
 * guard on world writes (Worlds checks it before every write of an existing world): a world may be
 * written by the tab that holds it, or by any tab when none holds it, never by a tab that has it
 * open view only. The UI never offers what this refuses; it is a backstop.
 *
 * It also carries the news between tabs: what was saved, renamed, made or deleted, and which
 * world was opened or closed, so other tabs read again what they show (Worlds, a view-only copy,
 * a held regional world's Out of date).
 *
 * Its state belongs to the host's locks object, one per tab, so tests can play several tabs over
 * one store by installing each tab's locks in turn. A host with no locks (a test that installs
 * none) claims every world, as before WL.
 */

/** A host that cannot lock: every world is free and claimed, nothing is told. */
const NO_LOCKS = Object.freeze({
    available: false,
    claim: async () => ({ release() {} }),
    whenFree: () => () => {},
    held: async () => [],
    exclusive: async (_name, fn) => fn(),
    tell: () => {},
    listen: () => () => {},
});

/** Each tab's claims and view-only worlds, by its locks object. */
const STATES = new WeakMap();

function locks() {
    return platform.worldLocks ?? NO_LOCKS;
}

function state() {
    const host = locks();
    let entry = STATES.get(host);
    if (!entry) {
        entry = { claims: new Map(), viewing: new Set() };
        STATES.set(host, entry);
    }
    return entry;
}

export class WorldAccess {
    /** Whether the host can lock worlds at all. */
    static get available() {
        return locks().available !== false;
    }

    /**
     * Claims a world for editing in this tab. True when this tab holds it (already, or now); false
     * when another tab holds it, and then the world is this tab's view only.
     * @param {string} worldId
     * @returns {Promise<boolean>}
     */
    static async claim(worldId) {
        if (!worldId) return true;
        const { claims, viewing } = state();
        if (claims.has(worldId)) {
            viewing.delete(worldId);
            return true;
        }
        const claim = await locks().claim(worldId);
        if (!claim) {
            viewing.add(worldId);
            return false;
        }
        claims.set(worldId, claim);
        viewing.delete(worldId);
        locks().tell({ kind: "opened", worldId });
        return true;
    }

    /**
     * Opens a world view only on purpose, claiming nothing (decision 42's viewer opens worlds so;
     * WL only through a claim refused).
     * @param {string} worldId
     */
    static view(worldId) {
        if (!worldId) return;
        const { claims, viewing } = state();
        if (claims.has(worldId)) WorldAccess.release(worldId);
        viewing.add(worldId);
    }

    /** Lets a world go: its claim released (and told), or its view only ended. */
    static release(worldId) {
        if (!worldId) return;
        const { claims, viewing } = state();
        viewing.delete(worldId);
        const claim = claims.get(worldId);
        if (!claim) return;
        claims.delete(worldId);
        claim.release();
        locks().tell({ kind: "closed", worldId });
    }

    /** Whether this tab holds the world for editing. */
    static holds(worldId) {
        return !!worldId && state().claims.has(worldId);
    }

    /** Whether this tab has the world open view only. */
    static viewing(worldId) {
        return !!worldId && state().viewing.has(worldId);
    }

    /** The ids of the worlds held for editing by another tab or client. */
    static async elsewhere() {
        const { claims } = state();
        return new Set((await locks().held()).filter((id) => !claims.has(id)));
    }

    /**
     * Of the worlds given, those this tab may not write: open view only here, or held elsewhere.
     * @param {Array<string|null|undefined>} worldIds
     * @returns {Promise<string[]>}
     */
    static async refused(worldIds) {
        const ids = [...new Set(worldIds.filter(Boolean))];
        if (!ids.length) return [];
        const { claims, viewing } = state();
        const unclaimed = ids.filter((id) => !claims.has(id));
        if (!unclaimed.length) return [];
        const elsewhere = new Set(await locks().held());
        return unclaimed.filter((id) => viewing.has(id) || elsewhere.has(id));
    }

    /** Calls back once when the world's holder lets go; returns a function that stops waiting. */
    static whenFree(worldId, callback) {
        return locks().whenFree(worldId, callback);
    }

    /** Runs `fn` while no other tab runs a task of the same name (the world migration). */
    static exclusive(name, fn) {
        return locks().exclusive(name, fn);
    }

    /**
     * Tells the other tabs what was done to a world.
     * @param {"saved"|"renamed"|"created"|"deleted"|"opened"|"closed"} kind
     * @param {string|null} worldId
     */
    static tell(kind, worldId) {
        try {
            locks().tell({ kind, worldId: worldId ?? null });
        } catch (error) {
            console.warn("FWMB | The other tabs could not be told:", error);
        }
    }

    /** Hears the other tabs; returns a function that stops listening. */
    static listen(callback) {
        return locks().listen(callback);
    }
}
