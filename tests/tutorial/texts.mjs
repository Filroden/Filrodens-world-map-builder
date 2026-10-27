// Writes the tutorial's texts from its step files, without running the studio: each page's wiki
// page (wiki/Tutorial-<nn>-<Title>.md) and video shooting script (tests/tutorial/scripts/<nn>-<slug>.md).
// npm run tutorial:texts. tutorial:build writes them too, for every page, since a page's text
// depends on its neighbours (its Start from and Next links, and the page count).
import { loadPages, writeTexts } from "./run.mjs";

const pages = await loadPages();
for (const page of pages) writeTexts(page, pages);
console.log(`Wrote the wiki page and video script of ${pages.length} pages.`);
