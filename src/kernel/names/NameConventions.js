// The conventions that join given names and family names, and the word-forming rules they need
// (patronymics, a family name's form for a woman, a byname from a place). Personal names N2,
// from the names prototype's `lib/conventions.mjs`.
//
// A culture's convention (its `form`):
// - inherited: a family name passed down, chosen once for the household (a wife takes it or keeps
//   her own);
// - byname: a second name from the head's trade, his place, a feature or his father, which the
//   household shares, as medieval bynames before they set into surnames;
// - patronymic: each person named after their father (or mother, by `lineage`);
// - clan: a clan or house name with the culture's own prefixes (Mac, Ó, Ní and Nic);
// - single: one given name, with now and then a byname to tell two people apart;
// - roman: praenomen, the family's nomen and a cognomen; a daughter takes the nomen's feminine.
// And `order`: given name first, or family name first.

export const FORMS = Object.freeze(["inherited", "byname", "patronymic", "clan", "single", "roman"]);
export const ORDERS = Object.freeze(["given-first", "family-first"]);
export const LINEAGES = Object.freeze(["father", "mother"]);
export const WIVES = Object.freeze(["takes", "keeps"]);

const VOWEL = /[aeiouyàáâãäåæèéêëìíîïòóôõöøùúûüýāăēĕīĭōŏūŭœ]/i;
const isVowel = (c) => VOWEL.test(c ?? "");

/**
 * A suffix joined to a word: kept off when the word already ends with it, and a vowel dropped
 * where two would meet.
 */
export function joinSuffix(word, suffix) {
    if (!suffix) return word;
    if (word.toLowerCase().endsWith(suffix.toLowerCase())) return word;
    if (isVowel(word.at(-1)) && isVowel(suffix[0])) return word.slice(0, -1) + suffix;
    return word + suffix;
}

/** A template ("{p}er", "de {p}", "{p}") filled with a word, joining suffixes by joinSuffix. */
export function fill(template, key, word) {
    const at = template.indexOf(`{${key}}`);
    if (at < 0) return template;
    const before = template.slice(0, at);
    const after = template.slice(at + key.length + 2);
    if (after && !after.startsWith(" ")) return before + joinSuffix(word, after);
    return before + word + after;
}

// Castilian and Portuguese patronymic surnames: the well-known forms, then a rule
const IBERIAN = {
    Castillian: {
        Rodrigo: "Rodríguez", Fernando: "Fernández", Fernán: "Fernández", Gonzalo: "González", Martín: "Martínez", Pedro: "Pérez",
        Sancho: "Sánchez", Diego: "Díaz", Gómez: "Gómez", García: "Garcés", Lope: "López", Álvaro: "Álvarez", Nuño: "Núñez",
        Ruy: "Ruiz", Domingo: "Domínguez", Juan: "Ibáñez", Alfonso: "Alfonso", Alonso: "Alonso", Esteban: "Estébanez",
        Gutierre: "Gutiérrez", Pelayo: "Peláez", Bermudo: "Bermúdez", Ordoño: "Ordóñez", Vela: "Velázquez", Blasco: "Blázquez",
        Íñigo: "Íñiguez", Miguel: "Míguez", Andrés: "Andrés", Lorenzo: "Lorenzo", Tello: "Téllez",
    },
    Portuguese: {
        Rodrigo: "Rodrigues", Fernão: "Fernandes", Gonçalo: "Gonçalves", Martim: "Martins", Pedro: "Pires", Sancho: "Sanches",
        Diogo: "Dias", Lopo: "Lopes", Álvaro: "Álvares", Nuno: "Nunes", Rui: "Rodrigues", Domingos: "Domingues", Estêvão: "Esteves",
        Vasco: "Vasques", Henrique: "Henriques", Mem: "Mendes", Paio: "Pais", Soeiro: "Soares", Egas: "Viegas", Garcia: "Garcia",
        Gil: "Gil", Afonso: "Afonso", João: "Anes", Lourenço: "Lourenço", Duarte: "Duarte", Vicente: "Vicente", Gomes: "Gomes",
    },
};

/** A patronymic (or matronymic) from a parent's given name, by the base's rule, for a child of `sex`. */
export function patronymic(base, baseName, parent, sex) {
    const rule = base.father ?? {};
    if (rule.rule === "castilian") {
        const known = IBERIAN[baseName]?.[parent];
        if (known) return known;
        const stem = isVowel(parent.at(-1)) ? parent.slice(0, -1) : parent;
        return stem + (baseName === "Portuguese" ? "es" : "ez");
    }
    if (rule.rule === "slavic") return slavicPatronymic(parent, sex);
    if (rule.rule === "nordic") {
        const stem = parent.endsWith("s") ? parent.slice(0, -1) : parent;
        return stem + (sex === "f" ? "sdatter" : "sson");
    }
    const template = rule[sex] ?? rule.m;
    return template ? fill(template, "f", parent) : parent;
}

function slavicPatronymic(parent, sex) {
    const f = sex === "f";
    if (/(ei|ey)$/.test(parent)) return parent.slice(0, -1) + (f ? "evna" : "evich");
    if (/(iy|ii)$/.test(parent)) return parent.slice(0, -2) + (f ? "ievna" : "ievich");
    if (parent === "Igor") return f ? "Igorevna" : "Igorevich";
    if (/[aя]$/.test(parent)) return parent.slice(0, -1) + (f ? "ichna" : "ich");
    if (/[jkgx]$/.test(parent)) return parent + (f ? "ovna" : "ovich");
    if (/(ch|sh|zh|ts)$/.test(parent)) return parent + (f ? "evna" : "evich");
    return parent + (f ? "ovna" : "ovich");
}

/** A family name's form for a woman, where the language changes it. */
export function feminineFamily(baseName, name) {
    if (baseName === "Ruthenian") {
        if (/sk(y|iy|ii)$/.test(name)) return name.replace(/sk(y|iy|ii)$/, "skaya");
        if (/(ov|ev|in|yn)$/.test(name)) return name + "a";
        if (/oi$/.test(name)) return name.replace(/oi$/, "aya");
        return name;
    }
    if (baseName === "Greek") {
        if (/os$/.test(name)) return name.replace(/os$/, "e");
        if (/es$/.test(name)) return name.replace(/es$/, "issa");
        if (/as$/.test(name)) return name.replace(/as$/, "aina");
        return name;
    }
    if (baseName === "Roman") return name.replace(/ius$/, "ia").replace(/us$/, "a");
    return name;
}
