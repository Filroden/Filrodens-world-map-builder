// Personal names (N2) and household heads (N2b), the names prototype's checks promoted (its 10
// names checks and 5 heads checks) on the households of the promoted places of the module's P0JBVA
// fixture. The fixture's run has no cultures, so each place is peopled as one of the prototype's
// sample places was: Grironcairn as Husbergluf (a Nordic market town), Graymoutht as Eldudarkho
// (a Nordic city) and as Bonevilde (an English great city's households), Bellde as Saureykir
// (Nordic and English) and Sprinbell as Gobeth (Dark Elven, whose line runs through the mother,
// and Dwarven).
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { test } from "node:test";
import { NamesGenerator } from "../../vendor/azgaar-names/names-generator.js";
import { NAMES, createNamer, isCleanName, sanitiseList } from "../../src/kernel/names/PersonNames.js";
import { FAMOUS, FANTASY_BASES, REAL_BASES } from "../../src/kernel/names/data/PersonNameBases.js";
import { HEADS, householdsOf } from "../../src/studios/local/engine/Households.js";
import { buildTown } from "../../src/studios/local/engine/Town.js";
import { inputOf } from "../local/helpers.mjs";

const HILLFOLK = { name: "Hillfolk", colour: "#5b7fa6", openness: 0.5, nameBase: "Nordic" };
const VALEFOLK = { name: "Valefolk", colour: "#c9a227", openness: 0.5, nameBase: "English" };
/** Each sample place: the promoted place it is built on, and its people. */
const SAMPLES = {
    Husbergluf: { place: "Grironcairn", cultures: [{ ...HILLFOLK, share: 1 }] },
    Eldudarkho: { place: "Graymoutht", cultures: [{ ...HILLFOLK, share: 1 }] },
    Saureykir: { place: "Bellde", cultures: [{ ...HILLFOLK, share: 0.627 }, { ...VALEFOLK, share: 0.373 }] },
    Gobeth: { place: "Sprinbell", cultures: [{ name: "Deepfolk", colour: "#7d6aa8", openness: 0.35, nameBase: "Dark Elven", share: 0.8 }, { name: "Stonefolk", colour: "#b0794b", openness: 0.5, nameBase: "Dwarven", share: 0.2 }] },
    Bonevilde: { place: "Graymoutht", cultures: [{ name: "Local", colour: "#9a8f7a", openness: 0.5, nameBase: "English", share: 1 }] },
};
const PLACES = ["Husbergluf", "Eldudarkho", "Saureykir", "Gobeth"];
const BASES = new NamesGenerator(() => 0).nameBases.map((b) => b.name);

const towns = new Map();
const records = new Map();
/**
 * A sample place's households, unnamed, under a Household heads setting: { seed, cultures (with
 * heads and lineage), ageBands, households (houses then farmhouses) }.
 */
function load(sample, heads = "auto") {
    const key = `${sample}:${heads}`;
    if (records.has(key)) return structuredClone(records.get(key));
    const { place, cultures } = SAMPLES[sample];
    if (!towns.has(place)) towns.set(place, { input: inputOf(place), town: buildTown(inputOf(place)) });
    const { input, town } = towns.get(place);
    const namer = createNamer({ cultures });
    const withHeads = cultures.map((c) => ({ ...c, heads, lineage: namer.cultureOf(c.name).settings.lineage }));
    const people = householdsOf(town, { cultures: withHeads });
    const record = { seed: input.seed, cultures: withHeads, ageBands: people.totals.ageBands, nearby: input.neighbours.map((n) => n.name), households: [...people.houses, ...people.farms] };
    records.set(key, record);
    return structuredClone(record);
}
const nearbyOf = (sample) => load(sample).nearby;

const nameAll = (record, namer = createNamer({ cultures: record.cultures })) => {
    const households = structuredClone(record.households);
    households.forEach((h, i) => namer.household(`${record.seed}:people:h${i}`, h));
    return households;
};
const sample = (base, n = 400) => {
    const namer = createNamer({ cultures: [{ name: "C", nameBase: base }] });
    const out = [];
    for (let i = 0; i < n; i++) {
        const h = { culture: "C", trade: ["smith", "weaver", "labourer", "merchant"][i % 4], wealth: ["poor", "middling", "wealthy"][i % 3], members: [{ role: "head", age: 40 }, { role: "wife", age: 35 }, { role: "father", age: 68 }, { role: "child", age: 10 }, { role: "child", age: 6 }, { role: "servant", age: 20 }, { role: "kinswoman", age: 44 }] };
        namer.household(`t:${base}:${i}`, h);
        out.push(h);
    }
    return { namer, households: out };
};

// A part of a full name: a capitalised word (with marks, apostrophes, one hyphen), or one of the
// lowercase particles the conventions use
const PARTICLES = new Set(["ag", "welet", "ibn", "bint", "bin", "binti", "ben", "bat", "de", "da", "di", "hin", "mār", "mārat", "kızı"]);
const WORD = /^(al-)?\p{Lu}[\p{L}\p{M}'’ʾ]*(-\p{L}[\p{L}\p{M}'’]*)*$/u;
const tokenOk = (t) => PARTICLES.has(t) || WORD.test(t);

test("the same households get the same names, and one household's names never depend on another's", () => {
    for (const place of PLACES) {
        const r = load(place);
        const a = nameAll(r);
        const b = nameAll(r);
        assert.deepEqual(a.map((h) => h.members.map((m) => m.full)), b.map((h) => h.members.map((m) => m.full)), place);
        // One household named on its own, from a fresh namer, matches
        const i = Math.floor(r.households.length / 2);
        const alone = structuredClone(r.households[i]);
        createNamer({ cultures: r.cultures }).household(`${r.seed}:people:h${i}`, alone);
        assert.deepEqual(alone.members.map((m) => m.full), a[i].members.map((m) => m.full), place);
    }
});

test("every one of the 43 bases names every member of every household", () => {
    assert.equal(BASES.length, 43);
    for (const base of BASES) {
        const { households } = sample(base, 200);
        for (const h of households) for (const m of h.members) {
            assert.ok(typeof m.given === "string" && m.given.length >= 2, `${base}: given ${m.given}`);
            assert.ok(typeof m.full === "string" && m.full.length >= 2, `${base}: full ${m.full}`);
        }
    }
});

test("no given or family name holds a common rude word (NameFilter), in 300 households of every base", async () => {
    const { isBlockedName } = await import("../../src/kernel/names/NameFilter.js");
    const bad = [];
    for (const base of BASES) {
        const { households } = sample(base, 300);
        // The sample has no neighbouring places (whose names are the map's own and not checked)
        for (const h of households) for (const m of h.members) for (const part of [m.given, m.family].filter(Boolean)) if (isBlockedName(part)) bad.push(`${base}: ${m.full}`);
    }
    assert.deepEqual(bad.slice(0, 20), [], `${bad.length} blocked`);
});

test("no empty, cut-short, run-together or garbled names", () => {
    const bad = [];
    const check = (base, namer, m) => {
        const C = namer.cultureOf(m.culture ?? "C");
        if (m.full !== m.full.trim() || /\s{2}/.test(m.full)) bad.push(`${base}: spacing "${m.full}"`);
        for (const t of m.full.split(" ")) if (!tokenOk(t)) bad.push(`${base}: token "${t}" in "${m.full}"`);
        const listed = C.sets.m.has(m.given) || C.sets.f.has(m.given) || C.baseName === "Roman";
        if (!listed && !isCleanName(m.given, [Math.min(C.lengths.m[0], C.lengths.f[0]), Math.max(C.lengths.m[1], C.lengths.f[1])])) bad.push(`${base}: generated "${m.given}"`);
    };
    for (const base of BASES) {
        const { namer, households } = sample(base, 300);
        for (const h of households) for (const m of h.members) check(base, namer, m);
    }
    for (const place of PLACES) {
        const r = load(place);
        const namer = createNamer({ cultures: r.cultures });
        for (const h of nameAll(r, namer)) for (const m of h.members) check(place, namer, { ...m, culture: m.culture ?? h.culture });
    }
    assert.deepEqual(bad.slice(0, 20), [], `${bad.length} bad names`);
});

test("each convention's shares stay within bounds", () => {
    // English inherited names over a great city's households: the list, trades, places, features
    // and fathers at their shares, within three points
    const r = load("Bonevilde");
    const households = nameAll(r);
    const counts = {};
    for (const h of households) if (h.nameKind) counts[h.nameKind] = (counts[h.nameKind] ?? 0) + 1;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    for (const [kind, want] of Object.entries(NAMES.INHERITED)) assert.ok(Math.abs((counts[kind] ?? 0) / total - want) < 0.03, `${kind}: ${((counts[kind] ?? 0) / total).toFixed(3)} for ${want}`);
    // Mix: about four given names in five are from the list
    const C = createNamer({ cultures: r.cultures }).cultureOf("Local");
    const people = households.flatMap((h) => h.members);
    const listed = people.filter((m) => C.sets.m.has(m.given) || C.sets.f.has(m.given)).length / people.length;
    assert.ok(Math.abs(listed - NAMES.REAL_SHARE) < 0.03, `listed ${listed.toFixed(3)}`);
    // Patronymics: a Nordic child is named after the head (his own given name), a wife after her own father
    const nordic = nameAll(load("Husbergluf"));
    for (const h of nordic) {
        const head = h.members[0];
        for (const m of h.members) {
            // (a woman heading the household names her children after their late father, N2b:
            // the heads checks below hold that)
            if (m.own || head.role !== "head" || head.sex !== "m") continue;
            if (m.role === "child") assert.ok(m.full.endsWith(m.sex === "f" ? "sdatter" : "sson") && m.full.includes(head.given.replace(/s$/, "")), `${m.full} of ${head.full}`);
        }
    }
    // Wives take their husband's name in English, keep their own in Italian
    for (const [base, takes] of [["English", true], ["Italian", false]]) {
        const { households: hs } = sample(base, 300);
        const same = hs.filter((h) => h.members[1].family === h.members[0].family).length / hs.length;
        assert.ok(takes ? same === 1 : same < 0.2, `${base}: ${same}`);
    }
});

test("members the household model gives no sex are even, within three points", () => {
    let f = 0;
    let n = 0;
    for (const place of PLACES) for (const h of nameAll(load(place))) for (const m of h.members) {
        if (!["child", "grown child", "servant", "apprentice", "journeyman", "lodger", "miller's man"].includes(m.role)) continue;
        n++;
        if (m.sex === "f") f++;
    }
    assert.ok(Math.abs(f / n - 0.5) < 0.03, `${(f / n).toFixed(3)} of ${n}`);
});

test("the user's own lists are made safe and used as they are", () => {
    const typed = "Ælfric\n<b>Bad</b>\n  Wulfstan  \nWulfstan\n\u0007Eadric\nhttp://x\n" + "Ab".repeat(30) + "\nGod-win";
    assert.deepEqual(sanitiseList(typed), ["Ælfric", "Wulfstan", "Eadric", "God-win"]);
    assert.equal(sanitiseList(Array.from({ length: 5000 }, (_, i) => `N${String.fromCharCode(97 + (i % 26))}${i}`).join("\n")).length, 0, "digits are not names");
    assert.equal(sanitiseList(Array.from({ length: 5000 }, (_, i) => "N" + "abcdefghij"[i % 10] + "abcdefghij"[Math.floor(i / 10) % 10] + "abcdefghij"[Math.floor(i / 100) % 10] + "abcdefghij"[Math.floor(i / 1000) % 10]).join("\n")).length, NAMES.LIST_MAX);
    const names = { m: "Ælfric\nWulfstan\nEadric", f: "Æthelflæd\nEadgyth", family: "Thorpe\nHolt" };
    const namer = createNamer({ cultures: [{ name: "Old", nameBase: "English", names: { lists: names } }] });
    for (let i = 0; i < 200; i++) {
        const h = { culture: "Old", trade: "smith", wealth: "middling", members: [{ role: "head", age: 40 }, { role: "wife", age: 35 }, { role: "child", age: 5 }] };
        namer.household(`u${i}`, h);
        for (const m of h.members) assert.ok(["Ælfric", "Wulfstan", "Eadric", "Æthelflæd", "Eadgyth"].includes(m.given), m.given);
    }
});

test("the name data is small", () => {
    const dir = new URL("../../src/kernel/names/data/", import.meta.url);
    const bytes = readdirSync(dir).reduce((a, f) => a + statSync(new URL(f, dir)).size, 0);
    assert.ok(bytes < 120_000, `${bytes} bytes`);
    assert.equal(Object.keys(REAL_BASES).length, 33);
});

test("a great city's 230,000 people are named in under 2 s", () => {
    // Graymoutht's households eight times over, each from its own seed
    const r = load("Bonevilde");
    const copies = Array.from({ length: 8 }, (_, k) => ({ ...r, seed: `${r.seed}:${k}` }));
    const people = 8 * r.households.reduce((a, h) => a + h.members.length, 0);
    const started = performance.now();
    for (const copy of copies) nameAll(copy);
    const ms = performance.now() - started;
    assert.ok(people > 220_000);
    if (!process.env.CI) assert.ok(ms < 2000, `${Math.round(ms)} ms`);
});

test("no famous ruler or character is on a list, or made by a chain", () => {
    const listed = [];
    for (const [base, b] of Object.entries({ ...REAL_BASES, ...FANTASY_BASES })) {
        for (const key of ["m", "f", "family"]) for (const n of typeof b[key] === "string" ? b[key].split(",") : []) if (FAMOUS.has(n.trim())) listed.push(`${base}: ${n}`);
    }
    assert.deepEqual(listed, []);
    const made = [];
    for (const base of Object.keys(FANTASY_BASES)) {
        const namer = createNamer({ cultures: [{ name: "C", nameBase: base }] });
        for (let i = 0; i < 2000; i++) {
            const name = namer.given(`famous:${i}`, "C", i % 2 ? "f" : "m");
            if (FAMOUS.has(name)) made.push(`${base}: ${name}`);
        }
    }
    assert.deepEqual(made, []);
});

test("half the names from places come from places near the household's place", () => {
    const r = load("Bonevilde");
    const nearby = nearbyOf("Bonevilde");
    assert.ok(nearby.length >= 3);
    const households = nameAll(r, createNamer({ cultures: r.cultures, nearby }));
    const fromPlaces = households.filter((h) => h.nameKind === "place");
    const near = fromPlaces.filter((h) => h.nameNearby);
    const share = near.length / fromPlaces.length;
    assert.ok(Math.abs(share - NAMES.NEARBY) < 0.04, `${share.toFixed(3)} of ${fromPlaces.length}`);
    // An English toponymic name is the place's own name
    for (const h of near) assert.ok(nearby.includes(h.name), h.name);
    // A Valefolk household in Bellde (as Saureykir) takes its neighbours' names too; Nordic patronymics take none
    const s = load("Saureykir");
    const named = nameAll(s, createNamer({ cultures: s.cultures, nearby: nearbyOf("Saureykir") }));
    assert.ok(named.some((h) => h.culture === "Valefolk" && h.nameNearby));
    assert.ok(!named.some((h) => h.culture === "Hillfolk" && h.nameNearby));
    // Names of several words (a castle with its keep word) are never used
    const e = createNamer({ cultures: s.cultures, nearby: ["Slenika Castle", "Reykki"] });
    assert.deepEqual(e.cultureOf("Valefolk").near, ["Reykki"]);
});

// ------------------------------------------------------------------------------------ household heads (N2b)

const HEAD_PLACES = ["Husbergluf", "Saureykir", "Gobeth"];
const SETTINGS = ["auto", "men", "women", "either"];
const WOMEN_TRADES = new Set(["brewer", "weaver", "innkeeper", "baker", "dyer", "herbalist", "fishmonger", "chandler", "mercer", "glover", "tailor", "gardener", "labourer", "fuller", "cottar"]);
const want = (culture) => (culture.heads === "auto" ? (culture.lineage === "mother" ? HEADS.women : HEADS.men) : HEADS[culture.heads]);

test("each culture's households are headed by women at its setting's share, within a point", () => {
    for (const place of HEAD_PLACES) for (const heads of SETTINGS) {
        const r = load(place, heads);
        for (const c of r.cultures) {
            const own = r.households.filter((h) => h.culture === c.name);
            const share = own.filter((h) => h.members[0].sex === "f").length / own.length;
            assert.ok(Math.abs(share - want(c)) < 0.01, `${place} ${heads} ${c.name}: ${share.toFixed(3)} for ${want(c).toFixed(3)}`);
        }
    }
    // Automatic follows the lineage: Deepfolk (a mother's line) mostly women, Stonefolk mostly men
    const g = load("Gobeth", "auto");
    assert.equal(g.cultures.find((c) => c.name === "Deepfolk").lineage, "mother");
    assert.equal(g.cultures.find((c) => c.name === "Stonefolk").lineage, "father");
});

test("spouses are of the other sex; a head of the sex that heads fewer is single or widowed", () => {
    for (const place of HEAD_PLACES) for (const heads of SETTINGS) {
        const r = load(place, heads);
        let husbands = 0;
        for (const h of r.households) {
            const head = h.members[0];
            const spouses = h.members.filter((m) => m.role === "wife" || m.role === "husband");
            assert.ok(spouses.length <= 1);
            for (const s of spouses) {
                assert.notEqual(s.sex, head.sex, `${place} ${heads}: ${head.sex} head with ${s.role}`);
                assert.equal(s.role, head.sex === "m" ? "wife" : "husband");
            }
            if (spouses[0]?.role === "husband") husbands++;
            const c = r.cultures.find((x) => x.name === h.culture);
            const share = want(c);
            const minority = share < 0.5 ? "f" : share > 0.5 ? "m" : null;
            if (head.sex === minority) assert.equal(spouses.length, 0, `${place} ${heads}: a ${head.sex} head of few with a spouse`);
            // Widowed households take the sex that heads fewer
            if (head.role === "widow, head") assert.equal(head.sex, "f");
            if (head.role === "widower, head") assert.equal(head.sex, "m");
            if (minority && (head.role === "widow, head" || head.role === "widower, head")) assert.equal(head.sex, minority);
        }
        if (heads === "either" || heads === "women") assert.ok(husbands > 0, `${place} ${heads}: no woman head with a husband`);
    }
});

test("under Mostly men, most women heading households in their own right keep the trades women headed households in", () => {
    for (const place of ["Husbergluf", "Saureykir"]) {
        const r = load(place, "men");
        const own = r.households.filter((h) => h.members[0].sex === "f" && h.members[0].role === "head");
        const kept = own.filter((h) => WOMEN_TRADES.has(h.trade)).length / own.length;
        assert.ok(kept > 0.9, `${place}: ${kept.toFixed(2)}`);
    }
});

test("every member has a sex, the houses hold their people, and the ages keep to the table", () => {
    for (const place of HEAD_PLACES) for (const heads of SETTINGS) {
        const r = load(place, heads);
        for (const h of r.households) {
            assert.equal(h.members.length, h.people);
            for (const m of h.members) assert.ok(m.sex === "m" || m.sex === "f");
        }
        for (const band of r.ageBands) assert.ok(Math.abs(band.got - band.want) <= 0.015, `${place} ${heads} ${band.band}: ${band.got} for ${band.want}`);
    }
});

test("names follow the head and the lineage", () => {
    // Saureykir under Either: an English husband takes his wife's name when he marries into her
    // household; a Nordic child is named after the father (the husband, where the head is his wife)
    const r = load("Saureykir", "either");
    const namer = createNamer({ cultures: r.cultures });
    let english = 0;
    let nordic = 0;
    r.households.forEach((h, i) => {
        namer.household(`${r.seed}:people:h${i}`, h);
        const [head] = h.members;
        const husband = h.members.find((m) => m.role === "husband");
        if (!husband || head.sex !== "f") return;
        if (h.culture === "Valefolk") {
            english++;
            assert.equal(husband.family, head.family);
        }
        if (h.culture === "Hillfolk") {
            for (const c of h.members.filter((m) => m.role === "child" && !m.own)) {
                nordic++;
                assert.ok(c.family.startsWith(husband.given.replace(/s$/, "")), `${c.full}, father ${husband.full}`);
            }
        }
    });
    assert.ok(english > 50 && nordic > 50, `${english} ${nordic}`);
    // Gobeth: Deepfolk children take their mother's house; Stonefolk (keeping their own clans)
    // their father's
    const g = load("Gobeth", "either");
    const gn = createNamer({ cultures: g.cultures });
    let checked = 0;
    g.households.forEach((h, i) => {
        gn.household(`${g.seed}:people:h${i}`, h);
        const mother = h.members.find((m) => !m.own && (m.role === "wife" || ((m.role === "head" || m.role === "widow, head") && m.sex === "f")));
        const father = h.members.find((m) => !m.own && (m.role === "husband" || (m.role === "head" && m.sex === "m")));
        if (!mother || !father) return;
        const parent = h.culture === "Deepfolk" ? mother : father;
        for (const c of h.members.filter((m) => m.role === "child" && !m.own)) {
            checked++;
            assert.equal(c.family, parent.family, `${h.culture}: ${c.full}, parents ${mother.full} and ${father.full}`);
        }
    });
    assert.ok(checked > 100, `${checked}`);
});

test("a culture's own names settings (N3) win over its name style's; every one on Automatic names exactly as none", () => {
    const r = load("Bonevilde");
    const local = r.cultures[0];
    const withNames = (names) => ({ ...r, cultures: [{ ...local, names }] });
    const plain = nameAll(r);
    // Automatic everywhere (each setting null, as the culture inspector keeps it): the same names
    assert.deepEqual(nameAll(withNames({ form: null, order: null, lineage: null, wife: null })), plain);
    const families = (households) => households.filter((h) => h.members.some((m) => m.role === "child" && !m.own) && h.members[0].sex === "m");
    const childTakes = (households) => {
        const all = families(households).flatMap((h) => h.members.filter((m) => m.role === "child" && !m.own).map((c) => c.family === h.members[0].family));
        return all.filter(Boolean).length / all.length;
    };
    // English by its style: an inherited family name the children take, a wife taking it, given name first
    assert.ok(childTakes(plain) > 0.95, `${childTakes(plain)}`);
    // Patronymic: each child named after the father, not his own name
    const patronymic = nameAll(withNames({ form: "patronymic" }));
    assert.ok(childTakes(patronymic) < 0.05, `${childTakes(patronymic)}`);
    // Family name first
    const first = nameAll(withNames({ order: "family-first" })).flatMap((h) => h.members).filter((m) => m.family && m.full !== m.given);
    assert.ok(first.length > 1000 && first.every((m) => m.full.startsWith(`${m.family} `)), first.find((m) => !m.full.startsWith(`${m.family} `))?.full);
    // The spouse keeping their own name
    const wives = (households) => households.map((h) => [h.members[0], h.members.find((m) => m.role === "wife")]).filter(([, wife]) => wife);
    const sameName = (households) => wives(households).filter(([head, wife]) => head.family === wife.family).length / wives(households).length;
    assert.ok(sameName(plain) > 0.95 && sameName(nameAll(withNames({ wife: "keeps" }))) < 0.2, `${sameName(plain)} ${sameName(nameAll(withNames({ wife: "keeps" })))}`);
});
