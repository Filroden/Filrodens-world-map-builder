// The waterfront. A port has a quay along the shore by its centre, lined with warehouses, with
// jetties into the water and, in a larger port on the sea, a harbour basin between two moles with
// a light at the end of one; ships lie in the basin and at anchor beyond. A town or village by the
// water without sea trade has a short quay or a landing stage. A river port has a quay along the
// river bank by its bridge.
import { dist, lerp, offsetPolyline } from "../Geometry.js";
import { RESERVED, STREET } from "./Occupancy.js";
import { alongShore, shorePoint } from "./Shore.js";

/** A port's quay: base length, length per person, and the most (m). */
const QUAY_M = [120, 1 / 30, 900];
/** A town's or village's quay without sea trade. */
const LANDING_M = [50, 1 / 80, 260];
/** The quay's street runs this far (m) inland of the waterline; its half width. */
const QUAY_INSET = 7;
const QUAY_HALF = 5;
/** A harbour basin, for a port of at least HARBOUR_PEOPLE: width base, per person, range (m). */
const HARBOUR_PEOPLE = 3000;
const HARBOUR_M = [140, 1 / 80, 160, 460];
/** The moles run out this share of the basin's width, then turn in this share from each side. */
const MOLE_OUT = 0.55;
const MOLE_IN = 0.28;
/** Jetties: spacing, length and width (m). */
const JETTY_SPACING = [38, 58];
const JETTY_LENGTH = [18, 32];
const JETTY_WIDTH = 5;
/** Ships: one per this many people, within these bounds; their length (m). */
const SHIP_PEOPLE = 2500;
const SHIPS = [2, 12];
const SHIP_LENGTH = [16, 30];
/** A river port's quay: base length, per person, and the most (m). */
const RIVER_QUAY_M = [70, 1 / 120, 420];

export function buildPort(T) {
    const { input, shore, river, centre: C, occupancy, kind } = T;
    T.quays = [];
    T.moles = [];
    T.jetties = [];
    T.ships = [];
    T.light = null;
    const random = T.R("port");
    const population = input.population;
    const lengthOf = ([base, per, most], extra = 0) => Math.min(most, base + population * per + extra);

    if (shore?.main) {
        const line = shore.main;
        const isPort = input.port;
        let tc = alongShore(line, C);
        const harbourWidth = isPort && (shore.body === "sea" || kind === "city") && population >= HARBOUR_PEOPLE ? Math.max(HARBOUR_M[2], Math.min(HARBOUR_M[3], HARBOUR_M[0] + population * HARBOUR_M[1])) : 0;
        // Keep the basin clear of the river's mouth: it lies on the far side of the centre from it
        if (harbourWidth && river.mouth && !river.brook) {
            const mouthAt = alongShore(line, river.mouth);
            if (Math.abs(mouthAt - tc) < harbourWidth / 2 + river.width / 2 + 25) tc = mouthAt + Math.sign(tc - mouthAt || 1) * (harbourWidth / 2 + river.width / 2 + 25);
        }
        const length = Math.max(lengthOf(isPort ? QUAY_M : LANDING_M), harbourWidth + 60);
        const dry = (p) => T.inFrame(p) && !T.seaAt(p) && T.rdAt(p) - river.width / 2 > QUAY_HALF + 3;
        const runs = [];
        let run = [];
        for (let t = tc - length / 2; t <= tc + length / 2; t += 8) {
            const p = shorePoint(line, t, QUAY_INSET);
            if (dry(p)) run.push(p);
            else {
                if (run.length > 2) runs.push(run);
                run = [];
            }
        }
        if (run.length > 2) runs.push(run);
        for (const points of runs) {
            const quay = { points, half: QUAY_HALF, rank: 1, quay: true };
            T.quays.push(quay);
            T.streets.push(quay);
            occupancy.stampPolyline(points, QUAY_HALF, STREET);
        }
        // A sea wall's water gates each open onto a lane down to the quay
        for (const gate of T.wall?.gates ?? []) {
            if (!gate.water) continue;
            const inward = [gate.p[0] - Math.cos(gate.dir) * 30, gate.p[1] - Math.sin(gate.dir) * 30];
            const down = shorePoint(line, alongShore(line, gate.p), QUAY_INSET);
            if (!dry(down) || !dry(inward)) continue;
            const lane = { points: [inward, gate.p, down], half: 3, rank: 2, waterGate: true };
            occupancy.clearPolyline(lane.points, lane.half, RESERVED, STREET);
            occupancy.stampPolyline(lane.points, lane.half, STREET);
            T.streets.push(lane);
        }
        // The harbour: two moles out from the shore, turning in towards each other
        let basin = null;
        if (harbourWidth) {
            const t1 = tc - harbourWidth / 2;
            const t2 = tc + harbourWidth / 2;
            const out = harbourWidth * MOLE_OUT;
            const arm = (t, outward, turn) => {
                const root = shorePoint(line, t, 3);
                const elbow = [root[0] + line.u[0] * outward, root[1] + line.u[1] * outward];
                const end = [elbow[0] + line.v[0] * turn, elbow[1] + line.v[1] * turn];
                return [root, elbow, end];
            };
            const a = arm(t1, out, harbourWidth * MOLE_IN);
            const b = arm(t2, out * 0.85, -harbourWidth * MOLE_IN);
            const sound = (mole) => mole.every((p) => T.inFrame(p)) && T.seaAt(mole[1]) && T.seaAt(mole[2]);
            if (sound(a) && sound(b)) {
                T.moles.push({ points: a, width: 9 }, { points: b, width: 9 });
                T.light = a[2];
                basin = { t1, t2, out };
            }
        }
        // Jetties along the quay: in the basin, or along the waterfront where there is none
        const from = basin ? basin.t1 + 25 : tc - length / 2 + 10;
        const to = basin ? basin.t2 - 25 : tc + length / 2 - 10;
        const jettyCount = isPort ? Infinity : kind === "village" ? 1 : 3;
        let placed = 0;
        for (let t = from + random.range(0, 20); t <= to && placed < jettyCount; t += random.range(JETTY_SPACING[0], JETTY_SPACING[1])) {
            const root = shorePoint(line, t, 1);
            const reach = random.range(JETTY_LENGTH[0], JETTY_LENGTH[1]) * (isPort ? 1 : 0.7);
            const tip = [root[0] + line.u[0] * reach, root[1] + line.u[1] * reach];
            if (!T.inFrame(root) || T.seaAt(root) || !T.seaAt(tip) || T.rdAt(root) - river.width / 2 < 12) continue;
            T.jetties.push({ points: [root, tip], width: JETTY_WIDTH });
            placed++;
        }
        // Ships in the basin and at anchor off the waterfront
        if (isPort) {
            const wanted = Math.max(SHIPS[0], Math.min(SHIPS[1], Math.round(population / SHIP_PEOPLE)));
            const inBasin = basin ? Math.ceil(wanted * 0.6) : 0;
            const clear = (p, length) =>
                T.inFrame(p) &&
                T.seaAt(p) &&
                T.ships.every((ship) => dist(ship.p, p) > (ship.length + length) / 2 + 6) &&
                T.jetties.every((jetty) => dist(lerp(jetty.points[0], jetty.points[1], 0.5), p) > length / 2 + 10) &&
                T.moles.every((mole) => mole.points.every((q, k) => k === 0 || dist(lerp(mole.points[k - 1], q, 0.5), p) > length / 2 + 14));
            for (let tries = 0; tries < 400 && T.ships.length < wanted; tries++) {
                const anchored = T.ships.length >= inBasin;
                const length = random.range(SHIP_LENGTH[0], SHIP_LENGTH[1]) * (anchored ? 1.2 : 1);
                const t = anchored ? tc + random.range(-1, 1) * Math.max(250, length) * 2 : random.range(basin.t1 + 20, basin.t2 - 20);
                const s = anchored ? random.range(basin ? basin.out + 60 : 60, (basin ? basin.out : 0) + 320) : random.range(18, basin.out - 18);
                const p = shorePoint(line, t, -s);
                // Moored ships lie along the quay; at anchor they swing to the wind
                const angle = anchored ? random.range(0, Math.PI) : Math.atan2(line.v[1], line.v[0]) + random.range(-0.15, 0.15);
                if (!anchored && !(alongShore(line, p) > basin.t1 + 10 && alongShore(line, p) < basin.t2 - 10)) continue;
                if (clear(p, length)) T.ships.push({ p, angle, length, width: length * 0.3 });
            }
        }
    }

    // A river port's quay along the bank by the bridge, on the town's side
    if (input.riverPort && !river.brook && kind !== "village") {
        const bridgeAt = lerp(T.bridge[0], T.bridge[1], 0.5);
        const line = river.line.filter((p) => !T.seaAt(p));
        let at = 0;
        for (let k = 1; k < line.length; k++) if (dist(line[k], bridgeAt) < dist(line[at], bridgeAt)) at = k;
        const reach = lengthOf(RIVER_QUAY_M) / 2;
        // Which side of the river the town stands on
        const a = line[Math.max(0, at - 1)];
        const b = line[Math.min(line.length - 1, at + 1)];
        const cross = (b[0] - a[0]) * (C[1] - a[1]) - (b[1] - a[1]) * (C[0] - a[0]);
        const offset = (river.width / 2 + QUAY_HALF + 1) * (cross > 0 ? -1 : 1);
        const bank = offsetPolyline(line, offset);
        const runs = [];
        let run = [];
        for (let k = 0; k < bank.length; k++) {
            const p = bank[k];
            const ok = dist(line[k], line[at]) < reach && T.inFrame(p) && !T.seaAt(p) && dist(p, bridgeAt) > 12;
            if (ok) run.push(p);
            else {
                if (run.length > 2) runs.push(run);
                run = [];
            }
        }
        if (run.length > 2) runs.push(run);
        for (const points of runs) {
            const quay = { points, half: QUAY_HALF - 1, rank: 1, quay: true, river: true };
            T.quays.push(quay);
            T.streets.push(quay);
            occupancy.stampPolyline(points, QUAY_HALF - 1, STREET);
        }
    }
}
