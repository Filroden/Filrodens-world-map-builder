// The v5 file structure's layers (S0 step 1, RF1): the shell and the kernel never import a studio,
// the kernel never imports the shell, a studio never imports another studio's code, and the
// platform never imports a studio. Studios share code only through the kernel, and the shell
// reaches a studio only through its registration, which the hosts hand it (src/studios/index.js).
// The kernel and the shell reach the platform only through its index (src/platform/index.js), so
// either host's implementation can stand behind it; the platform may import the kernel and the
// shell, since each host puts the shell together (its dialogues, the web page's template helpers).
//
// And no script under src/ is part of an import cycle (RF1 broke the six there were), by its static
// and dynamic imports. A worker's URL is left out of that: it starts a module graph of its own, in
// the worker, so it can't make a cycle in the page's.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Every script under src/, as a repository path. */
function scripts(folder = join(ROOT, "src")) {
    return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) return scripts(path);
        return entry.name.endsWith(".js") ? [relative(ROOT, path).replaceAll("\\", "/")] : [];
    });
}

/**
 * The repository paths a script imports (static, dynamic and worker URLs), relative ones only.
 * @param {string} path
 * @param {{workers?: boolean}} [options] - `workers: false` leaves out the workers' URLs.
 */
function importsOf(path, { workers = true } = {}) {
    const text = readFileSync(join(ROOT, path), "utf8");
    const found = [];
    for (const match of text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.\.?\/[^"']+)["']|new URL\(\s*["'](\.\.?\/[^"']+)["']\s*,\s*import\.meta\.url/g)) {
        if (!workers && match[2]) continue;
        found.push(relative(ROOT, resolve(dirname(join(ROOT, path)), match[1] ?? match[2])).replaceAll("\\", "/"));
    }
    return found;
}

/** Every script under src/ with the scripts it imports (see importsOf for the options). */
function graph(options) {
    return new Map(scripts().map((path) => [path, importsOf(path, options)]));
}

/** The layer a repository path belongs to. */
function layerOf(path) {
    if (path.startsWith("src/shell/")) return "shell";
    if (path.startsWith("src/kernel/")) return "kernel";
    if (path === "src/studios/index.js") return "studios";
    const studio = /^src\/studios\/([^/]+)\//.exec(path);
    if (studio) return `studio:${studio[1]}`;
    if (path.startsWith("src/platform/")) return "platform";
    if (path === "src/config.js") return "config";
    if (path.startsWith("vendor/")) return "vendor";
    return "other";
}

/** What each layer may import. */
const ALLOWED = {
    kernel: ["kernel", "config", "platform", "vendor"],
    shell: ["shell", "kernel", "config", "platform", "vendor"],
    // The barrel builds FILRODENSWMB from each layer's own config (RF1)
    config: ["kernel", "shell", "platform", "studio:world", "studio:local"],
};

/** The one host script that names the studios (the web page names them from web/main.js). */
const HOST = "src/platform/foundry/StudioWindow.js";

/** The platform's one way in for the kernel and the shell. */
const PLATFORM_INDEX = "src/platform/index.js";

/** Each import that crosses the layers wrongly, as "from -> to". */
function crossings(imports) {
    const found = [];
    for (const [path, targets] of imports) {
        const from = layerOf(path);
        for (const target of targets) {
            const to = layerOf(target);
            const crossing = `${path} -> ${target}`;
            if (ALLOWED[from] && !ALLOWED[from].includes(to)) found.push(crossing);
            else if (from.startsWith("studio:") && to.startsWith("studio:") && to !== from) found.push(crossing);
            else if (from === "platform" && (to.startsWith("studio:") || (to === "studios" && path !== HOST))) found.push(crossing);
            else if ((from === "kernel" || from === "shell") && to === "platform" && target !== PLATFORM_INDEX) found.push(crossing);
        }
    }
    return found;
}

/** The import cycles in a graph, each as its scripts in order (Tarjan's strongly connected components). */
function cycles(imports) {
    const index = new Map();
    const low = new Map();
    const stack = [];
    const onStack = new Set();
    const found = [];
    let next = 0;
    const visit = (path) => {
        index.set(path, next);
        low.set(path, next);
        next++;
        stack.push(path);
        onStack.add(path);
        for (const target of imports.get(path) ?? []) {
            if (!imports.has(target)) continue;
            if (!index.has(target)) {
                visit(target);
                low.set(path, Math.min(low.get(path), low.get(target)));
            } else if (onStack.has(target)) {
                low.set(path, Math.min(low.get(path), index.get(target)));
            }
        }
        if (low.get(path) !== index.get(path)) return;
        const component = [];
        let member;
        do {
            member = stack.pop();
            onStack.delete(member);
            component.push(member);
        } while (member !== path);
        const selfImport = component.length === 1 && (imports.get(path) ?? []).includes(path);
        if (component.length > 1 || selfImport) found.push(component.sort());
    };
    for (const path of imports.keys()) if (!index.has(path)) visit(path);
    return found;
}

test("the shell and the kernel never import a studio, and a studio never imports another", () => {
    const found = crossings(graph());
    assert.deepEqual(found, [], `Imports across the layers:\n${found.join("\n")}`);
});

test("no script under src/ is part of an import cycle", () => {
    const found = cycles(graph({ workers: false }));
    assert.deepEqual(found, [], `Import cycles:\n${found.map((cycle) => cycle.join(", ")).join("\n")}`);
});

test("only the hosts name the studios they offer", () => {
    const naming = scripts().filter((path) => importsOf(path).includes("src/studios/index.js"));
    assert.deepEqual(naming.sort(), [HOST]);
    const web = readFileSync(join(ROOT, "web/main.js"), "utf8");
    assert.match(web, /import\("\.\.\/src\/studios\/index\.js"\)/, "the web page names them too");
});

test("the layer check finds what it looks for", () => {
    assert.equal(layerOf("src/shell/Shell.js"), "shell");
    assert.equal(layerOf("src/studios/world/app/MapStudio.js"), "studio:world");
    assert.equal(layerOf("src/kernel/random/Random.js"), "kernel");
    assert.ok(importsOf("src/studios/world/WorldStudio.js").includes("src/studios/world/app/MapStudio.js"));
    const worker = "src/studios/world/generation/GenerationWorker.js";
    assert.ok(importsOf("src/studios/world/tools/GenerationWorkers.js").includes(worker), "a worker's URL counts for the layers");
    assert.ok(!importsOf("src/studios/world/tools/GenerationWorkers.js", { workers: false }).includes(worker), "but not for the cycles");
    // Each rule, on a made-up graph
    const made = (edges) => new Map(edges.map(([from, to]) => [from, to]));
    assert.deepEqual(crossings(made([["src/kernel/a.js", ["src/studios/world/b.js"]]])), ["src/kernel/a.js -> src/studios/world/b.js"], "the kernel importing a studio");
    assert.deepEqual(crossings(made([["src/studios/local/a.js", ["src/studios/world/b.js"]]])), ["src/studios/local/a.js -> src/studios/world/b.js"], "a studio importing another");
    assert.deepEqual(crossings(made([["src/platform/foundry/store.js", ["src/studios/world/tools/TerrainVersion.js"]]])), ["src/platform/foundry/store.js -> src/studios/world/tools/TerrainVersion.js"], "the platform importing a studio");
    assert.deepEqual(crossings(made([["src/platform/web/index.js", ["src/studios/index.js"]]])), ["src/platform/web/index.js -> src/studios/index.js"], "a platform script other than the host naming the studios");
    assert.deepEqual(crossings(made([["src/kernel/a.js", ["src/platform/foundry/index.js"]]])), ["src/kernel/a.js -> src/platform/foundry/index.js"], "the kernel reaching past the platform's index");
    assert.deepEqual(crossings(made([[HOST, ["src/studios/index.js", "src/shell/Shell.js"]], ["src/kernel/a.js", [PLATFORM_INDEX]]])), [], "what the layers allow");
    assert.deepEqual(cycles(made([["src/a.js", ["src/b.js"]], ["src/b.js", ["src/c.js"]], ["src/c.js", ["src/a.js"]], ["src/d.js", ["src/a.js"]]])), [["src/a.js", "src/b.js", "src/c.js"]], "a cycle of three, not the script leading into it");
    assert.deepEqual(cycles(made([["src/a.js", ["src/a.js"]]])), [["src/a.js"]], "a script importing itself");
    assert.deepEqual(cycles(made([["src/a.js", ["src/b.js"]], ["src/b.js", []]])), [], "no cycle");
});
