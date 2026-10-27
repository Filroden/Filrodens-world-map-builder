// The few Foundry globals the module code reached by these tests calls, so it can run under Node:
// deep clones, ids, localisation that returns its key, and a compendium whose one journal entry
// records the updates it is sent. Import before the module code.
let idCounter = 0;
/** Stands in for foundry.data.operators.ForcedDeletion: a value that deletes its key in an update. */
class ForcedDeletion {}

globalThis.foundry = {
    data: { operators: { ForcedDeletion } },
    utils: { deepClone: (value) => structuredClone(value), randomID: () => `stub${String(idCounter++).padStart(12, "0")}`, debounce: (fn) => fn },
    applications: { handlebars: { renderTemplate: async () => "<p>summary</p>" } },
};
globalThis.game = { i18n: { localize: (key) => key, format: (key) => key }, packs: new Map() };
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };

/**
 * A compendium with one journal entry whose flags start as `flags`. Its updates are applied the
 * way Foundry applies them (objects merged into what is there, a ForcedDeletion value deleting its
 * key) and recorded.
 */
export function stubCompendium(id, flags) {
    const doc = {
        id,
        flags: structuredClone(flags),
        pages: { contents: [{ id: "page1" }] },
        updates: [],
        async update(data) {
            this.updates.push(data);
            for (const [path, value] of Object.entries(data)) applyUpdate(this, path, value);
            return this;
        },
    };
    const pack = { collection: "world.fwmb-maps", getDocument: async (docId) => (docId === id ? doc : null) };
    globalThis.game.packs = new Map([["world.fwmb-maps", pack]]);
    globalThis.JournalEntry = { create: async (data) => ({ id: "new", ...data }) };
    return doc;
}

function applyUpdate(doc, path, value) {
    const parts = path.split(".");
    const last = parts.pop();
    let target = doc;
    for (const part of parts) target = target[part] ??= {};
    if (value instanceof ForcedDeletion) delete target[last];
    else if (isPlainObject(value) && isPlainObject(target[last])) for (const [key, inner] of Object.entries(value)) applyUpdate(target[last], key, inner);
    else target[last] = structuredClone(value);
}

const isPlainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value) && !ArrayBuffer.isView(value);
