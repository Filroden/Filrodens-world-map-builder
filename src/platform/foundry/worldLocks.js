/**
 * Foundry's world locks and news (the platform's `worldLocks` service, see ../index.js; WL). Two
 * GM clients can open the studio in the same Foundry world, so a world open for editing in one is
 * opened view only in the other, as a second tab is on the web.
 *
 * Two world settings, registered and not shown, carry it (no socket, so no change to module.json):
 * - `worldLocks`: the holders, `{ [worldId]: { user, client, at } }`. The holder is the client (a
 *   page load), not the user, since one user may be connected from two browsers. A holder whose
 *   user is no longer connected is ignored by every client and dropped by the active GM when
 *   Foundry says the user left (userConnected), so nothing needs a heartbeat. A client that
 *   crashes while its user stays connected in another browser keeps its holder until that user
 *   leaves too (said in the wiki).
 * - `worldNews`: the latest news, `{ kind, worldId, client, at }`, kept apart from the holders so
 *   a save told never races a claim.
 *
 * A world setting's change reaches every client, which is how both are heard. Each client reads
 * the holders again after its own write arrives, so of two clients claiming the same world at the
 * same moment only the one whose write landed last keeps it.
 */
import { FILRODENSWMB } from "../../config.js";

const LOCKS = "worldLocks";
const NEWS = "worldNews";

/** This page load's id: a holder's client. */
const CLIENT = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 18);

const listeners = new Set();
const waiters = new Map(); // worldId -> Set<callback>
const mine = new Set();
let lastNews = null;

const key = (name) => `${FILRODENSWMB.ID}.${name}`;
const read = () => {
    try {
        const value = game.settings.get(FILRODENSWMB.ID, LOCKS);
        return value && typeof value === "object" ? structuredClone(value) : {};
    } catch {
        return {};
    }
};
const live = (holder) => !!holder && !!game.users?.get(holder.user)?.active;
const write = (holders) => game.settings.set(FILRODENSWMB.ID, LOCKS, holders);

/** Calls back those waiting for a world that is free now. */
function wakeWaiters() {
    const holders = read();
    for (const [worldId, callbacks] of [...waiters]) {
        if (live(holders[worldId]) && holders[worldId].client !== CLIENT) continue;
        waiters.delete(worldId);
        for (const callback of callbacks) callback();
    }
}

/**
 * Registers the settings and the hook; called once at init (main.js), before any world opens.
 */
export function registerWorldLocks() {
    game.settings.register(FILRODENSWMB.ID, LOCKS, { scope: "world", config: false, type: Object, default: {}, onChange: () => wakeWaiters() });
    game.settings.register(FILRODENSWMB.ID, NEWS, {
        scope: "world",
        config: false,
        type: Object,
        default: {},
        onChange: (news) => {
            if (!news?.kind || news.client === CLIENT || news.at === lastNews) return;
            lastNews = news.at;
            for (const listener of listeners) listener({ kind: news.kind, worldId: news.worldId ?? null });
        },
    });
    Hooks.on("userConnected", (user, connected) => {
        if (connected) return;
        wakeWaiters();
        // The active GM drops the holders of a user who left, so the setting stays tidy
        if (!game.users?.activeGM?.isSelf) return;
        const holders = read();
        const gone = Object.keys(holders).filter((worldId) => holders[worldId]?.user === user.id);
        if (!gone.length) return;
        for (const worldId of gone) delete holders[worldId];
        write(holders).catch((error) => console.warn("FWMB | A world lock could not be dropped:", error));
    });
}

export const foundryWorldLocks = {
    available: true,

    async claim(worldId) {
        const holders = read();
        const holder = holders[worldId];
        if (live(holder) && holder.client !== CLIENT) return null;
        holders[worldId] = { user: game.user.id, client: CLIENT, at: Date.now() };
        try {
            await write(holders);
        } catch (error) {
            console.warn("FWMB | The world could not be locked; it is open for editing here regardless:", error);
            return { release() {} };
        }
        // Another client's claim of the same world may have landed after this one
        if (read()[worldId]?.client !== CLIENT) return null;
        mine.add(worldId);
        return {
            release() {
                if (!mine.delete(worldId)) return;
                const now = read();
                if (now[worldId]?.client !== CLIENT) return;
                delete now[worldId];
                write(now).catch((error) => console.warn("FWMB | A world lock could not be released:", error));
            },
        };
    },

    whenFree(worldId, callback) {
        const set = waiters.get(worldId) ?? new Set();
        set.add(callback);
        waiters.set(worldId, set);
        queueMicrotask(wakeWaiters);
        return () => set.delete(callback);
    },

    async held() {
        const holders = read();
        return Object.keys(holders).filter((worldId) => live(holders[worldId]));
    },

    /** Foundry runs the studio's start in each client alone; nothing to wait for. */
    async exclusive(_name, fn) {
        return fn();
    },

    tell(news) {
        const at = `${Date.now()}-${CLIENT}`;
        lastNews = at;
        game.settings.set(FILRODENSWMB.ID, NEWS, { kind: news.kind, worldId: news.worldId ?? null, client: CLIENT, at }).catch((error) => console.warn("FWMB | The other clients could not be told:", error));
    },

    listen(callback) {
        listeners.add(callback);
        return () => listeners.delete(callback);
    },
};

/** For tests: the setting keys. */
export const WORLD_LOCK_SETTINGS = Object.freeze({ locks: key(LOCKS), news: key(NEWS) });
