// Help (HelpPanel) in the inspector's column, drawn from the real template in happy-dom: its
// three sections and their links (new tab, noopener), the other host's link by host, the shortcuts
// by tool; Help covering an object and bringing it back when closed, forgetting it when an object
// opens in its place or the tool changes; the rail button pressed while it shows; and the version
// details a bug report needs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { Window } from "happy-dom";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const window = new Window({ url: "http://localhost/" });
for (const name of Object.getOwnPropertyNames(window)) {
    if (/^[A-Z]/.test(name) && !(name in globalThis)) globalThis[name] = window[name];
}
Object.assign(globalThis, { window, document: window.document });
after(() => window.happyDOM.close());
const document = window.document;

const { installPlatform, platform } = await import("../../src/platform/index.js");
const { createWebTemplates, registerHelpers } = await import("../../src/platform/web/templates.js");
const { Overlay } = await import("../../src/ui/Overlay.js");
const i18n = { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" };
const handlebars = Handlebars.create();
registerHelpers(handlebars, i18n);
const templates = createWebTemplates({ handlebars, prefix: "modules/filrodens-world-map-builder/templates/", fetchText: async (path) => readFileSync(join(ROOT, "templates", path), "utf8") });
await templates.load(["parts/section.hbs", "parts/face-fields.hbs", "parts/inspector-help.hbs"]);

let host = null;
const notices = [];
const module = { version: "4.0.0", host: "web", hostVersion: null };
installPlatform({
    i18n,
    templates,
    module,
    notify: { info: (text) => notices.push(text), warn: (text) => notices.push(text), error: () => {} },
    dialogs: { dismiss: ({ placement } = {}) => host && Overlay.dismissAll(host, placement), attach: () => () => {} },
    utils: { ...platform.utils },
});

const { HelpPanel } = await import("../../src/applications/HelpPanel.js");
const { Inspector } = await import("../../src/applications/Inspector.js");
const { FILRODENSWMB } = await import("../../src/config.js");

/** An object kind for Help to cover. */
const PIN = Object.freeze({
    id: "pin",
    template: "modules/filrodens-world-map-builder/templates/parts/face-fields.hbs",
    find: (app, ref) => app.pins.find((pin) => pin.id === ref.id) ?? null,
    header: (_app, pin) => ({ title: pin.name }),
    context: () => ({ face: { bold: true, italic: true } }),
    apply: () => false,
});

function studio() {
    document.body.innerHTML = '<div class="fwmb-studio"><button data-action="toggleHelp" aria-pressed="false"></button></div>';
    host = document.querySelector(".fwmb-studio");
    return { root: host, pins: [{ id: "keep", name: "Keep" }, { id: "port", name: "Port" }], mapWidth: 400, mapHeight: 300, meshSession: { mesh: { cellCount: 1234 } }, _expandedSections: new Set(), _collapsedSections: new Set(), view: { render: () => {} } };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const shown = (app) => Inspector.current(app)?.kind.id ?? null;

beforeEach(() => {
    notices.length = 0;
    module.host = "web";
});

test("Help holds About, Help and Acknowledgements, every link opening in a new tab", async () => {
    const app = studio();
    await HelpPanel.open(app);
    const dialog = app.root.querySelector("dialog.fwmb-inspector--help");
    assert.ok(dialog);
    assert.deepEqual([...dialog.querySelectorAll(":scope .fwmb-overlay-body > details > summary .fwmb-section-title")].map((title) => title.textContent), ["FILRODENSWMB.UI.HelpAbout", "FILRODENSWMB.UI.HelpHelp", "FILRODENSWMB.UI.HelpAcknowledgements"]);
    const links = [...dialog.querySelectorAll("a")];
    assert.ok(links.length > 10);
    assert.ok(links.every((link) => link.target === "_blank" && link.rel === "noopener" && link.querySelector(".fwmb-icon--open-in-new")));
    const hrefs = links.map((link) => link.getAttribute("href"));
    for (const url of [FILRODENSWMB.HELP.SPONSOR, FILRODENSWMB.HELP.REPOSITORY, FILRODENSWMB.HELP.LICENCE, FILRODENSWMB.HELP.CHANGELOG, FILRODENSWMB.HELP.WIKI, FILRODENSWMB.HELP.TUTORIAL, FILRODENSWMB.HELP.ISSUE, FILRODENSWMB.HELP.FOUNDRY_PACKAGE]) assert.ok(hrefs.includes(url), url);
    assert.equal(hrefs.includes(FILRODENSWMB.HELP.WEB_VERSION), false, "the web version is not offered on the web");
    assert.ok(dialog.querySelectorAll('[data-section^="helpShortcuts"]').length > 3, "a fold per tool");
    assert.ok(dialog.querySelector('[data-inspector-action="copyVersion"]') && dialog.querySelector('[data-inspector-action="showShortcuts"]'));
    assert.equal(app.root.querySelector('[data-action="toggleHelp"]').getAttribute("aria-pressed"), "true");
    Inspector.close(app);
    await settle();
    assert.equal(app.root.querySelector('[data-action="toggleHelp"]').getAttribute("aria-pressed"), "false");

    module.host = "foundry";
    const context = HelpPanel.context(app);
    assert.equal(context.links.otherHost.url, FILRODENSWMB.HELP.WEB_VERSION, "Foundry offers the web version");
});

test("Help covers what the inspector showed and brings it back when closed", async () => {
    const app = studio();
    await Inspector.open(app, PIN, { id: "keep" });
    await HelpPanel.toggle(app);
    assert.equal(shown(app), "help");
    await HelpPanel.toggle(app);
    await settle();
    await settle();
    assert.equal(shown(app), "pin", "closing Help brings the pin back");
    assert.equal(Inspector.current(app).ref.id, "keep");
});

test("an object opened while Help shows replaces it, and Help forgets what it covered", async () => {
    const app = studio();
    await Inspector.open(app, PIN, { id: "keep" });
    await HelpPanel.open(app);
    await Inspector.open(app, PIN, { id: "port" });
    await settle();
    assert.equal(Inspector.current(app).ref.id, "port");
    Inspector.close(app);
    await settle();
    await settle();
    assert.equal(shown(app), null, "nothing comes back");

    // A tool change forgets it too
    await Inspector.open(app, PIN, { id: "keep" });
    await HelpPanel.open(app);
    HelpPanel.forget(app);
    platform.dialogs.dismiss({ placement: "docked" });
    await settle();
    await settle();
    assert.equal(shown(app), null);
});

test("the version details hold the module, the host, the browser, WebGL and the map", async () => {
    const app = studio();
    const text = HelpPanel.versionDetails(app);
    const lines = text.split("\n");
    assert.equal(lines.length, 5);
    assert.match(lines[0], /4\.0\.0/);
    assert.match(lines[1], /HelpHostWeb/);
    assert.match(lines[4], /"width":400.*"height":300.*"cells":1234/);
    module.host = "foundry";
    module.hostVersion = "14.350";
    assert.match(HelpPanel.versionDetails(app).split("\n")[1], /Foundry VTT 14\.350/);
});
