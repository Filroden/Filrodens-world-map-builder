/**
 * A built place as plain data, to cross between threads: a built town holds functions (a shore's
 * tests, a cavern's sampler) that cannot be copied to another thread; `plain` keeps everything
 * else, typed arrays included, and shares what is shared. The Local studio's worker sends the kept
 * version's town and households back once, through it (the prototype's `engine/jobs.mjs`).
 */
/** A copy that can cross between threads: functions dropped, cycles and shared objects kept once. */
export function plain(value, seen = new Map()) {
    if (value === null || typeof value !== "object") return typeof value === "function" ? undefined : value;
    if (ArrayBuffer.isView(value)) return value;
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
        const out = [];
        seen.set(value, out);
        for (const item of value) out.push(plain(item, seen));
        return out;
    }
    if (value instanceof Map) {
        const out = new Map();
        seen.set(value, out);
        for (const [k, v] of value) out.set(k, plain(v, seen));
        return out;
    }
    const out = {};
    seen.set(value, out);
    for (const [k, v] of Object.entries(value)) {
        if (typeof v === "function") continue;
        out[k] = plain(v, seen);
    }
    return out;
}
