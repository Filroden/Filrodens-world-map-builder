/**
 * What Explore's Households and supply says (L-surface step 3; boards L6 and L6b): the panel's
 * figures, the households card's words, a house's name by its kind and where it stands, and the
 * household views' legends. Plain functions over the engine's households (Households.js in the
 * engine, sent back by the worker at Keep) and the settlement's input; every word comes from the
 * strings, through the `t` they are given ({localize, format, lang}), so they are tested with no
 * DOM and no host.
 *
 * The engine names no streets or quarters (handoff §9 I), so a house is named by its trade where
 * its trade is one a house is known by, and by what it stands nearest: the market, the quays, the
 * water, a gate, the place of worship, the castle (FILRODENSWMB.LOCAL.HOUSEHOLDS.NEAR_M), else its
 * street (a main street, a back lane) or outside the walls.
 */
import { FILRODENSWMB } from "../../../config.js";
import { SPECIALISTS, TRADE_TABLES, WEALTH } from "../engine/Households.js";
import { HOUSEHOLD_VIEWS, VIEW_COLOURS, VIEW_STEPS } from "../render/Styles.js";

/** The family's lines by whose they are: the couple's, or the head's alone. */
const CHILDREN = { Their: "FILRODENSWMB.UI.HouseholdChildrenTheir", His: "FILRODENSWMB.UI.HouseholdChildrenHis", Her: "FILRODENSWMB.UI.HouseholdChildrenHer" };
const CHILD = { Their: "FILRODENSWMB.UI.HouseholdChildTheir", His: "FILRODENSWMB.UI.HouseholdChildHis", Her: "FILRODENSWMB.UI.HouseholdChildHer" };
const SON = { Their: "FILRODENSWMB.UI.HouseholdSonTheir", His: "FILRODENSWMB.UI.HouseholdSonHis", Her: "FILRODENSWMB.UI.HouseholdSonHer" };
const DAUGHTER = { Their: "FILRODENSWMB.UI.HouseholdDaughterTheir", His: "FILRODENSWMB.UI.HouseholdDaughterHis", Her: "FILRODENSWMB.UI.HouseholdDaughterHer" };
const MOTHER = { His: "FILRODENSWMB.UI.HouseholdMotherHis", Her: "FILRODENSWMB.UI.HouseholdMotherHer" };
const FATHER = { His: "FILRODENSWMB.UI.HouseholdFatherHis", Her: "FILRODENSWMB.UI.HouseholdFatherHer" };

/** A trade's or role's key: its words with spaces, hyphens and apostrophes folded ("man-at-arms": manAtArms). */
export function wordKey(name) {
    return String(name)
        .replace(/['’]/g, "")
        .replace(/[\s-]+(\w)/g, (_, c) => c.toUpperCase());
}

/** The groups a house is not known by the trade of: its head labours, farms, or has no trade. */
const UNNAMED_GROUPS = new Set(["labour", "land", "none"]);
/** The heads with no trade of their own: widowed. */
const WIDOWED = new Set(["widow", "widower"]);
/** Those who work in the house, and those who lodge there. */
const WORKING = new Set(["servant", "apprentice", "journeyman", "miller's man"]);
/** Where a house can stand by, with how far it is from it (the engine's distances). */
const NEAR = [
    ["market", "dMarket"],
    ["quay", "dQuay"],
    ["water", "dWater"],
    ["gate", "dGate"],
    ["worship", "dWorship"],
    ["castle", "dCastle"],
];

/** Every trade the engine can give a head of household, with its group (for the strings' test). */
export function allTrades() {
    const out = new Map();
    for (const table of Object.values(TRADE_TABLES)) for (const [name, , group] of table) out.set(name, group);
    for (const [name, group] of SPECIALISTS) out.set(name, group);
    out.set("widower", "none");
    return out;
}

/** Where a trade is drawn to in a kind of place ("market", "front", …, "any"), or null. */
export function placeOfTrade(trade, { kind = "town", cave = false, farm = false } = {}) {
    const tables = farm ? [TRADE_TABLES.farm] : [cave ? TRADE_TABLES.cave : TRADE_TABLES[kind], TRADE_TABLES.town, TRADE_TABLES.city, TRADE_TABLES.village].filter(Boolean);
    for (const table of tables) {
        const found = table.find((row) => row[0] === trade);
        if (found) return found[3];
    }
    return SPECIALISTS.find((row) => row[0] === trade)?.[2] ?? null;
}

/** A string's first letter in capitals, in the language's own way. */
function capitalised(text, lang) {
    return text ? text.charAt(0).toLocaleUpperCase(lang) + text.slice(1) : text;
}

/** Words joined as a list ("Wulfric, Aldith and Ebba"). */
function listOf(words, lang) {
    try {
        return new Intl.ListFormat(lang, { style: "long", type: "conjunction" }).format(words);
    } catch {
        return words.join(", ");
    }
}

/** A number in the language's own way. */
function number(value, lang, digits = 0) {
    return Number(value).toLocaleString(lang, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/** A share as a whole percentage. */
function percent(share, lang) {
    return Number(share).toLocaleString(lang, { style: "percent", maximumFractionDigits: 0 });
}

/**
 * A line of the card with its name set apart (bold in the card): the string formatted with a
 * marker for the name, then split there, so each language puts the name where it reads.
 */
function line(t, key, data) {
    const MARK = "\u0000";
    const text = t.format(key, { ...data, name: MARK });
    const at = text.indexOf(MARK);
    return at < 0 ? { before: text, name: "", after: "" } : { before: text.slice(0, at), name: data.name ?? "", after: text.slice(at + 1) };
}

/** What a house stands nearest, by the engine's distances (see the module's comment), or null. */
export function placeOfHouse(h, { walled = false, near = FILRODENSWMB.LOCAL.HOUSEHOLDS.NEAR_M } = {}) {
    if (h.farm) return null;
    let best = null;
    for (const [place, field] of NEAR) {
        const d = h[field];
        const within = near[place];
        if (!Number.isFinite(d) || !within || d > within) continue;
        const score = d / within;
        if (!best || score < best.score) best = { place, score };
    }
    if (best) return best.place;
    if (h.back) return "back";
    if ((h.rank ?? 1) <= 1) return "main";
    if (walled && h.inside === false) return "outside";
    return null;
}

/**
 * A house named by its kind and where it stands ("Cutler's house, on the market", "A house on a
 * main street", "A farmhouse, in its country").
 */
export function houseName(t, h, { walled = false } = {}) {
    if (h.farm) return t.localize("FILRODENSWMB.UI.HouseFarm");
    const place = placeOfHouse(h, { walled });
    const known = h.trade && !UNNAMED_GROUPS.has(h.group) && !WIDOWED.has(h.trade);
    const house = known ? t.format("FILRODENSWMB.UI.HouseOfTrade", { trade: capitalised(t.localize(`FILRODENSWMB.UI.HouseholdTrade.${wordKey(h.trade)}`), t.lang) }) : null;
    const where = place ? t.localize(`FILRODENSWMB.UI.HousePlace.${place}`) : null;
    if (house && where) return t.format("FILRODENSWMB.UI.HouseNamedAt", { house, place: where });
    if (house) return house;
    if (where) return t.format("FILRODENSWMB.UI.HouseAt", { place: where });
    return t.localize("FILRODENSWMB.UI.HouseAlone");
}

/** The household's wealth, in words. */
export function wealthWord(t, wealth) {
    return t.localize(`FILRODENSWMB.UI.HouseholdWealth.${wealth}`);
}

/**
 * The households card (boards L6 and L6b): the house, its wealth, the household's people and
 * culture, the family, those working in the house, lodgers, each with their names, a member's own
 * culture where it is not the household's, and the trade.
 * @param {object} t - {localize, format, lang}
 * @param {object} h - A home of the engine's households (a house or a farmhouse).
 * @param {object} [place] - The settlement: its name, kind, whether walled, whether a cavern.
 */
export function cardOf(t, h, { name = "", kind = "town", walled = false, cave = false } = {}) {
    const lang = t.lang;
    const [head, ...rest] = h.members;
    const his = head?.sex === "f" ? "Her" : "His";
    const spouse = rest.find((m) => m.role === "wife" || m.role === "husband") ?? null;
    const whose = spouse ? "Their" : his;
    const nameOf = (m) => m.full || m.given || "";
    const own = (m) => (m.culture && m.culture !== h.culture ? m.culture : null);
    const person = (m, key, data = {}) => ({ ...line(t, key, { name: nameOf(m), age: number(m.age, lang), ...data }), culture: own(m) });

    const family = [];
    if (head) {
        family.push(
            WIDOWED.has(h.trade) || /widow/.test(head.role)
                ? person(head, "FILRODENSWMB.UI.HouseholdHeadWidowed")
                : person(head, "FILRODENSWMB.UI.HouseholdHead", { trade: t.localize(`FILRODENSWMB.UI.HouseholdTrade.${wordKey(h.trade)}`) }),
        );
    }
    if (spouse) family.push(person(spouse, spouse.role === "wife" ? "FILRODENSWMB.UI.HouseholdWife" : "FILRODENSWMB.UI.HouseholdHusband"));
    const children = rest.filter((m) => m.role === "child").sort((a, b) => b.age - a.age);
    if (children.length) {
        const key = (children.length === 1 ? CHILD : CHILDREN)[whose];
        const names = listOf(children.map((m) => m.given || ""), lang);
        family.push({ ...line(t, key, { name: names, ages: listOf(children.map((m) => number(m.age, lang)), lang) }), culture: null });
    }
    for (const m of rest) {
        if (m.role === "mother" || m.role === "father") family.push(person(m, (m.role === "mother" ? MOTHER : FATHER)[his]));
        else if (m.role === "grown child") family.push(person(m, (m.sex === "f" ? DAUGHTER : SON)[whose]));
        else if (m.role === "kinsman" || m.role === "kinswoman") family.push(person(m, m.role === "kinsman" ? "FILRODENSWMB.UI.HouseholdKinsman" : "FILRODENSWMB.UI.HouseholdKinswoman"));
    }
    const working = rest.filter((m) => WORKING.has(m.role)).map((m) => person(m, "FILRODENSWMB.UI.HouseholdWorker", { role: t.localize(`FILRODENSWMB.UI.HouseholdRole.${wordKey(m.role)}`) }));
    const lodging = rest.filter((m) => m.role === "lodger").map((m) => person(m, "FILRODENSWMB.UI.HouseholdWorker", { role: t.localize("FILRODENSWMB.UI.HouseholdRole.lodger") }));
    return {
        title: houseName(t, h, { walled }),
        wealth: wealthWord(t, h.wealth),
        line: t.format("FILRODENSWMB.UI.HouseholdLine", {
            people: h.members.length === 1 ? t.localize("FILRODENSWMB.UI.HouseholdPeopleOne") : t.format("FILRODENSWMB.UI.HouseholdPeople", { count: number(h.members.length, lang) }),
            culture: h.culture ?? "",
        }),
        family,
        working,
        lodging,
        trade: tradeLine(t, h, { name, kind, cave }),
    };
}

/** The card's trade line ("Metal: cutler, sold at the market."), or null for a widowed head. */
export function tradeLine(t, h, { name = "", kind = "town", cave = false } = {}) {
    if (!h.trade || WIDOWED.has(h.trade)) return null;
    const group = t.localize(`FILRODENSWMB.UI.HouseholdGroup.${h.group}`);
    const trade = t.localize(`FILRODENSWMB.UI.HouseholdTrade.${wordKey(h.trade)}`);
    if (h.group === "labour") return t.format("FILRODENSWMB.UI.HouseholdTradeLabour", { group, trade });
    if (h.group === "land") return t.format("FILRODENSWMB.UI.HouseholdTradeFarm", { group, trade, place: name });
    const where = placeOfTrade(h.trade, { kind, cave, farm: h.farm });
    const phrase = where && where !== "any" ? t.localize(`FILRODENSWMB.UI.HouseholdWhere.${where}`) : null;
    return phrase ? t.format("FILRODENSWMB.UI.HouseholdTradeLine", { group, trade, where: phrase }) : t.format("FILRODENSWMB.UI.HouseholdTradeBare", { group, trade });
}

/** The line over the canvas while pointing at a house: "Cutler's house, on the market · prosperous". */
export function readoutOf(t, h, place = {}) {
    return t.format("FILRODENSWMB.UI.HouseholdsReadout", { house: houseName(t, h, place), wealth: wealthWord(t, h.wealth) });
}

// ---------------------------------------------------------------------- the panel

/** The way most of a route's length goes: road, river, sea or overland. */
function modeOf(modes = {}) {
    const ways = ["road", "river", "sea", "land"];
    return ways.reduce((best, way) => ((modes[way] ?? 0) > (modes[best] ?? 0) ? way : best), "road");
}

/**
 * The supply in a normal year as the panel shows it: what comes in, as shares of all that comes
 * in (they add up to the whole), then what goes on.
 * @param {object} supply - The settlement's supply (Supply.js supplyOf, or supplyWithoutRun).
 * @returns {{rows: {key: string, share: number, data?: object}[], out: {key: string, amount: number, data?: object}[], standIn: boolean}|null}
 */
export function supplyOf(supply) {
    if (!supply) return null;
    const byMode = {};
    for (const flow of supply.fromPlaces ?? []) byMode[modeOf(flow.modes)] = (byMode[modeOf(flow.modes)] ?? 0) + (flow.amount ?? 0);
    const parts = [
        { key: "FILRODENSWMB.UI.SupplyOwn", amount: supply.own ?? 0 },
        { key: "FILRODENSWMB.UI.SupplyCountry", amount: supply.countryTotal ?? 0 },
        ...["road", "river", "sea", "land"].map((way) => ({ key: `FILRODENSWMB.UI.SupplyBy.${way}`, amount: byMode[way] ?? 0 })),
        { key: supply.withoutRun ? "FILRODENSWMB.UI.SupplyBoughtIn" : "FILRODENSWMB.UI.SupplyImports", amount: supply.imports ?? 0 },
    ];
    const total = parts.reduce((a, p) => a + p.amount, 0);
    const rows = parts.filter((p) => p.amount > 0).map((p) => ({ key: p.key, share: total > 0 ? p.amount / total : 0 }));
    const out = [];
    if (supply.out?.amount > 0) out.push({ key: "FILRODENSWMB.UI.SupplySoldOn", amount: supply.out.amount, data: { name: supply.out.name } });
    if (supply.exports > 0) out.push({ key: "FILRODENSWMB.UI.SupplyExported", amount: supply.exports });
    return { rows, out, standIn: !!supply.withoutRun };
}

/**
 * The panel's figures (board L6): its totals, cultures by their people, trade groups by their
 * households, the supply.
 * @param {object} households - The engine's {houses, farms, totals}.
 * @param {object} [options]
 * @param {object} [options.supply] - The settlement's supply (from its input).
 * @param {object} [options.land] - The town's land figures (how much of its own food land the frame clips).
 */
export function figuresOf(households, { supply = null, land = null } = {}) {
    const { totals, houses } = households;
    const cultures = new Map();
    for (const h of houses) for (const m of h.members) cultures.set(m.culture ?? h.culture, (cultures.get(m.culture ?? h.culture) ?? 0) + 1);
    const people = totals.people;
    const groups = Object.entries(totals.groups ?? {})
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([group, count]) => ({ group, count }));
    return {
        people,
        houses: totals.houses,
        perHouse: totals.houses ? people / totals.houses : 0,
        country: totals.countryPeople ?? 0,
        farmhouses: totals.farmhouses ?? 0,
        cultures: [...cultures].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, people: count, share: people ? count / people : 0 })),
        groups,
        supply: supplyOf(supply),
        clipped: (land?.ownFedClipped ?? 0) > 0.5,
    };
}

/** A culture's colour: its own, else one of the trade group colours in turn (never two alike in one place). */
function cultureColour(colours, name, index) {
    const spare = Object.values(VIEW_COLOURS.groups);
    return colours?.[name] ?? spare[index % spare.length];
}

/**
 * The panel's context: its figures in words.
 * @param {object} t
 * @param {object} figures - figuresOf.
 * @param {object} [options]
 * @param {Object<string, string>} [options.colours] - Each culture's colour, by name.
 */
export function panelOf(t, figures, { colours = {} } = {}) {
    const lang = t.lang;
    const { TRADES_SHOWN } = FILRODENSWMB.LOCAL.HOUSEHOLDS;
    const groups = figures.groups.map(({ group, count }) => ({ label: t.localize(`FILRODENSWMB.UI.HouseholdGroup.${group}`), count: number(count, lang) }));
    const supply = figures.supply;
    return {
        totals: [
            { value: number(figures.people, lang), label: t.localize("FILRODENSWMB.UI.HouseholdsPeople") },
            { value: number(figures.houses, lang), label: t.localize("FILRODENSWMB.UI.HouseholdsHouses") },
            { value: number(figures.perHouse, lang, 1), label: t.localize("FILRODENSWMB.UI.HouseholdsPerHouse") },
            { value: number(figures.groups.length, lang), label: t.localize("FILRODENSWMB.UI.HouseholdsGroups") },
        ],
        country: figures.farmhouses
            ? t.format(figures.farmhouses === 1 ? "FILRODENSWMB.UI.HouseholdsCountryOne" : "FILRODENSWMB.UI.HouseholdsCountry", { people: number(figures.country, lang), farms: number(figures.farmhouses, lang) })
            : null,
        cultures: figures.cultures.map((culture, index) => ({
            name: culture.name,
            colour: cultureColour(colours, culture.name, index),
            width: Math.round(culture.share * 1000) / 10,
            label: t.format("FILRODENSWMB.UI.HouseholdsCultureShare", { name: culture.name, people: number(culture.people, lang), share: percent(culture.share, lang) }),
        })),
        oneCulture: figures.cultures.length <= 1,
        groups: groups.slice(0, TRADES_SHOWN),
        moreGroups: groups.slice(TRADES_SHOWN),
        more: groups.length > TRADES_SHOWN ? t.format("FILRODENSWMB.UI.HouseholdsMore", { count: number(groups.length - TRADES_SHOWN, lang) }) : null,
        supply: supply
            ? {
                  rows: [
                      ...supply.rows.map((row) => ({ label: t.localize(row.key), value: percent(row.share, lang) })),
                      ...supply.out.map((row) => ({ label: t.format(row.key, row.data ?? {}), value: t.format("FILRODENSWMB.UI.SupplyPeoplesFood", { people: number(row.amount, lang) }) })),
                  ],
                  standIn: supply.standIn,
                  clipped: figures.clipped,
              }
            : null,
    };
}

// ---------------------------------------------------------------------- the views' legends

/**
 * A household view's legend: its title and keys. Graded views (people, age) in five steps; the
 * others name what the settlement holds (its trade groups and cultures by their households, the
 * five wealths).
 * @param {object} t
 * @param {string} view - One of HOUSEHOLD_VIEWS.
 * @param {object} households
 * @param {Object<string, string>} [colours] - Each culture's colour, by name.
 */
export function legendOf(t, view, households, colours = {}) {
    if (!HOUSEHOLD_VIEWS.includes(view)) return null;
    const lang = t.lang;
    const title = t.localize(`FILRODENSWMB.UI.SettlementView.${view}`);
    const steps = (cuts, under) =>
        VIEW_COLOURS.sequence.map((colour, k) => {
            const from = k === 0 ? (under ? null : 1) : cuts[k - 1] + 1;
            const to = cuts[k];
            const label =
                k === cuts.length
                    ? t.format("FILRODENSWMB.UI.LegendOrMore", { from: number(from, lang) })
                    : from === null
                      ? t.format("FILRODENSWMB.UI.LegendUnder", { to: number(to + 1, lang) })
                      : t.format("FILRODENSWMB.UI.LegendRange", { from: number(from, lang), to: number(to, lang) });
            return { colour, label };
        });
    switch (view) {
        case "people":
            return { title, items: steps(VIEW_STEPS.people, false) };
        case "age":
            return { title, items: steps(VIEW_STEPS.age, true) };
        case "wealth":
            return { title, items: WEALTH.map((w) => ({ colour: VIEW_COLOURS.wealth[w], label: wealthWord(t, w) })) };
        case "group": {
            const groups = Object.entries(households.totals.groups ?? {})
                .filter(([, n]) => n > 0)
                .sort((a, b) => b[1] - a[1]);
            return { title, items: groups.map(([g]) => ({ colour: VIEW_COLOURS.groups[g] ?? VIEW_COLOURS.groups.none, label: t.localize(`FILRODENSWMB.UI.HouseholdGroup.${g}`) })) };
        }
        case "culture": {
            const cultures = Object.entries(households.totals.cultures ?? {})
                .filter(([, n]) => n > 0)
                .sort((a, b) => b[1] - a[1]);
            return { title, items: cultures.map(([name], index) => ({ colour: cultureColour(colours, name, index), label: name })) };
        }
        default:
            return null;
    }
}

/** Each culture's roof colour for the drawing's Culture view: as legendOf gives them. */
export function cultureRoofs(households, colours = {}) {
    const names = Object.entries(households?.totals?.cultures ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name);
    return Object.fromEntries(names.map((name, index) => [name, { roof: cultureColour(colours, name, index) }]));
}
