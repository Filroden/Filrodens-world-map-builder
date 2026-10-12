// Every Handlebars template compiles with only the helpers the module provides or registers, and
// every partial it names exists. Foundry registers its own helpers (localize among them) in the
// studio window, but the web host has to register them itself, so a template that quietly relied
// on a Foundry-only helper would compile in Foundry and fail on the web. Compiling here with
// knownHelpersOnly turns that into a build-time failure.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import Handlebars from "handlebars";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TEMPLATES = join(ROOT, "templates");
// Where the templates are served from in Foundry; partials are named by this path
const FOUNDRY_PREFIX = "modules/filrodens-world-map-builder/templates/";

/**
 * Helpers a template may call with arguments. Handlebars' own block helpers are always known;
 * these are the ones the module relies on beyond them (Foundry provides localize in the studio
 * window; the web host registers its own). Add a helper here when the module starts registering
 * it on both hosts.
 */
const KNOWN_HELPERS = { localize: true };

/** Every .hbs file under templates/, as paths relative to the templates folder with / separators. */
function listTemplates(dir = TEMPLATES) {
    const found = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) found.push(...listTemplates(path));
        else if (name.endsWith(".hbs")) found.push(relative(TEMPLATES, path).replaceAll("\\", "/"));
    }
    return found.sort();
}

const templates = listTemplates();

test("there are templates to check", () => {
    assert.ok(templates.length > 20, `found ${templates.length} templates under templates/`);
});

for (const path of templates) {
    test(`${path} compiles with the module's helpers only`, () => {
        const source = readFileSync(join(TEMPLATES, path), "utf8");
        assert.doesNotThrow(() => Handlebars.compile(source, { knownHelpers: KNOWN_HELPERS, knownHelpersOnly: true, strict: false }));
    });
}

test("every statically named partial exists", () => {
    const missing = [];
    for (const path of templates) {
        const source = readFileSync(join(TEMPLATES, path), "utf8");
        for (const match of source.matchAll(/\{\{>\s*"([^"]+)"/g)) {
            const named = match[1];
            const file = named.startsWith(FOUNDRY_PREFIX) ? join(TEMPLATES, named.slice(FOUNDRY_PREFIX.length)) : join(TEMPLATES, named);
            if (!existsSync(file)) missing.push(`${path} -> ${named}`);
        }
    }
    assert.deepEqual(missing, []);
});
