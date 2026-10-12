// Every data-action a template uses has a handler in the studio's action table, so a renamed or
// removed handler is caught here rather than by a button that does nothing in Foundry.
//
// The table is read from the source of MapStudioApp.js rather than imported, because importing
// the class needs Foundry's ApplicationV2 at module load. Each handler is one line of the form
// `name(e, t) { ... }` inside DEFAULT_OPTIONS.actions. When the thin-frame work turns the table
// into a plain object on the controller, import it here instead and drop the parsing.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const APP_SOURCE = join(ROOT, "src/applications/MapStudioApp.js");
const TEMPLATES = join(ROOT, "templates");

/** The action names in MapStudioApp's handler table. */
function handlerNames() {
    const source = readFileSync(APP_SOURCE, "utf8");
    const start = source.indexOf("actions: {");
    assert.ok(start > 0, "DEFAULT_OPTIONS.actions not found in MapStudioApp.js");
    // The table ends at the first line holding only a closing brace at its indentation
    const end = source.indexOf("\n        },", start);
    const table = source.slice(start, end);
    return new Set([...table.matchAll(/^\s+([A-Za-z]\w*)\(e, t\)/gm)].map((match) => match[1]));
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
