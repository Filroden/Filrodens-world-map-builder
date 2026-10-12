import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { copyFiles } from "./copy.mjs";
import fs from "fs";

// design/ holds internal work (prototypes, harnesses, notes). A local pack keeps it, because the
// test Foundry runs the module from dist/ and the prototypes are opened from there. A release
// pack (CI is set on GitHub Actions) leaves it out, so the release zip never carries it even
// though the folder is also gitignored and absent from a CI checkout.
const isRelease = Boolean(process.env.CI);
const excludedFolders = ["dist", "node_modules", ".git", ".github", "scripts", "tests", "wiki"];
if (isRelease) excludedFolders.push("design");

if (fs.existsSync("./dist")) {
    fs.rmSync("./dist", { recursive: true });
}

copyFiles(".", "./dist", ["js", "json", "css", "hbs", "svg", "md", "html", "mjs"], [], excludedFolders, ["package.json", "package-lock.json", "GEMINI.md", ".DS_Store", ".gitignore", ".gitattributes"])
    .then(() => {
        console.log("File copy operation completed successfully!");
    })
    .catch((error) => {
        console.error("Error during file copy operation:", error);
        process.exit(1);
    });
