import js from "@eslint/js";
import globals from "globals";

export default [
    js.configs.recommended,
    {
        files: ["**/*.js", "**/*.mjs"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.browser,
                // Foundry VTT Globals
                foundry: "readonly",
                game: "readonly",
                canvas: "readonly",
                ui: "readonly",
                Hooks: "readonly",
                FilePicker: "readonly",
                AudioHelper: "readonly",
                VideoHelper: "readonly",
                PIXI: "readonly",
                Actor: "readonly",
                Item: "readonly",
                Scene: "readonly",
                Folder: "readonly",
                JournalEntry: "readonly",
                JournalEntryPage: "readonly",
                Token: "readonly",
                User: "readonly",
                ChatMessage: "readonly",
                Macro: "readonly",
                Roll: "readonly",
                Config: "readonly",
                Handlebars: "readonly",
                jQuery: "readonly",
                renderTemplate: "readonly",
                CONFIG: "readonly",
                fromUuid: "readonly",
                fromUuidSync: "readonly",
                // Hosting & Module Globals
                ForgeVTT: "readonly",
                Sequencer: "readonly",
                Sequence: "readonly",
                Trowel: "readonly",
                TokenMagic: "readonly",
            },
        },
        rules: {
            "no-unused-vars": ["warn", { argsIgnorePattern: "^_", ignoreRestSiblings: true }],
            "no-debugger": "warn",
            "no-console": "off", // Set to "warn" if you want to find left-over logs
        },
    },
    // --- The platform boundary ---
    // The studio and the engine run in Foundry and on a plain web page, so they reach the host
    // only through src/platform (see src/platform/index.js). Foundry's globals are allowed in
    // Foundry's own implementation of those services and in the module's Foundry entry points.
    {
        files: ["src/**/*.js"],
        ignores: ["src/platform/foundry/**", "src/hooks/**"],
        rules: {
            "no-restricted-globals": [
                "error",
                ...["game", "ui", "foundry", "Hooks", "CONFIG", "Handlebars", "FilePicker", "JournalEntry", "JournalEntryPage", "renderTemplate", "fromUuid", "fromUuidSync", "canvas"].map((name) => ({
                    name,
                    message: `Foundry's ${name} is only reachable through src/platform (see src/platform/index.js).`,
                })),
            ],
        },
    },
    // --- The layers' settings (RF1) ---
    // FILRODENSWMB is split by layer (src/config.js puts it together). The layers below the World
    // studio, and the Local studio beside it, never import the World studio's own part: what they
    // need from it lives in their own layer's config or the kernel's.
    {
        files: ["src/kernel/**/*.js", "src/shell/**/*.js", "src/platform/**/*.js", "src/studios/local/**/*.js"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["**/studios/world/config.js"],
                            message: "The World studio's settings are its own: read them through src/config.js, or move what this layer needs into its own config (RF1).",
                        },
                    ],
                },
            ],
        },
    },
    // --- PIXI in the kernel ---
    // The kernel reads no host's globals: PIXI is handed in (see DrawnDecoration.build and LabelWidth.usePixi).
    {
        files: ["src/kernel/**/*.js"],
        rules: {
            "no-restricted-globals": [
                "error",
                ...["game", "ui", "foundry", "Hooks", "CONFIG", "Handlebars", "FilePicker", "JournalEntry", "JournalEntryPage", "renderTemplate", "fromUuid", "fromUuidSync", "canvas"].map((name) => ({
                    name,
                    message: `Foundry's ${name} is only reachable through src/platform (see src/platform/index.js).`,
                })),
                { name: "PIXI", message: "The kernel is handed PIXI (see DrawnDecoration.build and LabelWidth.usePixi)." },
            ],
        },
    },
    // --- Override for Node.js build scripts and tests ---
    {
        files: ["scripts/**/*.mjs", "tests/**/*.mjs"],
        languageOptions: {
            globals: {
                ...globals.node, // This explicitly allows 'process', '__dirname', etc.
            },
        },
    },
];
