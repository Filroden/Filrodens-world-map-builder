// The name filter's probe (roadmap decision 45; not run in CI): generated place names from every
// name base through the filter, with each base's share blocked and the words that block them, so
// the list in src/kernel/names/data/BlockedWords.js can be checked when it changes.
//
//   node scripts/name-probe.mjs [names a base, default 20000] [--words] [--examples]
//
// A word belongs on the list only where it takes out no more than NAME_FILTER.CAP of any base's
// names; the probe marks a base over the cap.
import { NamesGenerator } from "../vendor/azgaar-names/names-generator.js";
import { FILRODENSWMB } from "../src/config.js";
import { blockedWordIn } from "../src/kernel/names/NameFilter.js";
import { mulberry32 } from "../src/kernel/random/Random.js";

const count = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 20000);
const showWords = process.argv.includes("--words");
const showExamples = process.argv.includes("--examples");
const cap = FILRODENSWMB.NAME_FILTER.CAP;
const generator = new NamesGenerator(mulberry32(45));
const byWord = new Map();
let over = 0;
for (let base = 0; base < generator.nameBases.length; base++) {
    let blocked = 0;
    const words = new Map();
    for (let i = 0; i < count; i++) {
        const name = i % 4 === 3 ? generator.getBaseShort(base) : generator.getBase(base);
        const word = blockedWordIn(name);
        if (!word) continue;
        blocked++;
        words.set(word, (words.get(word) ?? 0) + 1);
        const all = byWord.get(word) ?? { count: 0, examples: new Set() };
        all.count++;
        if (all.examples.size < 6) all.examples.add(name);
        byWord.set(word, all);
    }
    const share = blocked / count;
    if (share > cap) over++;
    console.log(`${generator.nameBases[base].name.padEnd(16)} ${(share * 100).toFixed(2).padStart(5)}%${share > cap ? "  OVER THE CAP" : ""}${showWords && words.size ? "  " + [...words].sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ${n}`).join(", ") : ""}`);
}
if (showExamples) for (const [word, { count: n, examples }] of [...byWord].sort((a, b) => b[1].count - a[1].count)) console.log(`${word.padEnd(10)} ${String(n).padStart(5)}  ${[...examples].join(", ")}`);
console.log(`${generator.nameBases.length} bases, ${count} names each; ${over} over the cap of ${(cap * 100).toFixed(1)}%`);
