// World locks and news in memory, shared by fake tabs (WL): what the web host's Web Locks and
// BroadcastChannel give, for Node, which has neither across tabs. Each tab is a locks object as
// platform.worldLocks takes it; a test installs one tab's at a time to act as that tab.

/** One browser's locks: every tab made from it sees the same holders and hears the same news. */
export function createLockHub() {
    const holders = new Map(); // worldId -> tab
    const waiting = new Map(); // worldId -> Set<callback>
    const tabs = new Set();
    let tasks = Promise.resolve();

    const free = (worldId) => {
        const callbacks = waiting.get(worldId);
        if (!callbacks) return;
        waiting.delete(worldId);
        for (const callback of callbacks) callback();
    };

    function tab(name = `tab${tabs.size + 1}`) {
        const listeners = new Set();
        const own = new Set();
        const self = {
            name,
            available: true,
            async claim(worldId) {
                if (holders.has(worldId)) return null;
                holders.set(worldId, self);
                own.add(worldId);
                return {
                    release() {
                        if (holders.get(worldId) !== self) return;
                        holders.delete(worldId);
                        own.delete(worldId);
                        free(worldId);
                    },
                };
            },
            whenFree(worldId, callback) {
                if (!holders.has(worldId)) {
                    queueMicrotask(callback);
                    return () => {};
                }
                const set = waiting.get(worldId) ?? new Set();
                set.add(callback);
                waiting.set(worldId, set);
                return () => set.delete(callback);
            },
            async held() {
                return [...holders.keys()];
            },
            exclusive(_name, fn) {
                const run = tasks.then(() => fn());
                tasks = run.catch(() => {});
                return run;
            },
            tell(news) {
                for (const other of tabs) if (other !== self) for (const listener of other.listeners) listener({ ...news });
            },
            listen(callback) {
                listeners.add(callback);
                return () => listeners.delete(callback);
            },
            /** The tab closed or crashed: its locks go, as a browser lets a closed tab's go. */
            close() {
                for (const worldId of [...own]) {
                    holders.delete(worldId);
                    own.delete(worldId);
                    free(worldId);
                }
                tabs.delete(self);
            },
            listeners,
        };
        tabs.add(self);
        return self;
    }

    return { tab };
}
