// Foundry's image storage for imports (src/platform/foundry/assets.js): an image is uploaded once
// into the world's own fwmb-assets folder, named by its hash, the folder made when it is missing;
// an image already there is not uploaded again; a failed upload is an error, not a path.
import assert from "node:assert/strict";
import { test } from "node:test";

const calls = [];
let failUploads = false;
globalThis.game = { world: { id: "myworld" } };
globalThis.foundry = {
    utils: { getRoute: (path) => `/${path}` },
    applications: {
        apps: {
            FilePicker: {
                implementation: {
                    browse: async (source, target) => {
                        calls.push(["browse", target]);
                        throw new Error("no such folder");
                    },
                    createDirectory: async (source, target) => calls.push(["create", target]),
                    upload: async (source, folder, file) => {
                        calls.push(["upload", folder, file.name, file.type]);
                        return failUploads ? false : { path: `${folder}/${file.name}` };
                    },
                },
            },
        },
    },
};

const { foundryAssets } = await import("../../src/platform/foundry/assets.js");
const HASH = "0123456789abcdef0123456789abcdef";

test("an imported image is uploaded once, into the world's fwmb-assets folder, named by its hash", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    assert.equal(await foundryAssets.keep(bytes, "webp", HASH), `worlds/myworld/fwmb-assets/${HASH}.webp`);
    assert.equal(await foundryAssets.keep(bytes, "webp", HASH), `worlds/myworld/fwmb-assets/${HASH}.webp`);
    assert.deepEqual(calls, [
        ["browse", "worlds/myworld/fwmb-assets"],
        ["create", "worlds/myworld/fwmb-assets"],
        ["upload", "worlds/myworld/fwmb-assets", `${HASH}.webp`, "image/webp"],
    ]);
});

test("a failed upload is an error, so the image is left out rather than pointing at nothing", async () => {
    failUploads = true;
    await assert.rejects(foundryAssets.keep(new Uint8Array([4]), "png", "fedcba9876543210fedcba9876543210"), /upload/);
    failUploads = false;
});

test("an embedded image is read from its data URL; a path is fetched from the world's data", async () => {
    assert.deepEqual([...(await foundryAssets.read("data:image/png;base64,AQID"))], [1, 2, 3]);
    globalThis.fetch = async (url) => ({ ok: url === "/worlds/myworld/a.png", arrayBuffer: async () => new Uint8Array([9]).buffer });
    assert.deepEqual([...(await foundryAssets.read("worlds/myworld/a.png"))], [9]);
    assert.equal(await foundryAssets.read("worlds/myworld/missing.png"), null);
});
