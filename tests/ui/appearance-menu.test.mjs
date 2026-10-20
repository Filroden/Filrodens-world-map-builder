// The rail's Appearance menu (AppearanceMenu) and its markup in the rail (toolbar.hbs), in
// happy-dom: Mode and Hue as two groups of menuitemradio items with the current choice checked, the
// button named by the choice; a choice is stored and shown at once in the menu and in More; Up,
// Down, Home and End move through the items, Enter chooses leaving the menu open, Escape closes it
// and returns focus to the button. And the web host's full screen.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
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

const { installPlatform } = await import("../../src/platform/index.js");
const { createWebTemplates, registerHelpers } = await import("../../src/platform/web/templates.js");
const i18n = { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" };
const handlebars = Handlebars.create();
registerHelpers(handlebars, i18n);
const templates = createWebTemplates({ handlebars, prefix: "modules/filrodens-world-map-builder/templates/", fetchText: async (path) => readFileSync(join(ROOT, "templates", path), "utf8") });
await templates.load(["toolbar.hbs"]);

const stored = new Map();
installPlatform({
    i18n,
    templates,
    settings: { register: () => {}, get: (key) => stored.get(key), set: async (key, value) => stored.set(key, value) },
});

const { AppearanceMenu } = await import("../../src/ui/AppearanceMenu.js");
const { FILRODENSWMB } = await import("../../src/config.js");

/** The rail as the studio draws it, with the occasional group's entries. */
async function rail() {
    const occasional = FILRODENSWMB.STUDIO.OCCASIONAL.filter((entry) => !entry.host).map((entry) => (entry.menu ? { ...entry, appearance: AppearanceMenu.context() } : entry.tool ? { tool: entry.tool, ...FILRODENSWMB.STUDIO.TOOLS[entry.tool] } : entry));
    document.body.innerHTML = `<div class="fwmb-studio"><div class="fwmb-toolbar">${await templates.render("modules/filrodens-world-map-builder/templates/toolbar.hbs", { railStages: [], railOccasional: occasional })}</div></div>`;
    return document.querySelector(".fwmb-studio");
}

const key = (target, name) => {
    const event = new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: target });
    return AppearanceMenu.handleKey(document.querySelector(".fwmb-studio"), event);
};

test("the menu holds Mode (Auto, Light, Dark) and Hue (Gold, Teal), the current choice checked, the button named by it", async () => {
    stored.set("themeMode", "dark");
    stored.set("themeHue", "teal");
    const root = await rail();
    const menu = root.querySelector(".fwmb-appearance-menu");
    assert.equal(menu.getAttribute("role"), "menu");
    const groups = [...menu.querySelectorAll('[role="group"]')].map((group) => [...group.querySelectorAll('[role="menuitemradio"]')].map((item) => item.dataset.value + (item.getAttribute("aria-checked") === "true" ? "*" : "")));
    assert.deepEqual(groups, [["auto", "light", "dark*"], ["gold", "teal*"]]);
    const button = root.querySelector('[data-action="toggleAppearance"]');
    assert.match(button.dataset.tooltip, /AppearanceTooltip.*ThemeModeDark.*ThemeHue\.Teal/);
    // More holds the same two groups, inline
    assert.equal(root.querySelectorAll('.fwmb-rail-more [role="menuitemradio"]').length, 5);
});

test("a choice is stored and shown at once, in the menu, in More and in the button's name", async () => {
    stored.set("themeMode", "auto");
    stored.set("themeHue", "gold");
    const root = await rail();
    await AppearanceMenu.choose(root, root.querySelector('.fwmb-appearance-menu [data-value="light"]'));
    assert.equal(stored.get("themeMode"), "light");
    const checked = [...root.querySelectorAll('[data-theme-key="themeMode"][aria-checked="true"]')].map((item) => item.dataset.value);
    assert.deepEqual(checked, ["light", "light"], "the menu and More both show it");
    assert.match(root.querySelector('[data-action="toggleAppearance"]').dataset.tooltip, /ThemeModeLight/);
});

test("Up, Down, Home and End move through the items; Enter chooses, leaving the menu; Escape closes and returns focus", async () => {
    stored.set("themeMode", "auto");
    stored.set("themeHue", "gold");
    const root = await rail();
    const items = [...root.querySelectorAll('.fwmb-appearance-menu [role="menuitemradio"]')];
    items[0].focus();
    assert.ok(key(items[0], "ArrowDown"));
    assert.equal(document.activeElement, items[1]);
    assert.ok(key(items[1], "End"));
    assert.equal(document.activeElement, items[4]);
    assert.ok(key(items[4], "ArrowDown"));
    assert.equal(document.activeElement, items[0], "it wraps round");
    assert.ok(key(items[0], "ArrowUp"));
    assert.ok(key(items[4], "Home"));
    assert.equal(document.activeElement, items[0]);

    assert.ok(key(items[4], "Enter"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(stored.get("themeHue"), "teal");
    assert.ok(key(items[2], "Escape"));
    assert.equal(document.activeElement, root.querySelector('[data-action="toggleAppearance"]'));
    assert.equal(root.querySelector('[data-action="toggleAppearance"]').getAttribute("aria-expanded"), "false");
    assert.equal(key(root.querySelector('[data-action="toggleAppearance"]'), "ArrowDown"), false, "keys outside the menu are not its");
});

test("the web host's full screen follows the page, and Foundry offers none", async () => {
    const { createWebPlatform } = await import("../../src/platform/web/index.js");
    const frame = document.body.appendChild(document.createElement("div"));
    const web = createWebPlatform({ strings: new Map(), lang: "en", handlebars: Handlebars.create(), fetchTemplate: async () => "", records: new Map(), frame, manifest: { id: "filrodens-world-map-builder", version: "4.0.0" }, baseUrl: "http://localhost/", storage: { getItem: () => null, setItem: () => {} } });
    const fullscreen = web.frame.fullscreen;
    assert.equal(typeof fullscreen.enabled(), "boolean");
    assert.equal(fullscreen.active(), false);
    let changed = 0;
    const stop = fullscreen.onChange(() => changed++);
    document.dispatchEvent(new window.Event("fullscreenchange"));
    stop();
    document.dispatchEvent(new window.Event("fullscreenchange"));
    assert.equal(changed, 1);
    const { foundryFrame } = await import("../../src/platform/foundry/index.js");
    assert.equal(foundryFrame.fullscreen, undefined);
});
