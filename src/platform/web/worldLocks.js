/**
 * The web host's world locks and news (the platform's `worldLocks` service, see ../index.js): a
 * world open for editing holds a Web Lock on its id, so another tab of the same site opens it view
 * only, and what one tab writes is told to the others on a BroadcastChannel (WL).
 *
 * A Web Lock belongs to its tab: closing or crashing the tab lets it go, so none is ever left
 * behind. Both APIs need a secure context (https, or localhost for serve:web). Without
 * `navigator.locks` every claim succeeds, as before WL, and the console says so once; without
 * BroadcastChannel nothing is told.
 */

/** Every world lock's name starts so; the id follows. */
const WORLD_PREFIX = "fwmb-world:";

/** Other locks' names (the migration's, see exclusive) start so. */
const TASK_PREFIX = "fwmb-task:";

/** The channel the news goes on. */
const CHANNEL = "fwmb";

/**
 * @param {object} [options] - For tests: the lock manager and channel class to use.
 * @param {LockManager|null} [options.locks]
 * @param {typeof BroadcastChannel|null} [options.Channel]
 */
export function createWebWorldLocks({ locks = globalThis.navigator?.locks ?? null, Channel = globalThis.BroadcastChannel ?? null } = {}) {
    let said = false;
    const sayUnavailable = () => {
        if (said) return;
        said = true;
        console.info("FWMB | This page cannot lock worlds (it needs https or localhost), so a world can be open for editing in more than one tab here.");
    };

    const listeners = new Set();
    let channel = null;
    const openChannel = () => {
        if (channel || !Channel) return channel;
        channel = new Channel(CHANNEL);
        channel.onmessage = (event) => {
            const news = event?.data;
            if (!news || typeof news.kind !== "string") return;
            for (const listener of listeners) listener(news);
        };
        return channel;
    };

    return {
        get available() {
            return !!locks;
        },

        /** A claim on the world (`{ release() }`), or null when another tab holds it. */
        claim(worldId) {
            if (!locks) {
                sayUnavailable();
                return Promise.resolve({ release() {} });
            }
            return new Promise((resolve) => {
                locks
                    .request(`${WORLD_PREFIX}${worldId}`, { ifAvailable: true }, (lock) => {
                        if (!lock) {
                            resolve(null);
                            return undefined;
                        }
                        // Held until released: the request's promise is kept open until then
                        return new Promise((done) => {
                            let released = false;
                            resolve({
                                release() {
                                    if (released) return;
                                    released = true;
                                    done();
                                },
                            });
                        });
                    })
                    .catch(() => resolve(null));
            });
        },

        /**
         * Calls back once when the holder of the world lets go (a shared request waits behind it
         * and lets go at once). Returns a function that stops waiting.
         */
        whenFree(worldId, callback) {
            if (!locks) return () => {};
            const stop = new AbortController();
            locks
                .request(`${WORLD_PREFIX}${worldId}`, { mode: "shared", signal: stop.signal }, () => {
                    if (!stop.signal.aborted) callback();
                })
                .catch(() => {});
            return () => stop.abort();
        },

        /** The ids of the worlds held for editing (by any tab, this one's included). */
        async held() {
            if (!locks) return [];
            try {
                const { held = [] } = await locks.query();
                return held.filter((lock) => lock.mode === "exclusive" && lock.name?.startsWith(WORLD_PREFIX)).map((lock) => lock.name.slice(WORLD_PREFIX.length));
            } catch {
                return [];
            }
        },

        /** Runs `fn` while no other tab runs a task of the same name (it waits its turn). */
        exclusive(name, fn) {
            if (!locks) return Promise.resolve().then(fn);
            return locks.request(`${TASK_PREFIX}${name}`, () => fn());
        },

        /** Tells the other tabs (never this one) what was done to a world. */
        tell(news) {
            try {
                openChannel()?.postMessage({ kind: news.kind, worldId: news.worldId ?? null });
            } catch (error) {
                console.warn("FWMB | The other tabs could not be told:", error);
            }
        },

        /** Hears what the other tabs tell; returns a function that stops listening. */
        listen(callback) {
            openChannel();
            listeners.add(callback);
            return () => listeners.delete(callback);
        },
    };
}
