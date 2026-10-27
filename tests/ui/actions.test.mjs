// Every data-action a template uses has a handler in the studio's action table, so a renamed or
// removed handler is caught here rather than by a button that does nothing in Foundry.
//
// The table is imported from the studio itself, which loads without Foundry.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TEMPLATES = join(ROOT, "templates");

const { MapStudio } = await import("../../src/applications/MapStudio.js");

/** The action names in the studio's handler table. */
function handlerNames() {
    return new Set(Object.keys(MapStudio.ACTIONS));
}

/** Every data-action value in the templates, with the templates that use it. */
function templateActions(dir = TEMPLATES, found = new Map()) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            templateActions(path, found);
        } else if (name.endsWith(".hbs")) {
            for (const match of readFileSync(path, "utf8").matchAll(/data-action="([^"{}]+)"/g)) {
                if (!found.has(match[1])) found.set(match[1], []);
                found.get(match[1]).push(name);
            }
        }
    }
    return found;
}

test("every data-action in the templates has a handler", () => {
    const handlers = handlerNames();
    assert.ok(handlers.size > 50, `found ${handlers.size} handlers`);
    const actions = templateActions();
    assert.ok(actions.size > 30, `found ${actions.size} distinct actions in templates`);
    const unhandled = [...actions].filter(([action]) => !handlers.has(action)).map(([action, files]) => `${action} (${[...new Set(files)].join(", ")})`);
    assert.deepEqual(unhandled, []);
});
