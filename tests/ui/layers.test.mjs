// The v5 file structure's layers (S0 step 1): the shell and the kernel never import a studio, the
// kernel never imports the shell, and a studio never imports another studio's code. Studios share
// code only through the kernel, and the shell reaches a studio only through its registration,
// which the hosts hand it (src/studios/index.js).
//
// One exception is known and kept for now: the Foundry platform's scene export and store still
// reach into the World studio (SceneExporter, store.js). The export dialogue moves into the kernel
// in S0 step 7, and these move with it.
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

/** The repository paths a script imports (static, dynamic and worker URLs), relative ones only. */
function importsOf(path) {
    const text = readFileSync(join(ROOT, path), "utf8");
    const found = [];
    for (const match of text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.\.?\/[^"']+)["']|new URL\(\s*["'](\.\.?\/[^"']+)["']\s*,\s*import\.meta\.url/g)) {
        found.push(relative(ROOT, resolve(dirname(join(ROOT, path)), match[1] ?? match[2])).replaceAll("\\", "/"));
    }
    return found;
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
    config: ["kernel"],
};

/** The known exceptions (see the comment at the top). */
const KNOWN = new Set(["src/platform/foundry/SceneExporter.js", "src/platform/foundry/store.js"]);

test("the shell and the kernel never import a studio, and a studio never imports another", () => {
    const crossings = [];
    for (const path of scripts()) {
        const from = layerOf(path);
        for (const target of importsOf(path)) {
            const to = layerOf(target);
            if (ALLOWED[from] && !ALLOWED[from].includes(to)) crossings.push(`${path} -> ${target}`);
            if (from.startsWith("studio:") && to.startsWith("studio:") && to !== from) crossings.push(`${path} -> ${target}`);
            if (from === "platform" && to.startsWith("studio:") && !KNOWN.has(path) && !path.startsWith("src/platform/foundry/StudioWindow.js")) crossings.push(`${path} -> ${target}`);
        }
    }
    assert.deepEqual(crossings, [], `Imports across the layers:\n${crossings.join("\n")}`);
});

test("only the hosts name the studios they offer", () => {
    const naming = scripts().filter((path) => importsOf(path).includes("src/studios/index.js"));
    assert.deepEqual(naming.sort(), ["src/platform/foundry/StudioWindow.js"]);
    const web = readFileSync(join(ROOT, "web/main.js"), "utf8");
    assert.match(web, /import\("\.\.\/src\/studios\/index\.js"\)/, "the web page names them too");
});

test("the layer check finds what it looks for", () => {
    assert.equal(layerOf("src/shell/Shell.js"), "shell");
    assert.equal(layerOf("src/studios/world/app/MapStudio.js"), "studio:world");
    assert.equal(layerOf("src/kernel/random/Random.js"), "kernel");
    assert.ok(importsOf("src/studios/world/WorldStudio.js").includes("src/studios/world/app/MapStudio.js"));
});
