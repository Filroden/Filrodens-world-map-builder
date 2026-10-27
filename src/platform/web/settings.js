/**
 * The module's settings on the web (the platform's `settings` service), kept in the browser's
 * local storage under "fwmb.<key>". Foundry's world and client scopes are the same thing here:
 * one reader, one browser.
 *
 * A setting is registered with its default (and optionally an onChange callback) before it is
 * read, as in Foundry. When storage cannot be used (a private window that refuses it, say) the
 * values are kept in memory for the session instead, so the studio still works.
 */

const PREFIX = "fwmb.";

/** Storage that keeps values in memory only. */
function memoryStorage() {
    const values = new Map();
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
    };
}

/** The storage to use: the given one if it can be written to, otherwise memory. */
function usableStorage(storage) {
    try {
        storage.setItem(`${PREFIX}probe`, "1");
        return storage;
    } catch {
        return memoryStorage();
    }
}

/**
 * @param {Storage} [storage] - Defaults to the browser's local storage.
 */
export function createWebSettings(storage = globalThis.localStorage) {
    const store = storage ? usableStorage(storage) : memoryStorage();
    const configs = new Map();

    function read(key) {
        const raw = store.getItem(PREFIX + key);
        if (raw === null) return undefined;
        try {
            return JSON.parse(raw);
        } catch {
            return undefined;
        }
    }

    return {
        register(key, config) {
            configs.set(key, config);
        },
        get(key) {
            const config = configs.get(key);
            if (!config) throw new Error(`Setting "${key}" is not registered`);
            return read(key) ?? structuredClone(config.default);
        },
        async set(key, value) {
            const config = configs.get(key);
            if (!config) throw new Error(`Setting "${key}" is not registered`);
            store.setItem(PREFIX + key, JSON.stringify(value));
            config.onChange?.(value);
            return value;
        },
    };
}
