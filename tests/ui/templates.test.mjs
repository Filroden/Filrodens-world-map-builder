// Every Handlebars template compiles, calls only helpers the module knows about, and names only
// partials that exist. Foundry registers its own helpers (localize, eq, or, numberFormat among
// them) in the studio window, but the web host has to register them itself, so a template that
// quietly relied on another Foundry helper would work in Foundry and fail on the web. Handlebars
// only reports a missing helper when the template is rendered, so the helper calls are read from
// the parsed template instead and checked against the list below.
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
 * Helpers the templates may call. Handlebars' own (if, unless, each, with, lookup, log) are always
 * there; the rest are Foundry's, which the studio window gets for free and the web host must
 * register itself (see the thin-frame plan). Add a helper here when the module starts registering
 * it on both hosts.
 */
const KNOWN_HELPERS = new Set(["if", "unless", "each", "with", "lookup", "log", "localize", "eq", "or", "numberFormat"]);

/**
 * The names of every helper a template calls: any mustache, block or subexpression with
 * parameters or a hash (a bare `{{name}}` is a context lookup and is left alone).
 *
 * @param {object} node - A node of the parsed template.
 * @param {Set<string>} found - Collects the helper names.
 */
function collectHelpers(node, found) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
        for (const child of node) collectHelpers(child, found);
        return;
    }
    const isCall = ["MustacheStatement", "BlockStatement", "SubExpression", "PartialStatement"].includes(node.type);
    if (isCall && node.type !== "PartialStatement" && (node.params?.length || node.hash?.pairs?.length) && node.path?.type === "PathExpression") {
        found.add(node.path.original);
    }
    for (const [key, value] of Object.entries(node)) if (key !== "loc" && key !== "path") collectHelpers(value, found);
}

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
    test(`${path} compiles and calls only known helpers`, () => {
        const source = readFileSync(join(TEMPLATES, path), "utf8");
        const ast = Handlebars.parse(source);
        assert.doesNotThrow(() => Handlebars.compile(ast));
        const helpers = new Set();
        collectHelpers(ast.body, helpers);
        const unknown = [...helpers].filter((name) => !KNOWN_HELPERS.has(name));
        assert.deepEqual(unknown, [], `helpers not registered on both hosts: ${unknown.join(", ")}`);
    });
}

test("every statically named partial exists", () => {
    const missing = [];
    for (const path of templates) {
        const source = readFileSync(join(TEMPLATES, path), "utf8");
        // Partials ({{> "…"}}) and partial blocks ({{#> "…"}} … {{/"…"}})
        for (const match of source.matchAll(/\{\{#?>\s*"([^"]+)"/g)) {
            const named = match[1];
            const file = named.startsWith(FOUNDRY_PREFIX) ? join(TEMPLATES, named.slice(FOUNDRY_PREFIX.length)) : join(TEMPLATES, named);
            if (!existsSync(file)) missing.push(`${path} -> ${named}`);
        }
    }
    assert.deepEqual(missing, []);
});

test("Foundry preloads every template drawn as a partial", () => {
    // In Foundry a template is a partial only once loadTemplates has registered it (the web host
    // registers them all); the dialogues and the window's frame are rendered by path instead
    const main = readFileSync(join(ROOT, "main.js"), "utf8");
    const preloaded = new Set([...main.matchAll(/"modules\/filrodens-world-map-builder\/templates\/([^"]+)"/g)].map((match) => match[1]));
    const missing = templates.filter((path) => !path.startsWith("dialogs/") && path !== "studio.hbs" && !preloaded.has(path));
    assert.deepEqual(missing, []);
    const gone = [...preloaded].filter((path) => !templates.includes(path));
    assert.deepEqual(gone, [], "preloaded templates that no longer exist");
});
