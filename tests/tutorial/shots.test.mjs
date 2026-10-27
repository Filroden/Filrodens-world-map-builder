// The wiki's screenshot list (tests/tutorial/shots): every `<!-- screenshot: <slug> | ... -->`
// comment in a wiki page has a shot in that page's shots file and every shot a comment, a picture
// supplied from Foundry is there, and putting the images in a page is the same however often it
// runs. Playing the shots needs Chromium and is done by hand (npm run tutorial:shots); this needs
// neither, and checks the list against the wiki only where the wiki's repository is checked out.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PATHS } from "./run.mjs";
import { commentSlugs, imageDir, loadShotPages, placeImages } from "./shots.mjs";

const pages = await loadShotPages();
const wikiHere = existsSync(join(PATHS.wiki, "Home.md"));

test("every shot has a slug and a caption, and every slug is used once", () => {
    const slugs = pages.flatMap(({ shots }) => shots.map((shot) => shot.slug));
    assert.equal(new Set(slugs).size, slugs.length, "a slug is used twice");
    for (const { page, shots } of pages) {
        for (const shot of shots) {
            assert.match(shot.slug, /^[a-z0-9-]+$/, `${page}: ${shot.slug}`);
            assert.ok(shot.caption?.trim(), `${page}: ${shot.slug} has no caption`);
            assert.ok(shot.provided || shot.screenshot || shot.exported, `${page}: ${shot.slug} says neither what to capture nor that it is supplied`);
        }
    }
});

test("the wiki's screenshot comments and the shots files match, page by page", { skip: !wikiHere && "the wiki is not checked out" }, () => {
    for (const { page, shots } of pages) {
        const file = join(PATHS.wiki, `${page}.md`);
        assert.ok(existsSync(file), `no wiki page ${page}.md for its shots file`);
        assert.deepEqual(commentSlugs(readFileSync(file, "utf8")).toSorted(), shots.map((shot) => shot.slug).toSorted(), page);
        for (const shot of shots.filter((each) => each.provided)) {
            assert.ok(existsSync(join(PATHS.wiki, "images", imageDir(page), `${shot.slug}.png`)), `${page}: the supplied picture ${shot.slug}.png is missing`);
        }
    }
});

test("putting the images in a page puts each under its comment, and again replaces it", () => {
    const shots = [{ slug: "a-shot", caption: "The caption." }];
    const page = "# Page\n\n<!-- screenshot: a-shot | what it shows -->\n\nText.\n";
    const once = placeImages(page, "My-Page", shots);
    assert.equal(once, "# Page\n\n<!-- screenshot: a-shot | what it shows -->\n\n![The caption.](images/my-page/a-shot.png)\n\n*The caption.*\n\nText.\n");
    assert.equal(placeImages(once, "My-Page", [{ ...shots[0], caption: "New." }]), once.replaceAll("The caption.", "New."));
    assert.equal(placeImages(once, "My-Page", shots), once);
});
