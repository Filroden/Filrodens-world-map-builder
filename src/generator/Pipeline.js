import { FILRODENSWMB } from "../config.js";
import { buildModelCells } from "./CellValues.js";
import { CellGraph, EDGE } from "./CellGraph.js";
import { engineCultures } from "./CultureInput.js";
import { resolveCultures, sharesOf, spreadCultures, townMix } from "./Cultures.js";
import { feedbackPass } from "./Feedback.js";
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

/** Thrown (rejected) when a run is cancelled. */
export class GenerationCancelled extends Error {
    constructor() {
        super("Generation cancelled");
        this.name = "AbortError";
    }
}

/**
 * Runs the generator.
 * @param {import("./GeneratorInput.js").GeneratorPayload} payload
 * @param {object} [options]
 * @param {function({stage: string, pct: number}): void} [options.onProgress]
 * @param {function(): boolean} [options.isCancelled]
 * @param {function(): Promise<void>} [options.pause]
 * @param {number} [options.breathMs] - Longest stretch of work between pauses (BREATH_MS).
 * @returns {Promise<object>} The run's result (see assembleResult).
 */
export async function runGenerator(payload, { onProgress = null, isCancelled = () => false, pause = defaultPause, breathMs = BREATH_MS } = {}) {
    const settings = resolveSettings(payload.settings, payload.mapSeed);
    const age = settings.ages.at(-1);
    const driver = new StageDriver({ onProgress, isCancelled, pause, breathMs });
    const run = { settings, age, timings: {} };

    run.cells = await driver.step("values", () => buildModelCells({ ...payload, biome: modelBiomeRaster(payload) }, settings.world), run);
    run.graph = new CellGraph(run.cells);
    run.cultures = await driver.step("cultures", () => spreadCultures(run.graph, resolveCultures(cultureList(settings, payload))), run);
    const common = { cultures: run.cultures, world: settings.world };

    const towns = await driver.stage("towns", () => placeTowns(run.graph, { ...common, era: age }), run);
    const trade = await driver.stage("trade", () => tradeRounds(run.graph, { ...common, towns: towns.towns, cellPop: towns.cellPop, totalPop: towns.totalPop }), run);
    const realms = await driver.step("realms", () => buildRealms(run.graph, { ...common, towns: trade.towns, cellPop: towns.cellPop, traffic: trade.traffic }), run);
    const feedback = await driver.step("feedback", () => feedbackPass(run.graph, { ...common, towns: trade.towns, cellPop: towns.cellPop, traffic: trade.traffic, realms, strife: age.strife }), run);

    const final = { traffic: trade.traffic, security: feedback.security, royalSeats: feedback.royalSeats };
    const finalTrade = await driver.stage("finalTrade", () => tradeRounds(run.graph, { ...common, towns: feedback.towns, cellPop: feedback.cellPop, totalPop: feedback.totalPop, final }), run);
    const finalRealms = await driver.step("finalRealms", () => buildRealms(run.graph, { ...common, towns: finalTrade.towns, cellPop: feedback.cellPop, traffic: finalTrade.traffic, fixedSeats: feedback.royalSeats }), run);
    const names = await driver.step("names", () => nameEverything({ seed: settings.seed, nameBase: settings.nameBase, cultures: run.cultures, towns: finalTrade.towns, castles: feedback.castles, realms: finalRealms }), run);
    driver.report("names", 1);
    return assembleResult(run, { feedback, finalTrade, finalRealms, names });
}

/** The cultures of a run (the map's, in the engine's form); with none, the default culture speaking the run's name style. */
function cultureList(settings, payload) {
    if (settings.cultures.length) return engineCultures(settings.cultures, payload);
    return [{ ...FILRODENSWMB.GENERATOR.CULTURES.DEFAULT, nameBase: settings.nameBase }];
}

function defaultPause() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Runs stages, turning their yielded fractions into overall progress, pausing and cancelling. */
class StageDriver {
    #last = performance.now();

    constructor({ onProgress, isCancelled, pause, breathMs }) {
        this.breathMs = breathMs;
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

    report(id, fraction) {
        const span = this.span.get(id);
        const pct = Math.min(100, Math.round(100 * (span.start + span.width * Math.min(1, Math.max(0, fraction)))));
        this.onProgress?.({ stage: id, pct });
    }

    async #breathe(id, fraction, always) {
        if (!always && performance.now() - this.#last < this.breathMs) return;
        this.report(id, fraction);
        await this.pause();
        this.#last = performance.now();
        if (this.isCancelled()) throw new GenerationCancelled();
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
