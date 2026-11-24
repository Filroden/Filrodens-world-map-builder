// Shared by the Local studio's tests: the promoted places of the module's P0JBVA fixture, each as
// the engine's input saved in tests/local/fixtures/inputs/ (recorded in the towns prototype against
// v4.3.0 with their fingerprints, prints.json; claude/v5-l-surface-step1-plan.md §1), and the
// fingerprints the tests compare with.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(here, "fixtures");

/** The fingerprints, town views and figures recorded for each promoted place. */
export const PRINTS = JSON.parse(readFileSync(join(FIXTURES, "prints.json"), "utf8"));

/** The promoted places, one of each kind, picked by rule from the fixture's run (P-towns' harness/promote/places.mjs). */
export const PLACES = Object.freeze(Object.entries(PRINTS.places).map(([name, p]) => Object.freeze({ name, id: p.id, role: p.role, tier: p.tier, population: p.population })));

/** A place's saved input. */
export function inputOf(name) {
    return JSON.parse(readFileSync(join(FIXTURES, "inputs", `${name}.json`), "utf8"));
}

/** A town's fingerprint (P-towns' tools/prints.mjs): its buildings, streets, fields and wall, to a tenth of a metre. */
export function townPrint(town) {
    const r = (p) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
    const h = createHash("sha256");
    for (const b of town.buildings) h.update(`${b.kind}:${b.poly.map(r).join(" ")};`);
    for (const s of town.streets) h.update(`s:${s.points.map(r).join(" ")};`);
    for (const f of town.fields) h.update(`f:${f.use}:${f.poly.map(r).join(" ")};`);
    if (town.wall) h.update(`w:${town.wall.polygon.map(r).join(" ")}`);
    return h.digest("hex").slice(0, 16);
}

/** Fields of a household that are names (or the namer's marks), left out of its fingerprint. */
const NAME_KEYS = new Set(["family", "given", "name", "full", "own"]);

/** Households' fingerprint: every field of every household and the totals but their names. */
export function householdPrint(people) {
    const h = createHash("sha256");
    const strip = (v) =>
        Array.isArray(v)
            ? v.map(strip)
            : v && typeof v === "object"
              ? Object.fromEntries(Object.entries(v).filter(([k, x]) => !NAME_KEYS.has(k) && typeof x !== "function" && k !== "building" && k !== "house").map(([k, x]) => [k, strip(x)]))
              : v;
    for (const hh of [...people.houses, ...people.farms]) h.update(JSON.stringify(strip(hh)));
    h.update(JSON.stringify(people.totals));
    return h.digest("hex").slice(0, 16);
}

/** The label a check names a place by. */
export const label = (spec) => `${spec.name} (${spec.role})`;
