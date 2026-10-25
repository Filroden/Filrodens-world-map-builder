// Writes the video's shooting scripts (tests/tutorial/scripts/<nn>-<slug>.md) from the tutorial's
// step files, without running the studio: npm run tutorial:script. tutorial:build writes them too.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pageStem, videoScript } from "./lib/emit.mjs";
import { loadPages, PATHS } from "./run.mjs";

mkdirSync(PATHS.scripts, { recursive: true });
for (const page of await loadPages()) {
    writeFileSync(join(PATHS.scripts, `${pageStem(page)}.md`), videoScript(page, page.source));
    console.log(`scripts/${pageStem(page)}.md`);
}
