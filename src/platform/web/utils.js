/**
 * The web host's general helpers (the platform's `utils` service), behaving as Foundry's own do
 * where the shared code depends on it (see src/platform/index.js).
 */

/** Characters a random id is drawn from, as Foundry's ids are. */
const ID_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 16;

/** Characters escaped for HTML, and what each becomes (the same set Handlebars escapes). */
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;", "`": "&#x60;", "=": "&#x3D;" };

/** Input types read as numbers by readForm. */
const NUMBER_INPUTS = new Set(["number", "range"]);

/** A 16-character random id. */
export function randomID() {
    const values = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
    return Array.from(values, (value) => ID_CHARACTERS[value % ID_CHARACTERS.length]).join("");
}

function isPlainObject(value) {
    if (value === null || typeof value !== "object") return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/**
 * A copy of plain data: arrays and plain objects are copied all the way down and dates are
 * copied; anything else (class instances, typed arrays) is shared, as Foundry's deepClone does.
 */
export function deepClone(value) {
    if (Array.isArray(value)) return value.map(deepClone);
    if (value instanceof Date) return new Date(value);
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deepClone(entry)]));
}

/** Calls `fn` once calls to the returned function have stopped for `delay` milliseconds. */
export function debounce(fn, delay) {
    let timer = null;
    return function debounced(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

/** Path parts never followed or written: they would reach an object's prototype rather than its own data. */
const UNSAFE_PARTS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Turns dotted keys ("label.color") into nested objects. A key with a `__proto__`, `constructor`
 * or `prototype` part is skipped: followed, it would walk onto Object.prototype and write there
 * for every object in the page.
 */
function expandDottedKeys(source) {
    const expanded = {};
    for (const [key, value] of Object.entries(source)) {
        const path = key.split(".");
        if (path.some((part) => UNSAFE_PARTS.has(part))) continue;
        const last = path.pop();
        let target = expanded;
        for (const part of path) target = target[part] = isPlainObject(target[part]) ? target[part] : {};
        target[last] = value;
    }
    return expanded;
}

/**
 * Merges `source` into `target` (which is changed and returned): plain objects are merged key by
 * key all the way down, anything else replaces what was there, and dotted keys in `source` are
 * expanded first. This is what Foundry's mergeObject does with its default options, except that
 * keys reaching a prototype are never merged (see expandDottedKeys).
 */
export function mergeObject(target, source = {}) {
    for (const [key, value] of Object.entries(expandDottedKeys(source))) {
        if (UNSAFE_PARTS.has(key)) continue;
        if (isPlainObject(value) && isPlainObject(target[key])) mergeObject(target[key], value);
        else target[key] = value;
    }
    return target;
}

/** Text made safe to place in HTML, attribute values included. */
export function escapeHtml(text) {
    return String(text ?? "").replace(/[&<>"'`=]/g, (character) => HTML_ESCAPES[character]);
}

/** One field's value as readForm reports it. */
function fieldValue(field) {
    if (field.type === "checkbox") return field.checked;
    if (NUMBER_INPUTS.has(field.type)) return field.value === "" ? null : Number(field.value);
    if (field.localName === "select" && field.multiple) return [...field.selectedOptions].map((option) => option.value);
    return field.value;
}

/**
 * A form's named fields as a flat object, by name: checkboxes as booleans, number inputs and
 * sliders as numbers, multiple selects as arrays, a radio group as its checked value. Disabled
 * fields and buttons are left out.
 */
export function readForm(form) {
    const data = {};
    for (const field of form.elements) {
        if (!field.name || field.disabled || field.localName === "button" || field.localName === "fieldset") continue;
        if (field.type === "radio") {
            if (field.checked) data[field.name] = field.value;
            continue;
        }
        data[field.name] = fieldValue(field);
    }
    return data;
}
