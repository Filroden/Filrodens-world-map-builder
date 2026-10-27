// The backup and the portable map file: MapPackage carries a map's images and custom pin icons out
// (embedded, packaged by hash, or not at all) and brings them back in, the host's way; Backup packs
// every map into a zip and reads one back, refusing a zip shaped to do harm (an entry whose name
// climbs out of its folder, an entry that unpacks a thousand times its size, too many entries) and
// anything that is not a backup. Raster images are decoded with a stand-in here (Node has no
// createImageBitmap); SVG cleaning is checked in a browser by svg-clean.test.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const { FILRODENSWMB } = await import("../../src/config.js");
const { Backup } = await import("../../src/data/Backup.js");
const { MapPackage } = await import("../../src/data/MapPackage.js");
const { MapImport } = await import("../../src/data/MapImport.js");
const { ImageCheck } = await import("../../src/data/ImageCheck.js");
const { ImportRefusal } = await import("../../src/data/Sanitize.js");
const { zipSync, strToU8 } = await import("../../vendor/fflate/fflate.js");

const refusedFor = (reason) => (error) => error instanceof ImportRefusal && error.reason === reason;
const CHECK = { decode: async () => ({ width: 4, height: 4, close() {} }) };

/** A tiny "PNG": the signature and a marker byte, which the stand-in decoder accepts. */
const png = (marker) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker]);
const dataUrl = (bytes) => ImageCheck.toDataUrl(bytes, "png");

/** A small saved map with a decoration, a reference image and pins on a custom icon. */
function savedMap({ id = "mapAAAAAAAAAAAAA", decoration = "worlds/w/deco.png", reference = "worlds/w/ref.png" } = {}) {
    const base = JSON.parse(readFileSync(new URL("./fixtures/fwmb_eldoria.json", import.meta.url), "utf8"));
    return {
        ...base,
        mapDecorations: [{ id: "decoAAAAAAAAAAAA", type: "decoration", name: "Rose", src: decoration, x: 1, y: 1, rotation: 0, scale: 1, visibility: "all" }],
        reference: { src: reference, alpha: 0.4, scale: 2, x: 10, y: 20 },
        mapPins: [{ id: "pinAAAAAAAAAAAAA", name: "Harbour", icon: "iconOldAAAAAAAAA", x: 5, y: 5, visibility: "all" }],
        customPinStyles: [{ id: "pinStyleAAAAAAAA", name: "Port", icon: "iconOldAAAAAAAAA", scale: 1, color: "#ffffff" }],
        parentId: null,
        _id: id,
    };
}

/** A host's images by path, for `read`; and a host that keeps images by remembering them. */
function host() {
    const files = new Map([
        ["worlds/w/deco.png", png(1)],
        ["worlds/w/ref.png", png(2)],
        ["worlds/w/icon.png", png(3)],
    ]);
    const kept = [];
    const icons = [{ id: "iconOldAAAAAAAAA", name: "Anchor", path: "worlds/w/icon.png" }];
    return {
        files,
        kept,
        icons,
        read: async (src) => (src.startsWith("data:") ? ImageCheck.dataUrlBytes(src) : (files.get(src) ?? null)),
        keep: async (bytes, type, hash) => {
            kept.push(hash);
            return `worlds/other/fwmb-assets/${hash}.png`;
        },
        registry: {
            entries: [],
            list() {
                return this.entries;
            },
            async add(entry) {
                const added = { id: `iconNew${this.entries.length}AAAAAAAA`.slice(0, 16), ...entry };
                this.entries.push(added);
                return added;
            },
        },
    };
}

// ------------------------------------------------------------------ MapPackage

test("embed carries every image in the file; resolve stores each the host's way and moves pins to the icon it adds", async () => {
    const from = host();
    const map = savedMap();
    const { file, missing } = await MapPackage.prepare({ mapData: map, name: "Harbour", icons: from.icons, mode: "embed", read: from.read });
    assert.equal(missing, 0);
    assert.ok(file.mapDecorations[0].src.startsWith("data:image/png;base64,"));
    assert.ok(file.reference.src.startsWith("data:image/png;base64,"));
    assert.deepEqual(file.pinIcons.map((icon) => [icon.id, icon.name, icon.src.slice(0, 22)]), [["iconOldAAAAAAAAA", "Anchor", "data:image/png;base64,"]]);
    assert.equal(map.mapDecorations[0].src, "worlds/w/deco.png", "the saved map is left as it was");

    const to = host();
    const { mapData, pinIcons, name } = MapImport.read(JSON.parse(JSON.stringify(file)));
    assert.equal(name, "Harbour");
    const result = await MapPackage.resolve({ mapData, pinIcons, keep: to.keep, icons: to.registry, check: CHECK });
    assert.equal(result.missing, 0);
    assert.match(mapData.mapDecorations[0].src, /^worlds\/other\/fwmb-assets\/[0-9a-f]{32}\.png$/);
    assert.match(mapData.reference.src, /^worlds\/other\/fwmb-assets\/[0-9a-f]{32}\.png$/);
    assert.deepEqual({ alpha: mapData.reference.alpha, scale: mapData.reference.scale, x: mapData.reference.x }, { alpha: 0.4, scale: 2, x: 10 });
    assert.equal(to.registry.entries.length, 1);
    assert.equal(mapData.mapPins[0].icon, to.registry.entries[0].id);
    assert.equal(mapData.customPinStyles[0].icon, to.registry.entries[0].id);

    // The same icon arriving again is matched to the one already added, by its stored image
    const again = MapImport.read(JSON.parse(JSON.stringify(file)));
    await MapPackage.resolve({ mapData: again.mapData, pinIcons: again.pinIcons, keep: to.keep, icons: to.registry, check: CHECK });
    assert.equal(to.registry.entries.length, 1);
    assert.equal(again.mapData.mapPins[0].icon, to.registry.entries[0].id);
});

test("an image that cannot be read or fails its check is left out and counted, and its decoration goes", async () => {
    const from = host();
    from.files.delete("worlds/w/deco.png");
    const { file, missing } = await MapPackage.prepare({ mapData: savedMap(), icons: from.icons, mode: "embed", read: from.read });
    assert.equal(missing, 1);
    assert.ok(!("src" in file.mapDecorations[0]));

    file.reference.src = `data:image/png;base64,${Buffer.from("<html>not an image</html>").toString("base64")}`;
    const to = host();
    const { mapData, pinIcons } = MapImport.read(JSON.parse(JSON.stringify(file)));
    const result = await MapPackage.resolve({ mapData, pinIcons, keep: to.keep, icons: to.registry, check: CHECK });
    assert.equal(result.missing, 2);
    assert.deepEqual(mapData.mapDecorations, []);
    assert.equal(mapData.reference, null);
});

test("keep (Maps only) carries no images: paths stay, embedded images go", async () => {
    const from = host();
    const map = savedMap({ decoration: dataUrl(png(9)) });
    const { file, missing } = await MapPackage.prepare({ mapData: map, icons: from.icons, mode: "keep" });
    assert.equal(missing, 1);
    assert.ok(!("src" in file.mapDecorations[0]));
    assert.equal(file.reference.src, "worlds/w/ref.png");
    assert.equal(file.pinIcons[0].src, "worlds/w/icon.png");
});

// ------------------------------------------------------------------ Backup

test("a backup round-trips its maps, regional maps after their parents, with each image once", async () => {
    const from = host();
    const assets = new Map();
    const modelRun = { version: 1, run: "runAAAAAAAAAAAAA", cellCount: 1, cells: {} };
    const parent = await MapPackage.prepare({ mapData: savedMap(), modelRun, name: "World", icons: from.icons, mode: "assets", read: from.read, assets });
    const child = await MapPackage.prepare({ mapData: { ...savedMap(), parentId: "worldAAAAAAAAAAA" }, name: "Region", icons: from.icons, mode: "assets", read: from.read, assets });
    assert.equal(assets.size, 3, "the decoration, the reference and the icon, each once although both maps use them");
    assert.ok(parent.file.mapDecorations[0].src.startsWith("fwmb-asset:"));

    const bytes = Backup.pack({
        maps: [
            { id: "regionAAAAAAAAAA", name: "Region", parentId: "worldAAAAAAAAAAA", file: child.file },
            { id: "worldAAAAAAAAAAA", name: "World", parentId: null, file: parent.file },
        ],
        assets,
        app: "foundry",
        version: "4.0.0",
    });
    const backup = Backup.read(bytes);
    assert.equal(backup.app, "foundry");
    assert.deepEqual(
        backup.maps.map((map) => [map.id, map.name, map.parentId]),
        [
            ["regionAAAAAAAAAA", "Region", "worldAAAAAAAAAAA"],
            ["worldAAAAAAAAAAA", "World", null],
        ],
    );

    assert.deepEqual(backup.mapFile("worldAAAAAAAAAAA").modelRun, modelRun, "a map's model run travels in its file");
    assert.equal(backup.mapFile("regionAAAAAAAAAA").modelRun, undefined);

    const to = host();
    const restored = MapImport.read(backup.mapFile("regionAAAAAAAAAA"));
    assert.equal(restored.name, "Region");
    const result = await MapPackage.resolve({ mapData: restored.mapData, pinIcons: restored.pinIcons, assetBytes: backup.assetBytes, keep: to.keep, icons: to.registry, check: CHECK });
    assert.equal(result.missing, 0);
    assert.match(restored.mapData.mapDecorations[0].src, /^worlds\/other\/fwmb-assets\//);
    assert.equal(restored.mapData.parentId, "worldAAAAAAAAAAA", "the importer keeps the parent's id; the restore remaps it");
    assert.match(Backup.fileName(new Date("2026-10-21T10:00:00Z")), /^fwmb-maps-2026-10-21\.zip$/);
});

test("a zip with an entry whose name climbs out of its folder is refused before anything is unpacked", () => {
    const manifest = strToU8(JSON.stringify({ format: 1, maps: [], assets: [] }));
    for (const name of ["../../evil.json", "maps/../../evil.json", "maps\\evil.json", "/etc/passwd", "elsewhere/map.json", "maps/a b.json"]) {
        const bytes = zipSync({ "manifest.json": manifest, [name]: strToU8("{}") });
        assert.throws(() => Backup.read(bytes), refusedFor("damaged"), name);
    }
});

test("a zip bomb (an entry unpacking to a thousand times its size) is refused before it is inflated", () => {
    const manifest = strToU8(JSON.stringify({ format: 1, maps: [{ id: "mapAAAAAAAAAAAAA", name: "Bomb", parentId: null }], assets: [] }));
    const zeros = new Uint8Array(20 * 1048576);
    const bytes = zipSync({ "manifest.json": manifest, "maps/mapAAAAAAAAAAAAA.json": [zeros, { level: 9 }] });
    assert.ok(zeros.length / bytes.length > 1000, `the entry packs at ${Math.round(zeros.length / bytes.length)}:1`);
    assert.throws(() => Backup.read(bytes), refusedFor("tooLarge"));
});

test("too many entries, too large a file, and files that are not backups are refused", () => {
    const manifest = strToU8(JSON.stringify({ format: 1, maps: [], assets: [] }));
    const many = { "manifest.json": manifest };
    for (let i = 0; i < 20; i++) many[`maps/map${String(i).padStart(13, "0")}.json`] = strToU8("{}");
    const before = FILRODENSWMB.LIMITS.BACKUP.ENTRIES;
    FILRODENSWMB.LIMITS.BACKUP.ENTRIES = 10;
    try {
        assert.throws(() => Backup.read(zipSync(many)), refusedFor("tooLarge"));
    } finally {
        FILRODENSWMB.LIMITS.BACKUP.ENTRIES = before;
    }
    assert.throws(() => Backup.read(new TextEncoder().encode("not a zip at all")), refusedFor("notBackup"));
    assert.throws(() => Backup.read(zipSync({ "maps/mapAAAAAAAAAAAAA.json": strToU8("{}") })), refusedFor("notBackup"), "no manifest");
    assert.throws(() => Backup.read(zipSync({ "manifest.json": strToU8(JSON.stringify({ format: 99, maps: [] })) })), refusedFor("notBackup"));
    assert.throws(() => Backup.read(zipSync({ "manifest.json": strToU8(JSON.stringify({ format: 1, maps: [{ id: "a.b" }] })) })), refusedFor("damaged"));

    // A manifest's __proto__ pollutes nothing, and a map listed without its file is left out
    const listed = Backup.read(zipSync({ "manifest.json": strToU8('{"__proto__":{"polluted":true},"format":1,"maps":[{"id":"mapAAAAAAAAAAAAA","name":"Gone"}],"assets":[]}') }));
    assert.equal({}.polluted, undefined);
    assert.deepEqual(listed.maps, []);
    assert.throws(() => listed.mapFile("mapAAAAAAAAAAAAA"), refusedFor("notMap"));
});
