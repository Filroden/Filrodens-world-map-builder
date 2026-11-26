/**
 * Words kept out of generated names (roadmap decision 45; see NameFilter). This file exists to
 * filter offensive words, so it lists them, slurs included, in plain text so the list can be read
 * and changed. The words are the strong and common rude words of English, French, German, Spanish,
 * Italian, Portuguese, Dutch and Polish, without accents and in lower case (NameFilter reads a name
 * the same way).
 *
 * Each word is listed where it is rude, as the probe of generated names shows (scripts/name-probe.mjs):
 * - anywhere: never innocent inside another word;
 * - start: at the start of a word of the name (Arsereacht), but innocent at its end ("-pass" ends
 *   Dawnpass, "-tit" ends Nahuatl names);
 * - end: at the end of a word of the name;
 * - whole: only as a word of the name by itself, as it is an ordinary syllable elsewhere ("-acum"
 *   ends Roman names).
 * A word goes on the list only where it takes out no more than 1% of any name base's generated
 * names (FILRODENSWMB.NAME_FILTER.CAP), so the list stays narrow.
 *
 * ALLOWED names pass whatever they hold: well-known real names in common use, each with its reason
 * (Ken, 2026-11-26). Real names are otherwise checked like any other.
 */

const words = (...lists) => Object.freeze([...new Set(lists.flat())].sort());

export const BLOCKED_WORDS = Object.freeze({
    anywhere: words(
        // English
        ["fuck", "cunt", "wank", "whore", "bitch", "bastard", "arsehole", "asshole", "bollock", "dildo", "jizz", "nigger", "nigga", "faggot", "retard"],
        // French
        ["merde", "putain", "salope", "connard", "couille", "foutre", "encule", "batard", "bougnoule", "youpin"],
        // German
        ["scheiss", "fotze", "ficken", "arschloch", "wichser", "schlampe", "kacke", "schwuchtel", "kanake"],
        // Spanish
        ["mierda", "joder", "pendejo", "maricon", "gilipollas", "chingar", "cabron", "culero"],
        // Italian
        ["cazzo", "minchia", "stronzo", "puttana", "vaffanculo", "coglion", "frocio"],
        // Portuguese
        ["caralho", "buceta", "piroca"],
        // Dutch
        ["klootzak", "godverdomme", "neuken", "flikker", "kanker"],
        // Polish
        ["kurwa", "pizda", "kutas", "pierdol", "skurwysyn", "jebac", "jebany"],
    ),
    start: words(
        // English
        ["shit", "porn", "arse", "ass", "tit", "cock", "slut", "twat", "turd", "piss", "dick", "wank", "prick", "spunk", "fag"],
        // French
        ["pute", "bite", "chier"],
        // German
        ["arsch", "fick"],
        // Spanish
        ["puta", "puto"],
        // Dutch
        ["hoer"],
    ),
    end: words(
        // English
        ["shit"],
    ),
    whole: words(
        // English
        ["cum", "bum", "poo", "tits", "boob", "boobs", "knob", "nob", "coon", "gook", "spic", "chink", "kike", "paki", "tranny"],
        // French
        ["conne", "chatte", "bordel", "nique", "pede", "cul"],
        // German
        ["hure", "neger", "pisser"],
        // Spanish
        ["cono", "polla", "verga", "zorra"],
        // Italian
        ["merda", "culo", "figa", "troia"],
        // Portuguese
        ["porra", "foda", "foder", "viado", "bosta", "cacete"],
        // Dutch
        ["kut", "lul", "tering", "pik"],
        // Polish
        ["chuj", "huj", "cipa", "dupa", "pedal", "szmata"],
    ),
});

/** Names that pass whatever they hold, each with its reason. */
export const ALLOWED = Object.freeze({
    Titus: "a Roman given name in common use",
    Titu: "a Quechua given name (Titu Cusi), on our own lists",
    Titilayo: "a Yoruba given name, on our own lists",
    Dickson: "an English family name in common use",
    Yoshitsune: "a Japanese given name (Minamoto no Yoshitsune), on our own lists",
});
