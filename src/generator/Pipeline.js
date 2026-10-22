import { FILRODENSWMB } from "../config.js";
import { buildModelCells } from "./CellValues.js";
import { CellGraph, EDGE } from "./CellGraph.js";
import { engineCultures } from "./CultureInput.js";
import { resolveCultures, sharesOf, spreadCultures, townMix } from "./Cultures.js";
import { feedbackPass } from "./Feedback.js";
import { formerAge } from "./FormerAge.js";
import { resolveSettings } from "./GeneratorSettings.js";
import { modelBiomeRaster } from "./ModelBiomes.js";
import { nameEverything } from "./Names.js";
import { buildRealms } from "./Realms.js";
import { routeChains } from "./RouteChains.js";
import { placeTowns } from "./Towns.js";
import { tradeRounds } from "./Trade.js";

/**
 * The generator's run: the stages in order, with progress reports and the chance to stop.
 *
 *   values -> cultures -> towns -> trade (two rounds) -> realms -> feedback (security and
 *   clearing) -> final trade round -> final realms (the first realms' seats kept) -> names
 *
 * Platform-neutral: it runs in the generation worker (the `generate` task) and, where workers are
 * unavailable, on the main thread, with the same code and therefore the same result. The long
 * stages (towns and trade) are generators that yield their progress, the others plain functions;
 * the run pauses (`pause`, which lets a worker see a
 * cancel message and a page stay responsive) whenever BREATH_MS has passed since the last pause,
 * and stops with GenerationCancelled when asked.
 *
 * One age is simulated: the settings' last age, whose era and strife the run takes.
 */

/** Longest stretch of work between pauses, in ms. */
const BREATH_MS = 40;

/** Thrown inside a run when it is asked to stop with the ages finished (see runGenerator). */
class AgeStopped extends Error {}

/** Thrown (rejected) when a run is cancelled. */
export class GenerationCancelled extends Error {
    constructor() {
        super("Generation cancelled");
        this.name = "AbortError";
    }
}

/**
 * Runs the generator.
 *
 * A run is one or more ages (settings.ages, oldest first; see GeneratorSettings). The model cells
 * are built once. Each age then runs the stages in turn; an age after the first starts from the
 * age before: its land cleared, its towns favoured where the new age places its own (inertia), its
 * roads and lanes already built, and its realm seats kept where a duchy still sits on one. A one-age
 * run is exactly the run of before ages were added.
 *
 * An age may hold a culture event naming one of the map's cultures: it arrives in that age (it is
 * absent from the ages before), or invades (arrives, spreads at an advantage taking land, and the
 * age's strife rises where it takes land from another people).
 *
 * The last age finished is the run's result; the ages before it are kept, in brief, in its history.
 * Asked to stop (isStopping) once an age has finished, the run lets go of the age under way and
 * ends with the ages finished.
 *
 * @param {import("./GeneratorInput.js").GeneratorPayload} payload
 * @param {object} [options]
 * @param {function({stage: string, pct: number, age?: number, ages?: number}): void} [options.onProgress]
 * @param {function(): boolean} [options.isCancelled]
 * @param {function(): boolean} [options.isStopping] - Whether to end with the ages finished.
 * @param {function(): Promise<void>} [options.pause]
 * @param {number} [options.breathMs] - Longest stretch of work between pauses (BREATH_MS).
 * @returns {Promise<object>} The run's result (see assembleResult).
 */
export async function runGenerator(payload, { onProgress = null, isCancelled = () => false, isStopping = () => false, pause = defaultPause, breathMs = BREATH_MS } = {}) {
    const settings = resolveSettings(payload.settings, payload.mapSeed);
    const ages = settings.ages;
    const driver = new StageDriver({ onProgress, isCancelled, isStopping, pause, breathMs, ages: ages.length });
    const run = { settings, age: ages.at(-1), timings: {} };

    run.cells = await driver.step("values", () => buildModelCells({ ...payload, biome: modelBiomeRaster(payload) }, settings.world), run);
    run.graph = new CellGraph(run.cells);
    const people = cultureList(settings, payload);

    let previous = null;
    const history = [];
    let last = null;
    let before = null;
    for (let index = 0; index < ages.length; index++) {
        if (index > 0 && isStopping()) break;
        driver.setAge(index);
        const finished = await runAge(run, driver, { settings, people, ages, index, previous }).catch((error) => {
            if (error instanceof AgeStopped) return null;
            throw error;
        });
        if (!finished) break;
        if (last) history.push(ageHistory(last, ages[index - 1]));
        before = last;
        last = finished.age;
        previous = finished.next(previous);
    }
    // Naming the places is the run's last step, whatever was asked: it is never let go
    driver.endAges();
    run.cultures = last.cultures;
    run.agesRun = history.length + 1;
    const { feedback, finalTrade, finalRealms } = last;
    const former = before ? formerAge(run.graph, before, last, settings.nameBase) : null;
    const formerNames = former ? { towns: former.ruins, castles: former.castles } : null;
    const names = await driver.step("names", () => nameEverything({ seed: settings.seed, nameBase: settings.nameBase, cultures: run.cultures, towns: finalTrade.towns, castles: feedback.castles, realms: finalRealms, former: formerNames }), run);
    driver.report("names", 1);
    const result = assembleResult(run, { feedback, finalTrade, finalRealms, names });
    result.history = history;
    result.ages = { asked: ages.length, run: run.agesRun };
    if (former) Object.assign(result, formerResult(run, result, former, names, history));
    return result;
}

/**
 * One age's stages, from the age before (`previous`; none for the first). Returns the age, and how
 * the next age starts from it.
 */
async function runAge(run, driver, { settings, people, ages, index, previous }) {
    const age = ages[index];
    const { list, invader } = agePeople(settings, people, ages, index);
    const cultures = await driver.step("cultures", () => spreadCultures(run.graph, resolveCultures(list), { invader }), run);
    const common = { cultures, world: settings.world };
    const towns = await driver.stage("towns", () => placeTowns(run.graph, { ...common, era: age, previous }), run);
    const trade = await driver.stage("trade", () => tradeRounds(run.graph, { ...common, towns: towns.towns, cellPop: towns.cellPop, totalPop: towns.totalPop, built: previous?.built ?? null }), run);
    const realms = await driver.step("realms", () => buildRealms(run.graph, { ...common, towns: trade.towns, cellPop: towns.cellPop, traffic: trade.traffic, keptSeats: previous?.seats ?? null }), run);
    const strifeAt = invader >= 0 && previous ? invasionStrife(run.cells, cultures, invader, previous, age.strife) : null;
    const feedback = await driver.step("feedback", () => feedbackPass(run.graph, { ...common, towns: trade.towns, cellPop: towns.cellPop, traffic: trade.traffic, realms, strife: age.strife, strifeAt }), run);

    const final = { traffic: trade.traffic, security: feedback.security, royalSeats: feedback.royalSeats };
    const finalTrade = await driver.stage("finalTrade", () => tradeRounds(run.graph, { ...common, towns: feedback.towns, cellPop: feedback.cellPop, totalPop: feedback.totalPop, final }), run);
    const finalRealms = await driver.step("finalRealms", () => buildRealms(run.graph, { ...common, towns: finalTrade.towns, cellPop: feedback.cellPop, traffic: finalTrade.traffic, fixedSeats: feedback.royalSeats }), run);

    return {
        age: { cultures, feedback, finalTrade, finalRealms },
        next: (before) => ({
            towns: finalTrade.towns,
            cleared: feedback.cleared,
            // Roads and lanes stay built from age to age, used or not
            built: builtEdges(run.graph, finalTrade.traffic, before?.built ?? null),
            seats: new Set(finalRealms.realms.map((realm) => realm.seat)),
            dominantId: Array.from(cultures.dominant, (culture) => (culture >= 0 ? (cultures.cultures[culture].id ?? null) : null)),
        }),
    };
}

/** The cultures of a run (the map's, in the engine's form); with none, the default culture speaking the run's name style. */
function cultureList(settings, payload) {
    if (settings.cultures.length) return engineCultures(settings.cultures, payload);
    return [{ ...FILRODENSWMB.GENERATOR.CULTURES.DEFAULT, nameBase: settings.nameBase }];
}

/**
 * The cultures living in an age: every map culture but those an event brings in a later age (with
 * none left, the default culture), and the index among them of the one invading in this age (-1).
 */
function agePeople(settings, people, ages, index) {
    if (!settings.cultures.length) return { list: people, invader: -1 };
    const arrives = new Map();
    ages.forEach((age, at) => {
        if (age.event && !arrives.has(age.event.culture)) arrives.set(age.event.culture, at);
    });
    const list = people.filter((culture) => !(arrives.get(culture.id) > index));
    if (!list.length) return { list: [{ ...FILRODENSWMB.GENERATOR.CULTURES.DEFAULT, nameBase: settings.nameBase }], invader: -1 };
    const event = ages[index].event;
    return { list, invader: event?.kind === "invasion" ? list.findIndex((culture) => culture.id === event.culture) : -1 };
}

/**
 * The age's strife at each cell under an invasion: higher (AGES.INVASION.STRIFE) on land the invader
 * now holds that another people held in the age before.
 */
function invasionStrife(cells, cultures, invader, previous, strife) {
    const raised = Math.min(1, strife + FILRODENSWMB.GENERATOR.AGES.INVASION.STRIFE);
    const invaderId = cultures.cultures[invader].id ?? null;
    const strifeAt = new Float64Array(cells.count).fill(strife);
    for (let cell = 0; cell < cells.count; cell++) {
        if (cultures.dominant[cell] === invader && previous.dominantId[cell] !== null && previous.dominantId[cell] !== invaderId) strifeAt[cell] = raised;
    }
    return strifeAt;
}

/** The edges built as roads and lanes: those carrying trade now, and those built before. */
function builtEdges(graph, traffic, before) {
    const built = new Uint8Array(graph.edgeCount);
    for (let edge = 0; edge < graph.edgeCount; edge++) built[edge] = before?.[edge] || (traffic[edge] > 0 && graph.edgeKind[edge] !== EDGE.RIVER) ? 1 : 0;
    return built;
}

/**
 * What the age before the present left (see FormerAge), as the result carries it: its ruins and
 * abandoned castles named, its old roads chained as routes are (roads only), and on every place
 * of the present and every ruin its tier in each age (-1 where it was none; 0 city, 1 large town,
 * 2 town), with the age it was last a realm's seat for a former capital (ages counted from 1).
 */
function formerResult(run, result, former, names, history) {
    const formerAgeNumber = history.length;
    const tiersAt = history.map((age) => {
        const tiers = new Map();
        for (let index = 0; index < age.places.length; index += 3) tiers.set(age.places[index], age.places[index + 1]);
        return tiers;
    });
    const agesOf = (cell, now) => [...tiersAt.map((tiers) => tiers.get(cell) ?? -1), now];
    for (const place of result.places) {
        if (place.kind !== "town") continue;
        place.ages = agesOf(place.cell, place.tier);
        if (former.formerSeats.has(place.cell)) place.formerCapital = formerAgeNumber;
    }
    const ruins = former.ruins.map((ruin) => ({
        kind: "ruin",
        cell: ruin.cell,
        name: names.former.towns.get(ruin.cell),
        formerTier: ruin.formerTier,
        formerAge: formerAgeNumber,
        formerCapital: ruin.formerCapital ? formerAgeNumber : null,
        population: Math.round(ruin.population),
        ages: agesOf(ruin.cell, -1),
    }));
    const abandonedCastles = former.castles.map((castle, index) => ({ kind: "abandonedCastle", cell: castle.cell, name: names.former.castles[index].name, keep: names.former.castles[index].keep, formerAge: formerAgeNumber }));
    const nodes = [...result.places.map((place) => place.cell), ...ruins.map((ruin) => ruin.cell)];
    const oldRoads = routeChains(run.graph, former.oldTraffic, nodes).filter((chain) => chain.transport === "road");
    return { ruins, abandonedCastles, oldRoads };
}

/**
 * An earlier age in brief, kept in the run's history so the map's past can be shown: its era and strife,
 * its places (cell, tier and whether a realm's seat, three numbers each), castles, realm seats and
 * each cell's realm.
 */
function ageHistory(age, settingsOfAge) {
    const seats = new Set(age.finalRealms.realms.map((realm) => realm.seat));
    return {
        development: settingsOfAge.development,
        plague: settingsOfAge.plague,
        strife: settingsOfAge.strife,
        places: age.finalTrade.towns.flatMap((town) => [town.cell, town.tier, seats.has(town.cell) ? 1 : 0]),
        castles: age.feedback.castles.map((castle) => castle.cell),
        seats: [...seats],
        realm: Int32Array.from(age.finalRealms.realmOfCell),
    };
}

function defaultPause() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Runs stages, turning their yielded fractions into overall progress, pausing and cancelling. */
class StageDriver {
    #last = performance.now();
    #age = 0;
    #agesDone = false;

    constructor({ onProgress, isCancelled, isStopping = () => false, pause, breathMs, ages = 1 }) {
        this.breathMs = breathMs;
        this.ages = ages;
        this.isStopping = isStopping;
        this.onProgress = onProgress;
        this.isCancelled = isCancelled;
        this.pause = pause;
        const stages = FILRODENSWMB.GENERATOR.STAGES;
        const total = stages.reduce((sum, stage) => sum + stage.weight, 0);
        let before = 0;
        this.span = new Map(stages.map((stage) => {
            const span = { start: before / total, width: stage.weight / total };
            before += stage.weight;
            return [stage.id, span];
        }));
    }

    /** Runs one stage that does its work in one go (a plain function) and returns its value. */
    async step(id, work, run) {
        await this.#breathe(id, 0, true);
        const started = performance.now();
        const value = work();
        run.timings[id] = Math.round(performance.now() - started);
        return value;
    }

    /** Runs one stage that reports as it goes (a generator function) to its return value. */
    async stage(id, makeGenerator, run) {
        await this.#breathe(id, 0, true);
        const started = performance.now();
        const steps = makeGenerator();
        for (;;) {
            const { value, done } = steps.next();
            if (done) {
                run.timings[id] = Math.round(performance.now() - started);
                return value;
            }
            await this.#breathe(id, value, false);
        }
    }

    /** The age under way (0 first): progress runs through the ages in turn. */
    setAge(index) {
        this.#age = index;
    }

    /** The ages are done: a stop asked for now changes nothing. */
    endAges() {
        this.#agesDone = true;
    }

    report(id, fraction) {
        const span = this.span.get(id);
        const withinAge = span.start + span.width * Math.min(1, Math.max(0, fraction));
        if (this.ages <= 1) {
            this.onProgress?.({ stage: id, pct: Math.min(100, Math.round(100 * withinAge)) });
            return;
        }
        const pct = Math.min(100, Math.round((100 * (this.#age + withinAge)) / this.ages));
        this.onProgress?.({ stage: id, pct, age: this.#age + 1, ages: this.ages });
    }

    async #breathe(id, fraction, always) {
        if (!always && performance.now() - this.#last < this.breathMs) return;
        this.report(id, fraction);
        await this.pause();
        this.#last = performance.now();
        if (this.isCancelled()) throw new GenerationCancelled();
        // An age after the first lets go when asked to stop: the ages finished are the run
        if (this.#age > 0 && !this.#agesDone && this.isStopping()) throw new AgeStopped();
    }
}

// ------------------------------------------------------------------ the result

/**
 * The run's output as plain data (typed arrays and plain objects, so it can leave a worker as
 * transferables): the model cells' values, the places, the realm hierarchy and the routes. Cell
 * ids are model cell ids, which are also the display mesh's ids of the model sites.
 */
function assembleResult(run, { feedback, finalTrade, finalRealms, names }) {
    const { cells, graph, cultures, settings } = run;
    const seats = new Set(finalRealms.realms.map((realm) => realm.seat));
    const places = [
        ...finalTrade.towns.map((town) => townPlace(run, town, names, seats, feedback.cellPop)),
        ...feedback.castles.map((castle, index) => castlePlace(castle, names.castles[index])),
    ];
    const routes = routeChains(graph, finalTrade.traffic, finalTrade.towns.map((town) => town.cell));
    const people = peopleByUnit(feedback.cellPop, finalRealms);
    const realmMix = unitCultures(cultures, finalRealms.realmOfCell, feedback.cellPop, finalRealms.realms.length);
    const duchyMix = unitCultures(cultures, finalRealms.duchyOfCell, feedback.cellPop, finalRealms.duchies.length);
    const countyMix = unitCultures(cultures, finalRealms.countyOfCell, feedback.cellPop, finalRealms.counties.length);
    return {
        revision: FILRODENSWMB.GENERATOR.REVISION,
        settings,
        modelCells: modelCellOutput(run, feedback, finalRealms),
        modelGraph: { neighbourStart: Int32Array.from(cells.neighbourStart), neighbourList: Int32Array.from(cells.neighbourList) },
        // Each culture as the run used it: the map's id (none for the default culture), its name and
        // colour then, and its homeland cells (given, or placed) with how many points it was given
        // and how many of the points it was given were left out (off the map, or not on land)
        cultures: cultures.cultures.map((culture, index) => ({
            id: culture.id ?? null,
            name: culture.name,
            color: culture.color ?? null,
            nameBase: culture.nameBase,
            homelands: Array.from(cultures.homelands[index]),
            homelandsAuto: cultures.homelandNotes[index].auto,
            homelandsLeftOut: Math.max(0, (culture.homelandsGiven ?? 0) - (culture.homelandCells?.length ?? 0)) + cultures.homelandNotes[index].offLand,
        })),
        places,
        realms: finalRealms.realms.map((realm, index) => ({
            kind: realm.kind,
            seat: realm.seat,
            name: names.realms[index].name,
            capital: names.realms[index].capital,
            duchies: realm.duchies,
            population: Math.round(people.realm[index]),
            landKm2: Math.round(realm.landKm2),
            cultures: realmMix[index],
        })),
        // Duchies and counties name their largest culture (-1 for none)
        duchies: finalRealms.duchies.map((duchy, index) => ({ seat: duchy.seat, name: names.duchies[index], realm: finalRealms.realmOfDuchy[index], counties: duchy.counties, population: Math.round(people.duchy[index]), culture: duchyMix[index][0]?.[0] ?? -1 })),
        counties: finalRealms.counties.map((county, index) => ({ seat: county.seat, name: names.counties[index], duchy: finalRealms.duchyOfCounty[index], population: Math.round(people.county[index]), culture: countyMix[index][0]?.[0] ?? -1 })),
        routes,
        stats: statistics(run, { feedback, finalTrade, finalRealms, routes, places }),
        timings: run.timings,
        cellCount: cells.count,
    };
}

/**
 * The people living in each realm, duchy and county: the sum of their cells' population. (The
 * realms' own totals add the townspeople to the countryside for their tax base; the towns' people
 * are already counted in the cells, so these are the headcounts to report.)
 */
function peopleByUnit(cellPop, realms) {
    const realm = new Float64Array(realms.realms.length);
    const duchy = new Float64Array(realms.duchies.length);
    const county = new Float64Array(realms.counties.length);
    for (let cell = 0; cell < cellPop.length; cell++) {
        if (realms.realmOfCell[cell] >= 0) realm[realms.realmOfCell[cell]] += cellPop[cell];
        if (realms.duchyOfCell[cell] >= 0) duchy[realms.duchyOfCell[cell]] += cellPop[cell];
        if (realms.countyOfCell[cell] >= 0) county[realms.countyOfCell[cell]] += cellPop[cell];
    }
    return { realm, duchy, county };
}

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

function townPlace(run, town, names, seats, cellPop) {
    const mix = town.mix ?? townMix(run.cultures, run.cells, cellPop, town.cell, 3 - town.tier);
    return {
        kind: "town",
        cell: town.cell,
        name: names.towns.get(town.cell),
        tier: town.tier,
        capital: seats.has(town.cell),
        population: Math.round(town.population),
        origin: town.origin,
        port: !!town.port,
        coastal: !!town.coastal,
        navigable: !!town.navigable,
        fortified: !!town.fortified,
        security: round(town.security ?? 1, 3),
        culture: town.culture ?? mix[0][0],
        mix: mix.map(([culture, share]) => [culture, round(share, 3)]),
    };
}

function castlePlace(castle, name) {
    return { kind: "castle", cell: castle.cell, name: name.name, keep: name.keep, reason: castle.reason, security: round(castle.security, 3) };
}

/**
 * Each unit's people by culture (a realm's, duchy's or county's), largest first: the shares of its
 * cells weighted by their people.
 * @param {import("./Cultures.js").CultureData} cultures
 * @param {Int32Array} unitOfCell - Each cell's unit, or -1.
 * @param {Float64Array} cellPop
 * @param {number} count - How many units there are.
 * @returns {[number, number][][]}
 */
function unitCultures(cultures, unitOfCell, cellPop, count) {
    const totals = Array.from({ length: count }, () => new Map());
    for (let cell = 0; cell < unitOfCell.length; cell++) {
        const unit = unitOfCell[cell];
        if (unit < 0 || unit >= count) continue;
        for (const [culture, share] of sharesOf(cultures, cell)) totals[unit].set(culture, (totals[unit].get(culture) ?? 0) + share * cellPop[cell]);
    }
    return totals.map((byCulture) => {
        const sum = [...byCulture.values()].reduce((total, value) => total + value, 0) || 1;
        return [...byCulture.entries()].map(([culture, value]) => [culture, round(value / sum, 3)]).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    });
}

function modelCellOutput(run, feedback, realms) {
    const { cells, cultures } = run;
    return {
        capacity: Float32Array.from(cells.food),
        // The land each cell holds, so a thematic layer can give its people and food per area
        landArea: Float32Array.from(cells.landKm2),
        population: Float32Array.from(feedback.cellPop),
        security: Float32Array.from(feedback.security),
        cleared: Float32Array.from(feedback.cleared),
        realm: Int32Array.from(realms.realmOfCell),
        duchy: Int32Array.from(realms.duchyOfCell),
        county: Int32Array.from(realms.countyOfCell),
        water: Uint8Array.from(cells.water),
        culture: Int32Array.from(cultures.dominant),
        shareStart: Int32Array.from(cultures.shareStart),
        shareCulture: Int32Array.from(cultures.shareCulture),
        shareValue: Float32Array.from(cultures.shareValue),
    };
}

/** Counts and totals for the run's report and the parity checks. */
function statistics(run, { feedback, finalTrade, finalRealms, routes, places }) {
    const { graph, cells } = run;
    const towns = places.filter((place) => place.kind === "town");
    const km = { road: 0, river: 0, sea: 0 };
    for (let edge = 0; edge < graph.edgeCount; edge++) {
        if (!(finalTrade.traffic[edge] > 0)) continue;
        const kind = graph.edgeKind[edge];
        if (kind === EDGE.RIVER) km.river += graph.edgeKm[edge];
        else if (kind === EDGE.SEA) km.sea += graph.edgeKm[edge];
        else km.road += graph.edgeKm[edge];
    }
    let land = 0;
    for (let cell = 0; cell < cells.count; cell++) if (!cells.water[cell]) land++;
    return {
        modelCells: cells.count,
        landCells: land,
        population: Math.round(feedback.totalPop),
        kingdoms: finalRealms.realms.filter((realm) => realm.kind === "kingdom").length,
        independents: finalRealms.realms.filter((realm) => realm.kind === "independent").length,
        duchies: finalRealms.duchies.length,
        counties: finalRealms.counties.length,
        cities: towns.filter((town) => town.tier === 0).length,
        largeTowns: towns.filter((town) => town.tier === 1).length,
        towns: towns.filter((town) => town.tier === 2).length,
        castles: feedback.castles.length,
        fortified: towns.filter((town) => town.fortified).length,
        roadKm: Math.round(km.road),
        riverKm: Math.round(km.river),
        seaKm: Math.round(km.sea),
        routes: routes.length,
    };
}
