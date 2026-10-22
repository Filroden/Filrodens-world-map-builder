// Generated items' Lock in the Pins and Routes lists' rows: an icon button (not a checkbox, so it is
// not mistaken for Mass Edit's tick) on generated rows only, pressed when locked, with what
// Generate again will do in its tooltip; and a slider partial's reset value for double-click.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { Window } from "happy-dom";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const window = new Window({ url: "http://localhost/" });
after(() => window.happyDOM.close());

const { createWebTemplates, registerHelpers } = await import("../../src/platform/web/templates.js");
const i18n = { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" };
const handlebars = Handlebars.create();
registerHelpers(handlebars, i18n);
const templates = createWebTemplates({ handlebars, prefix: "modules/filrodens-world-map-builder/templates/", fetchText: async (path) => readFileSync(join(ROOT, "templates", path), "utf8") });
await templates.load(["parts/list-rows-pin.hbs", "parts/list-rows-route.hbs", "parts/shared-range.hbs"]);

async function rowsOf(template, rows, massEdit = false) {
    const holder = window.document.createElement("div");
    holder.innerHTML = await templates.render(`modules/filrodens-world-map-builder/templates/${template}`, { rows, massEdit, noMatches: false });
    return holder;
}

const ROWS = [
    { id: "own", name: "My inn", icon: "dot", color: "#000", visibility: "all", generated: false },
    { id: "free", name: "Ashford", icon: "dot", color: "#000", visibility: "all", generated: true, locked: false, edited: false },
    { id: "edited", name: "Brill", icon: "dot", color: "#000", visibility: "all", generated: true, locked: false, edited: true },
    { id: "locked", name: "Cray", icon: "dot", color: "#000", visibility: "all", generated: true, locked: true, edited: false },
];

for (const template of ["parts/list-rows-pin.hbs", "parts/list-rows-route.hbs"]) {
    test(`${template}: a generated row has a Lock icon button, pressed when locked; a hand-made row has none`, async () => {
        const holder = await rowsOf(template, ROWS, true);
        const lockOf = (id) => holder.querySelector(`[data-id="${id}"] [data-action="toggleLock"]`);
        assert.equal(lockOf("own"), null);
        for (const id of ["free", "edited", "locked"]) {
            const button = lockOf(id);
            assert.equal(button.localName, "button", "a button, not a checkbox");
            assert.equal(button.getAttribute("aria-pressed"), String(id === "locked"));
            assert.ok(button.querySelector(`.fwmb-icon--${id === "locked" ? "lock" : "lock-open"}`));
        }
        assert.equal(lockOf("free").dataset.tooltip, "FILRODENSWMB.UI.ListUnlockedHint");
        assert.equal(lockOf("edited").dataset.tooltip, "FILRODENSWMB.UI.ListEditedHint");
        assert.equal(lockOf("locked").dataset.tooltip, "FILRODENSWMB.UI.ListLockedHint");
        assert.equal(holder.querySelectorAll('input[type="checkbox"][data-mass-type]').length, ROWS.length, "Mass Edit's ticks are separate");
    });
}

test("a slider given a reset value carries it as data-default; one without has none", async () => {
    const render = (extra) => templates.render("modules/filrodens-world-map-builder/templates/parts/shared-range.hbs", { name: "generator.world.density", label: "L", value: 2, min: 0.25, max: 4, step: 0.05, ...extra });
    const holder = window.document.createElement("div");
    holder.innerHTML = await render({ resetTo: "1" });
    assert.equal(holder.querySelector("input").dataset.default, "1");
    holder.innerHTML = await render({});
    assert.equal(holder.querySelector("input").dataset.default, undefined);
});
